import { chromium, Browser, BrowserContext } from 'playwright';
import { USER_AGENTS, VIEWPORT } from '../config/constants';

// setup browser with human-like settings
export async function setupBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
    const browser = await chromium.launch({ 
        headless: false,
        slowMo: 100,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox'
        ]
    });
    
    const context = await browser.newContext({
        viewport: VIEWPORT,
        userAgent: USER_AGENTS[0]
    });

    return { browser, context };
}
