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
            return `[S:${el.id}] SCROLLABLE ${el.tag} (height: ${el.clientHeight}px, scrollable: ${el.scrollHeight}px) class="${el.className}" visible: "${el.visibleContent || ''}"`;
        }
        const parts = [`[${el.id}] ${el.tag}`];
        if (el.text) parts.push(`text="${el.text}"`);
        if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
        if (el.inputType) parts.push(`type="${el.inputType}"`);
        if (el.value) parts.push(`value="${el.value}"`);
        if (el.ariaLabel) parts.push(`aria-label="${el.ariaLabel}"`);
        if (el.title) parts.push(`title="${el.title}"`);
        if (el.role) parts.push(`role="${el.role}"`);
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
    1. NAVIGATION PRIORITY (IN ORDER OF PREFERENCE):
       a) SEARCH BAR FIRST: If you see a search bar or search input on the page, ALWAYS use it to navigate or search. Type the website name or search query, then press enter.
       b) Direct URL: If no search bar is available and you know the exact URL, use action "goToURL" with the full URL
       c) Clicking links: Only as a last resort if neither search bar nor direct URL works
       
       IMPORTANT: Search bars are the MOST RELIABLE way to navigate. Use them whenever available!
       
    2. Look at the screenshot. Identify the element that helps you reach the goal (or close a popup).
    3. If a popup/modal is blocking the view, your priority is to CLOSE it (look for an 'X' or 'Close' button).
    4. INTERACTING WITH INPUTS:
       - For text/number inputs: use action "type" with the elementId and value
       - After typing into a search box or form field, use action "press_enter" to submit (no elementId needed)
       - For combobox/button elements (role="combobox"): use action "click" to open them, then click the option you want
       - DO NOT try to type into buttons or comboboxes - always click them
    5. SELECTING FROM DROPDOWNS:
       - For select elements (native dropdowns), use action "select" with the elementId and the value/label you want
       - For custom dropdowns (comboboxes, scrollable lists):
         a) First CLICK the combobox button to open the dropdown
         b) If needed, scroll the container using "scroll_element" to find your option
         c) Then CLICK the option you want (like "2021")
       - Example workflow: {"action": "click", "elementId": 140} -> {"action": "click", "elementId": 27}
    6. SCROLLING STRATEGY:
       - If the target option (like "2021") is hidden in a scrollable list, use "scroll_element" on the BLUE tag (S:XX) to scroll that container
       - The visible content of scrollable areas is shown in the DOM summary - use this to know if you need to scroll
       - DO NOT use global scroll if a sidebar/modal exists; scroll the sidebar/modal directly using its BLUE tag
       - To scroll the MAIN PAGE: use action "scroll" with direction "down" or "up"
       - To scroll a SPECIFIC CONTAINER (modal, sidebar, dropdown list): use action "scroll_element" with the elementId (from BLUE tag) and direction "down" or "up"
    7. Use the DOM element details above to understand what each elemnt does (text, placeholder, aria-label, role, etc.)
    8. Return JSON ONLY (no markdown):
    
    {
        "thought": "brief reasoning",
        "action": "click" | "type" | "select" | "goToURL" | "scroll" | "scroll_element" | "press_enter" | "finished",
        "elementId": number (the number in the red/blue box - required for click/type/select/scroll_element),
        "value": string (if typing or selecting),
        "direction": "down" | "up" (if scrolling),
        "url": string (if using goToURL - use full URL like "https://example.com")
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
