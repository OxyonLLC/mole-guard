
function resolveCatalogImage(src) {
  if (!src || typeof src !== 'string') return src;
  if (!src.endsWith('.svg')) return src;
  const pngCandidate = src.replace(/\.svg$/i, '.png');
  return pngCandidate;
}

import { detectDeviceProfile, recommendationText } from '../core/device-profile.js';
import { shareGame } from '../core/share.js';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function platformIcon(platform) {
  if (platform === 'mobile') {
    return `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="7" y="2.75" width="10" height="18.5" rx="2.8" stroke="currentColor" stroke-width="1.8"/>
        <circle cx="12" cy="18.2" r="1.2" fill="currentColor"/>
      </svg>`;
  }
  return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.8"/>
      <path d="M3.8 12H20.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M12 3.8C14 6.1 15.1 8.9 15.1 12C15.1 15.1 14 17.9 12 20.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M12 3.8C10 6.1 8.9 8.9 8.9 12C8.9 15.1 10 17.9 12 20.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;
}

function shareIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M15 8L19 4M19 4H15.5M19 4V7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M11 6H8.6C6.61177 6 5 7.61177 5 9.6V15.4C5 17.3882 6.61177 19 8.6 19H14.4C16.3882 19 18 17.3882 18 15.4V13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;
}

function difficultyMeter(value) {
  const match = String(value).match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return '';
  const on = Math.max(0, Math.min(Number(match[1]), Number(match[2])));
  const total = Math.max(1, Math.min(Number(match[2]), 5));
  return `<div class="catalog-meter">${Array.from({ length: total }, (_, index) => `<i class="${index < on ? 'on' : ''}"></i>`).join('')}</div>`;
}

function statTemplate([label, value]) {
  const meter = label.toLowerCase() === 'difficulty' ? difficultyMeter(value) : '';
  return `
    <div class="catalog-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${meter}
    </div>`;
}

function cardTemplate(game) {
  const stats = game.stats.map(statTemplate).join('');
  const live = game.status === 'live';
  const experimental = String(game.maturity || '').toLowerCase() === 'experimental';
  const flag = game.badge ? `<span class="catalog-flag ${live && !experimental ? '' : 'soon'}">${escapeHtml(game.badge)}</span>` : '';
  const shareBtn = `<button type="button" class="catalog-icon-btn" aria-label="Share ${escapeHtml(game.title)}" data-share="${escapeHtml(game.id)}">${shareIcon()}</button>`;
  const cta = live
    ? `<button data-launch="${escapeHtml(game.launch)}" class="btn ${game.primary ? 'primary' : ''} catalog-play-btn">▶ Start</button>`
    : `<button type="button" class="btn ghost catalog-play-btn" disabled>Coming Soon</button>`;

  return `
    <article class="catalog-card card ${live ? '' : 'planned'} ${game.featuredOrder <= 2 ? 'is-premium' : ''}"
      data-game-id="${escapeHtml(game.id)}"
      data-platform="${escapeHtml(game.platform)}"
      data-status="${escapeHtml(game.status)}"
      data-tags="${escapeHtml(game.tags.join(','))}"
      data-title="${escapeHtml(game.title)}"
      data-reward="${escapeHtml(String(game.stats.find(([label]) => label === 'Reward')?.[1] || '0').replace(/[^\d]/g, ''))}"
      data-featured-order="${escapeHtml(String(game.featuredOrder))}">
      <div class="catalog-thumb-wrap">
        ${flag}
        <img class="catalog-thumb" src="${escapeHtml(game.thumb)}" alt="${escapeHtml(game.title)}" />
      </div>
      <div class="catalog-body">
        <div class="catalog-card-head">
          <div>
            <h3>${escapeHtml(game.title)}</h3>
            <div class="catalog-eyebrow">${escapeHtml(game.subtitle)}</div>
          </div>
          <div class="catalog-head-actions">
            ${shareBtn}
            <div class="catalog-platform" aria-hidden="true">${platformIcon(game.platform)}</div>
          </div>
        </div>
        <p class="catalog-desc">${escapeHtml(game.description)}</p>
        <div class="catalog-stats">${stats}</div>
        <div class="catalog-trust">
          <span><b>${escapeHtml(game.maturity || (live ? 'Live' : 'Coming'))}</b> product state</span>
          <small>${escapeHtml(game.rewardNote || 'No reward behavior is claimed.')}</small>
        </div>
        <div class="catalog-actions-row">
          ${cta}
          <div class="catalog-side-actions">
            <span class="catalog-pill ${live ? 'live' : 'planned-pill'}">${escapeHtml(game.pill)}</span>
          </div>
        </div>
      </div>
    </article>`;
}

