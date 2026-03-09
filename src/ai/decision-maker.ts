import { groq } from './groq-client';
import { DecisionResult } from '../types';

// use vision model to decide what to do next
export async function determineAction(
    goal: string, 
    screenshotBase64: string, 
    history: string[], 
    domRepresentation: string
): Promise<DecisionResult> {
    // only keep last 5 actions
    const recentHistory = history.slice(-5);

    const prompt = `
    You are a browser automation agent. Goal: "${goal}".
    
    Attached is a screenshot of the current page.
    
    Below is a structured DOM tree of the page. Interactive elements are marked with [N] where N is a numeric ID you can reference in your actions.
    Scrollable containers show scroll position info. Structural wrapper tags are collapsed — only meaningful content and interactive elements remain.
    
    PAGE DOM:
    ${domRepresentation}
    
    Recent Action History (last 5 actions):
    ${recentHistory.join('\n')}

    INSTRUCTIONS:
    1. NAVIGATION PRIORITY (IN ORDER OF PREFERENCE):
       a) SEARCH BAR FIRST: If you see a search bar or search input on the page, ALWAYS use it to navigate or search. Type the website name or search query, then press enter.
       b) Direct URL: If no search bar is available and you know the exact URL, use action "goToURL" with the full URL
       c) Clicking links: Only as a last resort if neither search bar nor direct URL works
       
       IMPORTANT: Search bars are the MOST RELIABLE way to navigate. Use them whenever available!
       
    2. READING THE DOM TREE:
       - Elements marked with [N] are interactive — use N as the elementId in your actions
       - The tree preserves page structure: attributes like placeholder, aria-label, role, href, value, type are shown inline
       - Scrollable containers show scroll info like "scroll=0.0↑ 2.5↓ 0%" meaning 0 pages above, 2.5 pages below, scrolled 0%
       - Structural wrappers (div, span, section, etc.) are collapsed — only meaningful content remains
       - Use the DOM tree to understand what each element does and find the right target
       
    3. Look at the screenshot AND the DOM tree together. Identify the element that helps you reach the goal (or close a popup).
    4. If a popup/modal is blocking the view, your priority is to CLOSE it (look for an 'X' or 'Close' button).
    5. INTERACTING WITH INPUTS:
       - For text/number inputs: use action "type" with the elementId and value. If an autocomplete dropdown appears after typing, the page will be re-tagged automatically so you can click a suggestion in the next step.
       - After typing into a search box or form field, use action "press_enter" to submit (no elementId needed)
       - For combobox/button elements (role="combobox"): use action "click" to open them, then click the option you want
       - DO NOT try to type into buttons or comboboxes - always click them
    6. SELECTING FROM DROPDOWNS:
       - For <select> elements (tag="select" in DOM tree): ALWAYS use action "select" with the elementId and the label text of the option you want. NEVER click a <select> — it opens a native OS menu that cannot be seen or interacted with.
       - For custom dropdowns (comboboxes, scrollable lists):
         a) First CLICK the combobox button to open the dropdown
         b) If needed, scroll the container using "scroll_element" to find your option
         c) Then CLICK the option you want
       - Example workflow: {"action": "click", "elementId": 140} -> {"action": "click", "elementId": 27}
    7. SCROLLING STRATEGY:
       - Check the scroll info in the DOM tree to know if a container needs scrolling
       - To scroll the MAIN PAGE: use action "scroll" with direction "down" or "up"
       - To scroll a SPECIFIC CONTAINER (modal, sidebar, dropdown list): use action "scroll_element" with the elementId and direction "down" or "up"
       - DO NOT use global scroll if a sidebar/modal exists; scroll the container directly
    8. SLIDERS: NEVER interact with range sliders or drag handles. If you need to set a numeric value (like mileage or price), type it into the corresponding text input field instead.
    9. AVOID LOOPS: If you see the same action repeated in recent history, do NOT repeat it again. Try a different approach instead.
    10. Return JSON ONLY (no markdown):
    
    {
        "thought": "brief reasoning",
        "action": "click" | "type" | "select" | "goToURL" | "scroll" | "scroll_element" | "press_enter" | "finished",
        "elementId": number (the NUMERIC ID only - for red tags use the number directly, for blue tags like "S:104" use just 104 - required for click/type/select/scroll_element),
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
                        { type: "text", text: prompt + "\n\n" + prompt },
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
