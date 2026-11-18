// The public face of the GeoHackers API. What matters most is that nothing in the
// event family, however it is spelled, ever reaches the upstream: the tests below
// run real requests through Express and http-proxy-middleware into a stand-in
// upstream that records what arrived, and check bodies, not only status codes.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import {
  canonicalPath,
  isEventFamily,
  geoHackersApiDecision,
  geoHackersApiGuard,
  PUBLIC_GEOHACKERS_ROUTES,
} from "../../src/mole/geohackersApiGuard.js";
import { isPublicRequestPath } from "../../src/mole/publicFiles.js";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

// Every spelling of the event family the API (Express: case-insensitive, trailing
// slash optional) could route, plus ones it would not but a later hop might tidy.
const EVENT_SPELLINGS = [
  "/events", "/events/", "/EVENTS", "/Events/x", "/events/x", "/events/x/", "/events/x/submission",
  "/events/x/requeue", "/events/x/reobserve", "/events/queue/next", "//events", "///events/x",
  "/events//x", "/./events", "/x/../events", "/%65vents", "/%45VENTS/x", "/events%2Fx", "/%2Fevents",
  "/%252Fevents", "/%2565vents", "/events%2fx%2fsubmission", "\\events", "/\\events", "/events;x",
  "/events.json", "/eventsx", "/events%20", "/events%00", "/%2e/events", "/%2e%2e/events",
];

test("every spelling of the event family is refused for every method, query or not", () => {
  for (const spelling of EVENT_SPELLINGS) {
    for (const method of METHODS) {
      for (const q of ["", "?limit=1", "?discordUserId=1&wallet=2", "#frag"]) {
        const d = geoHackersApiDecision(method, `/geohackers-api${spelling}${q}`);
        assert.equal(d.allow, false, `${method} ${spelling}${q} must be refused`);
        assert.ok([400, 404].includes(d.status), `${method} ${spelling}${q} -> ${d.status}`);
      }
    }
  }
});

test("the prefix itself is matched in any case and with odd spellings", () => {
  for (const p of ["/GEOHACKERS-API/events", "/GeoHackers-Api/events/x", "//geohackers-api/events", "/%67eohackers-api/events", "//geohackers-api/health"]) {
    assert.equal(geoHackersApiDecision("GET", p).allow, false, p);
  }
});

test("allowed public routes pass, with or without a query or trailing slash", () => {
  const ok = [
    ["GET", "/health"], ["HEAD", "/health"], ["GET", "/health/"], ["GET", "/HEALTH"], ["GET", "/public"],
    ["GET", "/faucet/info"], ["GET", "/proofs/verify_0b9c2e2a-1d7c-4e7e-8a51-5a9f1c2d3e4f"],
    ["GET", "/xl1balance?address=00&target=mainnet"], ["GET", "/lookback?address=00&lookback=250"],
    ["GET", "/games/crypto-spades/leaderboard?limit=25"], ["POST", "/claim"],
    ["POST", "/games/crypto-spades/sessions"], ["POST", "/games/crypto-spades/sessions/s_123/complete"],
    ["POST", "/cowitness/cowitness_abc/prepare"], ["POST", "/cowitness/cowitness_abc/complete"],
    ["OPTIONS", "/claim"], ["OPTIONS", "/cowitness/cowitness_abc/prepare"],
  ];
  for (const [m, p] of ok) assert.deepEqual(geoHackersApiDecision(m, `/geohackers-api${p}`), { allow: true }, `${m} ${p}`);
});

test("everything not on the allowlist is refused, including member profiles and internal views", () => {
  const refused = [
    "/", "/u/123456789012345678", "/U/x", "/lookup?wallet=x", "/blocklist", "/blocklist/check?wallet=x",
    "/faucet/control", "/x/status", "/x/drafts/1", "/worker/status", "/xl1/health", "/stats", "/dashboard",
    "/cowitness", "/cowitness/expire", "/cowitness/x/accept", "/cowitness/x/decline", "/vouch", "/config",
    "/proofs", "/proofs/", "/proofs/a/b", "/proofs/%2e%2e", "/proofs/..%2fevents", "/proofs/a%2Fb",
    "/health/../events", "/health%2F..%2Fevents", "/health/./", "/faucet//info", "/faucet/info/x",
    "/games/crypto-spades/sessions/x", "/games/crypto-spades/leaderboard/../../events",
  ];
  for (const p of refused) {
    const d = geoHackersApiDecision("GET", `/geohackers-api${p}`);
    assert.equal(d.allow, false, `GET ${p} must be refused`);
    assert.deepEqual(d.body, d.status === 405 ? { ok: false, error: "method_not_allowed" } : d.body);
  }
});

