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
    role?: string;
    scrollHeight?: number;
    clientHeight?: number;
    className?: string;
    visibleContent?: string;
}

// what the ai decides to do
export interface AgentDecision {
    thought: string;
    action: 'click' | 'type' | 'select' | 'navigate' | 'scroll' | 'scroll_element' | 'press_enter' | 'goToURL' | 'finished' | 'error';
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
