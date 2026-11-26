// ==UserScript==
// @name         Keyboard Support for Spelling Time
// @namespace    http://tampermonkey.net
// @version      2.0
// @description  Add keyboard support and customizable settings to Spelling Time
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

    function getSetting(key) {
        return GM_getValue(key, DEFAULT_SETTINGS[key]);
    }

    function setSetting(key, value) {
        GM_setValue(key, value);
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

    // 1. Inject CSS to hide div#kb if enabled in settings
    if (getSetting('hideOnScreenKeyboard')) {
        const style = document.createElement('style');
        style.innerHTML = `
            div#kb {
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

    // Helper to simulate a complete pointer/mouse interaction sequence
    function simulateClick(element) {
        if (!element || element.disabled) return;

        // Omit `view: window` because Tampermonkey's sandboxed `window` proxy fails UIEventInit validation
        const eventOptions = {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1
        };

        if (typeof PointerEvent !== 'undefined') {
            element.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
        }
        element.dispatchEvent(new MouseEvent('mousedown', eventOptions));

        if (typeof PointerEvent !== 'undefined') {
            element.dispatchEvent(new PointerEvent('pointerup', eventOptions));
        }
        element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
        element.dispatchEvent(new MouseEvent('click', eventOptions));
    }

    // Helper to find specific key buttons or primary action buttons
    function findButton(key) {
        const buttons = Array.from(document.querySelectorAll('button'));

        return buttons.find(button => {
            const buttonText = (button.textContent || button.innerText || '').replace(/\s+/g, '').toLowerCase();
            const ariaLabel = (button.getAttribute('aria-label') || '').replace(/\s+/g, '').toLowerCase();
            const classList = button.className.toLowerCase();
            const id = button.id.toLowerCase();

            // Handle Enter key
            if (key === 'enter') {
                return classList.includes('primary') ||
                       id === 'n' ||
                       id === 'sub' ||
                       buttonText.includes('enter') ||
                       buttonText.includes('go') ||
                       ariaLabel.includes('enter');
            }

            // Handle Backspace
            if (key === 'backspace') {
                return classList.includes('k-back') || buttonText === 'delete' || ariaLabel === 'delete';
            }

            // Handle Arrow Keys
            if (key === 'arrowleft') {
                return classList.includes('k-left') || buttonText.includes('moveleft') || ariaLabel.includes('moveleft');
            }
            if (key === 'arrowright') {
                return classList.includes('k-right') || buttonText.includes('moveright') || ariaLabel.includes('moveright');
            }

            // Handle Spacebar
            if (key === ' ' || key === 'spacebar') {
                return buttonText === '' || buttonText.includes('space') || ariaLabel.includes('space');
            }

            return buttonText === key || ariaLabel === key;
        });
    }

    // Helper to locate layout switching toggles (.k-sym or .k-abc)
    function findLayoutButton(type) {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(button => {
            const classList = button.className.toLowerCase();
            const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
            const buttonText = (button.textContent || button.innerText || '').toLowerCase();

            if (type === 'sym') {
                return classList.includes('k-sym') || ariaLabel.includes('numbers') || buttonText.includes('123');
            }
            if (type === 'abc') {
                return classList.includes('k-abc') || ariaLabel.includes('letters') || buttonText.includes('abc');
            }
            return false;
        });
    }

    window.addEventListener('keydown', function(event) {
        // Skip script trigger if typing inside an actual input/textarea field
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
            return;
        }

        const pressedKey = event.key;
        const lowerKey = pressedKey.toLowerCase();

        // 0. Handle Hint shortcut (defaults to Backquote / `)
        if (getSetting('enableHintKey')) {
            const targetCode = getSetting('hintKeyCode');
            const targetLabel = getSetting('hintKeyLabel').toLowerCase();
            const isHintMatch = (targetCode && event.code === targetCode) ||
                                (lowerKey === targetLabel) ||
                                (targetLabel === '`' && (pressedKey === '`' || pressedKey === '~' || event.code === 'Backquote'));

            if (isHintMatch) {
                const hintBtn = document.querySelector('button#hint.btn.small') || document.getElementById('hint');
                if (hintBtn) {
                    event.preventDefault();
                    event.stopPropagation();
                    simulateClick(hintBtn);
                }
                return;
            }
        }

        // 1. Handle CapsLock gracefully
        if (pressedKey === 'CapsLock') {
            return;
        }

        // 2. Handle Forward Delete key by emulating a move right followed by backspace
        if (pressedKey === 'Delete') {
            event.preventDefault();
            const rightBtn = findButton('arrowright');
            const backBtn = findButton('backspace');

            if (rightBtn && backBtn) {
                simulateClick(rightBtn);
                setTimeout(() => {
                    simulateClick(backBtn);
                }, 10);
            }
            return;
        }

        // 3. Try finding the key directly in the current view
        let targetButton = findButton(lowerKey);

        if (targetButton) {
            event.preventDefault();
            simulateClick(targetButton);
        } else {
            // 4. If not found, it's likely hidden in the symbols panel
            const symButton = findLayoutButton('sym');

            if (symButton) {
                event.preventDefault();

                // Open symbols layout
                simulateClick(symButton);

                // Execute layout switch, character press, and reversion seamlessly
                setTimeout(() => {
                    const targetButtonSym = findButton(lowerKey);
                    if (targetButtonSym) {
                        simulateClick(targetButtonSym);
                    }

                    // Instantly switch back to standard text layout
                    const abcButton = findLayoutButton('abc');
                    if (abcButton) {
                        simulateClick(abcButton);
                    }
                }, 0);
            }
        }
    }, true);
})();
