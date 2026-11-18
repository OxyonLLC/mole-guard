(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.XL1Shell = api
  if (typeof document !== 'undefined' && document.documentElement) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => api.mount())
    else api.mount()
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // The WinLEW XL1 frame (2026-10-23 XL1 experience sprint): a quiet top bar (the WinLEW mole, a
  // few doors) and a footer plate with every destination. These are WinLEW's participation pages;
  // the producers, chain and evidence are Oxyon's and live on oxyon.io (the "Network" door).
  // Every page ships the same header and footer as static HTML, so nothing depends on this file;
  // it re-renders both from this one config so they cannot drift, and marks the current page.
  // Only real destinations: if a thing has no page, it has no link. External links are marked ↗.
  const DISCORD = 'https://discord.gg/PSCrBzqdbE'
  const NAV = [
    { group: null, items: [{ label: 'XL1 hub', href: '/xl1/', top: true }] },
    { group: 'Play', items: [
      { label: 'Arcade', href: '/xl1/arcade/', top: true },
      { label: 'Mole Hub', href: '/mole-hub/' },
      // CryptoSpades became Mole Spades (2026-10-24); /xl1/crypto-spades/ now forwards here.
      { label: 'Mole Spades', href: '/xl1/arcade/play/?game=molespades', top: true },
    ] },
    { group: 'Take part', items: [
      { label: 'GeoHackers', href: '/xl1/geohackers/', top: true },
      { label: 'XL1 faucet', href: '/xl1/geohackers/#faucet' },
      { label: 'Verify', href: '/xl1/verify/', top: true },
      { label: 'Discord', href: DISCORD, external: true },
    ] },
    { group: 'Check it', items: [
      { label: 'Arcade ledger', href: '/xl1/arcade/#activity' },
      { label: 'XL1 explorer', href: 'https://explore.xyo.network/xl1/mainnet', external: true },
      // The producers, chain viewer, block race and evidence are Oxyon's.
      { label: 'Network', href: 'https://oxyon.io/xl1/', external: true, top: true },
      { label: "What's live", href: 'https://oxyon.io/status/', external: true },
    ] },
    { group: 'WinLEW', items: [
      { label: 'winlew.co', href: '/' },
      { label: 'Who does what', href: '/xl1/#learn' },
    ] },
  ]
  const ALL = NAV.flatMap((g) => g.items)

  const normPath = (p) => {
    let path = String(p || '/').split('#')[0].split('?')[0]
    if (!path.endsWith('/') && !/\.[a-z0-9]+$/i.test(path)) path += '/'
    return path
  }

  /** The nav item for a pathname: exact path match on internal, hash-free links; the longest wins. */
  function currentItem(pathname) {
    const here = normPath(pathname)
    let best = null
    for (const it of ALL) {
      if (it.external || it.href.includes('#') || it.href.includes('?')) continue
      const p = normPath(it.href)
      // The hub and the site root match only themselves: every page sits under them.
      if ((here === p || (p !== '/xl1/' && p !== '/' && here.startsWith(p))) && (!best || p.length > normPath(best.href).length)) best = it
    }
    return best
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const link = (it, cur) => `<a href="${esc(it.href)}"${it.external ? ' rel="noopener"' : ''}${it === cur ? ' aria-current="page"' : ''}>${esc(it.label)}${it.external ? '<span class="ext" aria-hidden="true">↗</span>' : ''}</a>`

  /** Inner HTML of <header class="nav">. */
  function navHtml(pathname) {
    const cur = currentItem(pathname)
    const top = ALL.filter((it) => it.top)
    return `<a class="brand" href="/" aria-label="WinLEW home">
      <img class="brand-mark" src="/images/avatars/mole-guard-128.png" alt="" aria-hidden="true" width="28" height="28">
      <span class="brand-word">WinLEW</span><span class="brand-sub">XL1</span>
    </a>
    <nav aria-label="XL1">${top.map((it) => link(it, cur)).join('')}</nav>`
  }

  /** Inner HTML of the footer: the specification plate, with every destination grouped. */
  function plateHtml(pathname) {
    const cur = currentItem(pathname)
    const groups = NAV.filter((g) => g.group).map((g) => `<div><p class="plate-h">${esc(g.group)}</p>${g.items.map((it) => link(it, cur)).join('')}</div>`).join('')
    const role = cur && cur.href !== '/xl1/' ? `XL1 · ${esc(cur.label.toUpperCase())}` : 'XL1 HUB'
    return `<div class="plate">
      <img class="plate-mark" src="/images/avatars/mole-guard-128.png" alt="" aria-hidden="true" width="26" height="26">
      <p class="plate-name">WinLEW</p>
      <p class="plate-role">${role}&nbsp;&nbsp;·&nbsp;&nbsp;LET'S EVERYONE WIN</p>
      <hr>
      <nav class="plate-groups" aria-label="All XL1 pages">${groups}</nav>
      <p class="plate-net" id="xl1-net" data-state="unknown" role="status" aria-live="polite"><span class="net-dot" aria-hidden="true"></span><span id="xl1-net-label">XL1 network</span></p>
      <p class="plate-copy">WinLEW is independent community work, not affiliated with, sponsored by or endorsed by XYO Network. XL1 is XYO Network's blockchain. © <span id="year">2026</span> WinLEW</p>
    </div>`
  }

  let mounted = false
  function mount() {
    if (mounted || !document.body || !document.body.classList.contains('xl1-shell')) return
    mounted = true
    const header = document.querySelector('body > header.nav')
    if (!header) return // a page still on the old frame: leave it alone
    const footer = document.querySelector('body > footer')
    if (header) header.innerHTML = navHtml(location.pathname)
    if (footer) footer.innerHTML = plateHtml(location.pathname)
    const year = document.getElementById('year')
    if (year) year.textContent = new Date().getFullYear()

    // Sections fade in once, as on oxyon.io; skipped for reduced motion. Hidden only after this
    // runs (html.js), so without JavaScript everything shows.
    document.documentElement.classList.add('js')
    const targets = document.querySelectorAll('.reveal')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || !('IntersectionObserver' in window)) targets.forEach((t) => t.classList.add('in'))
    else {
      const io = new IntersectionObserver((entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
      }), { threshold: 0.1 })
      targets.forEach((t) => { if (t.getBoundingClientRect().top < window.innerHeight) t.classList.add('in'); else io.observe(t) })
    }

    // Network status comes only from data the page already fetched (the hub's hub.js dispatches
    // it). The shell never fetches anything itself.
    window.addEventListener('xl1:network', (e) => {
      const d = e.detail || {}
      const net = document.getElementById('xl1-net'), label = document.getElementById('xl1-net-label')
      if (!net || !label) return
      net.dataset.state = d.state || 'unknown'
      label.textContent = { online: 'XL1 network · online', stale: 'XL1 network · stale', offline: 'XL1 network · no telemetry', unknown: 'XL1 network · unknown' }[d.state] || 'XL1 network'
    })
  }

  return { NAV, DISCORD, normPath, currentItem, navHtml, plateHtml, mount }
})
