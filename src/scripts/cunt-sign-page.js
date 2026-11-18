#!/usr/bin/env node
// Serves tools/sign-challenge.html on localhost so a browser wallet extension
// will inject into it. `npm run cunt:sign-page`
//
// It lives in tools/ and is served ONLY by this script, deliberately NOT from
// src/public/ — a page that asks a wallet to sign an arbitrary message has no
// business being reachable on winlew.co. A test asserts it stays out.
//
// Binds 127.0.0.1 by default and serves exactly one file, reading nothing else
// off disk. WSL forwards localhost, so a browser on Windows reaches a server
// started here. `--lan` binds 0.0.0.0 instead, for signing from a phone.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PAGE = resolve(REPO, "tools/sign-challenge.html");

// PORT 0 = let the OS pick a free one, and print whatever it gave us.
//
// This was originally a fixed 8787, which is the WinLEW SITE's port
// (src/mole/config.js defaults PORT to 8787, and .env sets it). Visiting
// localhost:8787 with the site running serves the site — which looks exactly
// like this tool having been bolted onto winlew.co. It had not been, but a
// number that makes a person doubt that is not a number worth defending.
//
// An ephemeral port cannot collide with the site, the watchdog (8790), the XL1
// faucet (8791), the dashboard (8792), or a local validator (8899).
// SIGN_PAGE_PORT overrides if a fixed port is ever wanted; PORT is deliberately
// NOT read, because in this repo PORT means the website.
const port = Number(process.env.SIGN_PAGE_PORT || 0);

// --lan binds the LAN interface so a PHONE can reach the page. Off by default.
//
// Serving it on the LAN is safe in a way that is worth stating rather than
// assuming: the page holds no secret, stores nothing, and sends nothing. All it
// can do is ASK a wallet to sign, which the wallet will not do without the
// owner tapping approve on the device. The worst a neighbour can do is load a
// static page and read a challenge that is already public.
const lan = process.argv.includes("--lan");
const host = lan ? "0.0.0.0" : "127.0.0.1";

const server = createServer((req, res) => {
  if (req.method !== "GET") { res.writeHead(405).end(); return; }
  // One file, no path handling, so there is no traversal surface at all.
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
  });
  res.end(readFileSync(PAGE));
});

server.listen(port, host, () => {
  const actual = server.address().port;
  const urls = lan
    ? Object.values(networkInterfaces())
        .flat()
        .filter((i) => i && i.family === "IPv4" && !i.internal)
        .map((i) => `    http://${i.address}:${actual}     <- reachable from your phone`)
        .join("\n") || "    (no LAN interface found)"
    : `    http://localhost:${actual}`;
  console.log(`
  Signer proof-of-possession page

${urls}
${lan ? `    http://localhost:${actual}\n` : ""}

  Open that in the browser where your wallet extension lives. With a Ledger,
  attach it and open the Solana app first.

  ${lan ? "LAN mode: any device on this network can load the page. It holds no secret\n  and can only ASK a wallet to sign, which needs your approval on the device.\n\n  " : ""}This is NOT the WinLEW site. It is a throwaway process serving one file from
  tools/, and it stops when you press Ctrl-C. The site lives on its own port
  and does not serve this page — tools/ is outside src/public/ entirely.

  Bound to ${host}. No network calls, no third-party code, nothing stored.
`);
});
