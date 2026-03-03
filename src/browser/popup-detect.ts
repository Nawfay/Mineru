import { Page } from 'playwright';

export interface PopupInfo {
    detected: boolean;
    type: string;
    closeHint: string;
}

// try to auto-dismiss popups/modals/overlays before the LLM even sees them
// returns true if a popup was found and dismissed
export async function autoDismissPopup(page: Page): Promise<boolean> {
    return await page.evaluate(() => {
        const closeSelectors = [
            'button[aria-label*="close" i]',
            'button[aria-label*="dismiss" i]',
            '[role="button"][aria-label*="close" i]',
            '[role="button"][aria-label*="dismiss" i]',
            'button[class*="close" i]',
            'button[class*="dismiss" i]',
            'a[class*="close" i]',
            'div[class*="close" i]',
            '[data-dismiss="modal"]',
            '[data-close]',
        ];

        function tryCloseInside(container: Element): boolean {
            // try explicit close selectors
            for (const sel of closeSelectors) {
                const btn = container.querySelector(sel);
                if (btn instanceof HTMLElement) {
                    btn.click();
                    return true;
                }
            }
            // try buttons containing SVG (icon-only close buttons)
            const svgButtons = container.querySelectorAll('button');
            for (const btn of Array.from(svgButtons)) {
                if (btn.querySelector('svg') && btn instanceof HTMLElement) {
                    const rect = btn.getBoundingClientRect();
                    if (rect.width < 80 && rect.height < 80) {
                        btn.click();
                        return true;
                    }
                }
            }
            // fallback: small button near top-right corner of container
            const cRect = container.getBoundingClientRect();
            const allBtns = container.querySelectorAll('button, [role="button"]');
            for (const btn of Array.from(allBtns)) {
                const bRect = btn.getBoundingClientRect();
                const isTopRight = bRect.right > cRect.right - 80 && bRect.top < cRect.top + 80;
                const isSmall = bRect.width < 60 && bRect.height < 60;
                if (isTopRight && isSmall && btn instanceof HTMLElement) {
                    btn.click();
                    return true;
                }
            }
            return false;
        }

        // 1. ARIA dialogs
        const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]');
        for (const dialog of Array.from(dialogs)) {
            if (tryCloseInside(dialog)) return true;
        }

        // 2. overlay-style popups (high z-index covering viewport)
        const allEls = Array.from(document.querySelectorAll('*'));
        for (const el of allEls) {
            const style = window.getComputedStyle(el);
            const zIndex = parseInt(style.zIndex, 10);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            if (style.position !== 'fixed' && style.position !== 'absolute') continue;
            if (isNaN(zIndex) || zIndex < 100) continue;

            const rect = el.getBoundingClientRect();
            if (rect.width / window.innerWidth > 0.4 && rect.height / window.innerHeight > 0.4) {
                if (tryCloseInside(el)) return true;
            }
        }

        return false;
    });
}

// detect if a popup is still present (fallback for LLM prompt)
export async function detectPopup(page: Page): Promise<PopupInfo> {
    return await page.evaluate(() => {
        const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]');
        if (dialogs.length > 0) {
            return { detected: true, type: 'dialog', closeHint: 'Close the dialog first.' };
        }

        const allEls = Array.from(document.querySelectorAll('*'));
        for (const el of allEls) {
            const style = window.getComputedStyle(el);
            const zIndex = parseInt(style.zIndex, 10);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            if (style.position !== 'fixed' && style.position !== 'absolute') continue;
            if (isNaN(zIndex) || zIndex < 100) continue;

            const rect = el.getBoundingClientRect();
            if (rect.width / window.innerWidth > 0.4 && rect.height / window.innerHeight > 0.4) {
                const text = el.textContent?.toLowerCase() || '';
                const isCookie = text.includes('cookie') || text.includes('consent') || text.includes('accept all');
                return {
                    detected: true,
                    type: isCookie ? 'cookie-banner' : 'overlay',
                    closeHint: isCookie
                        ? 'Accept cookies or dismiss the banner.'
                        : 'A popup is blocking the page. Dismiss it first.'
                };
            }
        }

        return { detected: false, type: 'none', closeHint: '' };
    });
}
