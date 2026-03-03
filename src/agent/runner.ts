import { Page } from 'playwright';
import { getAccessibilityTree, tagInteractiveElements, showVisualTags, removeVisualTags } from '../browser/dom-tree';
import { determineAction } from '../ai/decision-maker';
import { determineStartingPage } from '../ai/starting-prompt';
import { executeAction } from './actions';
import { createSessionDir, saveDebugData } from '../utils/debug';
import { randomDelay } from '../utils/delays';
import { MAX_STEPS } from '../config/constants';
import { detectPopup } from '../browser/popup-detect';

// main agent loop
export async function runAgent(page: Page, goal: string): Promise<void> {
    let actionHistory: string[] = [];
    let stepCount = 0;

    console.log("Agent starting...");
    const sessionDir = createSessionDir();

    // let ai decide the best starting page and refine the goal
    console.log("Determining best starting page...");
    const { url: startingUrl, refinedGoal } = await determineStartingPage(goal, sessionDir);

    // use refined goal for the rest of the session
    const activeGoal = refinedGoal;

    // navigate to starting page
    await page.goto(startingUrl);

    while (stepCount < MAX_STEPS) {
        stepCount++;
        console.log(`\n--- Step ${stepCount} ---`);

        // wait for page to load
        await page.waitForLoadState('domcontentloaded');
        await randomDelay(800, 1500);

        // get accessibility tree (replaces screenshot + DOM tagging)
        const { tree, interactiveElements, treeText } = await getAccessibilityTree(page);
        console.log(`Found ${interactiveElements.length} interactive elements via accessibility tree.`);

        // tag elements in the DOM so we can interact with them via data-agent-persist
        await tagInteractiveElements(page, tree);

        // detect popups/modals and tell the LLM
        const popup = await detectPopup(page);
        if (popup.detected) {
            console.log(`⚠️ Popup detected: ${popup.type} — ${popup.closeHint}`);
        }

        // show visual debug tags on the page (numbered overlays)
        await showVisualTags(page, tree);

        // take screenshot for debug only (not sent to LLM)
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 50 });

        // remove visual tags before executing actions
        await removeVisualTags(page);

        // ask ai what to do next (text-only, no vision)
        await randomDelay(500, 1000);
        const result = await determineAction(
            activeGoal,
            treeText,
            actionHistory,
            page.url(),
            popup
        );
        const decision = result.decision;
        console.log("Decision:", decision);

        saveDebugData(
            stepCount,
            screenshot,
            interactiveElements,
            decision,
            page.url(),
            result.prompt,
            result.response
        );

        if (decision.action === 'finished') {
            console.log("Goal achieved!");
            break;
        }

        await executeAction(page, decision, actionHistory);
    }

    console.log("Session ended.");
}
