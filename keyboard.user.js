// ==UserScript==
// @name         Keyboard Support for Spelling Time
// @namespace    http://tampermonkey.net
// @version      2.9
// @description  Intercept Ctrl/Cmd shortcuts, block Enter key repeat, fast paste, undo/redo, and keyboard support for Spelling Time with fallback button selectors
// @author       Isaac
// @match        *://*.haydnsbooks.github.io/Spelling-Time/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://github.com/ilim-cell/Spelling-Time/raw/refs/heads/main/keyboard.meta.js
// @downloadURL  https://github.com/ilim-cell/Spelling-Time/raw/refs/heads/main/keyboard.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- Default Settings ---
    const DEFAULT_SETTINGS = {
        enableHintKey: true,
        hintKeyCode: 'Backquote', // Physical ` key
        hintKeyLabel: '`',
        hideOnScreenKeyboard: true
    };

    // Exact data-k values supported by KB.rows() in Spelling Time
    const SYM_LAYER_KEYS = new Set([
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
        '-', ':', ';', '(', ')', '"', "'", '%',
        '?', '!', ',', '.'
    ]);

    const SHIFT_TO_SYM_KEY = {
        '?': '?',
        '!': '!',
        '"': '"',
        ':': ':',
        ';': ';',
        '(': '(',
        ')': ')',
        '%': '%',
        '_': '-',
        '+': '=',
        '<': ',',
        '>': '.'
    };

    const CODE_TO_BASE_KEY = {
        Backquote: '`',
        Digit1: '1',
        Digit2: '2',
        Digit3: '3',
        Digit4: '4',
        Digit5: '5',
        Digit6: '6',
        Digit7: '7',
        Digit8: '8',
        Digit9: '9',
        Digit0: '0',
        Minus: '-',
        Equal: '=',
        BracketLeft: '[',
        BracketRight: ']',
        Backslash: '\\',
        Semicolon: ';',
        Quote: "'",
        Comma: ',',
        Period: '.',
        Slash: '/'
    };

    function getSetting(key) {
        return GM_getValue(key, DEFAULT_SETTINGS[key]);
    }

    function setSetting(key, value) {
        GM_setValue(key, value);
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function nextFrame() {
        return new Promise(resolve => requestAnimationFrame(() => resolve()));
    }

    function normalizeLabel(el) {
        return (el.textContent || el.innerText || '').trim();
    }

    function isVisibleAndEnabled(el) {
        if (!el || el.disabled) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    // --- Tampermonkey Menu Settings ---
    function registerSettingsMenu() {
        const hintEnabled = getSetting('enableHintKey');
        const hintLabel = getSetting('hintKeyLabel');
        const hideKb = getSetting('hideOnScreenKeyboard');

        GM_registerMenuCommand(
            `Hint Shortcut (${hintLabel}): ${hintEnabled ? 'ON' : 'OFF'}`,
            () => {
                setSetting('enableHintKey', !hintEnabled);
                location.reload();
            }
        );

        GM_registerMenuCommand(
            `Set Hint Key (Current: ${hintLabel})`,
            () => {
                const input = prompt(
                    'Enter a single character or key name for Hint (e.g., `, /, ?, h):',
                    hintLabel
                );
                if (input !== null && input.trim() !== '') {
                    const clean = input.trim();
                    setSetting('hintKeyLabel', clean);
                    setSetting('hintKeyCode', clean === '`' ? 'Backquote' : '');
                    location.reload();
                }
            }
        );

        GM_registerMenuCommand(
            `Hide On-Screen Keyboard: ${hideKb ? 'ON' : 'OFF'}`,
            () => {
                setSetting('hideOnScreenKeyboard', !hideKb);
                location.reload();
            }
        );
    }

    registerSettingsMenu();

    // 1. Inject CSS to hide on-screen keyboard containers if enabled in settings
    if (getSetting('hideOnScreenKeyboard')) {
        const style = document.createElement('style');
        style.innerHTML = `
            div#kb,
            .wgk-wrap,
            .hk-wrap {
                position: absolute !important;
                left: -9999px !important;
                top: -9999px !important;
                opacity: 0 !important;
                pointer-events: none !important;
                height: 0 !important;
                overflow: hidden !important;
            }
        `;
        document.head.appendChild(style);
    }

    // --- Undo / Redo History ---
    const undoStack = [];
    const redoStack = [];
    let isReplayingHistory = false;
    let pendingPasteFromKeydown = false;

    function recordAction(action) {
        if (isReplayingHistory || !action) return;
        undoStack.push(action);
        redoStack.length = 0;
    }

    function isEditableTarget(el) {
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' ||
               tag === 'TEXTAREA' ||
               tag === 'SELECT' ||
               el.isContentEditable;
    }

    function isNativeButtonFocused(el) {
        return Boolean(el && el.tagName === 'BUTTON' && el.id !== 'hint');
    }

    // KB.press listens to pointerdown on #kb
    function clickKbElement(el) {
        if (!el || el.disabled) return false;

        if (typeof PointerEvent !== 'undefined') {
            el.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: 1,
                composed: true
            }));
        } else {
            el.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: 1
            }));
        }
        return true;
    }

    function clickActionButton(el) {
        if (!el || el.disabled) return false;

        const opts = {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1
        };

        if (typeof PointerEvent !== 'undefined') {
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
        }
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        if (typeof PointerEvent !== 'undefined') {
            el.dispatchEvent(new PointerEvent('pointerup', opts));
        }
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        return true;
    }

    // --- Layout Detection & Fallback Button Resolution ---
    function hasDefaultKbLayout() {
        const kb = document.getElementById('kb');
        return Boolean(kb && kb.querySelector('button[data-k]'));
    }

    function hasWgkLayout() {
        return document.querySelectorAll('button.wgk').length > 0;
    }

    function hasHkLayout() {
        return document.querySelectorAll('button.hk').length > 0;
    }

    function findWgkLetterButton(upperChar) {
        const buttons = Array.from(document.querySelectorAll('button.wgk:not(.wide)'));
        return buttons.find(btn => normalizeLabel(btn).toUpperCase() === upperChar && !btn.disabled) || null;
    }

    function findWgkWideButton(targetLabel) {
        const lowerTarget = targetLabel.toLowerCase();
        const buttons = Array.from(document.querySelectorAll('button.wgk.wide'));
        return buttons.find(btn => normalizeLabel(btn).toLowerCase() === lowerTarget && !btn.disabled) || null;
    }

    function findHkLetterButton(upperChar) {
        const buttons = Array.from(document.querySelectorAll('button.hk'));
        return buttons.find(btn => normalizeLabel(btn).toUpperCase() === upperChar && !btn.disabled) || null;
    }

    function findKbDataKeyButton(dataKey) {
        const kb = document.getElementById('kb');
        if (!kb) return null;
        const buttons = Array.from(kb.querySelectorAll('button[data-k]'));
        return buttons.find(btn => btn.getAttribute('data-k') === dataKey && !btn.disabled) || null;
    }

    function findBackButton() {
        if (hasDefaultKbLayout()) {
            return findKbDataKeyButton('back');
        }
        if (hasWgkLayout()) {
            return findWgkWideButton('Delete');
        }
        return null;
    }

    function findEnterButton() {
        if (hasWgkLayout()) {
            const wgkEnter = findWgkWideButton('Enter');
            if (wgkEnter) return wgkEnter;
        }

        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(button => {
            const buttonText = (button.textContent || button.innerText || '').replace(/\s+/g, '').toLowerCase();
            const ariaLabel = (button.getAttribute('aria-label') || '').replace(/\s+/g, '').toLowerCase();
            const classList = button.className.toLowerCase();
            const id = button.id.toLowerCase();
            return classList.includes('primary') ||
                   id === 'n' ||
                   id === 'sub' ||
                   buttonText.includes('enter') ||
                   buttonText.includes('go') ||
                   ariaLabel.includes('enter');
        });
    }

    function resolveTargetDataKey(rawKey, code = '') {
        if (rawKey === ' ') return 'space';
        if (rawKey === 'Backspace') return 'back';
        if (rawKey === 'ArrowLeft') return 'left';
        if (rawKey === 'ArrowRight') return 'right';

        if (SHIFT_TO_SYM_KEY[rawKey]) {
            return SHIFT_TO_SYM_KEY[rawKey];
        }

        const lower = String(rawKey).toLowerCase();
        if (/^[a-z0-9]$/.test(lower)) {
            return lower;
        }
        if (SYM_LAYER_KEYS.has(lower)) {
            return lower;
        }

        if (code && CODE_TO_BASE_KEY[code]) {
            const base = CODE_TO_BASE_KEY[code].toLowerCase();
            if (SHIFT_TO_SYM_KEY[base]) return SHIFT_TO_SYM_KEY[base];
            if (SYM_LAYER_KEYS.has(base) || /^[a-z0-9]$/.test(base)) {
                return base;
            }
        }

        return null;
    }

    function shouldUppercaseLetter(rawKey, shiftKey) {
        return Boolean(shiftKey || /^[A-Z]$/.test(rawKey));
    }

    async function hitShiftThenLetter(dataKey) {
        const shiftBtn = findKbDataKeyButton('shift');
        if (shiftBtn) {
            clickKbElement(shiftBtn);
            await nextFrame();
        }
        const letterBtn = findKbDataKeyButton(dataKey);
        if (!letterBtn) return false;
        return clickKbElement(letterBtn);
    }

    async function waitForKbDataKey(dataKey, maxWaitMs = 200) {
        const start = performance.now();
        while (performance.now() - start < maxWaitMs) {
            const btn = findKbDataKeyButton(dataKey);
            if (btn) return btn;
            await delay(15);
        }
        return null;
    }

    function resolveUpperLetter(rawKey, code = '') {
        if (/^[a-zA-Z]$/.test(rawKey)) {
            return rawKey.toUpperCase();
        }
        if (code && /^Key([A-Z])$/.test(code)) {
            return code.replace(/^Key/, '').toUpperCase();
        }
        return null;
    }

    async function typeViaFallbackKeyboards(rawKey, code = '') {
        if (rawKey === 'Backspace') {
            const delBtn = findWgkWideButton('Delete');
            return delBtn ? clickActionButton(delBtn) : false;
        }

        const upperLetter = resolveUpperLetter(rawKey, code);
        if (!upperLetter) return false;

        if (hasWgkLayout()) {
            const wgkBtn = findWgkLetterButton(upperLetter);
            if (wgkBtn) return clickActionButton(wgkBtn);
        }

        if (hasHkLayout()) {
            const hkBtn = findHkLetterButton(upperLetter);
            if (hkBtn) return clickActionButton(hkBtn);
        }

        return false;
    }

    async function typeKeyAsync(rawKey, code = '', shiftKey = false) {
        if (rawKey === 'Enter') {
            const enterBtn = findEnterButton();
            if (enterBtn) {
                clickActionButton(enterBtn);
                return true;
            }
            return false;
        }

        if (!hasDefaultKbLayout()) {
            return typeViaFallbackKeyboards(rawKey, code);
        }

        const dataKey = resolveTargetDataKey(rawKey, code);
        if (!dataKey) return false;

        const directBtn = findKbDataKeyButton(dataKey);
        if (directBtn) {
            if (/^[a-z]$/.test(dataKey) && shouldUppercaseLetter(rawKey, shiftKey)) {
                return hitShiftThenLetter(dataKey);
            }
            return clickKbElement(directBtn);
        }

        if (SYM_LAYER_KEYS.has(dataKey)) {
            const symBtn = findKbDataKeyButton('sym');
            if (!symBtn) return false;

            clickKbElement(symBtn);
            const symKeyBtn = await waitForKbDataKey(dataKey, 200);
            let typed = false;

            if (symKeyBtn) {
                typed = clickKbElement(symKeyBtn);
            }

            const abcBtn = findKbDataKeyButton('abc');
            if (abcBtn) {
                await delay(15);
                clickKbElement(abcBtn);
            }

            return typed;
        }

        return false;
    }

    async function pasteStringFast(text, options = {}) {
        const shouldRecord = options.record !== false;
        const chars = Array.from(text).filter(ch => ch !== '\r');
        const insertedEntries = [];
        const useDefaultKb = hasDefaultKbLayout();

        for (let i = 0; i < chars.length; i++) {
            const ch = chars[i];

            if (ch === '\n') {
                const enterBtn = findEnterButton();
                if (enterBtn) clickActionButton(enterBtn);
                continue;
            }

            if (!useDefaultKb) {
                const ok = await typeViaFallbackKeyboards(ch, '');
                if (ok) {
                    insertedEntries.push({ rawKey: ch, code: '' });
                }
                continue;
            }

            const dataKey = resolveTargetDataKey(ch);
            if (!dataKey) continue;

            const directBtn = findKbDataKeyButton(dataKey);
            if (directBtn) {
                const isUpper = /^[a-z]$/.test(dataKey) && /^[A-Z]$/.test(ch);
                const ok = isUpper
                    ? await hitShiftThenLetter(dataKey)
                    : clickKbElement(directBtn);
                if (ok) {
                    insertedEntries.push({ rawKey: ch, code: '' });
                }
                continue;
            }

            if (SYM_LAYER_KEYS.has(dataKey)) {
                const symBtn = findKbDataKeyButton('sym');
                if (symBtn) {
                    clickKbElement(symBtn);
                    const symKeyBtn = await waitForKbDataKey(dataKey, 200);
                    if (symKeyBtn && clickKbElement(symKeyBtn)) {
                        insertedEntries.push({ rawKey: ch, code: '' });
                    }

                    const abcBtn = findKbDataKeyButton('abc');
                    if (abcBtn) {
                        await delay(15);
                        clickKbElement(abcBtn);
                        await waitForKbDataKey('a', 120);
                    }
                }
            }
        }

        if (shouldRecord && insertedEntries.length > 0) {
            recordAction({ type: 'paste', entries: insertedEntries });
        }
    }

    function triggerBackAction() {
        if (hasDefaultKbLayout()) {
            const backBtn = findKbDataKeyButton('back');
            if (backBtn) {
                clickKbElement(backBtn);
                return true;
            }
        } else if (hasWgkLayout()) {
            const delBtn = findWgkWideButton('Delete');
            if (delBtn) {
                clickActionButton(delBtn);
                return true;
            }
        }
        return false;
    }

    async function performUndo() {
        const action = undoStack.pop();
        if (!action) return;

        isReplayingHistory = true;
        try {
            if (action.type === 'key' || action.type === 'back') {
                triggerBackAction();
            } else if (action.type === 'paste') {
                for (let i = 0; i < action.entries.length; i++) {
                    triggerBackAction();
                }
            }
            redoStack.push(action);
        } finally {
            isReplayingHistory = false;
        }
    }

    async function performRedo() {
        const action = redoStack.pop();
        if (!action) return;

        isReplayingHistory = true;
        try {
            if (action.type === 'key') {
                await typeKeyAsync(action.rawKey, action.code || '', Boolean(action.shiftKey));
            } else if (action.type === 'paste') {
                await pasteStringFast(action.entries.map(e => e.rawKey).join(''), { record: false });
            } else if (action.type === 'back') {
                triggerBackAction();
            }
            undoStack.push(action);
        } finally {
            isReplayingHistory = false;
        }
    }

    function extractSpelledText() {
        const slotSelectors = [
            '[class*="slot"]:not([class*="kb"]):not([class*="wgk"]):not([class*="hk"])',
            '[class*="letter"]:not([class*="kb"]):not([class*="wgk"]):not([class*="hk"])',
            '[class*="tile"]:not([class*="kb"]):not([class*="wgk"]):not([class*="hk"])',
            '[class*="char"]:not([class*="kb"]):not([class*="wgk"]):not([class*="hk"])',
            '[data-letter]'
        ];

        for (const selector of slotSelectors) {
            const nodes = Array.from(document.querySelectorAll(selector)).filter(
                el => !el.closest('#kb, .wgk, .hk')
            );
            if (nodes.length > 0) {
                const text = nodes
                    .map(el => el.dataset.letter || el.textContent || '')
                    .join('')
                    .trim();
                if (text) return text;
            }
        }

        return '';
    }

    function copyTextToClipboard(text) {
        if (!text) return;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).catch(() => {});
        }
    }

    function handlePasteFromText(text) {
        if (!text) return;
        const cleanText = text.trim();
        if (!cleanText) return;
        pasteStringFast(cleanText, { record: true });
    }

    window.addEventListener('paste', function(event) {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        pendingPasteFromKeydown = false;

        const pasted = event.clipboardData && event.clipboardData.getData('text');
        if (pasted) {
            handlePasteFromText(pasted);
        } else if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
            navigator.clipboard.readText()
                .then(text => handlePasteFromText(text))
                .catch(() => {});
        }
    }, true);

    window.addEventListener('copy', function(event) {
        if (isEditableTarget(event.target)) return;
        const selection = window.getSelection ? String(window.getSelection()).trim() : '';
        if (selection) return;

        const spelled = extractSpelledText();
        if (spelled && event.clipboardData) {
            event.preventDefault();
            event.stopPropagation();
            event.clipboardData.setData('text/plain', spelled);
        }
    }, true);

    window.addEventListener('keydown', function(event) {
        if (isEditableTarget(event.target)) {
            return;
        }

        const primaryMod = event.ctrlKey || event.metaKey;
        const hasModifier = primaryMod || event.altKey;
        const pressedKey = event.key;
        const lowerKey = pressedKey.toLowerCase();

        if (event.repeat && (pressedKey === 'Enter' || pressedKey === 'Delete')) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (primaryMod && !event.altKey) {
            if (lowerKey === 'v' && !event.shiftKey) {
                event.preventDefault();
                event.stopPropagation();
                pendingPasteFromKeydown = true;
                if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                    navigator.clipboard.readText()
                        .then(text => {
                            if (pendingPasteFromKeydown && text) {
                                pendingPasteFromKeydown = false;
                                handlePasteFromText(text);
                            }
                        })
                        .catch(() => {});
                }
                return;
            }

            if (lowerKey === 'c' && !event.shiftKey) {
                const selection = window.getSelection ? String(window.getSelection()).trim() : '';
                if (!selection) {
                    const spelled = extractSpelledText();
                    if (spelled) {
                        event.preventDefault();
                        event.stopPropagation();
                        copyTextToClipboard(spelled);
                    }
                }
                return;
            }

            if (lowerKey === 'z' && !event.shiftKey) {
                event.preventDefault();
                event.stopPropagation();
                performUndo();
                return;
            }

            if ((lowerKey === 'y' && !event.shiftKey) || (lowerKey === 'z' && event.shiftKey)) {
                event.preventDefault();
                event.stopPropagation();
                performRedo();
                return;
            }
        }

        if (
            hasModifier ||
            /^F\d+$/.test(pressedKey) ||
            pressedKey === 'Escape' ||
            pressedKey === 'Tab' ||
            pressedKey === 'Shift' ||
            pressedKey === 'Control' ||
            pressedKey === 'Alt' ||
            pressedKey === 'Meta'
        ) {
            return;
        }

        // 0. Handle Hint shortcut (defaults to Backquote / `)
        if (getSetting('enableHintKey')) {
            const targetCode = getSetting('hintKeyCode');
            const targetLabel = getSetting('hintKeyLabel').toLowerCase();
            const isHintMatch = (targetCode && event.code === targetCode) ||
                                (lowerKey === targetLabel) ||
                                (targetLabel === '`' && (pressedKey === '`' || pressedKey === '~' || event.code === 'Backquote'));

            if (isHintMatch) {
                if (event.repeat) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                const hintBtn = document.querySelector('button#hint.btn.small') || document.getElementById('hint');
                if (hintBtn) {
                    event.preventDefault();
                    event.stopPropagation();
                    clickActionButton(hintBtn);
                }
                return;
            }
        }

        // 1. Handle CapsLock gracefully
        if (pressedKey === 'CapsLock') {
            return;
        }

        if (isNativeButtonFocused(event.target) && (pressedKey === 'Enter' || pressedKey === ' ')) {
            return;
        }

        // 2. Handle Forward Delete key
        if (pressedKey === 'Delete') {
            event.preventDefault();
            if (hasDefaultKbLayout()) {
                const rightBtn = findKbDataKeyButton('right');
                const backBtn = findKbDataKeyButton('back');
                if (rightBtn && backBtn) {
                    clickKbElement(rightBtn);
                    clickKbElement(backBtn);
                    recordAction({ type: 'back' });
                }
            } else if (hasWgkLayout()) {
                const delBtn = findWgkWideButton('Delete');
                if (delBtn) {
                    clickActionButton(delBtn);
                    recordAction({ type: 'back' });
                }
            }
            return;
        }

        // 3. Handle typing via #kb data-k buttons, or fallback to button.wgk / button.hk
        const useDefaultKb = hasDefaultKbLayout();
        const mappedDataKey = useDefaultKb
            ? resolveTargetDataKey(pressedKey, event.shiftKey ? event.code : '')
            : resolveUpperLetter(pressedKey, event.code);

        if (mappedDataKey || pressedKey === 'Enter') {
            event.preventDefault();
            typeKeyAsync(pressedKey, useDefaultKb && event.shiftKey ? event.code : '', useDefaultKb && event.shiftKey).then(typed => {
                if (typed && pressedKey !== 'Enter') {
                    recordAction({
                        type: mappedDataKey === 'back' ? 'back' : 'key',
                        rawKey: pressedKey,
                        code: useDefaultKb && event.shiftKey ? event.code : '',
                        shiftKey: useDefaultKb && event.shiftKey
                    });
                }
            });
        }
    }, true);
})();
