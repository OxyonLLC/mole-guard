function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const el = byId(id);
  if (el) el.textContent = value;
}

function setHtml(id, value) {
  const el = byId(id);
  if (el) el.innerHTML = value;
}

function attachLaunchBridge(storage, gameId, lane) {
  document.querySelectorAll(`[data-launch="${gameId}"]`).forEach((button) => {
    button.addEventListener('click', () => storage.rememberLane(lane));
  });
}

export function initGateway({ device, storage, games, engagement }) {
  const preferred = games[device.suggestedGame];
  const rememberedLane = storage.getLane();
  document.body.dataset.savedLane = rememberedLane;

  setText('deviceRecommendation', `${device.label} detected`);
  setText('deviceSummary', preferred.lane === 'web'
    ? 'We recommend the Instant Web Play lane first for bigger canvases, faster keyboard loops, and lower-friction run restarts.'
    : 'We recommend the Mobile-Native lane first for portrait play, swipe controls, and shorter reward loops.');
  setText('deviceAction', `Suggested start: ${preferred.label}`);
  setText('laneMemory', `Last saved lane: ${rememberedLane === 'web' ? 'Instant Web Play' : 'Mobile-Native'}`);

  document.querySelectorAll('[data-lane]').forEach((laneCard) => {
    const lane = laneCard.dataset.lane;
    laneCard.classList.toggle('recommended', lane === device.preferredLane);
  });

  Object.values(games).forEach((game) => {
    const selector = `[data-game-family="${game.id}"]`;
    document.querySelectorAll(selector).forEach((card) => {
      const hookList = card.querySelector('[data-game-hook]');
      if (hookList) {
        hookList.innerHTML = engagement.sessionHookSummary(game)
          .map((item) => `<li>${item}</li>`)
          .join('');
      }
      const share = card.querySelector('[data-share-copy]');
      if (share) share.value = engagement.buildSharePrompt(game);
      const reward = card.querySelector('[data-reward-band]');
      if (reward) reward.textContent = `${engagement.rewardBand(6, game.lane)}x mid-session reward curve`;
      const difficulty = card.querySelector('[data-difficulty-band]');
      if (difficulty) difficulty.textContent = `Difficulty ramps to ${engagement.difficultyBand(8, game.lane)}x by late-session`;
    });
    attachLaunchBridge(storage, game.id, game.lane);
  });

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const text = button.dataset.copy || '';
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        const original = button.textContent;
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = original; }, 1400);
      } catch {}
    });
  });

  document.querySelectorAll('[data-copy-share]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = button.closest('[data-game-family]')?.querySelector('[data-share-copy]');
      const text = target?.value || '';
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy share prompt'; }, 1400);
      } catch {}
    });
  });

  setHtml('roadmapPreview', `
    <div><strong>Phase A</strong><span>Gateway + lane detection + recommendation memory</span></div>
    <div><strong>Phase B</strong><span>Shared engagement systems: difficulty, rewards, social prompts</span></div>
    <div><strong>Phase C</strong><span>Platform adapters: keyboard-first DigLEW and touch-first Pac-Mole</span></div>
    <div><strong>Phase D</strong><span>Telemetry, profile sync, and reward claims through WinLEW identity flows</span></div>
  `);
}
