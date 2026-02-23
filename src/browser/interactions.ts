import { Page } from 'playwright';
import { randomDelay } from '../utils/delays';

// simulate human clicking behavior
export async function humanClick(page: Page, selector: string) {
    const element = page.locator(selector).first();
    await element.scrollIntoViewIfNeeded(); 
    await randomDelay(300, 700);
    
    // move mouse to center of element
    const box = await element.boundingBox();
    if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
    }
    await element.click();
}

const AUTOCOMPLETE_SELECTORS = '.ui-autocomplete, [role="listbox"], [class*="autocomplete"], [class*="suggestion"], .tt-menu, .awesomplete > ul, .pac-container';

// type like a human with delays
// automatically detects if an autocomplete dropdown appears and skips blur if so
export async function humanType(page: Page, selector: string, text: string): Promise<boolean> {
    const element = page.locator(selector).first();
    
    await element.scrollIntoViewIfNeeded();
    await randomDelay(200, 500);
    
    await element.focus();
    await randomDelay(100, 200);
    
    // select all existing text
    await element.click({ clickCount: 3 });
    await randomDelay(100, 200);
    
    // Meta+A is for mac, Ctrl+A for windows
    await page.keyboard.press('Meta+A');
    await randomDelay(100, 200);
    
    await page.keyboard.press('Backspace');
    await randomDelay(100, 200);
    
    // clear field
    await element.fill('');
    await randomDelay(100, 200);
    
    // type character by character
    await element.pressSequentially(text, { delay: 75 });
    await randomDelay(200, 400);
    
    // check if an autocomplete dropdown appeared
    let autocompleteDetected = false;
    try {
        await page.waitForSelector(AUTOCOMPLETE_SELECTORS, { state: 'visible', timeout: 2000 });
        autocompleteDetected = true;
        console.log('Autocomplete dropdown detected — skipping blur to keep it open');
        await randomDelay(300, 600);
    } catch {
        // no dropdown appeared, normal input — blur as usual
        await element.blur();
        await randomDelay(100, 200);
    }
    
    return autocompleteDetected;
}

// select from native dropdown (select element)
export async function humanSelect(page: Page, selector: string, value: string) {
    const element = page.locator(selector).first();
    
    await element.scrollIntoViewIfNeeded();
    await randomDelay(300, 700);
    
    // playwright handles native dropdowns automatically
    // you can select by value, label, or index
    await element.selectOption(value);
    
    await randomDelay(200, 400);
}

