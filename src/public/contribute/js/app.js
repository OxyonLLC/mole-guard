// WinLEW Contribute — sends a real WinLEW transfer from the connected
// wallet to one of the Dev/Faucet/Burn reserves. The server builds the exact
// transaction (right destination, right amount, right decimals); the wallet
// signs+sends it; the server independently re-verifies the confirmed result
// on-chain before recording anything — see src/mole/contributions.js. Never
// trusts a client-claimed amount.
const { hubApiFetch, walletLogin, setConnectedUi, getAuth, getCachedWallet, refreshWalletBalance, connectHubWalletProvider } = window.WinLEWAuth;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rankClass(rank) {
  if (rank === 1) return 'rankCell top1';
  if (rank === 2) return 'rankCell top2';
  if (rank === 3) return 'rankCell top3';
  return 'rankCell';
}

function setStatus(card, message, kind) {
  const el = card.querySelector('[data-status]');
  if (!el) return;
  el.textContent = message || '';
  el.className = `statusLine${kind ? ` ${kind}` : ''}`;
}

// Best-effort — a client-side failure (e.g. the wallet itself blocking the
// request) never reaches the server any other way, so this is the only way
// to get it into the same Discord channel /api/contribute/confirm logs to.
// Never blocks or delays the UI error message on this call's outcome.
function logClientError(cause, stage, message) {
  try {
    const auth = getAuth();
    void hubApiFetch('/api/contribute/log-client-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: auth.session || '', cause, stage, message: String(message || '').slice(0, 500) }),
    });
  } catch {
    // logging is not allowed to break the contribution flow
  }
}

// Phantom desktop throws an opaque "Unexpected error" from
// signAndSendTransaction — historically its security scanner (domain since
// cleared by Phantom, 2026-07-30), but still observed after clearing, so it
// can also be the wallet's own send pipeline failing post-approval. Shown
// raw, that string reads as a WinLEW bug, so translate it — and plain
// user-cancellations — into honest messages. Everything else stays verbatim
// for real debugging.
function friendlyWalletError(error, stage) {
  const message = String(error?.message || '');
  if (isUserRejection(error)) {
    return 'Cancelled in your wallet — nothing was sent.';
  }
  if (/no compatible solana wallet found|wallet_standard_send_transaction_unsupported/i.test(message)) {
    return 'This browser wallet cannot send the contribution transaction here. Use the "Manually send" flow below — it still credits the same contribution after on-chain verification.';
  }
  if (stage === 'sign_and_send' && /unexpected error/i.test(message)) {
    return 'Your wallet hit an internal error before the transaction could be sent, and it doesn\'t support the direct-signing fallback. Nothing was sent. Use the "Manually send" flow below — it credits the same contribution after on-chain verification.';
  }
  if (stage === 'sign_fallback') {
    return 'Your wallet refused to sign this transaction at all — both its send and its sign requests failed, which is a block inside the wallet extension on this browser, not a WinLEW or network failure. Nothing was sent. Try updating (or reinstalling) the wallet extension and disabling other wallet extensions or ad/tracker blockers, or use the "Manually send" flow below — it works right now and credits the same contribution.';
  }
  if (stage === 'sign_and_submit') {
    return `Your wallet signed the transaction, but submitting it to the network failed (${message || 'unknown error'}). You can safely try again, or use the "Manually send" flow below.`;
  }
  return message || 'Something went wrong. Try again.';
}

function isUserRejection(error) {
  return error?.code === 4001 || /user rejected|rejected the request/i.test(String(error?.message || ''));
}

function revealManualFallback(card) {
  if (typeof card.showManualSendPanel === 'function') card.showManualSendPanel();
}

