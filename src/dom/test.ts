import { chromium } from 'playwright';
import { DOMExtractor } from './extractor';
import * as fs from 'fs';
import * as path from 'path';

const TEST_URL = process.argv[2] || 'https://news.ycombinator.com';

async function main() {
    console.log('Launching browser...');

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
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 900 },
    });

    const page = await context.newPage();

    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    console.log(`Navigating to ${TEST_URL}...`);
    await page.goto(TEST_URL);
    await page.waitForTimeout(2000);

    console.log('Extracting DOM...\n');
    const extractor = new DOMExtractor(page);
    const result = await extractor.extract();

    console.log('=== LLM Representation ===\n');
    console.log(result.llmRepresentation);

    console.log('\n=== Selector Map ===\n');
    for (const [index, entry] of result.selectorMap) {
        console.log(`[${index}] ${entry.tagName} — css: ${entry.cssSelector} — hint: "${entry.textHint}"`);
    }
    console.log(`\nTotal interactive elements: ${result.selectorMap.size}`);

    // Save to file
    const outDir = path.resolve(__dirname, '../../debug-output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, 'dom-extraction-test.txt');
    const content = [
        `URL: ${TEST_URL}`,
        `Timestamp: ${new Date().toISOString()}`,
        `Interactive elements: ${result.selectorMap.size}`,
        '',
        '=== LLM Representation ===',
        result.llmRepresentation,
        '',
        '=== Selector Map ===',
        ...Array.from(result.selectorMap.entries()).map(
            ([i, e]) => `[${i}] ${e.tagName} — css: ${e.cssSelector} — hint: "${e.textHint}"`
        ),
    ].join('\n');

    fs.writeFileSync(outFile, content);
    console.log(`\nSaved to: ${outFile}`);

    await browser.close();
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
