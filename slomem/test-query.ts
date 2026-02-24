import { queryCache } from './query';

const testGoals = [
    "on https://www.clutch.ca/ - find me 2019 to 2023 Toyota RAV4 with less than 60,000km",

    "go to animechrono.com and find the watch order for Attack on Titan",

    "on https://www.autotrader.ca/ - find me a 2021 Honda Civic",

    "go to https://chiaki.site  and find the watch order for Attack on Titan",
];

async function runTests() {
    for (const goal of testGoals) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`GOAL: ${goal}`);
        console.log('='.repeat(60));

        const result = await queryCache(goal);

        console.log(`\nRESULT: ${result.status}`);
        if (result.status === 'hit') {
            console.log(`URL: ${result.url}`);
            console.log(`URL Type: ${result.urlType}`);
            console.log(`Steps Skipped: ${result.stepsSkipped}`);
            console.log(`Confidence: ${(result.confidence! * 100).toFixed(1)}%`);
            console.log(`Source: ${result.sourceSessionId}`);
        }
    }
}

runTests().catch(console.error);