// ── Contribution flow ────────────────────────────────────────────────────
async function submitContribution(card, cause, amount) {
  const btn = card.querySelector('[data-contribute]');
  const auth = getAuth();
  if (!auth.session) {
    setStatus(card, 'Connect your wallet first — click "Connect wallet" up top.', 'error');
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    setStatus(card, 'Pick a preset or enter a custom amount first.', 'error');
    return;
  }
  if (!window.solanaWeb3) {
    setStatus(card, 'Wallet library still loading — try again in a second.', 'error');
    return;
  }

  btn.disabled = true;
  let stage = 'connect_wallet';
  setStatus(card, 'Building transaction…');
  try {
    const connected = await connectHubWalletProvider({ requireSignAndSend: true });
    if (!connected || !connected.provider) throw new Error('No compatible Solana wallet found');

    stage = 'build';
    const buildRes = await hubApiFetch('/api/contribute/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: auth.session, cause, amountWinlew: amount }),
    });
    const buildData = await buildRes.json();
    if (!buildRes.ok || !buildData.ok) throw new Error(buildData.error || 'build_failed');

    setStatus(card, 'Approve the transaction in your wallet…');
    const raw = Uint8Array.from(atob(buildData.transactionBase64), (c) => c.charCodeAt(0));
    const transaction = window.solanaWeb3.Transaction.from(raw);

    stage = 'sign_and_send';
    let signature;
    try {
      ({ signature } = await connected.provider.signAndSendTransaction(transaction));
    } catch (sendError) {
      // Phantom desktop can fail its own send pipeline with an opaque
      // "Unexpected error" even after the user approves. If the wallet can
      // sign without sending, recover: sign here, submit through our server
      // RPC instead (/api/contribute/submit — relays only this exact
      // transaction shape, so no new trust surface).
      if (isUserRejection(sendError) || typeof connected.provider.signTransaction !== 'function') throw sendError;
      logClientError(cause, 'sign_and_send_fallback', sendError?.message || sendError);
      // Two distinct stages so the final error is honest about WHERE it
      // failed: 'sign_fallback' = the wallet refused to even sign (a
      // wallet/extension-side block — e.g. Phantom throwing "Unexpected
      // error" from signTransaction too), 'sign_and_submit' = signing
      // worked but our server relay couldn't land it on-chain.
      stage = 'sign_fallback';
      setStatus(card, 'Your wallet couldn\'t send it directly — signing and submitting via WinLEW instead…');
      const signed = await connected.provider.signTransaction(transaction);
      stage = 'sign_and_submit';
      const signedBytes = signed.serialize();
      let signedBase64 = '';
      for (let i = 0; i < signedBytes.length; i += 1) signedBase64 += String.fromCharCode(signedBytes[i]);
      signedBase64 = btoa(signedBase64);
      const submitRes = await hubApiFetch('/api/contribute/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: auth.session, cause, signedTransactionBase64: signedBase64 }),
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok || !submitData.ok) throw new Error(submitData.message || submitData.error || 'submit_failed');
      signature = submitData.signature;
    }

    stage = 'confirm';
    setStatus(card, 'Confirming on-chain…');
    const confirmRes = await hubApiFetch('/api/contribute/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: auth.session, cause, signature }),
    });
    const confirmData = await confirmRes.json();
    if (!confirmRes.ok || !confirmData.ok) throw new Error(confirmData.error || 'confirm_failed');

    setStatus(card, `✅ Contributed ${confirmData.amount.toLocaleString()} WinLEW — thank you!`, 'ok');
    void loadLeaderboard(activeCause);
  } catch (error) {
    console.warn('[contribute] flow failed:', error);
    if (
      stage === 'connect_wallet'
      || stage === 'sign_and_send'
      || stage === 'sign_fallback'
      || stage === 'sign_and_submit'
      || /no compatible solana wallet found|wallet_standard_send_transaction_unsupported|unexpected error/i.test(String(error?.message || error))
    ) {
      revealManualFallback(card);
    }
    setStatus(card, `⚠️ ${friendlyWalletError(error, stage)}`, 'error');
    // Always log the RAW message — the friendly translation would hide
    // exactly the diagnostic detail this Discord log exists to capture.
    logClientError(cause, stage, error?.message || error);
  } finally {
    btn.disabled = false;
  }
}

// The WinLEW mint — a public constant (same value shown on /, /transparency/,
// and the whitepaper), displayed so manual senders can confirm they're moving
// the right token. The server independently re-checks the mint on-chain during
// confirm regardless of what the user believes they sent.
const WINLEW_MINT = 'DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump';

// /api/contribute/confirm error codes → human explanations for the
// manual-send claim flow (the codes are contract, see src/mole/contributions.js).
const CONFIRM_ERROR_TEXT = {
  signature_required: 'Paste your transaction signature first.',
  signature_not_found: 'Couldn\'t find that signature on-chain yet — give it a few seconds after sending, then try again.',
  transaction_failed: 'That transaction failed on-chain, so there\'s nothing to credit.',
  wallet_mismatch: 'That transaction wasn\'t signed by your verified wallet — send from the wallet linked to your account.',
  wrong_destination_or_mint: 'That transaction doesn\'t send WinLEW to this card\'s wallet — double-check the address and token.',
  no_positive_transfer_found: 'No WinLEW actually arrived at this wallet in that transaction.',
  already_recorded: 'That transaction has already been claimed.',
};

