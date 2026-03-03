import { Page, CDPSession } from 'playwright';
import { DOMElement } from '../types';

interface AXNode {
    nodeId: string;
    backendDOMNodeId?: number;
    role?: { type: string; value: string };
    name?: { type: string; value: string; sources?: any[] };
    description?: { type: string; value: string };
    value?: { type: string; value: string | number };
    properties?: Array<{ name: string; value: { type: string; value: any } }>;
    childIds?: string[];
    parentId?: string;
    ignored?: boolean;
    ignoredReasons?: any[];
}

interface DOMTreeNode {
    role: string;
    name: string;
    description: string;
    value: string;
    backendNodeId: number;
    children: DOMTreeNode[];
    properties: Record<string, any>;
    isInteractive: boolean;
    agentId?: number;
    // new fields for smarter serialization
    tag?: string;           // original HTML tag from DOM
    attributes?: Record<string, string>;  // useful HTML attributes
    bounds?: { x: number; y: number; width: number; height: number };
    isVisible?: boolean;
    scrollInfo?: { scrollHeight: number; clientHeight: number; scrollTop: number };
}

// roles that represent interactive elements the agent can act on
const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'searchbox', 'combobox',
    'checkbox', 'radio', 'slider', 'spinbutton', 'switch',
    'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'listbox', 'treeitem', 'gridcell',
    'scrollbar', 'separator',
]);

// roles to collapse (pass children through, don't show the node itself)
const COLLAPSE_ROLES = new Set([
    'none', 'presentation', 'generic', 'InlineTextBox',
    'LineBreak',
]);

// structural roles that should be shown as context containers (not collapsed)
const STRUCTURAL_ROLES = new Set([
    'banner', 'navigation', 'main', 'complementary', 'contentinfo',
    'form', 'search', 'region', 'dialog', 'alertdialog', 'alert',
    'heading', 'list', 'listitem', 'table', 'row', 'cell',
    'tablist', 'tabpanel', 'menu', 'menubar', 'toolbar',
    'group', 'tree', 'treegrid', 'grid',
]);

// attributes worth showing to the LLM for interactive elements
const USEFUL_ATTRIBUTES = [
    'type', 'placeholder', 'value', 'checked', 'selected',
    'expanded', 'disabled', 'required', 'aria-label', 'title',
    'name', 'role', 'aria-expanded', 'aria-checked', 'aria-selected',
    'min', 'max', 'step', 'pattern', 'multiple', 'accept',
    'href',
];

