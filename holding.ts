import { chromium, Page } from 'playwright';
import Groq from 'groq-sdk';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// The specific user goal
const GOAL = "Navigate to clutch.ca. Find all 2021 BMW 3 Series with less than 50,000 km.";

// Realistic user agents
const USER_AGENTS = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

// Helper: Random delay to simulate human behavior
function randomDelay(min: number = 500, max: number = 2000): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

// Helper: Human-like mouse movement
async function humanClick(page: Page, selector: string) {
    const element = page.locator(selector).first();
    await element.scrollIntoViewIfNeeded();
    await randomDelay(300, 800);
    await element.click();
}

// Helper: Human-like typing
async function humanType(page: Page, selector: string, text: string) {
    const element = page.locator(selector).first();
    await element.scrollIntoViewIfNeeded();
    await randomDelay(200, 500);
    await element.click();
    await randomDelay(100, 300);
    
    // Type character by character with random delays
    for (const char of text) {
        await element.pressSequentially(char, { delay: Math.random() * 100 + 50 });
    }
}

interface DOMElement {
    id: number;
    tag: string;
    text?: string;
    href?: string;
    placeholder?: string;
    label?: string;
}

// 1. The "Eyes": Scans the page for interactive elements
async function getInteractiveMap(page: Page): Promise<DOMElement[]> {
    return await page.evaluate(() => {
        const elements = document.querySelectorAll(
            'button, a, input, select, textarea, [role="button"], [role="link"]'
        );
        
        const map: any[] = [];
        let idCounter = 0;

        elements.forEach((el) => {
            const rect = el.getBoundingClientRect();
            // Filter out hidden/tiny elements to reduce noise
            if (rect.width < 5 || rect.height < 5 || window.getComputedStyle(el).visibility === 'hidden') return;

            // Assign a temp ID to the DOM element so we can target it later
            el.setAttribute('data-agent-id', idCounter.toString());

            let label = '';
            // Try to find a label for inputs
            if (el.tagName === 'INPUT') {
                const id = el.id;
                if (id) {
                    const labelEl = document.querySelector(`label[for="${id}"]`);
                    if (labelEl) label = (labelEl as HTMLElement).innerText;
                }
            }

            map.push({
                id: idCounter,
                tag: el.tagName.toLowerCase(),
                text: (el as HTMLElement).innerText?.slice(0, 50).replace(/\n/g, ' ').trim() || '',
                placeholder: (el as HTMLInputElement).placeholder || '',
                label: label,
                href: (el as HTMLAnchorElement).href || ''
            });
            idCounter++;
        });
        return map;
    });
}

// 2. The "Brain": Uses Groq to decide the next move
async function determineAction(goal: string, dom: DOMElement[], history: string[]) {
    const prompt = `
    You are an autonomous browser agent. Your goal is: "${goal}".
    
    Here is the history of your actions so far:
    ${history.join('\n')}

    Here is the list of interactive elements on the current screen:
    ${JSON.stringify(dom)}

    INSTRUCTIONS:
    1. Analyze the current state and the goal.
    2. Select the ONE most logical next element to interact with.
    3. Return a JSON object (NO markdown, NO comments) with the following format:
    
    {
        "thought": "Reasoning for why you are taking this action",
        "action": "click" | "type" | "navigate" | "finished",
        "elementId": number (required for click/type),
        "value": string (required for type, e.g. "BMW"),
        "url": string (required for navigate if not on the site yet)
    }

    If the goal is fully achieved (e.g. you see the search results), return "action": "finished".
    `;

    const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile", // High reasoning capability
        temperature: 0,
        response_format: { type: "json_object" }
    });

    return JSON.parse(completion.choices[0].message.content || "{}");
}

// Helper: Save debug data to files
async function saveDebugData(page: Page, stepCount: number, interactiveMap: DOMElement[]) {
    const debugDir = path.join(process.cwd(), 'debug-output');
    if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
    }

    // Save full HTML
    const html = await page.content();
    fs.writeFileSync(
        path.join(debugDir, `step-${stepCount}-page.html`),
        html,
        'utf-8'
    );

    // Save interactive elements map
    fs.writeFileSync(
        path.join(debugDir, `step-${stepCount}-elements.json`),
        JSON.stringify(interactiveMap, null, 2),
        'utf-8'
    );

    // Save screenshot
    await page.screenshot({
        path: path.join(debugDir, `step-${stepCount}-screenshot.png`),
        fullPage: true
    });

    console.log(`📁 Debug data saved for step ${stepCount}`);
}

// 3. The "Body": Executes the action
async function run() {
    // const browser = await chromium.launch({ headless: false }); // Watch it work
    const browser = await chromium.launch({ 
        headless: false,
        slowMo: 100,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox'
        ]
    });
    const page = await browser.newPage();
    
    // Set a realistic viewport size
    await page.setViewportSize({ width: 1280, height: 800 });

    let actionHistory: string[] = [];
    let stepCount = 0;
    const MAX_STEPS = 15;

    console.log("🚀 Agent Starting...");

    // Initial navigation (if needed)
    if (!actionHistory.length) {
        await page.goto('https://google.com'); // Start neutral or directly on target
    }

    while (stepCount < MAX_STEPS) {
        stepCount++;
        console.log(`\n--- Step ${stepCount} ---`);

        // Wait for network to settle slightly
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1000); // Small stability wait

        // 1. Observe
        const interactiveMap = await getInteractiveMap(page);
        console.log(`Found ${interactiveMap.length} interactive elements.`);

        // Save debug data
        await saveDebugData(page, stepCount, interactiveMap);

        // 2. Think
        const decision = await determineAction(GOAL, interactiveMap, actionHistory);
        console.log("🤖 Decision:", decision);

        if (decision.action === 'finished') {
            console.log("✅ Goal Achieved!");
            break;
        }

        // 3. Act
        try {
            if (decision.action === 'navigate') {
                await page.goto(decision.url);
                await randomDelay(1000, 2000);
                actionHistory.push(`Navigated to ${decision.url}`);
            } 
            else if (decision.action === 'click') {
                const selector = `[data-agent-id="${decision.elementId}"]`;
                await humanClick(page, selector);
                await randomDelay(500, 1500);
                actionHistory.push(`Clicked element ${decision.elementId} (${decision.thought})`);
            } 
            else if (decision.action === 'type') {
                const selector = `[data-agent-id="${decision.elementId}"]`;
                await humanType(page, selector, decision.value);
                await randomDelay(300, 800);
                await page.keyboard.press('Enter');
                await randomDelay(1000, 2000);
                actionHistory.push(`Typed "${decision.value}" into element ${decision.elementId}`);
            }
        } catch (err) {
            console.error("❌ Action failed:", err);
            actionHistory.push(`Failed to execute ${decision.action} on ${decision.elementId}`);
        }
    }

    console.log("🏁 Session ended.");
    // await browser.close(); // Keep open to inspect results
}

run();