import { Page } from 'playwright';
import { humanClick, humanType, humanSelect } from '../browser/interactions';
import { randomDelay } from '../utils/delays';
import { AgentDecision } from '../types';

// execute the action decided by the ai
export async function executeAction(
    page: Page,
    decision: AgentDecision,
    actionHistory: string[]
): Promise<void> {
    // track if we should scroll to top after this action
    let shouldScrollToTop = false;

    try {
        if (decision.action === 'navigate' || decision.action === 'goToURL') {
            await page.goto(decision.url!);
            actionHistory.push(`Navigated to ${decision.url}`);
            shouldScrollToTop = true;
        } 
        else if (decision.action === 'click') {
            const selector = `[data-agent-persist="${decision.elementId}"]`;
            if (await page.locator(selector).count() > 0) {
                // if the ai tries to click a <select>, use selectOption instead
                const tagName = await page.locator(selector).first().evaluate(el => el.tagName.toLowerCase());
                if (tagName === 'select') {
                    console.log("Auto-correcting click on <select> — native selects can't be clicked, using selectOption");
                    // the ai  usually mentions what it wants to pick but we can't select without a value, so log a warning
                    if (decision.value) {
                        await humanSelect(page, selector, decision.value);
                        actionHistory.push(`Selected "${decision.value}" in dropdown ID ${decision.elementId} (auto-corrected from click)`);
                    } else {
                        actionHistory.push(`Tried to click native <select> ID ${decision.elementId} but no value provided — use action "select" with a value next time`);
                        console.log("No value provided for <select> — agent needs to use 'select' action with a value");
                    }
                    shouldScrollToTop = true;
                } else {
                    await humanClick(page, selector);
                    actionHistory.push(`Clicked ID ${decision.elementId} (${decision.thought})`);
                    
                    const role = await page.locator(selector).first().evaluate(el => el.getAttribute('role'));
                    if (tagName === 'button' || role === 'combobox' || role === 'button') {
                        shouldScrollToTop = true;
                    }
                }
            } else {
                console.log("Element missing after tag removal. Retrying...");
            }
        } 
        else if (decision.action === 'type') {
            const selector = `[data-agent-persist="${decision.elementId}"]`;
            
            try {
                const autocompleteDetected = await humanType(page, selector, decision.value!);
                
                if (!autocompleteDetected) {
                    // only dispatch extra events for normal inputs (not autocomplete)
                    await page.evaluate((sel) => {
                        const el = document.querySelector(sel);
                        if (el) {
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                            el.dispatchEvent(new Event('blur', { bubbles: true }));
                        }
                    }, selector);
                }
                
                await randomDelay(200, 400);
                actionHistory.push(
                    autocompleteDetected
                        ? `Typed "${decision.value}" into ID ${decision.elementId} (autocomplete dropdown appeared — waiting for selection)`
                        : `Typed "${decision.value}" into ID ${decision.elementId}`
                );
            } catch (err: any) {
                // only if typing fails, check if it's a combobox and click instead
                if (err.message && err.message.includes('not an <input>')) {
                    console.log("Element is not typeable, clicking instead");
                    await humanClick(page, selector);
                    actionHistory.push(`Clicked ID ${decision.elementId} (not a typeable element)`);
                    shouldScrollToTop = true;
                } else {
                    throw err;
                }
            }
        }
        else if (decision.action === 'select') {
            const selector = `[data-agent-persist="${decision.elementId}"]`;
            await humanSelect(page, selector, decision.value!);
            actionHistory.push(`Selected "${decision.value}" in dropdown ID ${decision.elementId}`);
            shouldScrollToTop = true;
        }
        else if (decision.action === 'press_enter') {
            // press enter key to submit forms or search
            await page.keyboard.press('Enter');
            await randomDelay(500, 1000);
            actionHistory.push(`Pressed Enter key`);
            console.log("Pressed Enter to submit");
            shouldScrollToTop = true;
        }
        else if (decision.action === 'scroll_element') {
            // strip "S" cause ai sees scroll containers labeled as "S:104"
            const rawId = String(decision.elementId).replace(/^S:/i, '');

            const selector = `[data-agent-persist="${rawId}"]`;
            const element = page.locator(selector).first();
            
            if (await element.count() > 0) {
                // hover over element first
                await element.hover();
                
                // scroll up or down
                const deltaY = decision.direction === 'up' ? -400 : 400;
                
                await element.evaluate((el, dy) => el.scrollBy({ top: dy, behavior: 'smooth' }), deltaY);
                
                await randomDelay(1000, 1500);
                actionHistory.push(`Scrolled containr ${decision.elementId} ${decision.direction}`);
                console.log(`Scrolled container ${decision.elementId} ${decision.direction}`);
            } else {
                console.log("Scroll container not found");
            }
            // don't scroll to top for container scrolling
        }
        else if (decision.action === 'scroll') {
            const direction = decision.direction || 'down';
            const scrollAmount = direction === 'down' ? 800 : -800;
            
            await page.evaluate((amount) => {
                window.scrollBy({ top: amount, behavior: 'smooth' });
            }, scrollAmount);
            actionHistory.push(`Scrolled ${direction} (main page)`);
            console.log(`Scrolled ${direction} (main page)`);
            
            await randomDelay(500, 1000);
            // don't scroll to top for intentional scrolling
        }

        // if this was a filter-type action, scroll to top and wait for content
        if (shouldScrollToTop) {
            console.log("Waiting for page to update after action...");
            
            // wait for any network activity to settle
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
                console.log("Network didn't idle, continuing anyway");
            });
            
            // scroll to top to see new results
            await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
            await randomDelay(800, 1200);
            
            console.log("Scrolled to top after filter action");
        }
    } catch (err) {
        console.error("Action failed:", err);
    }
}