export async function getAccessibilityTree(page: Page): Promise<{
    tree: DOMTreeNode;
    interactiveElements: DOMElement[];
    treeText: string;
}> {
    const cdp: CDPSession = await page.context().newCDPSession(page);

    try {
        // get AX tree + viewport info + DOM attributes in parallel
        const [axResult, viewportInfo] = await Promise.all([
            cdp.send('Accessibility.getFullAXTree') as Promise<{ nodes: AXNode[] }>,
            page.evaluate(() => ({
                viewportHeight: window.innerHeight,
                viewportWidth: window.innerWidth,
                scrollY: window.scrollY,
                scrollX: window.scrollX,
                pageHeight: document.documentElement.scrollHeight,
                pageWidth: document.documentElement.scrollWidth,
            })),
        ]);

        const { nodes } = axResult;

        const nodeMap = new Map<string, AXNode>();
        for (const node of nodes) {
            nodeMap.set(node.nodeId, node);
        }

        const rootAX = nodes[0];
        if (!rootAX) {
            return { tree: emptyNode(), interactiveElements: [], treeText: '(empty page)' };
        }

        let nextAgentId = 0;
        const interactiveElements: DOMElement[] = [];

        // get bounding rects for interactive elements via CDP
        const boundingRects = new Map<number, { x: number; y: number; width: number; height: number }>();

        function collectChildren(axNode: AXNode): DOMTreeNode[] {
            const results: DOMTreeNode[] = [];
            if (!axNode.childIds) return results;
            for (const childId of axNode.childIds) {
                const childAX = nodeMap.get(childId);
                if (!childAX) continue;
                const built = buildNode(childAX);
                if (built) {
                    if (Array.isArray(built)) {
                        results.push(...built);
                    } else {
                        results.push(built);
                    }
                }
            }
            return results;
        }

        function buildNode(axNode: AXNode): DOMTreeNode | DOMTreeNode[] | null {
            const role = axNode.role?.value || 'unknown';
            const name = axNode.name?.value || '';
            const desc = axNode.description?.value || '';
            const value = axNode.value?.value?.toString() || '';

            // ignored nodes — recurse through them
            if (axNode.ignored) {
                const children = collectChildren(axNode);
                if (children.length === 0) return null;
                if (children.length === 1) return children[0];
                return children;
            }

            const props: Record<string, any> = {};
            if (axNode.properties) {
                for (const p of axNode.properties) {
                    props[p.name] = p.value.value;
                }
            }

            const isInteractive = INTERACTIVE_ROLES.has(role);
            const isCollapse = COLLAPSE_ROLES.has(role);
            const children = collectChildren(axNode);

            // collapse generic/presentation wrappers
            if (isCollapse && !isInteractive) {
                if (name.trim() && children.length === 0) {
                    return {
                        role: 'text', name: name.substring(0, 100),
                        description: '', value: '',
                        backendNodeId: axNode.backendDOMNodeId || 0,
                        children: [], properties: {}, isInteractive: false,
                    };
                }
                if (children.length === 0) return null;
                if (children.length === 1) return children[0];
                return children;
            }

            // StaticText — keep as leaf text
            if (role === 'StaticText') {
                if (!name.trim()) return null;
                return {
                    role: 'text', name: name.substring(0, 100),
                    description: '', value: '',
                    backendNodeId: axNode.backendDOMNodeId || 0,
                    children: [], properties: {}, isInteractive: false,
                };
            }

            // paragraph — keep if it has content
            if (role === 'paragraph') {
                if (children.length === 0 && !name.trim()) return null;
            }

            const node: DOMTreeNode = {
                role,
                name: name.substring(0, 100),
                description: desc.substring(0, 100),
                value: value.substring(0, 100),
                backendNodeId: axNode.backendDOMNodeId || 0,
                children,
                properties: props,
                isInteractive,
            };

            if (isInteractive && axNode.backendDOMNodeId) {
                node.agentId = nextAgentId++;
                const el: DOMElement = {
                    id: node.agentId,
                    tag: role,
                    type: 'interactive',
                    text: name.substring(0, 50),
                    ariaLabel: name.substring(0, 50),
                    role: role,
                    value: value,
                };
                if (props.checked !== undefined) (el as any).checked = props.checked;
                if (props.expanded !== undefined) (el as any).expanded = props.expanded;
                if (props.selected !== undefined) (el as any).selected = props.selected;
                if (props.disabled !== undefined) (el as any).disabled = props.disabled;
                if (props.required !== undefined) (el as any).required = props.required;
                interactiveElements.push(el);
            }

            if ((role === 'ScrollArea' || props.scrollable) && node.agentId === undefined) {
                node.agentId = nextAgentId++;
                interactiveElements.push({
                    id: node.agentId,
                    tag: role,
                    type: 'scroll-container',
                    text: name.substring(0, 50),
                    role: role,
                });
            }

            return node;
        }

        const rawResult = buildNode(rootAX);
        let tree: DOMTreeNode;
        if (!rawResult) {
            tree = emptyNode();
        } else if (Array.isArray(rawResult)) {
            tree = { role: 'WebArea', name: '', description: '', value: '',
                backendNodeId: 0, children: rawResult, properties: {}, isInteractive: false };
        } else {
            tree = rawResult;
        }

        // serialize with the smarter compact format
        const treeText = serializeTreeSmart(tree, viewportInfo);
        return { tree, interactiveElements, treeText };
    } finally {
        await cdp.detach();
    }
}

// ─── Smart Serializer (browser-use inspired) ───────────────────────────────

interface ViewportInfo {
    viewportHeight: number;
    viewportWidth: number;
    scrollY: number;
    scrollX: number;
    pageHeight: number;
    pageWidth: number;
}

/**
 * Smarter serialization that produces a compact, token-efficient tree.
 * 
 * Key improvements over the old format:
 * 1. HTML-like tags: `[5]<button>Click me</button>` instead of `[5] button "Click me"`
 * 2. Attributes inline: `[9]<input type="checkbox" checked=true />`
 * 3. Non-interactive wrappers collapsed — only show structural landmarks + interactive elements + text
 * 4. Scroll position awareness at the top
 * 5. Groups consecutive text nodes to reduce noise
 */
