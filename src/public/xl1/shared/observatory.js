(function () {
  'use strict'

  // Control Center telemetry. Reads only the public status feeds the producers and publishers
  // already push to xl1-status-data -- never XL1 RPC, never a producer. Producer feeds refresh
  // every 30 s while the tab is visible; the GeoHackers and race feeds are read once per load.
  // Loaded by /xl1/ (index.html). Every DOM write tolerates a missing element, so a page can
  // carry any subset of the ids below.
  const T = window.XL1Telemetry
  const RAW = 'https://raw.githubusercontent.com/LewSales/xl1-status-data/main/'
  const FEEDS = [
    { key: 'windows', prefix: 'win', label: 'Windows', url: RAW + 'windows.json' },
    { key: 'rbpi3', prefix: 'pi', label: 'Raspberry Pi 3 B+', url: RAW + 'rbpi3.json' },
  ]
  // GeoHackers: the public summary (bands for completed windows; replaced the detailed geohackers.json 2026-11-06).
  const EXTRA = { geohackers: RAW + 'geohackers-summary.json', race: RAW + 'race.json' }
  const REFRESH_MS = 30 * 1000
  const REQUEST_TIMEOUT_MS = 8 * 1000
  const $ = (id) => document.getElementById(id)
  const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]))
  const num = (number) => T.value(number, (v) => Number(v).toLocaleString())

  async function fetchJson(url, requireSchema = true) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const separator = url.includes('?') ? '&' : '?'
      const response = await fetch(`${url}${separator}t=${Date.now()}`, { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (requireSchema && data.schema !== 1) throw new Error('unsupported telemetry schema')
      return data
    } finally {
      clearTimeout(timeout)
    }
  }

  function setState(element, state, label = state) {
    if (!element) return
    const cssState = { online: 'on', stale: 'stale', offline: 'off', unknown: 'unk' }[state] || 'unk'
    element.className = `status-dot ${cssState}`
    element.textContent = label
  }
  function setText(element, text) {
    if (!element) return
    element.textContent = text
  }
  function setHtml(element, html) {
    if (!element) return
    element.innerHTML = html
  }
  // A status tile: data-state drives its colour; the value and sub-line are plain text.
  function setTile(key, state, value, sub) {
    const tile = $(`stat-${key}`)
    if (tile) tile.dataset.state = state
    setText($(`stat-${key}-v`), value)
    setText($(`stat-${key}-sub`), sub)
  }

  function resultState(result) {
    return result.ok ? T.sourceState(result.data) : { state: 'unknown', label: 'unknown', age: null }
  }
  const TILE_LABEL = { online: 'Online', stale: 'Stale', offline: 'No recent telemetry', unknown: 'No telemetry' }

  function renderObservatory(results) {
    const states = results.map(resultState)
    results.forEach((result, index) => {
      const prefix = result.feed?.prefix || (index === 0 ? 'win' : 'pi')
      const state = states[index]
      const d = result.ok ? result.data : null
      setState($(`obs-${prefix}-status`), state.state, state.label)
      setState($(`card-${prefix}-status`), state.state, state.state === 'online' ? '' : state.label)
      setText($(`card-${prefix}-pill`), state.label)
      setText($(`card-${prefix}-metric`), d?.producer?.sharePercent != null ? `${d.producer.sharePercent}% observed share` : '')
      // Control Center producer card and status tile.
      setText($(`${prefix}-last`), num(d?.producer?.lastBlock))
      setText($(`${prefix}-total`), num(d?.producer?.blocks?.total))
      setText($(`${prefix}-24h`), num(d?.producer?.blocks?.day24h))
      setText($(`${prefix}-share`), d?.producer?.sharePercent != null ? `${d.producer.sharePercent}%` : '—')
      setText($(`${prefix}-rank`), d?.producer?.rank != null ? `#${d.producer.rank} of ${d.producer.producers ?? '—'}` : '—')
      setText($(`${prefix}-age`), state.age == null ? 'no telemetry' : `updated ${T.ageText(state.age)}`)
      setTile(prefix, state.state, TILE_LABEL[state.state] || 'No telemetry',
        d ? `${d.producer?.sharePercent != null ? `${d.producer.sharePercent}% share · ` : ''}${state.age == null ? '' : T.ageText(state.age)}` : 'feed unreachable')
    })

    const liveCount = states.filter((state) => state.state === 'online').length
    const knownCount = states.filter((state) => state.state !== 'unknown').length
    const overall = liveCount ? ['online', `${liveCount} source${liveCount === 1 ? '' : 's'} live`]
      : knownCount ? ['stale', 'telemetry not current'] : ['unknown', 'telemetry unavailable']
    setState($('obs-overall'), ...overall)

    const available = results.filter((result) => result.ok)
    const primary = available.find((result) => result.data.network) || available[0]
    const network = primary?.data.network
    const head = network?.observed?.toBlock ?? primary?.data.chain?.currentBlock
    setText($('obs-block'), num(head))
    setText($('obs-blocktime'), network?.blockTime?.meanSeconds != null
      ? `${Number(network.blockTime.meanSeconds).toFixed(1)}s mean` : '—')
    setText($('obs-observed'), num(network?.observed?.blocks))
    setText($('obs-produced'), available.length
      ? num(available.reduce((sum, result) => sum + Number(result.data.producer?.blocks?.total || 0), 0)) : '—')

    const times = available.map((result) => T.timestampMs(result.data.generatedAt)).filter(Number.isFinite)
    const freshest = times.length ? Date.now() - Math.max(...times) : null
    setText($('obs-updated'), freshest != null ? `Last telemetry update: ${T.ageText(freshest)}` : 'No telemetry reachable right now.')

    // Network tile: what our producers observe of the chain. It is only "online" when at least one
    // producer's view is current; otherwise it says so instead of guessing.
    const netState = liveCount ? 'online' : knownCount ? (states.some((s) => s.state === 'stale') ? 'stale' : 'offline') : 'unknown'
    setTile('network', netState, head != null ? `Block #${num(head)}` : 'No telemetry',
      freshest != null ? `seen by our producers · ${T.ageText(freshest)}` : 'no producer telemetry reachable')
    try {
      window.dispatchEvent(new CustomEvent('xl1:network', { detail: { state: netState,
        note: head != null ? `Block #${num(head)} · ${T.ageText(freshest)}` : 'No producer telemetry reachable.' } }))
    } catch { /* old browsers: the sidebar keeps its neutral label */ }
  }

  function renderProofs(results) {
    if (!$('proof-list')) return
    const events = results.filter((result) => result.ok && result.data.producer?.lastBlockUrl && result.data.producer?.lastBlock != null)
      .map((result) => ({
        source: result.feed.label,
        block: result.data.producer.lastBlock,
        url: result.data.producer.lastBlockUrl,
      }))
    $('proof-list').innerHTML = events.length ? events.map((event) => `
      <div class="proof-item"><span class="ico" aria-hidden="true">🧱</span>
        <div class="body">Produced block #${num(event.block)}<div class="src">BLOCK · ${esc(event.source)}</div></div>
        <a class="verify" href="${esc(event.url)}" target="_blank" rel="noopener" aria-label="Verify block ${esc(event.block)} from ${esc(event.source)}">Verify →</a>
      </div>`).join('') : '<div class="proof-item"><span class="ico" aria-hidden="true">◆</span><div class="body">No recent verifiable activity available.</div></div>'
  }

  // GeoHackers runs the XL1 faucet (/faucet, /drip in Discord). Its public feed says whether the
  // bot's proof pipeline has reported recently; a stale feed is shown as stale, never as live.
  function renderGeoHackers(result) {
    const state = result.ok ? T.sourceState(result.data) : { state: 'unknown', age: null }
    const d = result.ok ? result.data : null
    const faucetBand = d?.processedByKind?.faucet
    const label = { online: 'Reporting', stale: 'Stale feed', offline: 'No recent telemetry', unknown: 'No telemetry' }[state.state]
    setTile('faucet', state.state, label, d ? `${state.age == null ? '' : `feed ${T.ageText(state.age)}`}${faucetBand != null ? ` · ${faucetBand} faucet payouts last week` : ''}` : 'feed unreachable')
    for (const id of ['gh-status', 'faucet-status']) {
      const el = $(id)
      if (!el) continue
      el.textContent = label
      el.className = `pill ${state.state === 'online' ? 'live' : state.state === 'unknown' ? 'planned' : 'amber'}`
    }
    setText($('gh-proofs'), d?.processed?.confirmed != null ? `${d.processed.confirmed} proofs confirmed on ${d.processed.day}` : '')
  }

  // Block race summary from race.json (built off-box by the read-only race observer).
  function renderRace(result) {
    const d = result.ok ? result.data : null
    const board = d?.board?.last1000
    if (!board) { setText($('race-leader'), '—'); setText($('race-age'), 'race feed unreachable'); return }
    const ranked = Object.entries(board).sort((a, b) => b[1] - a[1])
    const place = (name) => ranked.findIndex(([n]) => n === name) + 1
    setText($('race-leader'), `${ranked[0][0]} · ${ranked[0][1]} wins`)
    setText($('race-ours'), `LewSales-2 #${place('LewSales-2') || '—'} · LewSales-pi3 #${place('LewSales-pi3') || '—'}`)
    const rd = d.rankDist, n = rd ? Object.values(rd).reduce((a, b) => a + b, 0) : 0
    setText($('race-rule'), n ? `2nd valid candidate won ${Math.round(100 * rd[2] / n)}% of ${num(d.heightsAnalysed)} races` : '')
    const age = d.generatedAt ? Date.now() - d.generatedAt : null
    setText($('race-age'), age == null ? '' : `updated ${T.ageText(age)}`)
  }

  async function refresh(force) {
    if (document.hidden && !force) return
    const settled = await Promise.allSettled(FEEDS.map((feed) => fetchJson(feed.url)))
    const results = settled.map((result, index) => result.status === 'fulfilled'
      ? { ok: true, feed: FEEDS[index], data: result.value }
      : { ok: false, feed: FEEDS[index], error: result.reason })
    renderObservatory(results)
    renderProofs(results)
  }
  async function loadOnce(url, render, requireSchema) {
    try { render({ ok: true, data: await fetchJson(url, requireSchema) }) } catch (error) { render({ ok: false, error }) }
  }

  // Small public surface for focused state/render tests; it performs no work.
  window.XL1Observatory = { resultState, renderObservatory, renderProofs, renderGeoHackers, renderRace }

  refresh(true)
  if ($('stat-faucet') || $('gh-status')) loadOnce(EXTRA.geohackers, renderGeoHackers, true)
  if ($('race-leader')) loadOnce(EXTRA.race, renderRace, false)
  setInterval(refresh, REFRESH_MS)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh() })
})()
