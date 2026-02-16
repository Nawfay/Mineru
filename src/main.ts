import { setupBrowser } from './browser/setup';
import { runAgent } from './agent/runner';

// what we want the agent to do
const GOAL = "on https://www.autotrader.ca/ - get me to the list of all 2021 BMW 3 Series with less than 50,000km use L3s4a4 if needed as postcal code"

async function main() {
    const { browser, context } = await setupBrowser();
    const page = await context.newPage();
    
    await runAgent(page, GOAL);
    
    // await browser.close();
}

main().catch(console.error);