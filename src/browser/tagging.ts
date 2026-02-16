import { Page } from 'playwright';
import { DOMElement } from '../types';

// tag interactive elements on the page
export async function tagPage(page: Page): Promise<DOMElement[]> {
    return await page.evaluate(() => {
        // remove old tags first
        document.querySelectorAll('.agent-tag').forEach(e => e.remove());

        const map: any[] = [];
        
        // find highest existing id
        let id = 0;
        document.querySelectorAll('[data-agent-persist]').forEach(el => {
            const existingId = parseInt(el.getAttribute('data-agent-persist') || '0', 10);
            if (existingId >= id) {
                id = existingId + 1;
            }
        });

        // helper function to create visual tags
        const createTag = (el: Element, color: string, prefix: string = '') => {
            const rect = el.getBoundingClientRect();
            // skip hidden or tiny elements
            if (rect.width < 10 || rect.height < 10 || window.getComputedStyle(el).visibility === 'hidden') return null;
            if (rect.top < 0 && rect.bottom < 0) return null;

            // check if element is occluded by something else
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const topEl = document.elementFromPoint(centerX, centerY);
            if (topEl && !el.contains(topEl) && !topEl.contains(el)) return null;

            // reuse existing id or create new one
            let elementId: number;
            const existingId = el.getAttribute('data-agent-persist');
            if (existingId !== null) {
                elementId = parseInt(existingId, 10);
            } else {
                elementId = id;
                id++;
                el.setAttribute('data-agent-persist', elementId.toString());
            }

            const tag = document.createElement('div');
            tag.className = 'agent-tag';
            tag.innerText = prefix + elementId.toString();
            Object.assign(tag.style, {
                position: 'fixed',
                top: Math.max(0, rect.top) + 'px',
                left: Math.max(0, rect.left) + 'px',
                backgroundColor: color,
                color: 'white',
                padding: '2px 4px',
                fontSize: '12px',
                fontWeight: 'bold',
                zIndex: '2147483647',
                border: '1px solid white',
                pointerEvents: 'none'
            });
            document.body.appendChild(tag);
            el.setAttribute('data-agent-id', elementId.toString());
            const entry = { 
                id: elementId, 
                tag: el.tagName.toLowerCase(), 
                type: prefix === 'S:' ? 'scroll-container' : 'interactive' 
            };
            return entry;
        };

        // tag interactive elements in red
        const interactives = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [role="option"], li[role="presentation"]');
        interactives.forEach((el) => {
            const entry = createTag(el, '#ff0000');
            if (entry) {
                const htmlEl = el as HTMLElement;
                map.push({
                    ...entry,
                    text: htmlEl.innerText?.substring(0, 50) || '',
                    placeholder: (el as HTMLInputElement).placeholder || '',
                    inputType: (el as HTMLInputElement).type || '',
                    value: (el as HTMLInputElement).value || '',
                    ariaLabel: el.getAttribute('aria-label') || '',
                    title: el.getAttribute('title') || '',
                    role: el.getAttribute('role') || ''
                });
            }
        });

        // tag scrollable containers in blue
        const allElements = document.querySelectorAll('*');
        allElements.forEach((el) => {
            const style = window.getComputedStyle(el);
            const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;

            if (isScrollable) {
                const entry = createTag(el, '#0000ff', 'S:');
                if (entry) {
                    const htmlEl = el as HTMLElement;
                    
                    // get visible text content from scrollable area
                    let visibleText = '';
                    const children = Array.from(htmlEl.children);
                    if (children.length > 0) {
                        // get first few visible items
                        visibleText = children.slice(0, 5).map(c => (c as HTMLElement).innerText?.trim()).filter(t => t).join(', ');
                    }
                    
                    map.push({
                        ...entry,
                        scrollHeight: el.scrollHeight,
                        clientHeight: el.clientHeight,
                        className: htmlEl.className || '',
                        visibleContent: visibleText.substring(0, 100)
                    });
                }
            }
        });

        return map;
    });
}

export async function removeTags(page: Page) {
    await page.evaluate(() => {
        document.querySelectorAll('.agent-tag').forEach(e => e.remove());
    });
}
