'use strict'

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
await import('./shell.js')
const S = globalThis.XL1Shell
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Every internal destination in the navigation must exist in the site.
for (const group of S.NAV) for (const item of group.items) {
  if (item.external) { assert.match(item.href, /^https:\/\//, `${item.label} external link must be https`); continue }
  const target = item.href.split('#')[0].split('?')[0]
  const file = path.join(publicDir, target, target.endsWith('/') ? 'index.html' : '')
  assert.ok(fs.existsSync(file), `${item.label} → ${item.href} has no file at ${file}`)
}

// Current-page matching: each page highlights exactly its own entry.
const expect = {
  '/xl1/': 'XL1 hub', '/xl1': 'XL1 hub', '/xl1/index.html': null, '/': 'winlew.co',
  // The producer pages moved to oxyon.io/xl1 (external links now), so no local page highlights them.
  '/xl1/geohackers/': 'GeoHackers', '/xl1/arcade/': 'Arcade', '/xl1/arcade/play/': 'Arcade',
  '/xl1/verify/': 'Verify', '/mole-hub/': 'Mole Hub',
}
// The site root and the hub match only themselves, never every page under them.
assert.equal(S.currentItem('/xl1/windows/'), null)
for (const [p, label] of Object.entries(expect)) {
  const hit = S.currentItem(p)
  if (label === null) continue
  assert.equal(hit?.label, label, `${p} should highlight ${label}, got ${hit?.label}`)
}

// The old CryptoSpades address forwards to Mole Spades, and a query-string link (Mole Spades)
// never claims the arcade play page it points into.
assert.equal(S.currentItem('/xl1/arcade/play/')?.label, 'Arcade')
assert.match(fs.readFileSync(path.join(publicDir, 'xl1', 'crypto-spades', 'index.html'), 'utf8'), /url=\/xl1\/arcade\/play\/\?game=molespades/)

// Rendered header marks one item current; the footer plate carries every destination.
const nav = S.navHtml('/xl1/geohackers/')
assert.equal((nav.match(/aria-current="page"/g) || []).length, 1)
assert.match(nav, /aria-current="page">GeoHackers<\/a>/)
// WinLEW's participation pages: the WinLEW brand, and Oxyon's network one door away.
assert.match(nav, /<span class="brand-word">WinLEW<\/span><span class="brand-sub">XL1<\/span>/)
assert.match(nav, /href="https:\/\/oxyon\.io\/xl1\/" rel="noopener">Network/)
assert.ok(!/OXYON|CONTROL CENTER|Control Center/.test(nav + S.plateHtml('/xl1/')), 'no Oxyon wordmark or Control Center on WinLEW pages')
assert.match(S.plateHtml('/xl1/'), /not affiliated with, sponsored by or endorsed by XYO Network/)
const plate = S.plateHtml('/xl1/geohackers/')
for (const g of S.NAV) for (const it of g.items) if (g.group) assert.ok(plate.includes(`href="${it.href}"`), `plate is missing ${it.label}`)
assert.ok(!/undefined/.test(nav + plate))

// Every page ships the same frame statically, so nothing depends on JavaScript.
for (const page of ['', 'geohackers/', 'verify/', 'arcade/']) {
  const html = fs.readFileSync(path.join(publicDir, 'xl1', page, 'index.html'), 'utf8')
  assert.ok(html.includes(S.navHtml('/xl1/' + page)), `/xl1/${page} header differs from shell.js`)
  assert.match(html, /\/xl1\/shared\/oxyon\.css/, `/xl1/${page} must load oxyon.css`)
}

console.log('shell navigation tests passed')