test("an allowed path with the wrong method is refused before it is forwarded", () => {
  for (const [m, p] of [["POST", "/health"], ["DELETE", "/proofs/x"], ["GET", "/claim"], ["PUT", "/claim"],
    ["GET", "/cowitness/x/prepare"], ["PATCH", "/public"]]) {
    const d = geoHackersApiDecision(m, `/geohackers-api${p}`);
    assert.equal(d.allow, false, `${m} ${p}`);
  }
});

test("other site paths are not touched, even malformed ones", () => {
  for (const p of ["/", "/health", "/api/profile/me", "/geohackers/", "/geohackers-apix/events", "/geohackers-verify/health",
    "/%E0%A4%A", "/xl1/verify/api-proxy.php/events"]) {
    assert.deepEqual(geoHackersApiDecision("GET", p), { allow: true }, p);
  }
});

test("control characters are a bad path, not a forwarded one", () => {
  assert.deepEqual(geoHackersApiDecision("GET", "/geohackers-api/health\r\nX: y").status, 400);
  assert.equal(geoHackersApiDecision("GET", "/geohackers-api/health%0d%0a").allow, false);
});

test("canonicalPath undoes layered escapes and refuses what cannot be decoded", () => {
  assert.equal(canonicalPath("/%2565vents"), "/events");
  assert.equal(canonicalPath("\\\\EVENTS//x"), "/events/x");
  assert.equal(canonicalPath("/%E0%A4%A"), null);
  assert.equal(isEventFamily("/%E0%A4%A"), true);
  assert.equal(isEventFamily("/proofs/events"), false);
});

test("allowlist patterns are anchored and unique", () => {
  const seen = new Set();
  for (const r of PUBLIC_GEOHACKERS_ROUTES) {
    assert.ok(r.regex.source.startsWith("^") && r.regex.source.endsWith("$"), r.pattern);
    assert.ok(!seen.has(r.pattern), r.pattern);
    seen.add(r.pattern);
    assert.ok(!/events/i.test(r.pattern), r.pattern);
  }
});

