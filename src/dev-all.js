// Backward-compatible entry point. Keep all ngrok ownership and lifecycle logic
// in one launcher so this older path cannot accidentally start a second tunnel.
await import('./scripts/dev-all.js');
