import { Page } from 'playwright';
import {
    RawDOMNode, DOMTreeNode, SelectorMapEntry, DOMExtractionResult,
} from './types';
import {
    LLM_INCLUDE_ATTRIBUTES, PRUNED_TAGS, INTERACTIVE_SELECTORS, DYNAMIC_CLASS_PATTERNS,
} from './config';

/**
 * DOMExtractor merges DOM structure, accessibility data, layout/visibility,
 * and JS event listeners into a single pruned tree, then serializes it into
 * a token-efficient numbered representation for an LLM.
 *
 *  1. buildRawTree()  — in-page JS to walk DOM, merge AX/layout/listener data
 *  2. processTree()   — prunes invisible/irrelevant nodes, assigns selector indices
 *  3. serialize()     — converts processed tree into compressed LLM string
 */
export class DOMExtractor {
    private page: Page;
    private selectorMap: Map<number, SelectorMapEntry> = new Map();
    private nextIndex = 1;

    constructor(page: Page) {
        this.page = page;
    }

    async extract(): Promise<DOMExtractionResult> {
        this.selectorMap = new Map();
        this.nextIndex = 1;

        const rawTree = await this.buildRawTree();
        const processedTree = this.processTree(rawTree);
        const llmRepresentation = this.serialize(processedTree, 0);

        return { llmRepresentation, selectorMap: this.selectorMap, tree: processedTree };
    }

    // ---------------------------------------------------------------
    // 1. In-page extraction
    // ---------------------------------------------------------------

