import { Page } from 'playwright';
import { tagPage, removeTags } from '../browser/tagging';
import { determineAction } from '../ai/decision-maker';
import { determineStartingPage } from '../ai/starting-prompt';
import { executeAction } from './actions';
import { createSessionDir, getSessionDir, saveDebugData } from '../utils/debug';
import { randomDelay } from '../utils/delays';
import { MAX_STEPS } from '../config/constants';

// main agent loop
export async function runAgent(page: Page, originalGoal: string): Promise<void> {
    let actionHistory: string[] = [];
    let stepCount = 0;

    console.log("Agent starting...");
    const sessionDir = createSessionDir();
    
    // refine goal and determine starting page
    console.log("Planning phase...");
    const { url: startingUrl, refinedGoal: goal } = await determineStartingPage(originalGoal, sessionDir);
    
    // navigate to starting page
    await page.goto(startingUrl);

    while (stepCount < MAX_STEPS) {
        stepCount++;
        console.log(`\n--- Step ${stepCount} ---`);

        // wait for page to load
        await page.waitForLoadState('domcontentloaded');
        await randomDelay(1000, 2000);

        // tag all interactive elements
        const interactiveMap = await tagPage(page);
        console.log(`Found ${interactiveMap.length} interacitve elements.`);

        // take screenshot for vision model
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 50 });
        const base64 = screenshot.toString('base64');

        // ask ai what to do next
        await randomDelay(1000, 2000);
        const result = await determineAction(goal, base64, actionHistory, interactiveMap);
        const decision = result.decision;
        console.log("Decision:", decision);

        saveDebugData(
            stepCount,
            screenshot,
            interactiveMap,
            decision,
            page.url(),
            result.prompt,
            result.response
        );

        await removeTags(page);

        if (decision.action === 'finished') {
            console.log("Goal acheived!");
            break;
        }

        await executeAction(page, decision, actionHistory);
    }

    console.log("Session ended.");
}
