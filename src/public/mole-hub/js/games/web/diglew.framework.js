export function createDiglewFramework({ engagement }) {
  return {
    id: 'diglew',
    lane: 'web',
    label: 'DigLEW',
    shareHighlight: 'a colony-cashout run',
    controlSurface: 'keyboard-mouse',
    layout: 'wide-canvas',
    coreLoop: 'upgrade colony → run maze → bank haul → reveal reward',
    difficultyModel: `pathing pressure ${engagement.difficultyBand(5, 'web')}x by mid-run`,
    retentionHook: 'persistent colony upgrades and best-run leaderboards',
    renderHints: {
      minCanvasWidth: 920,
      sidebarPriority: 'high',
      assistOverlay: false,
    },
  };
}