// ── Through real Express and the real proxy ──────────────────────────────────
// The stand-in upstream records every request it receives and answers with a
// marker, so a test can tell "the guard answered" from "the API answered".
async function harness({ withPathFilter = false } = {}) {
  const reached = [];
  const upstream = http.createServer((req, res) => {
    reached.push(`${req.method} ${req.url}`);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ upstream: true, method: req.method, url: req.url, body }));
    });
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const app = express();
  // web.js's own path filter, which runs before the guard in production.
  if (withPathFilter) app.use((req, res, next) => (isPublicRequestPath(req.path) ? next() : res.status(404).end()));
  app.use(geoHackersApiGuard());
  app.use("/geohackers-api", createProxyMiddleware({ target: `http://127.0.0.1:${upstream.address().port}`, pathRewrite: { "^/geohackers-api": "" } }));
  app.use((req, res) => res.status(404).json({ site: "fallthrough" }));
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const port = server.address().port;
  // Raw socket requests so the path is sent exactly as written, never normalised by a client.
  const send = (method, path, body = "") => new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1");
    let buf = "";
    sock.on("data", (d) => (buf += d));
    sock.on("end", () => {
      const [head, ...rest] = buf.split("\r\n\r\n");
      resolve({ status: Number(head.split(" ")[1]), head, body: rest.join("\r\n\r\n") });
    });
    sock.on("error", reject);
    // HTTP/1.0, so no reply comes back chunked.
    sock.write(`${method} ${path} HTTP/1.0\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  });
  return { reached, send, close: () => { server.close(); upstream.close(); } };
}

test("through Express and the proxy: the event family never reaches the upstream", async () => {
  const h = await harness();
  try {
    for (const spelling of EVENT_SPELLINGS.filter((s) => !s.includes("\\"))) {
      for (const method of ["GET", "POST", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
        const r = await h.send(method, `/geohackers-api${spelling}?discordUserId=1`, method === "POST" ? '{"autoSubmit":true}' : "");
        assert.ok(r.status === 404 || r.status === 400, `${method} ${spelling} -> ${r.status}`);
        assert.ok(!r.body.includes('"upstream"'), `${method} ${spelling} reached the upstream`);
        if (method !== "HEAD" && r.status === 404) assert.match(r.body, /"not_public"|"fallthrough"/, `${method} ${spelling}`);
      }
    }
    for (const p of ["/GEOHACKERS-API/events", "/GeoHackers-Api/EVENTS/x"]) {
      const r = await h.send("GET", p);
      assert.equal(r.status, 404, p);
      assert.match(r.body, /"not_public"/, p);
    }
    assert.deepEqual(h.reached, [], `upstream saw: ${h.reached.join(", ")}`);
  } finally {
    h.close();
  }
});

test("through Express and the proxy: allowed routes reach the upstream unchanged, with query and body", async () => {
  const h = await harness();
  try {
    const health = await h.send("GET", "/geohackers-api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body), { upstream: true, method: "GET", url: "/health", body: "" });
    const claim = await h.send("POST", "/geohackers-api/claim", '{"wallet":"00"}');
    assert.deepEqual(JSON.parse(claim.body), { upstream: true, method: "POST", url: "/claim", body: '{"wallet":"00"}' });
    const bal = await h.send("GET", "/geohackers-api/xl1balance?address=00&target=mainnet");
    assert.equal(JSON.parse(bal.body).url, "/xl1balance?address=00&target=mainnet");
    const denied = await h.send("GET", "/geohackers-api/u/123456789012345678");
    assert.equal(denied.status, 404);
    assert.deepEqual(JSON.parse(denied.body), { ok: false, error: "not_public" });
    assert.match(denied.head, /cache-control: no-store/i);
    assert.deepEqual(h.reached, ["GET /health", "POST /claim", "GET /xl1balance?address=00&target=mainnet"]);
  } finally {
    h.close();
  }
});

test("web.js mounts the guard before the GeoHackers API proxy", () => {
  const src = fs.readFileSync(new URL("../../src/mole/web.js", import.meta.url), "utf8");
  const guard = src.indexOf("app.use(geoHackersApiGuard())");
  const proxy = src.search(/'\/geohackers-api',\r?\n\s*createProxyMiddleware\(/);
  assert.ok(guard > 0, "guard is mounted");
  assert.ok(proxy > 0, "proxy found");
  assert.ok(guard < proxy, "guard runs first");
  assert.equal(src.split("app.use(geoHackersApiGuard())").length, 2, "mounted exactly once");
});

// The production order: the site's path filter, then the guard, then the proxy. Every route
// that must never be public is tried in every spelling; the upstream must see none of them,
// and the routes the public pages use must still arrive unchanged.
test("production order (path filter, guard, proxy): nothing private reaches the API", async () => {
  const h = await harness({ withPathFilter: true });
  try {
    const privatePaths = [...EVENT_SPELLINGS.filter((s) => !s.includes("\\")), "/u/123456789012345678", "/U/x", "/worker/status", "/xl1/health",
      "/stats", "/dashboard", "/", "/lookup", "/blocklist", "/blocklist/check", "/faucet/control", "/x/status", "/x/drafts/1/post",
      "/cowitness", "/cowitness/x/accept", "/cowitness/x/decline", "/cowitness/expire", "/vouch", "/events/x/requeue", "/events/x/reobserve"];
    for (const p of privatePaths) {
      for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
        const r = await h.send(method, `/geohackers-api${p}`, method === "GET" ? "" : '{"autoSubmit":true}');
        assert.ok([400, 404, 405].includes(r.status), `${method} ${p} -> ${r.status}`);
        assert.ok(!r.body.includes('"upstream"'), `${method} ${p} reached the upstream`);
      }
    }
    assert.deepEqual(h.reached, [], `upstream saw: ${h.reached.join(", ")}`);
    for (const [m, p] of [["GET", "/health"], ["GET", "/faucet/info"], ["GET", "/public"], ["GET", "/proofs/verify_abc"], ["POST", "/claim"],
      ["GET", "/xl1balance?address=00"], ["POST", "/games/crypto-spades/sessions"], ["POST", "/cowitness/cw_1/prepare"]]) {
      const r = await h.send(m, `/geohackers-api${p}`, m === "POST" ? "{}" : "");
      assert.equal(JSON.parse(r.body).upstream, true, `${m} ${p} should reach the API`);
    }
  } finally {
    h.close();
  }
});
