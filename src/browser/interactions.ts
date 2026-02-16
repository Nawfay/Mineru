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

// type like a human with delays
export async function humanType(page: Page, selector: string, text: string) {
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
}
