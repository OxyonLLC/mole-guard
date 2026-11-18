export async function shareGame(game) {
  const url = new URL(window.location.href);
  if (game.launch) {
    url.searchParams.set('game', game.launch);
    url.hash = game.launch === 'pacmole' ? 'pacmole' : game.launch;
  }

  const sharePayload = {
    title: `WinLEW Arcade — ${game.title}`,
    text: game.shareText || `Check out ${game.title} in the WinLEW Gaming Hub.`,
    url: url.toString(),
  };

  try {
    if (navigator.share) {
      await navigator.share(sharePayload);
      return { ok: true, message: `${game.title} shared.` };
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(`${sharePayload.title}\n${sharePayload.text}\n${sharePayload.url}`);
      return { ok: true, message: `${game.title} link copied.` };
    }

    return { ok: false, message: 'Share not available on this device.' };
  } catch (error) {
    return { ok: false, message: 'Share cancelled.' };
  }
}