export function initCatalogUi({ games, loadWallet }) {
  const grid = document.getElementById('catalogGrid');
  const filterButtons = [...document.querySelectorAll('.catalog-filter')];
  const laneButtons = [...document.querySelectorAll('[data-jump-filter]')];
  const sortSelect = document.getElementById('catalogSort');
  const toast = document.getElementById('catalogToast');
  const walletAmount = document.getElementById('navWalletAmount');
  const gatewayHint = document.getElementById('gatewayHint');
  const webLane = document.getElementById('laneWeb');
  const mobileLane = document.getElementById('laneMobile');
  let activeFilter = 'all';
  let toastTimer;

  if (!grid) {
    return { refreshWallet() {}, refreshRecommendations() {} };
  }

  grid.innerHTML = games.map(cardTemplate).join('');
  const cards = [...grid.querySelectorAll('.catalog-card')];

  const showToast = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 1800);
  };

  const getTags = (card) => String(card.dataset.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
  const featuredRank = (card) => Number(card.dataset.featuredOrder || 999);
  const rewardRank = (card) => Number(card.dataset.reward || 0);

  function matchesFilter(card, filter) {
    if (filter === 'all') return true;
    if (filter === 'planned') return card.dataset.status === 'planned';
    return getTags(card).includes(filter);
  }

  function sortCards(mode) {
    const sorted = [...cards];
    sorted.sort((a, b) => {
      if (mode === 'az') return String(a.dataset.title || '').localeCompare(String(b.dataset.title || ''));
      if (mode === 'mobile' || mode === 'web') {
        const aBias = a.dataset.platform === mode ? 0 : 1;
        const bBias = b.dataset.platform === mode ? 0 : 1;
        return aBias - bBias || featuredRank(a) - featuredRank(b);
      }
      return featuredRank(a) - featuredRank(b);
    });
    sorted.forEach((card) => grid.appendChild(card));
  }

  function renderCatalog() {
    sortCards(sortSelect?.value || 'featured');
    cards.forEach((card) => card.classList.toggle('hidden-by-filter', !matchesFilter(card, activeFilter)));
  }

  function setFilter(filter) {
    activeFilter = filter || 'all';
    filterButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.filter === activeFilter));
    renderCatalog();
  }

  function refreshWallet() {
    if (walletAmount && typeof loadWallet === 'function') {
      walletAmount.textContent = Number(loadWallet() || 0).toFixed(2);
    }
  }

  function refreshRecommendations() {
    const profile = detectDeviceProfile();
    if (gatewayHint) gatewayHint.textContent = recommendationText(profile);
    webLane?.classList.toggle('recommended-lane', profile.recommendedLane === 'web');
    mobileLane?.classList.toggle('recommended-lane', profile.recommendedLane === 'mobile');
  }

  filterButtons.forEach((btn) => btn.addEventListener('click', () => setFilter(btn.dataset.filter)));
  laneButtons.forEach((btn) => btn.addEventListener('click', () => {
    setFilter(btn.dataset.jumpFilter || 'all');
    grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  sortSelect?.addEventListener('change', renderCatalog);
  window.addEventListener('resize', refreshRecommendations);

  grid.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-share]');
    if (!button) return;
    const game = games.find((item) => item.id === button.dataset.share);
    if (!game) return;
    const result = await shareGame(game);
    showToast(result.message);
  });

  refreshWallet();
  refreshRecommendations();
  renderCatalog();
  return { refreshWallet, refreshRecommendations };
}
