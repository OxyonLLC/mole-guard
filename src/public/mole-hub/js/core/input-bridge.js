function sendKey(key) {
  const code = key === 'Space' ? 'Space' : key;
  const evt = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true });
  window.dispatchEvent(evt);
}

function attachButton(root, action, key) {
  const el = root.querySelector(`[data-touch-action="${action}"]`);
  if (!el) return;
  const fire = (event) => {
    event.preventDefault();
    sendKey(key);
  };
  el.addEventListener('pointerdown', fire);
  el.addEventListener('click', fire);
}

function attachSwipe(surface, buttonMap) {
  if (!surface) return;
  let startX = 0;
  let startY = 0;
  let active = false;
  const threshold = 28;

  surface.addEventListener('touchstart', (event) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
    active = true;
  }, { passive: true });

  surface.addEventListener('touchend', (event) => {
    if (!active) return;
    const touch = event.changedTouches?.[0];
    active = false;
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
    if (Math.abs(dx) > Math.abs(dy)) sendKey(dx > 0 ? buttonMap.right : buttonMap.left);
    else sendKey(dy > 0 ? buttonMap.down : buttonMap.up);
  }, { passive: true });
}

export function initTouchBridge({ device, laneSelector, controlsRootId, swipeSurfaceId, buttonMap }) {
  const controls = document.getElementById(controlsRootId);
  const laneGame = document.querySelector(laneSelector);
  const swipeSurface = document.getElementById(swipeSurfaceId);
  if (!controls || !laneGame) return;

  if (device.family === 'desktop') {
    controls.classList.add('hidden');
    return;
  }

  controls.classList.remove('hidden');
  Object.entries(buttonMap).forEach(([action, key]) => attachButton(controls, action, key));
  attachSwipe(swipeSurface, buttonMap);
}
