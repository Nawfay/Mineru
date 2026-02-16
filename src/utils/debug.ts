import * as fs from 'fs';
import * as path from 'path';
import { DOMElement, AgentDecision } from '../types';

let sessionDir: string | null = null;

// create a new folder for this session
export function createSessionDir(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    sessionDir = path.join(process.cwd(), 'debug-output', `session-${timestamp}`);
    
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    console.log(`Created sesion directory: ${sessionDir}`);
    return sessionDir;
}

// save all debug info for this step
export function saveDebugData(
    stepCount: number,
    screenshot: Buffer,
    interactiveMap: DOMElement[],
    decision: AgentDecision,
    url: string,
    prompt: string,
    response: string
) {
    if (!sessionDir) {
        throw new Error('Session directory not initialized. Call createSessionDir() first.');
    }
    
    // save screenshot
    
    fs.writeFileSync(
        path.join(sessionDir, `step-${stepCount}-screenshot.jpg`),
        screenshot
    );
    
    // save dom elements
    fs.writeFileSync(
        path.join(sessionDir, `step-${stepCount}-elements.json`),
        JSON.stringify(interactiveMap, null, 2)
    );
    
    // save ai decision
    fs.writeFileSync(
        path.join(sessionDir, `step-${stepCount}-decision.json`),
        JSON.stringify(decision, null, 2)
    );
    
    // save current url
    fs.writeFileSync(
        path.join(sessionDir, `step-${stepCount}-url.txt`),
        url
    );
    
    // save prompt sent to ai
    fs.writeFileSync(
        path.join(sessionDir, `step-${stepCount}-prompt.txt`),
        prompt
    );
    
    // save ai response
    fs.writeFileSync(
        path.join(sessionDir, `step-${stepCount}-response.json`),
        response
    );
    
    console.log(`Debug data saved for step ${stepCount}`);
}
