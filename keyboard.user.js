// ==UserScript==
// @name         Keyboard Support for Spelling Time
// @namespace    http://tampermonkey.net
// @version      1.4
// @description  Add keyboard support to Spelling Time
// @author       Isaac
// @match        *://*.haydnsbooks.github.io/Spelling-Time/*
// @grant        none
// ==/UserScript==

// IMPORTANT:


// CLICK ON THE "INSTALL" BUTTON ABOVE THIS SCRIPT!





























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

    // Helper to find specific key buttons
    function findButton(key) {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(button => {
            const buttonText = (button.textContent || button.innerText || '').replace(/\s+/g, '').toLowerCase();
            const ariaLabel = (button.getAttribute('aria-label') || '').replace(/\s+/g, '').toLowerCase();
            const classList = button.className.toLowerCase();

            if (key === 'backspace') {
                return classList.includes('k-back') || buttonText === 'delete' || ariaLabel === 'delete';
            }
            if (key === 'arrowleft') {
                return classList.includes('k-left') || buttonText.includes('moveleft') || ariaLabel.includes('moveleft');
            }
            if (key === 'arrowright') {
                return classList.includes('k-right') || buttonText.includes('moveright') || ariaLabel.includes('moveright');
            }
            if (key === ' ' || key === 'spacebar') {
                return buttonText === '' || buttonText.includes('space') || ariaLabel.includes('space');
            }
            if (key === 'enter') {
                return buttonText.includes('enter') || buttonText.includes('go') || ariaLabel.includes('enter');
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

        // Completely ignore native CapsLock handling
        if (pressedKey === 'CapsLock') {
            return;
        }

        // 1. Try finding the key directly in the current view
        let targetButton = findButton(lowerKey);

        if (targetButton) {
            event.preventDefault();
            simulateClick(targetButton);
        } else {
            // 2. If not found, it's likely hidden in the symbols panel
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
