// ==UserScript==
// @name         Keyboard Support for Spelling Time
// @namespace    http://tampermonkey.net
// @version      1.5
// @description  Add keyboard support to Spelling Time
// @author       Isaac
// @match        *://*.haydnsbooks.github.io/Spelling-Time/*
// @grant        none
// @updateURL    https://github.com/ilim-cell/Spelling-Time/raw/refs/heads/main/keyboard.meta.js
// @downloadURL  https://github.com/ilim-cell/Spelling-Time/raw/refs/heads/main/keyboard.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Helper to simulate a complete pointer/mouse interaction sequence
    function simulateClick(element) {
        const eventOptions = { bubbles: true, cancelable: true, view: window };
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(eventType => {
            const mouseEvt = new MouseEvent(eventType, eventOptions);
            element.dispatchEvent(mouseEvt);
        });
    }

    // Helper to find specific key buttons or primary action buttons
    function findButton(key) {
        const buttons = Array.from(document.querySelectorAll('button'));

        return buttons.find(button => {
            const buttonText = (button.textContent || button.innerText || '').replace(/\s+/g, '').toLowerCase();
            const ariaLabel = (button.getAttribute('aria-label') || '').replace(/\s+/g, '').toLowerCase();
            const classList = button.className.toLowerCase();
            const id = button.id.toLowerCase();

            // Handle Enter key: triggers any primary buttons (e.g., #n.btn.primary, #sub.btn.primary, or any class containing 'primary')
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

        // 1. Handle CapsLock gracefully (do nothing and don't block)
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
    });
})();
