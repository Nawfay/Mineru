import { openrouter } from './openrouter-client';
import * as fs from 'fs';
import * as path from 'path';

// refine goal and determine starting page
export async function determineStartingPage(originalGoal: string, sessionDir: string): Promise<{ url: string; refinedGoal: string }> {
    const prompt = `
    You are a browser automation planning assistant. The user provided this goal: "${originalGoal}"
    
    Your job is to:
    1. Fix any spelling errors or typos in the goal
    2. Refine the goal into a clear, specific, actionable objective
    3. Determine the best starting URL
    
    GOAL REFINEMENT RULES:
    - Fix spelling mistakes and typos
    - Make the goal specific and unambiguous
    - Break down vague requests into concrete steps
    - Add necessary details (like date ranges, filters, criteria)
    - Clarify what "success" looks like
    - Keep it concise but complete
    - Preserve the user's intent
    
    STARTING URL RULES:
    - If the goal mentions a specific website (like "clutch.ca", "amazon.com"), return that website's URL
    - If the goal is about searching or finding information, return "https://duckduckgo.com"
    - If you're unsure, return "https://duckduckgo.com"
    - Always return a full URL starting with https://
    
    EXAMPLES:
    
    Original: "find cars on clutch"
    Refined: "Navigate to clutch.ca and search for available cars. Display the search results page."
    URL: "https://clutch.ca"
    
    Original: "get me 2021 BMW 3 Series with less than 50k km"
    Refined: "Navigate to clutch.ca, apply filters for: Make=BMW, Model=3 Series, Year=2021, Mileage=less than 50,000 km. Display the filtered results."
    URL: "https://clutch.ca"
    
    Original: "what song did dishit79 listen to in jamurary 2025"
    Refined: "Navigate to last.fm/user/Dishit79, go to their library, filter by date range January 2025, and identify the songs they listened to during that period."
    URL: "https://www.last.fm/user/Dishit79"
    
    Return ONLY a JSON object:
    {
        "originalGoal": "the original goal",
        "refinedGoal": "the refined, actionable goal with spelling fixes",
        "url": "https://example.com",
        "reasoning": "brief explanation of refinements, spelling fixes, and URL choice"
    }
    `;

    try {
        const completion = await openrouter.chat.completions.create({
            model: "qwen/qwen3.5-plus-02-15",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            response_format: { type: "json_object" }
        });

        const response = JSON.parse(completion.choices[0].message.content || '{}');
        
        console.log("\n=== Planning Phase ===");
        console.log(`Original Goal: ${response.originalGoal}`);
        console.log(`Refined Goal: ${response.refinedGoal}`);
        console.log(`Starting URL: ${response.url}`);
        console.log(`Reasoning: ${response.reasoning}`);
        console.log("=====================\n");
        
        // save refined goal to debug folder
        const goalFile = path.join(sessionDir, 'refined-goal.json');
        fs.writeFileSync(goalFile, JSON.stringify({
            originalGoal: response.originalGoal,
            refinedGoal: response.refinedGoal,
            startingUrl: response.url,
            reasoning: response.reasoning,
            timestamp: new Date().toISOString()
        }, null, 2));
        console.log(`Saved refined goal to ${goalFile}`);
        
        return {
            url: response.url || "https://duckduckgo.com",
            refinedGoal: response.refinedGoal || originalGoal
        };
    } catch (e) {
        console.error("Error in planning phase:", e);
        return {
            url: "https://duckduckgo.com",
            refinedGoal: originalGoal
        };
    }
}

