// represents an element on the page
export interface DOMElement {
    id: number;
    tag: string;
    type: 'scroll-container' | 'interactive';
    text?: string;
    placeholder?: string;
    inputType?: string;
    value?: string;
    ariaLabel?: string;
    title?: string;
    scrollHeight?: number;
    clientHeight?: number;
    className?: string;
}

// what the ai decides to do
export interface AgentDecision {
    thought: string;
    action: 'click' | 'type' | 'navigate' | 'scroll' | 'scroll_element' | 'finished' | 'error';
    elementId?: number;
    value?: string;
    direction?: 'up' | 'down';
    url?: string;
}

export interface DecisionResult {
    decision: AgentDecision;
    prompt: string;
    response: string;
}