function serializeTreeSmart(tree: DOMTreeNode, viewport: ViewportInfo): string {
    const lines: string[] = [];

    // scroll position header — tells the LLM where we are on the page
    const scrollPercent = viewport.pageHeight > viewport.viewportHeight
        ? Math.round((viewport.scrollY / (viewport.pageHeight - viewport.viewportHeight)) * 100)
        : 0;
    const pagesBelow = viewport.pageHeight > viewport.viewportHeight
        ? Math.max(0, ((viewport.pageHeight - viewport.scrollY - viewport.viewportHeight) / viewport.viewportHeight))
        : 0;

    if (viewport.pageHeight > viewport.viewportHeight * 1.5) {
        lines.push(`[scroll position: ${scrollPercent}% | ${pagesBelow.toFixed(1)} pages below]`);
    }

    serializeNode(tree, 0, lines);

    // trim excessive output — cap at ~4000 lines to avoid token bloat from footer junk
    const MAX_LINES = 4000;
    if (lines.length > MAX_LINES) {
        lines.length = MAX_LINES;
        lines.push('... (page content truncated)');
    }

    return lines.join('\n');
}

function serializeNode(node: DOMTreeNode, depth: number, lines: string[], maxDepth: number = 20): void {
    if (depth > maxDepth) return;

    const indent = '\t'.repeat(depth);

    // text nodes — just output the text
    if (node.role === 'text') {
        if (node.name.trim()) {
            lines.push(`${indent}${node.name.trim()}`);
        }
        return;
    }

    // determine if this node should be shown as a container or collapsed
    const isInteractive = node.agentId !== undefined;
    const isStructural = STRUCTURAL_ROLES.has(node.role);
    const isWebArea = node.role === 'RootWebArea' || node.role === 'WebArea';
    const hasInteractiveDescendants = hasInteractiveInSubtree(node);

    // for the root WebArea, just process children
    if (isWebArea) {
        serializeChildren(node.children, depth, lines, maxDepth);
        return;
    }

    // interactive elements — always show with [id] marker and attributes
    if (isInteractive) {
        const line = formatInteractiveElement(node, indent);
        lines.push(line);

        // only render children that are themselves interactive or contain interactive elements
        // this avoids duplicating the text we already put inside the tag
        if (node.children.length > 0) {
            for (const child of node.children) {
                if (child.agentId !== undefined || hasInteractiveInSubtree(child)) {
                    serializeNode(child, depth + 1, lines, maxDepth);
                }
            }
        }
        return;
    }

    // structural landmarks — show as containers if they have meaningful content
    if (isStructural && hasInteractiveDescendants) {
        // heading — show inline with text
        if (node.role === 'heading') {
            const headingText = collectAllText(node);
            if (headingText) {
                lines.push(`${indent}${headingText}`);
            }
            // still process children for any interactive elements inside headings
            for (const child of node.children) {
                if (child.isInteractive || child.agentId !== undefined || hasInteractiveInSubtree(child)) {
                    serializeNode(child, depth + 1, lines, maxDepth);
                }
            }
            return;
        }

        // other structural roles — show as named sections
        const label = node.name ? `${node.role} "${node.name}"` : node.role;
        lines.push(`${indent}${label}`);
        serializeChildren(node.children, depth + 1, lines, maxDepth);
        return;
    }

    // headings without interactive descendants — show as text context
    if (node.role === 'heading') {
        const headingText = collectAllText(node);
        if (headingText) {
            lines.push(`${indent}${headingText}`);
        }
        return;
    }

    // paragraph with only text — show as text
    if (node.role === 'paragraph' && !hasInteractiveDescendants) {
        const text = collectAllText(node);
        if (text) {
            lines.push(`${indent}${text}`);
        }
        return;
    }

    // non-interactive, non-structural nodes — collapse and pass children through
    // but only if they have meaningful descendants
    if (node.children.length > 0) {
        // if this node has a meaningful name and no interactive children, show as text
        if (node.name.trim() && !hasInteractiveDescendants) {
            lines.push(`${indent}${node.name.trim()}`);
            return;
        }

        // otherwise just pass children through (collapse this wrapper)
        serializeChildren(node.children, depth, lines, maxDepth);
        return;
    }

    // leaf node with text — show it
    if (node.name.trim()) {
        lines.push(`${indent}${node.name.trim()}`);
    }
}