// "Manually send" — the no-dApp contribution path: the user sends WinLEW from
// their own wallet's Send screen (nothing for the site to build or sign), then
// pastes the resulting signature here. Credit goes through the exact same
// on-chain verification as the in-app flow (/api/contribute/confirm), which
// never trusts the client — so this adds zero new trust surface.
function wireManualSend(card, cause) {
  const toggle = card.querySelector('[data-manual-toggle]');
  const panel = card.querySelector('[data-manual-panel]');
  if (!toggle || !panel) return;

  const buildPanel = () => {
    // Full address comes from the card's own visible copy button — the same
    // value the user sees, one source of truth per card.
    const address = card.querySelector('.destAddrRow [data-copy]')?.dataset.copy || '';
    panel.innerHTML = `
      <p style="margin:0;">Prefer your own wallet's Send screen? It's a normal transfer — no dApp approval involved.</p>
      <div><span class="manualLabel">1 · Send WinLEW to</span><br/>
        <code>${esc(address)}</code>
        <button class="copyMini" type="button" data-copy="${esc(address)}">📋 Copy</button>
      </div>
      <div><span class="manualLabel">Token to send (WinLEW mint)</span><br/>
        <code>${WINLEW_MINT}</code>
        <button class="copyMini" type="button" data-copy="${WINLEW_MINT}">📋 Copy</button>
      </div>
      <a href="solana:${esc(address)}?spl-token=${WINLEW_MINT}" style="font-weight:700;">📲 Open in wallet app (mobile)</a>
      <div><span class="manualLabel">2 · Claim your Clout</span>
        <input type="text" autocomplete="off" spellcheck="false" placeholder="Paste your transaction signature" data-manual-signature />
      </div>
      <button class="btn" type="button" data-manual-verify>Verify &amp; claim</button>
      <div class="statusLine" data-manual-status></div>
    `;
    wireCopyButtons(panel);

    const statusEl = panel.querySelector('[data-manual-status]');
    const setManualStatus = (message, kind) => {
      statusEl.textContent = message || '';
      statusEl.className = `statusLine${kind ? ` ${kind}` : ''}`;
    };
    const verifyBtn = panel.querySelector('[data-manual-verify]');
    verifyBtn.addEventListener('click', async () => {
      const auth = getAuth();
      if (!auth.session) {
        setManualStatus('Connect your wallet first — click "Connect wallet" up top.', 'error');
        return;
      }
      const signature = panel.querySelector('[data-manual-signature]').value.trim();
      if (!signature) {
        setManualStatus(CONFIRM_ERROR_TEXT.signature_required, 'error');
        return;
      }
      verifyBtn.disabled = true;
      setManualStatus('Verifying on-chain…');
      try {
        const res = await hubApiFetch('/api/contribute/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session: auth.session, cause, signature }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'confirm_failed');
        setManualStatus(`✅ Verified — ${data.amount.toLocaleString()} WinLEW credited. Thank you!`, 'ok');
        void loadLeaderboard(activeCause);
      } catch (error) {
        console.warn('[contribute] manual claim failed:', error);
        setManualStatus(`⚠️ ${CONFIRM_ERROR_TEXT[error?.message] || error?.message || 'Something went wrong. Try again.'}`, 'error');
        logClientError(cause, 'manual_confirm', error?.message || error);
      } finally {
        verifyBtn.disabled = false;
      }
    });
  };

  const showPanel = () => {
    if (!panel.innerHTML) buildPanel();
    panel.hidden = false;
    toggle.textContent = 'Hide manual send';
  };
  card.showManualSendPanel = showPanel;

  toggle.addEventListener('click', () => {
    if (panel.hidden) {
      showPanel();
      return;
    }
    panel.hidden = true;
    toggle.textContent = 'Manually send';
  });
}

function wireCauseCard(card) {
  const cause = card.dataset.cause;
  const presetButtons = [...card.querySelectorAll('[data-amount]')];
  const customInput = card.querySelector('[data-custom-amount]');
  let selectedAmount = null;

  presetButtons.forEach((presetBtn) => {
    presetBtn.addEventListener('click', () => {
      presetButtons.forEach((b) => b.classList.remove('active'));
      presetBtn.classList.add('active');
      customInput.value = '';
      selectedAmount = Number(presetBtn.dataset.amount);
    });
  });
  customInput.addEventListener('input', () => {
    presetButtons.forEach((b) => b.classList.remove('active'));
    selectedAmount = customInput.value ? Number(customInput.value) : null;
  });

  card.querySelector('[data-contribute]').addEventListener('click', () => {
    void submitContribution(card, cause, selectedAmount);
  });
  wireManualSend(card, cause);

  return { presetButtons, customInput, setAmount: (amount) => {
    const match = presetButtons.find((b) => Number(b.dataset.amount) === amount);
    if (match) {
      match.click();
    } else {
      customInput.value = amount;
      selectedAmount = amount;
    }
  } };
}

// ── Clout leaderboard ────────────────────────────────────────────────────
let activeCause = '';
async function loadLeaderboard(cause) {
  const wrap = document.getElementById('cloutTableWrap');
  if (wrap) wrap.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const res = await hubApiFetch(`/api/contribute/leaderboard?cause=${encodeURIComponent(cause || '')}&limit=25`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'leaderboard_failed');
    const entries = data.entries || [];
    if (!wrap) return;
    if (!entries.length) {
      wrap.innerHTML = '<div class="emptyRow" style="padding:22px 0;">No contributions yet — be the first.</div>';
      return;
    }
    const rows = entries.map((entry, i) => {
      const rank = i + 1;
      // "masked" here means "no display name saved" — unrelated to wallet
      // verification, which is what "(off-platform, verified)" just below
      // actually reports. Was labeled "(unverified)" until 2026-07-28, which
      // confusingly implied the opposite of what that other label means.
      const nameHtml = `${esc(entry.name)}${entry.masked ? ' <span class="muted" style="font-size:11px;">(no name set)</span>' : ''}${entry.externalVerified ? ' <span class="muted" style="font-size:11px;">(off-platform, verified)</span>' : ''}`;
      const urls = Array.isArray(entry.evidenceUrls) ? entry.evidenceUrls : [];
      const evidenceHtml = urls.length
        ? urls.map((url, txIdx) => `<a href="${esc(url)}" target="_blank" rel="noreferrer noopener" title="View this transaction on Solscan">Solscan${urls.length > 1 ? ` #${txIdx + 1}` : ''} ↗</a>`).join(' · ')
        : '<span class="muted">—</span>';
      // Governance Vote Fund column — how much this contributor has put
      // toward vote weight, and roughly how many purchased votes that buys
      // (overview math, same as /mole votes: capped per proposal, not
      // allocation-aware). Server may omit the vote estimate when pricing
      // is unavailable; the fund total still shows.
      const fund = Number(entry.governanceTotal || 0);
      const votesHtml = !(fund > 0)
        ? '<span class="muted">—</span>'
        : (entry.votes != null
          ? `<span title="${esc(`${fund.toLocaleString(undefined, { maximumFractionDigits: 2 })} WinLEW in the Governance Vote Fund`)}">≈${entry.votes} vote${entry.votes === 1 ? '' : 's'}</span>`
          : `<span title="Current vote pricing unavailable">${fund.toLocaleString(undefined, { maximumFractionDigits: 2 })} LEW</span>`);
      return `<tr class="${entry.masked ? 'masked' : ''}">
        <td><span class="${rankClass(rank)}">${rank}</span></td>
        <td>${nameHtml}</td>
        <td class="num">${Number(entry.total).toLocaleString(undefined, { maximumFractionDigits: 2 })} WinLEW</td>
        <td class="num">${entry.contributions}</td>
        <td class="num">${votesHtml}</td>
        <td>${evidenceHtml}</td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `<table><thead><tr><th>#</th><th>Contributor</th><th class="num">Total</th><th class="num">Count</th><th class="num" title="Purchased governance vote weight this contributor's Vote Fund total currently buys — on top of the one free vote every verified holder gets. Capped per proposal.">🗳️ Votes</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>`;
  } catch (e) {
    console.warn('[contribute] leaderboard load failed:', e);
    if (wrap) wrap.innerHTML = '<p class="muted">⚠️ Could not load the leaderboard right now.</p>';
  }
}

// ── External growth links (Jupiter/Streamflow/Raydium) + direct transfers ──
// Jupiter/Streamflow/Raydium are third-party programs — there's no reserve
// wallet of ours to verify a transfer against, so clicking "Open" just
// reveals the reminder to come back and submit the resulting address for
// manual review. "directTransfer" is the odd one out (see
// EXTERNAL_CONTRIBUTION_LINKS in src/mole/contributions.js): it's for a
// holder who sent WinLEW straight to one of OUR OWN reserve wallets away
// from this page's buttons, so the field it needs is a transaction
// signature, not a contract/lock address — same review queue, different
// input shape, hence the placeholder swap below.
function wireExternalLinks() {
  const addressInput = document.querySelector('[data-external-address]');
  const platformSelect = document.querySelector('[data-external-platform]');
  const updateAddressPlaceholder = () => {
    if (!addressInput) return;
    addressInput.placeholder = platformSelect?.value === 'directTransfer'
      ? 'Transaction signature (not an address)'
      : 'Resulting contract/lock address';
  };
  platformSelect?.addEventListener('change', updateAddressPlaceholder);
  updateAddressPlaceholder();

  document.querySelectorAll('[data-external-open]').forEach((link) => {
    link.addEventListener('click', () => {
      const card = link.closest('.externalCard');
      card?.querySelector('[data-external-reminder]')?.classList.add('show');
      const linkId = card?.dataset.link;
      if (linkId && platformSelect) {
        platformSelect.value = linkId;
        updateAddressPlaceholder();
      }
    });
  });

  const submitBtn = document.querySelector('[data-external-submit]');
  if (!submitBtn) return;
  const statusEl = document.querySelector('[data-external-status]');
  const setExternalStatus = (message, kind) => {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.className = `statusLine${kind ? ` ${kind}` : ''}`;
  };

  submitBtn.addEventListener('click', async () => {
    const auth = getAuth();
    if (!auth.session) {
      setExternalStatus('Connect your wallet first — click "Connect wallet" up top.', 'error');
      return;
    }
    const linkId = platformSelect?.value;
    const address = addressInput?.value.trim();
    const note = document.querySelector('[data-external-note]')?.value.trim();
    if (!address) {
      setExternalStatus(linkId === 'directTransfer'
        ? 'Paste the transaction signature first.'
        : 'Paste the resulting contract/lock address first.', 'error');
      return;
    }
    submitBtn.disabled = true;
    setExternalStatus('Submitting…');
    try {
      const res = await hubApiFetch('/api/contribute/external-submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: auth.session, linkId, address, note }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'submit_failed');
      setExternalStatus(linkId === 'directTransfer'
        ? '✅ Submitted — thanks! A maintainer will verify it on-chain and add it to the Clout leaderboard if confirmed.'
        : '✅ Submitted — thanks! A maintainer will verify it on-chain and add it to Transparency if confirmed.', 'ok');
      if (addressInput) addressInput.value = '';
      const noteInput = document.querySelector('[data-external-note]');
      if (noteInput) noteInput.value = '';
    } catch (error) {
      console.warn('[contribute] external submission failed:', error);
      setExternalStatus(`⚠️ ${error?.message || 'Something went wrong. Try again.'}`, 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function wireLeaderboardTabs() {
  const container = document.querySelector('[data-tabs="clout"]');
  if (!container) return;
  container.querySelectorAll('.pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.pill').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeCause = btn.dataset.cause || '';
      void loadLeaderboard(activeCause);
    });
  });
}

// Same copy-button pattern /burn/ uses for its wallet address row. Takes a
// root so late-built DOM (the manual-send panels) can wire its own buttons.
function wireCopyButtons(root = document) {
  root.querySelectorAll('button[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        const original = btn.textContent;
        btn.textContent = '✅ Copied';
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch (e) {
        console.warn('[contribute] copy failed:', e);
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const cards = [...document.querySelectorAll('.causeCard')].map(wireCauseCard);
  wireCopyButtons();
  wireLeaderboardTabs();
  wireExternalLinks();
  void loadLeaderboard('');

  // Deep-link prefill: /contribute/?cause=burn&amount=100000 (used by the
  // Burn page's Contribute presets).
  const params = new URLSearchParams(window.location.search);
  const deepCause = params.get('cause');
  const deepAmount = Number(params.get('amount'));
  if (deepCause) {
    const card = document.querySelector(`.causeCard[data-cause="${CSS.escape(deepCause)}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (Number.isFinite(deepAmount) && deepAmount > 0) {
        const idx = [...document.querySelectorAll('.causeCard')].indexOf(card);
        if (idx >= 0) cards[idx].setAmount(deepAmount);
      }
    }
  }

  const notice = document.getElementById('walletNotice');
  if (notice) {
    if (getAuth().session) notice.textContent = '';
    else notice.textContent = 'Connect your wallet above to contribute — it must be the same wallet linked to your Discord account.';
  }
});

function wireNavWalletConnect() {
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => {
    walletLogin({ triggerBtn: e.currentTarget, onSuccess: () => window.location.reload() });
  });
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  refreshWalletBalance();
}
document.addEventListener('DOMContentLoaded', wireNavWalletConnect);
