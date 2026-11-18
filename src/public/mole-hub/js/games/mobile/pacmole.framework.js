export function createPacMoleTouchFramework({ engagement }) {
  return {
    id: 'pacmole',
    lane: 'mobile',
    label: 'Pac-Mole Touch',
    shareHighlight: 'a beetle-clearing streak',
    controlSurface: 'swipe-touch',
    layout: 'portrait-optimized',
    coreLoop: 'swipe lane choice → clear worms → trigger power mode → cash in streak',
    difficultyModel: `enemy pressure ${engagement.difficultyBand(7, 'mobile')}x by later boards`,
    retentionHook: 'short sessions, level unlocks, and shareable clutch clears',
    renderHints: {
      minCanvasWidth: 320,
      sidebarPriority: 'collapsed',
      assistOverlay: true,
    },
  };
}
