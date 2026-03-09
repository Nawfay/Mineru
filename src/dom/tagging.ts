import { Page } from 'playwright';
import { DOMTreeNode } from './types';

interface TagInfo {
    index: number;
    x: number;
    y: number;
    hasScroll: boolean;
}

/** Collect all interactive nodes with bounding boxes from the processed tree */
function collectTaggableNodes(node: DOMTreeNode, result: TagInfo[] = []): TagInfo[] {
    if (node.selectorIndex !== null && node.boundingBox) {
        result.push({
            index: node.selectorIndex,
            x: node.boundingBox.x,
            y: node.boundingBox.y,
            hasScroll: !!node.scrollInfo,
        });
    }
    for (const child of node.children) {
        collectTaggableNodes(child, result);
    }
    return result;
}

/** Inject visual labels onto the page that match the DOMExtractor's selector indices */
export async function injectTags(page: Page, tree: DOMTreeNode): Promise<void> {
    const tags = collectTaggableNodes(tree);
    await page.evaluate((tags) => {
        for (const t of tags) {
            const label = document.createElement('div');
            label.className = 'dom-extractor-tag';
            label.textContent = t.hasScroll ? `S:${t.index}` : String(t.index);
            Object.assign(label.style, {
                position: 'fixed',
                top: `${Math.max(0, t.y)}px`,
                left: `${Math.max(0, t.x)}px`,
                backgroundColor: t.hasScroll ? '#0000ff' : '#ff0000',
                color: 'white',
                padding: '2px 4px',
                fontSize: '12px',
                fontWeight: 'bold',
                zIndex: '2147483647',
                border: '1px solid white',
                pointerEvents: 'none',
                lineHeight: '1',
            });
            document.body.appendChild(label);
        }
    }, tags);
}

/** Remove all injected visual labels */
export async function removeTags(page: Page): Promise<void> {
    await page.evaluate(() => {
        document.querySelectorAll('.dom-extractor-tag').forEach(el => el.remove());
    });
}
