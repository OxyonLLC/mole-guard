export function detectDeviceProfile() {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrow = window.matchMedia?.('(max-width: 980px)').matches ?? window.innerWidth < 980;
  const touchPoints = Number(navigator.maxTouchPoints || 0);
  const isMobileLike = coarse || narrow || touchPoints > 1;
  return {
    coarse,
    narrow,
    touchPoints,
    isMobileLike,
    recommendedLane: isMobileLike ? 'mobile' : 'web',
  };
}

export function recommendationText(profile = detectDeviceProfile()) {
  return profile.recommendedLane === 'mobile'
    ? '📱 Mobile users: touch-first lane recommended'
    : '🖥️ Desktop users: instant web lane recommended';
}
