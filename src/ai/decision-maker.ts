import { groq } from './groq-client';
import { DOMElement, DecisionResult } from '../types';

// use vision model to decide what to do next
export async function determineAction(
    goal: string, 
    screenshotBase64: string, 
    history: string[], 
    domElements: DOMElement[]
): Promise<DecisionResult> {
    // only keep last 5 actions
    const recentHistory = history.slice(-5);
    
    // create readable summary of dom elements
    const domSummary = domElements.map(el => {
        if (el.type === 'scroll-container') {
            return `[S:${el.id}] SCROLLABLE ${el.tag} (height: ${el.clientHeight}px, scrollable: ${el.scrollHeight}px) class="${el.className}"`;
        }
        const parts = [`[${el.id}] ${el.tag}`];
        if (el.text) parts.push(`text="${el.text}"`);
        if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
        if (el.inputType) parts.push(`type="${el.inputType}"`);
        if (el.value) parts.push(`value="${el.value}"`);
        if (el.ariaLabel) parts.push(`aria-label="${el.ariaLabel}"`);
        if (el.title) parts.push(`title="${el.title}"`);
        return parts.join(' ');
    }).join('\n');

    const prompt = `
    You are a browser automation agent. Goal: "${goal}".
    
    Attached is a screenshot of the curent page.
    - RED LABELS (e.g. "5"): Clickable elements (Buttons, Links, Inputs).
    - BLUE LABELS (e.g. "S:12"): SCROLLABLE AREAS (Sidebars, Lists, Modals).
    
    DOM ELEMENTS (with details):
    ${domSummary}
    
    Recent Action History (last 5 actions):
    ${recentHistory.join('\n')}

    INSTRUCTIONS:
    1. Look at the screenshot. Identify the element that helps you reach the goal (or close a popup).
    2. If a popup/modal is blocking the view, your priority is to CLOSE it (look for an 'X' or 'Close' button).
    3. TYPING INTO INPUT FIELDS:
       - When you see input fields with type="text" or type="number", you can type directly into them
       - Look for input fields showing current values (e.g., "2015", "2026") that need to be changed
       - Use action "type" with the elementId of the input field and the value you want to enter
    4. SCROLLING STRATEGY:
       - If the target option (like a specific filter) is hidden in a list, use "scroll_element" on the BLUE tag enclosing it.
       - DO NOT use global scroll if a sidebar/modal exists; scroll the sidebar/modal directly using its BLUE tag.
       - To scroll the MAIN PAGE: use action "scroll" with direction "down" or "up"
       - To scroll a SPECIFIC CONTAINER (modal, sidebar, list): use action "scroll_element" with the elementId (from BLUE tag) and direction "down" or "up"
    5. Use the DOM element details above to understand what each elemnt does (text, placeholder, aria-label, etc.)
    6. Return JSON ONLY (no markdown):
    
    {
        "thought": "brief reasoning",
        "action": "click" | "type" | "navigate" | "scroll" | "scroll_element" | "finished",
        "elementId": number (the number in the red/blue box - required for click/type/scroll_element),
        "value": string (if typing),
        "direction": "down" | "up" (if scrolling),
        "url": string (if navigating)
    }
    `;

    try {
        const completion = await groq.chat.completions.create({
            model: "meta-llama/llama-4-maverick-17b-128e-instruct",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` } }
                    ]
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