/**
 * Serialize a list of children with label merging.
 * When a checkbox/radio is followed by a text/paragraph node, merge them into one line.
 * e.g. instead of:
 *   [11]<input type="checkbox" checked=true />
 *   BMW
 * produces:
 *   [11]<input type="checkbox" checked=true>BMW</input>
 */
function serializeChildren(children: DOMTreeNode[], depth: number, lines: string[], maxDepth: number): void {
    const indent = '\t'.repeat(depth);

    for (let i = 0; i < children.length; i++) {
        const child = children[i];

        // check if this is a checkbox/radio with no name, followed by a text label
        if (child.agentId !== undefined && isLabelableInput(child) && !child.name) {
            const nextLabel = peekNextLabel(children, i + 1);
            if (nextLabel.text) {
                // merge: render the input with the label text baked in
                const tag = mapRoleToTag(child.role);
                const attrs = buildAttributeString(child);
                let line = `${indent}[${child.agentId}]<${tag}`;
                if (attrs) line += ` ${attrs}`;
                line += `>${nextLabel.text}</${tag}>`;
                lines.push(line);
                i += nextLabel.skip; // skip the consumed label nodes
                continue;
            }
        }

        serializeNode(child, depth, lines, maxDepth);
    }
}

/** Check if a node is a checkbox, radio, or switch that can be labeled by adjacent text */
function isLabelableInput(node: DOMTreeNode): boolean {
    return ['checkbox', 'radio', 'switch'].includes(node.role);
}

/** Look ahead in siblings to find the next text label (text node or paragraph with text) */
function peekNextLabel(siblings: DOMTreeNode[], startIdx: number): { text: string; skip: number } {
    let skip = 0;
    for (let i = startIdx; i < siblings.length; i++) {
        const sib = siblings[i];
        // text node
        if (sib.role === 'text' && sib.name.trim()) {
            return { text: sib.name.trim(), skip: skip + 1 };
        }
        // paragraph containing only text
        if (sib.role === 'paragraph' && !hasInteractiveInSubtree(sib)) {
            const text = collectAllText(sib);
            if (text) {
                return { text, skip: skip + 1 };
            }
        }
        // stop looking if we hit another interactive element or structural node
        if (sib.agentId !== undefined || STRUCTURAL_ROLES.has(sib.role)) {
            break;
        }
        skip++;
    }
    return { text: '', skip: 0 };
}

/**
 * Format an interactive element in compact HTML-like syntax.
 * Example: [5]<button expanded=false>DEALS</button>
 * Example: [79]<input type="text" value="2021" />
 */
function formatInteractiveElement(node: DOMTreeNode, indent: string): string {
    const tag = mapRoleToTag(node.role);
    const attrs = buildAttributeString(node);
    const text = getInteractiveText(node);

    let line = `${indent}[${node.agentId}]<${tag}`;
    if (attrs) line += ` ${attrs}`;

    if (text) {
        line += `>${text}</${tag}>`;
    } else {
        line += ` />`;
    }

    return line;
}

/** Map AX roles to familiar HTML-like tag names */
function mapRoleToTag(role: string): string {
    const map: Record<string, string> = {
        button: 'button',
        link: 'a',
        textbox: 'input',
        searchbox: 'input',
        combobox: 'select',
        checkbox: 'input',
        radio: 'input',
        slider: 'input',
        spinbutton: 'input',
        switch: 'input',
        tab: 'tab',
        menuitem: 'menuitem',
        menuitemcheckbox: 'menuitem',
        menuitemradio: 'menuitem',
        option: 'option',
        listbox: 'select',
        treeitem: 'treeitem',
        gridcell: 'td',
        separator: 'hr',
        scrollbar: 'scrollbar',
    };
    return map[role] || role;
}

