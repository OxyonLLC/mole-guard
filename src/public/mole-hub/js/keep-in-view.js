// Keeps the game on screen on phones when a round ends (2026-10-24). At the end of a round some
// games reveal panels around the canvas (DigLEW's .diglew-ended-run shows the sidebar, about
// 1,450 px, ABOVE the canvas on a phone). The page doubles in height and the browser's scroll
// anchoring leaves the player at the footer. So: no scroll anchoring, and when the page changes
// size while the game is off screen, scroll back to it, unless the player was just scrolling.
// A touch that moves the page counts as scrolling; touches that only play the game don't.
// Inside the arcade frame, xl1/arcade/play/reward-bridge.js does this job, so this steps aside.
(() => {
  if (window !== window.top) return;
  const STAGE = '.view:not(.hidden):not(#hubView) canvas, .view:not(.hidden):not(#hubView) .mole-spades-board';
  const style = document.createElement('style');
  style.textContent = 'html{overflow-anchor:none}';
  document.head.appendChild(style);

  let scrolledAt = 0;
  let pending = 0;
  let touchY = null;
  window.addEventListener('touchstart', () => { touchY = window.scrollY; }, { passive: true, capture: true });
  const onTouch = () => { if (touchY !== null && Math.abs(window.scrollY - touchY) > 8) scrolledAt = Date.now(); };
  window.addEventListener('touchmove', onTouch, { passive: true, capture: true });
  let liftedAt = 0;
  window.addEventListener('touchend', () => { onTouch(); if (Date.now() - scrolledAt < 100) liftedAt = Date.now(); touchY = null; }, { passive: true, capture: true });
  // A flick keeps scrolling after the finger lifts.
  window.addEventListener('scroll', () => { if (Date.now() - liftedAt < 2000) scrolledAt = Date.now(); }, { passive: true });
  window.addEventListener('wheel', () => { scrolledAt = Date.now(); }, { passive: true, capture: true });
  window.addEventListener('keydown', (e) => { if (/^(PageUp|PageDown|Home|End)$/.test(e.key)) scrolledAt = Date.now(); }, { capture: true });

  const keepGameInView = () => {
    if (pending || Date.now() - scrolledAt < 3000) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      const stage = document.querySelector(STAGE);
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      if (r.height === 0 || (r.bottom > 0 && r.top < window.innerHeight)) return;
      window.scrollTo({ top: Math.max(0, r.top + window.scrollY), behavior: 'auto' });
    });
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(keepGameInView).observe(document.body);
})();
