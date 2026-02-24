import * as fs from 'fs';
import * as path from 'path';
import Groq from 'groq-sdk';
import * as dotenv from 'dotenv';
import { getCollection } from './chroma-client';
import { SessionMemory } from './types';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const DEBUG_OUTPUT_DIR = path.join(process.cwd(), 'debug-output');

// collect all URLs from a session in step order
function collectUrlChain(sessionDir: string, maxStep: number): { step: number; url: string }[] {
    const chain: { step: number; url: string }[] = [];
    const seen = new Set<string>();

    for (let i = 1; i <= maxStep; i++) {
        const urlPath = path.join(sessionDir, `step-${i}-url.txt`);
        if (!fs.existsSync(urlPath)) continue;

        const url = fs.readFileSync(urlPath, 'utf-8').trim();
        if (url && !seen.has(url)) {
            seen.add(url);
            chain.push({ step: i, url });
        }
    }

    return chain;
}

// ask groq to pick the best adaptable jump point from the URL chain
async function findJumpPoint(
    goal: string,
    urlChain: { step: number; url: string }[]
): Promise<{ url: string; step: number }> {
    // if only 1 URL, that's all we've got
    if (urlChain.length <= 1) {
        return { url: urlChain[0]?.url || '', step: urlChain[0]?.step || 1 };
    }

    const urlList = urlChain.map(u => `Step ${u.step}: ${u.url}`).join('\n');

    const prompt = `You are analyzing a browser automation session's URL history to find the best "jump point" — an intermediate URL that could be adapted for similar future goals.

Goal that was accomplished: "${goal}"

URLs visited (in order):
${urlList}

Pick the BEST jump point URL. A good jump point:
- Has query parameters or path segments that map to the goal's keywords (like ?q=SearchTerm, ?make=Honda, /search?query=...)
- Is adaptable — you could swap the search term or parameters for a different query
- Is as DEEP into the flow as possible while still being adaptable
- Is NOT just the homepage or a bare domain
- Is NOT a URL with opaque IDs that can't be derived from the goal (like /id/9253)

If the FINAL URL is adaptable (has meaningful query params or path segments), prefer it.
If the final URL has opaque IDs, look for an earlier search/filter URL.
If no URL is adaptable, return the final URL anyway.

Return ONLY JSON:
{
    "jumpPointUrl": "the best adaptable URL",
    "jumpPointStep": number,
    "reasoning": "why this URL is the best jump point"
}`;

    try {
        const completion = await groq.chat.completions.create({
            model: 'openai/gpt-oss-120b',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            response_format: { type: 'json_object' }
        });

        const response = JSON.parse(completion.choices[0].message.content || '{}');
        console.log(`  Jump point: Step ${response.jumpPointStep} — ${response.jumpPointUrl}`);
        console.log(`  Reasoning: ${response.reasoning}`);

        return {
            url: response.jumpPointUrl || urlChain[urlChain.length - 1].url,
            step: response.jumpPointStep || urlChain[urlChain.length - 1].step
        };
    } catch (e) {
        console.error('Jump point analysis error:', e);
        return { url: urlChain[urlChain.length - 1].url, step: urlChain[urlChain.length - 1].step };
    }
}

// parse a single session folder into a SessionMemory
async function parseSession(sessionDir: string): Promise<SessionMemory | null> {
    const sessionId = path.basename(sessionDir);

    const goalPath = path.join(sessionDir, 'refined-goal.json');
    if (!fs.existsSync(goalPath)) {
        console.log(`Skipping ${sessionId} — no refined-goal.json`);
        return null;
    }

    const goalData = JSON.parse(fs.readFileSync(goalPath, 'utf-8'));

    const files = fs.readdirSync(sessionDir);
    const stepNumbers = files
        .map(f => f.match(/^step-(\d+)-decision\.json$/))
        .filter(Boolean)
        .map(m => parseInt(m![1], 10));

    if (stepNumbers.length === 0) {
        console.log(`Skipping ${sessionId} — no steps found`);
        return null;
    }

    const maxStep = Math.max(...stepNumbers);

    const finalDecision = JSON.parse(
        fs.readFileSync(path.join(sessionDir, `step-${maxStep}-decision.json`), 'utf-8')
    );
    const success = finalDecision.action === 'finished';

    const finalUrlPath = path.join(sessionDir, `step-${maxStep}-url.txt`);
    const finalUrl = fs.existsSync(finalUrlPath)
        ? fs.readFileSync(finalUrlPath, 'utf-8').trim()
        : '';

    if (!finalUrl) {
        console.log(`Skipping ${sessionId} — no final URL`);
        return null;
    }

    let domain = '';
    try {
        domain = new URL(finalUrl).hostname.replace('www.', '');
    } catch {
        console.log(`Skipping ${sessionId} — invalid final URL`);
        return null;
    }

    // collect the full URL chain and find the best jump point
    const urlChain = collectUrlChain(sessionDir, maxStep);
    console.log(`\n  ${sessionId}: ${urlChain.length} unique URLs across ${maxStep} steps`);

    const jumpPoint = await findJumpPoint(goalData.originalGoal || goalData.refinedGoal, urlChain);

    return {
        sessionId,
        domain,
        originalGoal: goalData.originalGoal || '',
        refinedGoal: goalData.refinedGoal || '',
        finalUrl,
        jumpPointUrl: jumpPoint.url,
        jumpPointStep: jumpPoint.step,
        urlChain: urlChain.map(u => u.url),
        stepCount: maxStep,
        success,
        timestamp: goalData.timestamp || ''
    };
}

// scan all sessions and ingest into chroma
async function ingest() {
    if (!fs.existsSync(DEBUG_OUTPUT_DIR)) {
        console.log('No debug-output directory found.');
        return;
    }

    const sessions = fs.readdirSync(DEBUG_OUTPUT_DIR)
        .filter(d => d.startsWith('session-'))
        .map(d => path.join(DEBUG_OUTPUT_DIR, d));

    console.log(`Found ${sessions.length} sessions to process.`);

    const memories: SessionMemory[] = [];
    for (const sessionDir of sessions) {
        const mem = await parseSession(sessionDir);
        if (mem && mem.success) {
            memories.push(mem);
        }
    }

    console.log(`\n${memories.length} successful sessions to ingest.`);

    if (memories.length === 0) return;

    const collection = await getCollection();

    // delete all existing entries so we re-ingest with the new schema
    const existing = await collection.get();
    if (existing.ids.length > 0) {
        await collection.delete({ ids: existing.ids });
        console.log(`Cleared ${existing.ids.length} old entries.`);
    }

    // embed: domain + goal + final URL + jump point URL
    await collection.add({
        ids: memories.map(m => m.sessionId),
        documents: memories.map(m =>
            `domain: ${m.domain} | goal: ${m.originalGoal} | refined: ${m.refinedGoal} | result_url: ${m.finalUrl} | jump_point: ${m.jumpPointUrl}`
        ),
        metadatas: memories.map(m => ({
            domain: m.domain,
            originalGoal: m.originalGoal,
            refinedGoal: m.refinedGoal,
            finalUrl: m.finalUrl,
            jumpPointUrl: m.jumpPointUrl,
            jumpPointStep: m.jumpPointStep,
            stepCount: m.stepCount,
            timestamp: m.timestamp
        }))
    });

    console.log(`Ingested ${memories.length} sessions into ChromaDB.`);
}

ingest().catch(console.error);