/** Build compact attribute string from node properties */
function buildAttributeString(node: DOMTreeNode): string {
    const parts: string[] = [];

    // add type hint based on role
    if (node.role === 'checkbox') parts.push('type="checkbox"');
    else if (node.role === 'radio') parts.push('type="radio"');
    else if (node.role === 'searchbox') parts.push('type="search"');
    else if (node.role === 'slider') parts.push('type="range"');
    else if (node.role === 'spinbutton') parts.push('type="number"');
    else if (node.role === 'switch') parts.push('type="switch"');

    // value
    if (node.value) {
        parts.push(`value="${node.value}"`);
    }

    // important state properties
    if (node.properties.checked !== undefined) parts.push(`checked=${node.properties.checked}`);
    if (node.properties.expanded !== undefined) parts.push(`expanded=${node.properties.expanded}`);
    if (node.properties.selected !== undefined) parts.push(`selected=${node.properties.selected}`);
    if (node.properties.disabled) parts.push('disabled');
    if (node.properties.required) parts.push('required');
    if (node.properties.focused) parts.push('focused');

    return parts.join(' ');
}

/** Get the display text for an interactive element */
function getInteractiveText(node: DOMTreeNode): string {
    // for inputs, the "name" is usually the label, not content
    if (['textbox', 'searchbox', 'combobox', 'slider', 'spinbutton'].includes(node.role)) {
        // show the accessible name as a label hint if present
        if (node.name) return node.name;
        return '';
    }

    // for checkboxes/radios, collect the label text from siblings
    // (the name in AX tree is usually the label)
    if (['checkbox', 'radio', 'switch'].includes(node.role)) {
        return node.name || '';
    }

    // for buttons, links, tabs, etc. — collect all text content
    const allText = collectAllText(node);
    return allText || node.name || '';
}

/** Recursively collect all text from a subtree */
function collectAllText(node: DOMTreeNode): string {
    if (node.role === 'text') return node.name.trim();

    const parts: string[] = [];
    if (node.name && node.children.length === 0) {
        return node.name.trim();
    }

    for (const child of node.children) {
        const text = collectAllText(child);
        if (text) parts.push(text);
    }

    // deduplicate consecutive identical text
    const deduped: string[] = [];
    for (const part of parts) {
        if (deduped.length === 0 || deduped[deduped.length - 1] !== part) {
            deduped.push(part);
        }
    }

    return deduped.join(' ').substring(0, 150);
}

/** Check if any descendant is interactive */
function hasInteractiveInSubtree(node: DOMTreeNode): boolean {
    if (node.agentId !== undefined) return true;
    for (const child of node.children) {
        if (hasInteractiveInSubtree(child)) return true;
    }
    return false;
}

function emptyNode(): DOMTreeNode {
    return {
        role: 'WebArea', name: '', description: '', value: '',
        backendNodeId: 0, children: [], properties: {}, isInteractive: false,
    };
}

// ─── Element Tagging (unchanged) ───────────────────────────────────────────

export async function tagInteractiveElements(
    page: Page,
    tree: DOMTreeNode
): Promise<void> {
    const interactiveNodes: DOMTreeNode[] = [];
    function collect(node: DOMTreeNode) {
        if (node.agentId !== undefined) {
            interactiveNodes.push(node);
        }
        for (const child of node.children) collect(child);
    }
    collect(tree);

    if (interactiveNodes.length === 0) return;

    // phase 1: try CDP DOM.resolveNode for nodes with backendNodeId
    const cdp = await page.context().newCDPSession(page);
    const untagged: DOMTreeNode[] = [];
    try {
        for (const node of interactiveNodes) {
            if (!node.backendNodeId) {
                untagged.push(node);
                continue;
            }
            try {
                const { object } = await cdp.send('DOM.resolveNode', {
                    backendNodeId: node.backendNodeId,
                }) as any;

                if (object?.objectId) {
                    await cdp.send('Runtime.callFunctionOn', {
                        objectId: object.objectId,
                        functionDeclaration: `function(id) { this.setAttribute('data-agent-persist', id.toString()); }`,
                        arguments: [{ value: node.agentId }],
                    });
                } else {
                    untagged.push(node);
                }
            } catch {
                untagged.push(node);
            }
        }
    } finally {
        await cdp.detach();
    }

    // phase 2: fallback — use page.evaluate to find untagged elements by role+name
    if (untagged.length > 0) {
        const toTag = untagged.map(n => ({
            agentId: n.agentId!,
            role: n.role,
            name: n.name,
        }));

        await page.evaluate((items) => {
            const roleToSelector: Record<string, string> = {
                button: 'button, [role="button"]',
                link: 'a, [role="link"]',
                textbox: 'input[type="text"], input[type="search"], input:not([type]), textarea, [role="textbox"]',
                searchbox: 'input[type="search"], [role="searchbox"]',
                combobox: '[role="combobox"], select',
                checkbox: 'input[type="checkbox"], [role="checkbox"]',
                radio: 'input[type="radio"], [role="radio"]',
                tab: '[role="tab"]',
                option: 'option, [role="option"]',
                menuitem: '[role="menuitem"]',
                listbox: 'select, [role="listbox"]',
                slider: 'input[type="range"], [role="slider"]',
                switch: '[role="switch"]',
            };

            for (const item of items) {
                const existing = document.querySelector(`[data-agent-persist="${item.agentId}"]`);
                if (existing) continue;

                const selector = roleToSelector[item.role];
                if (!selector) continue;

                const candidates = document.querySelectorAll(selector);
                for (const el of Array.from(candidates)) {
                    if (el.hasAttribute('data-agent-persist')) continue;

                    const ariaLabel = el.getAttribute('aria-label') || '';
                    const text = (el as HTMLElement).innerText?.trim() || '';
                    const title = el.getAttribute('title') || '';
                    const name = item.name.toLowerCase();

                    if (name && (
                        ariaLabel.toLowerCase().includes(name) ||
                        text.toLowerCase().includes(name) ||
                        title.toLowerCase().includes(name) ||
                        name.includes(ariaLabel.toLowerCase()) ||
                        name.includes(text.toLowerCase())
                    )) {
                        el.setAttribute('data-agent-persist', item.agentId.toString());
                        break;
                    }
                }
            }
        }, toTag);
    }
}

