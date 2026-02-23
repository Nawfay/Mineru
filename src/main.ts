import { setupBrowser } from './browser/setup';
import { runAgent } from './agent/runner';

// what we want the agent to do
// const GOAL = "on https://www.clutch.ca/ - get me to the list of all only from 2021 to 2021 BMW 3 Series with less than 50,000km"
// const GOAL = "go on www.last.fm/user/dishit79 and get user Dishit79 and find his top song of all time"
// const GOAL = "go to https://www.metro.ca/en and add the basic ingredients, step by step, to make chili for me to my cart"
const GOAL = "on https://www.clutch.ca/ - get me to the list of all only from 2010 to 2021 Honda CRV with less than 50,000km"

async function main() {
    const { browser, context } = await setupBrowser();
    const page = await context.newPage();
    
    console.log("Running with goal:", GOAL);
    await runAgent(page, GOAL);
    
    // await browser.close();
}

main().catch(console.error);