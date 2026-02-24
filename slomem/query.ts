import Groq from 'groq-sdk';
import * as dotenv from 'dotenv';
import { getCollection } from './chroma-client';
import { CacheResult } from './types';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const DISTANCE_THRESHOLD = 1.2;

export async function queryCache(goal: string): Promise<CacheResult> {
    const urlMatch = goal.match(/https?:\/\/[^\s]+/);
    let goalDomain = '';
    if (urlMatch) {
        try {
            goalDomain = new URL(urlMatch[0]).hostname.replace('www.', '');
        } catch {}
    }

    const collection = await getCollection();
    const count = await collection.count();

    if (count === 0) {
        console.log('Cache is empty — no sessions ingested yet.');
        return { status: 'fallback' };
    }

    const results = await collection.query({
        queryTexts: [`domain: ${goalDomain} | goal: ${goal}`],
        nResults: 3
    });

    if (!results.documents[0] || results.documents[0].length === 0) {
        console.log('No similar sessions found.');
        return { status: 'fallback' };
    }

    const topDistance = results.distances![0][0]!;
    const topMeta = results.metadatas[0][0] as any;

    console.log(`\nTop match: distance=${topDistance.toFixed(3)}`);
    console.log(`  Domain: ${topMeta.domain}`);
    console.log(`  Goal: ${topMeta.originalGoal}`);
    console.log(`  Final URL: ${topMeta.finalUrl}`);
    console.log(`  Jump Point: ${topMeta.jumpPointUrl} (step ${topMeta.jumpPointStep})`);

    if (topDistance > DISTANCE_THRESHOLD) {
        console.log(`Distance ${topDistance.toFixed(3)} > threshold ${DISTANCE_THRESHOLD} — falling back.`);
        return { status: 'fallback' };
    }

    if (goalDomain && topMeta.domain !== goalDomain) {
        console.log(`Domain mismatch: ${goalDomain} vs ${topMeta.domain} — falling back.`);
        return { status: 'fallback' };
    }

    // try adapting the final url first
    console.log('\nTrying final url adaption...');
    const finalAdapted = await adaptUrl(goal, topMeta.originalGoal, topMeta.finalUrl);

    if (finalAdapted) {
        return {
            status: 'hit',
            url: finalAdapted,
            urlType: 'final',
            stepsSkipped: topMeta.stepCount,
            confidence: 1 - (topDistance / DISTANCE_THRESHOLD),
            sourceSessionId: results.ids[0][0]
        };
    }

    // final url wasnt adaptable so try the jump point
    if (topMeta.jumpPointUrl && topMeta.jumpPointUrl !== topMeta.finalUrl) {
        console.log('\nFinal URL not adaptable. Trying jump point...');
        const jumpAdapted = await adaptUrl(goal, topMeta.originalGoal, topMeta.jumpPointUrl);

        if (jumpAdapted) {
            return {
                status: 'hit',
                url: jumpAdapted,
                urlType: 'jump_point',
                stepsSkipped: topMeta.jumpPointStep,
                confidence: (1 - (topDistance / DISTANCE_THRESHOLD)) * 0.8, // slightly lower confidence
                sourceSessionId: results.ids[0][0]
            };
        }
    }

    return { status: 'fallback' };
}


// use groq to adapt a cached URL pattern to a new goal
async function adaptUrl(
    newGoal: string,
    cachedGoal: string,
    cachedUrl: string
): Promise<string | null> {
    const prompt = `You are a URL pattern adapter. You have a cached successful URL from a previous browser session.

Previous goal: "${cachedGoal}"
Previous result URL: "${cachedUrl}"

New goal: "${newGoal}"

Analyze the URL structure from the previous session and adapt it for the new goal.
- Identify the pattern (path segments, query params like ?q=, ?search=, ?make=, etc.)
- Apply the new goal's parameters to the same pattern
- URL-encode special characters in query params where needed
- If the new goal is too different to adapt (different site feature, different intent), return status "fallback"

Return ONLY JSON:
{
    "status": "success" | "fallback",
    "url": "https://...",
    "reasoning": "brief explanation"
}`;

    try {
        const completion = await groq.chat.completions.create({
            model: 'openai/gpt-oss-120b',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            response_format: { type: 'json_object' }
        });

        const response = JSON.parse(completion.choices[0].message.content || '{}');
        console.log(`  Adaptation: ${response.status} — ${response.reasoning}`);

        if (response.status === 'success' && response.url) {
            console.log(`  Adapted URL: ${response.url}`);
            return response.url;
        }
    } catch (e) {
        console.error('Groq adaptation error:', e);
    }

    return null;
}
    