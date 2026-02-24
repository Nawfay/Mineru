// a completed session distilled into what matters for caching
export interface SessionMemory {
    sessionId: string;
    domain: string;
    originalGoal: string;
    refinedGoal: string;
    finalUrl: string;
    jumpPointUrl: string;  // best adaptable intermediate URL (e.g. search page)
    jumpPointStep: number; // which step the jump point came from
    urlChain: string[];    // all unique URLs visited in order
    stepCount: number;
    success: boolean;
    timestamp: string;
}

export interface CacheResult {
    status: 'hit' | 'fallback';
    url?: string;
    urlType?: 'final' | 'jump_point'; // did we use the final URL or an intermediate?
    stepsSkipped?: number;             // how many agent steps this cache hit saves
    confidence?: number;
    sourceSessionId?: string;
}