// show colored numbered overlays using CDP backendNodeIds
export async function showVisualTags(page: Page, tree: DOMTreeNode): Promise<void> {
    const nodes: { agentId: number; backendNodeId: number }[] = [];
    function collect(node: DOMTreeNode) {
        if (node.agentId !== undefined && node.backendNodeId) {
            nodes.push({ agentId: node.agentId, backendNodeId: node.backendNodeId });
        }
        for (const child of node.children) collect(child);
    }
    collect(tree);

    if (nodes.length === 0) return;

    const cdp = await page.context().newCDPSession(page);
    const tagData: { id: number; top: number; left: number }[] = [];

    try {
        for (const node of nodes) {
            try {
                const { object } = await cdp.send('DOM.resolveNode', {
                    backendNodeId: node.backendNodeId,
                }) as any;

                if (object?.objectId) {
                    const { result } = await cdp.send('Runtime.callFunctionOn', {
                        objectId: object.objectId,
                        functionDeclaration: `function() {
                            const r = this.getBoundingClientRect();
                            return JSON.stringify({ top: r.top, left: r.left, w: r.width, h: r.height });
                        }`,
                        returnByValue: true,
                    }) as any;

                    if (result?.value) {
                        const rect = JSON.parse(result.value);
                        if (rect.w > 5 && rect.h > 5) {
                            tagData.push({ id: node.agentId, top: rect.top, left: rect.left });
                        }
                    }
                }
            } catch {
                // skip nodes that can't be resolved
            }
        }
    } finally {
        await cdp.detach();
    }

    if (tagData.length > 0) {
        await page.evaluate((tags) => {
            document.querySelectorAll('.agent-debug-tag').forEach(e => e.remove());
            for (const t of tags) {
                const tag = document.createElement('div');
                tag.className = 'agent-debug-tag';
                tag.innerText = String(t.id);
                Object.assign(tag.style, {
                    position: 'fixed',
                    top: Math.max(0, t.top) + 'px',
                    left: Math.max(0, t.left) + 'px',
                    backgroundColor: '#ff0000',
                    color: 'white',
                    padding: '1px 4px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    zIndex: '2147483647',
                    border: '1px solid white',
                    borderRadius: '3px',
                    pointerEvents: 'none',
                    lineHeight: '14px',
                });
                document.body.appendChild(tag);
            }
        }, tagData);
    }

    console.log(`Visual tags: placed ${tagData.length}/${nodes.length} overlays`);
}

// remove visual debug overlays
export async function removeVisualTags(page: Page): Promise<void> {
    await page.evaluate(() => {
        document.querySelectorAll('.agent-debug-tag').forEach(e => e.remove());
    });
}
