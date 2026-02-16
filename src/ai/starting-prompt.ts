import { groq } from './groq-client';

// determine the best starting page based on the goal (IN THE FUTURE WE CAN PROMPT A REFINED GOAL here if needed)
export async function determineStartingPage(goal: string): Promise<string> {
    const prompt = `
    You are a browser automation agent. Your goal is: "${goal}"
    
    Based on this goal, what is the best starting URL to begin from?
    
    RULES:
    - If the goal mentions a specific website (like "clutch.ca", "amazon.com", etc.), return that website's URL
    - If the goal is about searching or finding information, return "https://duckduckgo.com"
    - If you're unsure, return "https://duckduckgo.com"
    - Always return a full URL starting with https://
    
    Return ONLY a JSON object with the URL, no markdown:
    {
        "url": "https://example.com",
        "reasoning": "brief explanation"
    }
    `;

    try {
        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            response_format: { type: "json_object" }
        });

        const response = JSON.parse(completion.choices[0].message.content || '{}');
        console.log(`starting page is gonna be: ${response.url} - ${response.reasoning}`);
        
        return response.url || "https://duckduckgo.com";
    } catch (e) {
        console.error("error determining starting page:", e);
        return "https://duckduckgo.com";
    }
}