    private async buildRawTree(): Promise<RawDOMNode> {
        const interactiveSelectors = INTERACTIVE_SELECTORS;
        const prunedTagsList = Array.from(PRUNED_TAGS);

        return await this.page.evaluate(
            ({ interactiveSelectors, prunedTagsList }) => {
                const prunedTags = new Set(prunedTagsList.map(t => t.toUpperCase()));

                function hasJsClickListener(el: Element): boolean {
                    try {
                        const gEL = (window as any).getEventListeners;
                        if (typeof gEL === 'function') {
                            const listeners = gEL(el);
                            const clickTypes = ['click', 'mousedown', 'pointerdown', 'mouseup', 'pointerup'];
                            return clickTypes.some(t => listeners[t] && listeners[t].length > 0);
                        }
                    } catch { /* not available outside DevTools */ }
                    return false;
                }

                function isInteractiveElement(el: Element): boolean {
                    return interactiveSelectors.some(sel => {
                        try { return el.matches(sel); } catch { return false; }
                    });
                }

                function isElementVisible(el: Element): boolean {
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none') return false;
                    if (style.visibility === 'hidden') return false;
                    if (parseFloat(style.opacity) === 0) return false;
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0) return false;
                    return true;
                }

                function getScrollInfo(el: Element): any | null {
                    const style = window.getComputedStyle(el);
                    const isScrollable =
                        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                        el.scrollHeight > el.clientHeight;
                    if (!isScrollable) return null;

                    const scrollTop = el.scrollTop;
                    const scrollHeight = el.scrollHeight;
                    const clientHeight = el.clientHeight;
                    const maxScroll = scrollHeight - clientHeight;
                    return {
                        scrollTop, scrollHeight, clientHeight,
                        pagesAbove: clientHeight > 0 ? Math.round((scrollTop / clientHeight) * 10) / 10 : 0,
                        pagesBelow: clientHeight > 0 ? Math.round(((maxScroll - scrollTop) / clientHeight) * 10) / 10 : 0,
                        scrollPercent: maxScroll > 0 ? Math.round((scrollTop / maxScroll) * 100) : 0,
                    };
                }

                function getBoundingBox(el: Element): any | null {
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0) return null;
                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                }

                function getDirectText(el: Element): string {
                    let text = '';
                    for (const child of Array.from(el.childNodes)) {
                        if (child.nodeType === Node.TEXT_NODE) {
                            text += (child.textContent || '').trim() + ' ';
                        }
                    }
                    return text.trim().substring(0, 200);
                }

                function getAttributes(el: Element): Record<string, string> {
                    const attrs: Record<string, string> = {};
                    for (const attr of Array.from(el.attributes)) {
                        attrs[attr.name] = attr.value;
                    }
                    return attrs;
                }

                let nodeIdCounter = 0;

                function walkNode(el: Element): any {
                    const tagName = el.tagName.toLowerCase();
                    if (prunedTags.has(el.tagName)) return null;

                    const visible = isElementVisible(el);
                    const interactive = isInteractiveElement(el);
                    const jsClick = hasJsClickListener(el);
                    const box = getBoundingBox(el);
                    const scrollInfo = getScrollInfo(el);
                    const nodeId = nodeIdCounter++;

                    const children: any[] = [];
                    for (const child of Array.from(el.children)) {
                        const childNode = walkNode(child);
                        if (childNode) children.push(childNode);
                    }

                    return {
                        nodeId, backendNodeId: nodeId, tagName,
                        attributes: getAttributes(el),
                        textContent: getDirectText(el),
                        children,
                        role: el.getAttribute('role') || undefined,
                        ariaLabel: el.getAttribute('aria-label') || undefined,
                        ariaExpanded: el.getAttribute('aria-expanded') || undefined,
                        ariaChecked: el.getAttribute('aria-checked') || undefined,
                        ariaSelected: el.getAttribute('aria-selected') || undefined,
                        ariaDisabled: el.getAttribute('aria-disabled') || undefined,
                        boundingBox: box,
                        isVisible: visible,
                        isInteractive: interactive || jsClick,
                        hasJsClickListener: jsClick,
                        scrollInfo,
                    };
                }

                const root = document.body || document.documentElement;
                const tree = walkNode(root);
                return tree || {
                    nodeId: 0, backendNodeId: 0, tagName: 'body',
                    attributes: {}, textContent: '', children: [],
                    isVisible: true, isInteractive: false, hasJsClickListener: false,
                };
            },
            { interactiveSelectors, prunedTagsList }
        );
    }

    // ---------------------------------------------------------------
    // 2. Process tree: prune, filter attributes, assign indices
    // ---------------------------------------------------------------

    private processTree(raw: RawDOMNode): DOMTreeNode {
        return this.processNode(raw);
    }

    private processNode(raw: RawDOMNode): DOMTreeNode {
        const children: DOMTreeNode[] = [];
        for (const child of raw.children) {
            if (PRUNED_TAGS.has(child.tagName)) continue;
            children.push(this.processNode(child));
        }

        const filteredAttrs: Record<string, string> = {};
        for (const [key, value] of Object.entries(raw.attributes)) {
            if (LLM_INCLUDE_ATTRIBUTES.has(key)) {
                filteredAttrs[key] = key === 'class' ? this.filterDynamicClasses(value) : value;
            }
        }

        let selectorIndex: number | null = null;
        if (raw.isInteractive && raw.isVisible) {
            selectorIndex = this.nextIndex++;
            this.selectorMap.set(selectorIndex, {
                index: selectorIndex,
                backendNodeId: raw.backendNodeId,
                cssSelector: this.buildCssSelector(raw),
                tagName: raw.tagName,
                textHint: raw.textContent.substring(0, 50),
            });
        }

        return {
            selectorIndex, tagName: raw.tagName, attributes: filteredAttrs,
            textContent: raw.textContent, children,
            isInteractive: raw.isInteractive, isVisible: raw.isVisible,
            scrollInfo: raw.scrollInfo, boundingBox: raw.boundingBox, role: raw.role,
        };
    }

    private filterDynamicClasses(classStr: string): string {
        return classStr.split(/\s+/)
            .filter(cls => !DYNAMIC_CLASS_PATTERNS.some(pat => pat.test(cls)))
            .join(' ').trim();
    }

    private buildCssSelector(raw: RawDOMNode): string {
        const tag = raw.tagName;
        if (raw.attributes['id']) return `${tag}#${raw.attributes['id']}`;
        if (raw.attributes['data-testid']) return `${tag}[data-testid="${raw.attributes['data-testid']}"]`;
        if (raw.attributes['name']) return `${tag}[name="${raw.attributes['name']}"]`;
        if (raw.ariaLabel) return `${tag}[aria-label="${raw.ariaLabel}"]`;
        return tag;
    }

    // ---------------------------------------------------------------
    // 3. Serialize to LLM-readable string
    // ---------------------------------------------------------------

    /** Tags that are purely structural — collapse them (render children at same depth) */
    private static readonly COLLAPSE_TAGS = new Set([
        'div', 'span', 'section', 'article', 'aside', 'header', 'footer',
        'nav', 'main', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td',
        'th', 'center', 'figure', 'figcaption', 'details', 'summary',
        'dl', 'dt', 'dd', 'fieldset', 'legend', 'ul', 'ol', 'li',
        'body', 'form', 'p', 'b', 'i', 'em', 'strong', 'small', 'u',
    ]);

    private serialize(node: DOMTreeNode, depth: number): string {
        if (!node.isVisible && !this.hasVisibleDescendant(node)) return '';

        // Skip nodes that are just whitespace/punctuation noise
        if (this.isNoiseNode(node)) return '';

        const lines: string[] = [];
        const indent = '  '.repeat(depth);

        // Should this node be collapsed (children promoted to same level)?
        if (this.shouldCollapse(node)) {
            // If it has meaningful text, emit it as plain text
            const text = this.cleanText(node.textContent);
            if (text) {
                lines.push(`${indent}${text}`);
            }
            for (const child of node.children) {
                const s = this.serialize(child, depth);
                if (s) lines.push(s);
            }
            return lines.join('\n');
        }

        // This node is meaningful — render it with tag
        const indexPrefix = node.selectorIndex !== null ? `[${node.selectorIndex}] ` : '';
        const attrStr = this.serializeAttributes(node);
        const scrollStr = node.scrollInfo ? ` scroll="${this.formatScrollInfo(node.scrollInfo)}"` : '';
        const text = this.cleanText(node.textContent);

        // Serialize children
        const childLines: string[] = [];
        for (const child of node.children) {
            const s = this.serialize(child, depth + 1);
            if (s) childLines.push(s);
        }

        // Leaf node
        if (childLines.length === 0) {
            if (!text && !node.isInteractive && Object.keys(node.attributes).length === 0) return '';
            if (text) {
                lines.push(`${indent}${indexPrefix}<${node.tagName}${attrStr}${scrollStr}>${text}</${node.tagName}>`);
            } else {
                lines.push(`${indent}${indexPrefix}<${node.tagName}${attrStr}${scrollStr}>`);
            }
        }
        // Node with children
        else if (childLines.length === 1 && !text) {
            // Single child — inline it if the child is short enough
            const childTrimmed = childLines[0].trim();
            if (childTrimmed.length < 120 && !childTrimmed.includes('\n')) {
                lines.push(`${indent}${indexPrefix}<${node.tagName}${attrStr}${scrollStr}>${childTrimmed}</${node.tagName}>`);
            } else {
                lines.push(`${indent}${indexPrefix}<${node.tagName}${attrStr}${scrollStr}>`);
                lines.push(...childLines);
                lines.push(`${indent}</${node.tagName}>`);
            }
        } else {
            lines.push(`${indent}${indexPrefix}<${node.tagName}${attrStr}${scrollStr}>${text}`);
            lines.push(...childLines);
            lines.push(`${indent}</${node.tagName}>`);
        }

        return lines.join('\n');
    }

    /** Decide if a node should be collapsed (its tag removed, children promoted) */
    private shouldCollapse(node: DOMTreeNode): boolean {
        // Never collapse interactive or indexed nodes
        if (node.isInteractive || node.selectorIndex !== null) return false;
        // Never collapse nodes with scroll info or semantic roles
        if (node.scrollInfo || node.role) return false;
        // Collapse structural/layout tags
        if (DOMExtractor.COLLAPSE_TAGS.has(node.tagName)) return true;
        return false;
    }

    /** Detect noise: nodes that are just pipes, bullets, whitespace, or tiny punctuation */
    private isNoiseNode(node: DOMTreeNode): boolean {
        if (node.isInteractive || node.selectorIndex !== null) return false;
        if (node.children.length > 0) return false;
        if (node.scrollInfo || node.role) return false;
        const text = (node.textContent || '').trim();
        // Pure whitespace, pipes, bullets, dots
        if (/^[\s|·•–—\-.,;:]*$/.test(text)) return true;
        return false;
    }

    /** Clean text: collapse whitespace, trim */
    private cleanText(text: string): string {
        return text.replace(/\s+/g, ' ').trim();
    }

    private formatScrollInfo(info: NonNullable<DOMTreeNode['scrollInfo']>): string {
        return `${info.pagesAbove}↑ ${info.pagesBelow}↓ ${info.scrollPercent}%`;
    }

    private serializeAttributes(node: DOMTreeNode): string {
        const parts: string[] = [];
        for (const [key, value] of Object.entries(node.attributes)) {
            if (value) parts.push(`${key}="${value}"`);
        }
        return parts.length === 0 ? '' : ' ' + parts.join(' ');
    }

    private hasVisibleDescendant(node: DOMTreeNode): boolean {
        for (const child of node.children) {
            if (child.isVisible) return true;
            if (this.hasVisibleDescendant(child)) return true;
        }
        return false;
    }
}
