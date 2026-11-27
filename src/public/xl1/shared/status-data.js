// XL1 telemetry repositories (Sprint 004 rotation). A classic-script port of oxyon.io's
// src/static/xl1/app/status-data.mjs: SAME repositories, SAME identity rules, SAME newest-valid-copy choice.
// Change both together. Publishers write one file each to the ACTIVE period repository; older data stays in the
// historical repository, intact. Readers ask both and use the newest VALID copy of a file by its own generatedAt, so
// publishers can move one at a time and no page goes stale. Exposes window.XL1StatusData; performs no work on load.
;(function () {
  const OWNER = 'LewSales'
  const STATUS_REPOS = Object.freeze(['xl1-status-data-2026-11', 'xl1-status-data'])
  const statusUrl = (repo, file) => `https://raw.githubusercontent.com/${OWNER}/${repo}/main/${file}`
  const MAX_FUTURE_MS = 10 * 60 * 1000
  const HEX40 = /^[0-9a-f]{40}$/i
  const IDENTITY = {
    'rbpi3.json': (d) => d.label === 'rbpi3' && HEX40.test((d.producer && d.producer.address) || ''),
    'windows.json': (d) => d.label === 'windows' && HEX40.test((d.producer && d.producer.address) || ''),
    'race.json': (d) => d.network === 'sequence' && Array.isArray(d.heights),
    'race-sequence-winlew.json': (d) => d.network === 'sequence' && Array.isArray(d.heights),
    'race-mainnet.json': (d) => d.network === 'mainnet' && Array.isArray(d.heights),
    'race-mainnet-winlew.json': (d) => d.network === 'mainnet' && Array.isArray(d.heights),
    'geohackers-summary.json': (d) => d.schema === 'oxyon.geohackers.summary.v1',
  }
  function stampOf(doc) {
    const g = doc && doc.generatedAt
    if (typeof g === 'number' && Number.isFinite(g)) return g
    if (typeof g === 'string') { const t = Date.parse(g); return Number.isFinite(t) ? t : 0 }
    return 0
  }
  function validCopy(file, doc, now) {
    if (now === undefined) now = Date.now()
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false
    const t = stampOf(doc)
    if (!(t > 0) || t > now + MAX_FUTURE_MS) return false
    const identity = IDENTITY[file]
    return identity ? identity(doc) === true : true
  }
  function newestCopy(copies, file, now) {
    let best = null
    for (const c of copies) {
      if (!validCopy(file, c, now)) continue
      if (best === null || stampOf(c) > stampOf(best)) best = c
    }
    return best
  }
  // getJson(url) resolves to parsed JSON or null; a throw counts as missing. Resolves to the newest valid copy or null.
  async function fetchStatus(file, getJson) {
    const copies = await Promise.all(STATUS_REPOS.map((repo) => Promise.resolve().then(() => getJson(statusUrl(repo, file))).catch(() => null)))
    return newestCopy(copies, file)
  }
  // A cache-busted, no-store JSON fetch for fetchStatus (null on any HTTP error).
  async function noStoreJson(url, signal) {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store', signal })
    return r.ok ? r.json() : null
  }
  window.XL1StatusData = Object.freeze({ STATUS_REPOS, statusUrl, stampOf, validCopy, newestCopy, fetchStatus, noStoreJson })
})()
