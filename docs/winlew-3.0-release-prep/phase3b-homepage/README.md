# Phase 3B isolated homepage candidate

This directory contains the single-request data adapter for the Phase 3A
homepage candidate. It deliberately does not modify the Phase 3A baseline.

To exercise it in an isolated copy of the Phase 3A page, replace only the
`adapters.js` script reference with `../phase3b-homepage/summary-adapter.js`.
The adapter preserves the Phase 3A `WinLEW3AData.read(name)` interface while
coalescing every card onto one `GET /api/homepage/summary` request.

No automatic fallback to the nine direct reads exists.
