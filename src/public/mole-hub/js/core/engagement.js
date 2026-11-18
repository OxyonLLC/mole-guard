function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createEngagementSystem({ shareBaseUrl = '' } = {}) {
  return {
    buildSharePrompt(game) {
      const laneLabel = game.lane === 'web' ? 'desktop lane' : 'mobile lane';
      return `I just hit ${game.shareHighlight} in the WinLEW Gaming Hub ${laneLabel}. ${shareBaseUrl}?game=${game.id}`;
    },
    rewardBand(progression, lane) {
      const base = lane === 'web' ? 1.15 : 1;
      const curve = 1 + clamp(progression / 18, 0, 1.35);
      return Number((base * curve).toFixed(2));
    },
    difficultyBand(index, lane) {
      const start = lane === 'web' ? 1 : 0.85;
      const ramp = lane === 'web' ? 0.14 : 0.11;
      return Number((start + index * ramp).toFixed(2));
    },
    sessionHookSummary(game) {
      return [
        `${game.label}: ${game.coreLoop}`,
        `Escalation: ${game.difficultyModel}`,
        `Retention hook: ${game.retentionHook}`,
      ];
    },
  };
}
