(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.XL1Onboarding = api
  if (typeof document !== 'undefined' && document.documentElement) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => api.mount())
    else api.mount()
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // "New to XL1? Start here" (2026-10-24 onboarding sprint): the three-step guide on /xl1/arcade/
  // (get a wallet, connect and verify, play and earn). It opens for a first-time visitor, stays
  // closed once someone closes it or their wallet is verified, and never connects or installs
  // anything by itself: every step is a link the visitor chooses. The preference is one
  // localStorage key, and the page works the same without it (private windows, blocked storage).
  const KEY = 'wl.xl1.start'
  // Set once this browser has seen a verified account, so the guide stays shut for that player
  // even when the account check is briefly unavailable.
  const VERIFIED = 'wl.xl1.verified'

  /** Which wallet options to show first, from the user agent. Every option stays one tap away. */
  function platformOf(ua) {
    const s = String(ua || '')
    if (/Android/i.test(s)) return 'android'
    if (/iPhone|iPad|iPod/i.test(s) || (/Macintosh/i.test(s) && /Mobile/i.test(s))) return 'iphone'
    return 'desktop'
  }

  /**
   * Whether the guide should be open. A choice the visitor made wins. Otherwise it waits for the
   * account (closed while unknown, so a returning player's page doesn't jump), then opens for
   * anyone not yet verified. A browser that has seen a verified account keeps it shut.
   */
  function initialOpen({ stored, account, knownVerified = false }) {
    if (stored === 'open') return true
    if (stored === 'closed') return false
    if (account === 'ready' || knownVerified) return false
    return account != null
  }

  /** The step to point at for an account state (see arcade.js walletState). */
  function currentStep(account) {
    if (account === 'ready') return 3
    if (account === 'needs-wallet' || account === 'wallet-login') return 2
    return 1
  }

  const get = (k) => { try { return localStorage.getItem(k) } catch { return null } }
  const set = (k, v) => { try { localStorage.setItem(k, v) } catch {} }
  const read = () => get(KEY)
  const write = (v) => set(KEY, v)

  function choosePlatform(guide, platform) {
    for (const tab of guide.querySelectorAll('[data-platform-tab]')) {
      const on = tab.dataset.platformTab === platform
      tab.setAttribute('aria-selected', String(on))
      tab.tabIndex = on ? 0 : -1
    }
    for (const panel of guide.querySelectorAll('[data-platform-panel]')) panel.hidden = panel.dataset.platformPanel !== platform
  }

  function mount() {
    const guide = document.getElementById('start')
    if (!guide || guide.dataset.mounted) return
    guide.dataset.mounted = '1'
    let account = null
    let touched = false
    // A link to #start (the hub's "Get an XL1 wallet") always opens it.
    const linked = () => location.hash === '#start'
    const knownVerified = () => get(VERIFIED) === '1'
    const settle = () => { if (!touched && !linked()) guide.open = initialOpen({ stored: read(), account, knownVerified: knownVerified() }) }
    guide.open = linked() || initialOpen({ stored: read(), account, knownVerified: knownVerified() })
    window.addEventListener('hashchange', () => { if (linked()) guide.open = true })
    // No answer about the account (the script failed, or this isn't the arcade page): open for a
    // newcomer anyway after a moment, so the guide is never lost.
    setTimeout(() => { if (account == null) { account = 'unknown'; settle() } }, 4000)
    // Only a visitor's own click is remembered, not the page opening or closing it.
    guide.querySelector('summary')?.addEventListener('click', () => { touched = true; setTimeout(() => write(guide.open ? 'open' : 'closed'), 0) })

    choosePlatform(guide, platformOf(navigator.userAgent))
    const tabs = [...guide.querySelectorAll('[data-platform-tab]')]
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => choosePlatform(guide, tab.dataset.platformTab))
      tab.addEventListener('keydown', (e) => {
        const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key]
        if (to === undefined) return
        e.preventDefault()
        const next = tabs[(to + tabs.length) % tabs.length]
        choosePlatform(guide, next.dataset.platformTab); next.focus()
      })
    })

    // arcade.js reports the account state; the guide marks the step the visitor is on.
    window.addEventListener('wl:account', (e) => {
      account = e.detail?.state ?? 'unknown'
      if (account === 'ready') set(VERIFIED, '1')
      const step = currentStep(account)
      guide.querySelectorAll('[data-step]').forEach((li) => {
        const n = Number(li.dataset.step)
        li.dataset.state = account === 'ready' && n < 3 ? 'done' : n === step ? 'current' : ''
      })
      settle()
    })
  }

  return { KEY, VERIFIED, platformOf, initialOpen, currentStep, mount }
})
