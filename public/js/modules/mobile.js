/**
 * mobile.js
 * Fork-local mobile layer (RobbyC231/ViniPlay, branch `mobile`).
 *
 * Owns the JS side of mobile behaviour; the CSS side is /css/mobile.css. Keep fork
 * changes here and in that stylesheet so rebases onto upstream touch as few upstream
 * lines as possible. See the Obsidian note "ViniPlay Stack".
 */

import { UIElements } from './state.js';

// Scroll distance (px) in one direction before the header reacts. Finger jitter and
// the tail of a momentum fling stay under these, so the header no longer flickers.
const HIDE_AFTER_PX = 32;
const SHOW_AFTER_PX = 48;
// Must match the transition duration in mobile.css. Scroll events inside this window
// come from our own layout change (the guide growing/shrinking), not the user.
const TOGGLE_SETTLE_MS = 260;

/**
 * Entry point, called once after the main app's listeners are set up.
 */
export function initMobile() {
    setupAutoHideHeader();
}

/**
 * Auto-hides the app + guide headers while the guide scrolls down, and brings them back
 * on a deliberate scroll up.
 *
 * Replaces upstream's handler, which on touch devices:
 *  - collapsed the headers with an animated max-height, resizing the scroller every frame
 *    and shifting the grid ~200px under the finger;
 *  - oscillated at the bottom of the list: collapsing grows the scroller, the browser
 *    clamps scrollTop, that reads as an upward scroll and re-shows the header, forever;
 *  - reacted to 1px of upward jitter and to horizontal pans of the timeline;
 *  - could hide the header while the search box or its results were in use.
 *
 * The visible motion is now a compositor-only transform (see mobile.css). State stays
 * in the upstream `header-collapsed` class on #app-container, which ui.js clears on
 * tab changes.
 */
function setupAutoHideHeader() {
    const { appContainer: root, mainHeader, unifiedGuideHeader: guideHeader, guideContainer: scroller, searchResultsContainer: results } = UIElements;
    if (!root || !mainHeader || !guideHeader || !scroller) return;

    let headerHeight = 0;
    const measure = () => {
        // offsetHeight ignores transforms, so this stays correct while collapsed.
        headerHeight = mainHeader.offsetHeight + guideHeader.offsetHeight;
        root.style.setProperty('--vp-header-h', `${headerHeight}px`);
        root.style.setProperty('--vp-guide-header-h', `${guideHeader.offsetHeight}px`);
    };
    new ResizeObserver(measure).observe(mainHeader);
    new ResizeObserver(measure).observe(guideHeader);
    measure();

    const isCollapsed = () => root.classList.contains('header-collapsed');
    let settleUntil = 0;
    const setCollapsed = (collapsed) => {
        if (collapsed === isCollapsed()) return;
        root.classList.toggle('header-collapsed', collapsed);
        settleUntil = performance.now() + TOGGLE_SETTLE_MS;
    };

    // The header must stay put while the user is typing in or picking from it.
    const headerInUse = () =>
        mainHeader.contains(document.activeElement) ||
        guideHeader.contains(document.activeElement) ||
        (results && !results.classList.contains('hidden'));

    root.addEventListener('focusin', (e) => {
        if (guideHeader.contains(e.target) || mainHeader.contains(e.target)) setCollapsed(false);
    });

    let lastTop = scroller.scrollTop;
    let lastLeft = scroller.scrollLeft;
    let travel = 0; // signed distance scrolled in the current direction
    let frame = 0;

    const update = () => {
        frame = 0;
        const top = scroller.scrollTop;
        const left = scroller.scrollLeft;
        const dy = top - lastTop;
        const dx = left - lastLeft;
        lastTop = top;
        lastLeft = left;

        if (headerInUse()) { travel = 0; setCollapsed(false); return; }
        // Near the top (and iOS rubber-band above it) the header is always shown.
        if (top <= headerHeight) { travel = 0; setCollapsed(false); return; }
        // Self-inflicted scroll from our own resize, or the bottom rubber-band: ignore.
        const maxTop = scroller.scrollHeight - scroller.clientHeight;
        if (performance.now() < settleUntil || top >= maxTop - 1) { travel = 0; return; }
        // Lists barely taller than the viewport would flip between scrollable and not.
        if (maxTop < headerHeight * 2) { travel = 0; setCollapsed(false); return; }
        // Panning the timeline sideways is not a request to hide or show anything.
        if (dy === 0 || Math.abs(dx) > Math.abs(dy)) return;

        travel = Math.sign(dy) === Math.sign(travel) ? travel + dy : dy;
        if (travel > HIDE_AFTER_PX) setCollapsed(true);
        else if (travel < -SHOW_AFTER_PX) setCollapsed(false);
    };

    scroller.addEventListener('scroll', () => {
        if (!frame) frame = requestAnimationFrame(update);
    }, { passive: true });
}
