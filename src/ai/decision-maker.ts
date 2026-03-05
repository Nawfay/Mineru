import { groq } from './groq-client';
import { DecisionResult } from '../types';
import { PopupInfo } from '../browser/popup-detect';

// use text-based LLM to decide what to do next (no vision needed)
export async function determineAction(
    goal: string,
    accessibilityTree: string,
    history: string[],
    currentUrl: string,
    popup: PopupInfo
): Promise<DecisionResult> {
    const recentHistory = history.slice(-5);

    // build popup warning section
    let popupSection = '';
    if (popup.detected) {
        popupSection = `
⚠️ POPUP/MODAL DETECTED (type: ${popup.type})
${popup.closeHint}
You MUST dismiss this popup FIRST before doing anything else. The page content behind it is not accessible until the popup is closed. Look for a button labeled "close", "X", "dismiss", "accept", "got it", or similar in the accessibility tree above and click it.
`;
    }

    const prompt = `You are a browser automation agent. Goal: "${goal}"

CURRENT URL: ${currentUrl}
${popupSection}
PAGE STRUCTURE:
${accessibilityTree}

Elements with [N] are interactive — use the number as elementId.
Tags like <button>, <a>, <input>, <select> tell you the element type.
Attributes show state: value, checked, expanded, disabled, etc.
Text between tags is the visible label. Plain text lines are page content for context.

Recent actions:
${recentHistory.length > 0 ? recentHistory.join('\n') : '(none)'}

RULES:
1. POPUPS FIRST: If a popup/modal is detected, dismiss it before anything else.
2. NAVIGATION: Prefer search bars > direct URL > clicking links.
3. INTERACTIONS:
   - <input>: "type" with elementId + value
   - <button>/<a>: "click" with elementId
   - <select> expanded=false: "click" to open, then click the option
   - <select> with native options: "select" with elementId + option label
   - checkbox/radio: "click" to toggle
4. COLLAPSED SECTIONS: If a <button> shows expanded=false, its content is HIDDEN. You MUST click it to expand first before interacting with anything inside that section. Do NOT skip this step.
5. SCROLLING: "scroll" + direction for page, "scroll_element" + elementId for containers. Check scroll position at top of tree.
6. SLIDERS: Type into the associated text input instead.

Return JSON ONLY:
{
    "thought": "brief reasoning",
    "action": "click" | "type" | "select" | "goToURL" | "scroll" | "scroll_element" | "press_enter" | "finished",
    "elementId": number,
    "value": string,
    "direction": "down" | "up",
    "url": string
}`;

    try {
        const completion = await groq.chat.completions.create({
            // model: "meta-llama/llama-4-maverick-17b-128e-instruct",
            // model: "llama-3.3-70b-versatile",
            model: "openai/gpt-oss-120b",
            messages: [
                {
                    role: "user",
                    content: prompt + "\n\n" + prompt // prompt repetition: lets every token attend to every other token
                }
            ],
            temperature: 0,
            response_format: { type: "json_object" }
        });

        const response = completion.choices[0].message.content || "{}";

        return {
            decision: JSON.parse(response),
            prompt: prompt,
            response: response
        };
    } catch (e) {
        console.error("Groq Error:", e);
        return {
            decision: { action: "error", thought: `Error: ${e}` },
            prompt: prompt,
            response: `Error: ${e}`
        };
    }
}
