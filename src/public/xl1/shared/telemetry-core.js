(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.XL1Telemetry = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // Feeds publish about every five minutes. Two missed publish windows are
  // stale; thirty minutes without a publish is offline.
  const STALE_MS = 10 * 60 * 1000
  const OFFLINE_MS = 30 * 60 * 1000

  function timestampMs(value) {
    const time = new Date(value).getTime()
    return Number.isFinite(time) ? time : null
  }

  function sourceState(data, now = Date.now()) {
    if (!data || typeof data !== 'object') return { state: 'unknown', label: 'unknown', age: null }
    const generated = timestampMs(data.generatedAt)
    if (generated === null) return { state: 'unknown', label: 'unknown', age: null }
    const age = Math.max(0, now - generated)
    if (data.status === 'down' || age >= OFFLINE_MS) return { state: 'offline', label: 'offline', age }
    if (age >= STALE_MS) return { state: 'stale', label: 'stale', age }
    return { state: 'online', label: 'online', age }
  }

  function ageText(ms) {
    if (!Number.isFinite(ms)) return 'unknown'
    const seconds = Math.max(0, Math.round(ms / 1000))
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    return `${Math.round(minutes / 60)}h ago`
  }

  function value(value, formatter) {
    if (value === null || value === undefined || value === '') return '—'
    return formatter ? formatter(value) : value
  }

  return { STALE_MS, OFFLINE_MS, timestampMs, sourceState, ageText, value }
})
