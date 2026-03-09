// --- Raw CDP data types ---

export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ScrollInfo {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    pagesAbove: number;
    pagesBelow: number;
    scrollPercent: number;
}

export interface RawDOMNode {
    nodeId: number;
    backendNodeId: number;
    tagName: string;
    attributes: Record<string, string>;
    textContent: string;
    children: RawDOMNode[];
    role?: string;
    ariaLabel?: string;
    ariaExpanded?: string;
    ariaChecked?: string;
    ariaSelected?: string;
    ariaDisabled?: string;
    boundingBox?: BoundingBox;
    isVisible: boolean;
    isInteractive: boolean;
    hasJsClickListener: boolean;
    scrollInfo?: ScrollInfo;
}

export interface DOMTreeNode {
    selectorIndex: number | null;
    tagName: string;
    attributes: Record<string, string>;
    textContent: string;
    children: DOMTreeNode[];
    isInteractive: boolean;
    isVisible: boolean;
    scrollInfo?: ScrollInfo;
    boundingBox?: BoundingBox;
    role?: string;
}

export interface SelectorMapEntry {
    index: number;
    backendNodeId: number;
    cssSelector: string;
    tagName: string;
    textHint: string;
}

export interface DOMExtractionResult {
    llmRepresentation: string;
    selectorMap: Map<number, SelectorMapEntry>;
    tree: DOMTreeNode;
}
