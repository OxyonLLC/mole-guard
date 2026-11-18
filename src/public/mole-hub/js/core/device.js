const MOBILE_BREAKPOINT = 860;
const TABLET_BREAKPOINT = 1180;

function coarsePointer() {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function detectDeviceProfile(nav = {}, width = 1280, height = 720) {
  const ua = String(nav.userAgent || '').toLowerCase();
  const touchPoints = Number(nav.maxTouchPoints || 0);
  const isPhoneUa = /iphone|android.+mobile|windows phone|ipod/.test(ua);
  const isTabletUa = /ipad|tablet|android(?!.*mobile)/.test(ua);
  const touch = coarsePointer() || touchPoints > 0;
  const portrait = height >= width;

  const family = isPhoneUa || (touch && width <= MOBILE_BREAKPOINT)
    ? 'mobile'
    : (isTabletUa || (touch && width <= TABLET_BREAKPOINT) ? 'tablet' : 'desktop');

  return {
    family,
    portrait,
    touch,
    width,
    height,
    preferredLane: family === 'desktop' ? 'web' : 'mobile',
    suggestedGame: family === 'desktop' ? 'diglew' : 'pacmole',
    label:
      family === 'desktop'
        ? 'Desktop / keyboard-first'
        : family === 'tablet'
          ? 'Tablet / hybrid controls'
          : 'Mobile / touch-first',
  };
}

export function applyDeviceProfile(device, html, body) {
  if (!html || !body) return;
  html.dataset.deviceFamily = device.family;
  html.dataset.deviceOrientation = device.portrait ? 'portrait' : 'landscape';
  body.dataset.preferredLane = device.preferredLane;
}
