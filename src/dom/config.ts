/** Attributes we keep for the LLM representation */
export const LLM_INCLUDE_ATTRIBUTES = new Set([
    'id', 'type', 'placeholder', 'aria-label', 'aria-expanded',
    'aria-checked', 'aria-selected', 'aria-disabled', 'role',
    'href', 'value', 'checked', 'disabled', 'readonly',
    'name', 'for', 'autocomplete', 'data-testid', 'title', 'alt', 'src',
]);

/** Tags that are always pruned */
export const PRUNED_TAGS = new Set([
    'script', 'style', 'link', 'meta', 'noscript',
    'svg', 'path', 'br', 'hr', 'head', 'template', 'iframe',
]);

/** Interactive element selectors */
export const INTERACTIVE_SELECTORS = [
    'a', 'button', 'input', 'select', 'textarea', 'label',
    '[role="button"]', '[role="link"]', '[role="checkbox"]',
    '[role="radio"]', '[role="tab"]', '[role="menuitem"]',
    '[role="option"]', '[role="switch"]', '[role="combobox"]',
    '[role="textbox"]', '[role="searchbox"]',
    '[contenteditable="true"]',
];

/** CSS class patterns to strip (transient/dynamic states) */
export const DYNAMIC_CLASS_PATTERNS = [
    /hover/i, /active/i, /focus/i, /visited/i, /selected/i,
    /highlight/i, /animate/i, /transition/i, /fade/i,
    /slide/i, /pulse/i, /shake/i,
];
