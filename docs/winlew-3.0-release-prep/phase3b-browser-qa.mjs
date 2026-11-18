import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(here, "..");
const previewRoot = path.join(here, "phase3b-preview");
const shotRoot = path.join(previewRoot, "screenshots", "local");
const browsers = {
  chrome: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  edge: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
};
const viewports = {
  desktop: { width: 1440, height: 1000 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};
const legacy = [
  "/api/price/status", "/api/burn/status", "/api/transparency/status", "/api/modules/status",
  "/api/quiz/cycle", "/api/faucet/global-stats", "/api/governance/proposals",
  "/api/events/status", "/api/health/status",
];
const requestLog = [];

function item(state, fields, evidence) {
  const sourceAt = "2026-10-09T18:00:00.000Z";
  return {
    state, ...fields, sourceAt,
    cachedAt: "2026-10-09T18:00:01.000Z",
    expiresAt: "2026-10-09T18:01:01.000Z",
    servedAt: "2026-10-09T18:00:02.000Z",
    evidence,
    ...(state === "stale" ? { error: "source_unavailable" } : {}),
  };
}
function fixture(scenario) {
  const items = {
    price: item("live", { priceUsd: 0.00001234, liquidityUsd: 123456 }, "/links/"),
    burn: item("live", { percentOfTarget: 42.5 }, "/burn/"),
    transparency: item("live", { circulatingSupplyOk: true, circulatingDisplay: "862000000" }, "/transparency/"),
    modules: item("live", { visibleCount: 29, liveCount: 18 }, "/modules/"),
    quiz: item("live", { cycleEndMs: Date.now() + 86400000 }, "/quiz/"),
    faucet: item("live", { totalConfirmedCount: 321 }, "/faucet/"),
    governance: item("live", { proposalCount: 4, activeCount: 1 }, "/governance/"),
    events: item("live", { liveCount: 1, upcomingCount: 2 }, "/events/"),
    health: item("live", { reachableCount: 18, totalCount: 19 }, "/health/"),
  };
  if (scenario === "partial") items.events = { state: "unavailable", error: "source_unavailable", evidence: "/events/" };
  if (scenario === "stale") {
    items.price.state = "stale";
    items.price.error = "source_unavailable";
    items.burn.state = "stale";
    items.burn.error = "source_unavailable";
  }
  if (scenario === "unavailable") {
    for (const name of Object.keys(items)) items[name] = { state: "unavailable", error: "source_unavailable", evidence: items[name].evidence };
  }
  return { ok: true, schemaVersion: 1, generatedAt: new Date().toISOString(), items };
}
function mime(file) {
  return file.endsWith(".html") ? "text/html; charset=utf-8"
    : file.endsWith(".css") ? "text/css; charset=utf-8"
      : file.endsWith(".js") ? "text/javascript; charset=utf-8"
        : file.endsWith(".png") ? "image/png"
          : file.endsWith(".svg") ? "image/svg+xml"
            : "application/octet-stream";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  requestLog.push({ path: url.pathname, query: url.search, referer: req.headers.referer || "" });
  const summaryMatch = url.pathname.match(/^\/fixture\/([^/]+)\/api\/homepage\/summary$/);
  if (summaryMatch) {
    const scenario = summaryMatch[1];
    if (scenario === "timeout") await new Promise((resolve) => setTimeout(resolve, 1200));
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    if (scenario === "malformed") return res.end(JSON.stringify({ ok: true, unexpected: [] }));
    return res.end(JSON.stringify(fixture(scenario)));
  }
  if (url.pathname === "/favicon.ico") {
    res.statusCode = 204;
    return res.end();
  }
  try {
    let file;
    if (url.pathname === "/" || url.pathname === "/preview/" || url.pathname === "/preview/index.html") {
      file = path.join(previewRoot, "index.html");
      let html = await fs.readFile(file, "utf8");
      const scenario = url.searchParams.get("scenario") || "live";
      html = html.replace('<script src="adapters.js"></script>', `<script>window.WINLEW_3B_API_BASE = location.origin + "/fixture/${scenario}";</script><script src="adapters.js"></script>`);
      res.setHeader("Content-Type", mime(file));
      return res.end(html);
    }
    if (url.pathname.startsWith("/preview/")) file = path.join(previewRoot, url.pathname.slice("/preview/".length));
    else file = path.join(publicRoot, url.pathname.replace(/^\//, ""));
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve(publicRoot))) throw new Error("outside_public_root");
    let body = await fs.readFile(resolved);
    if (resolved.endsWith("adapters.js")) body = Buffer.from(body.toString("utf8").replace("const DEFAULT_TIMEOUT_MS = 12000;", "const DEFAULT_TIMEOUT_MS = 800;"));
    res.setHeader("Content-Type", mime(resolved));
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}/preview/index.html`;

async function waitForSettled(page) {
  await page.waitForFunction(() => {
    const states = [...document.querySelectorAll("[data-state]")].map((node) => node.textContent.trim());
    return states.length && states.every((value) => value !== "Checking");
  }, null, { timeout: 3000 });
}
async function structuralAccessibility(page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    const unlabeledImages = [...document.images].filter((img) => !img.hasAttribute("alt")).length;
    const unlabeledButtons = [...document.querySelectorAll("button")].filter((button) => !(button.innerText.trim() || button.getAttribute("aria-label") || button.querySelector(".sr-only"))).length;
    const emptyLinks = [...document.querySelectorAll("a")].filter((link) => !(link.innerText.trim() || link.getAttribute("aria-label"))).length;
    const landmarks = { header: !!document.querySelector("header"), nav: !!document.querySelector("nav"), main: !!document.querySelector("main"), footer: !!document.querySelector("footer") };
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((node) => Number(node.tagName.slice(1)));
    const headingSkips = headings.filter((level, index) => index && level > headings[index - 1] + 1).length;
    return { duplicateIds, unlabeledImages, unlabeledButtons, emptyLinks, landmarks, headingSkips };
  });
}
async function keyboardAudit(page) {
  const samples = [];
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    samples.push(await page.evaluate(() => {
      const el = document.activeElement;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName, text: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 60),
        visible: rect.width > 0 && rect.height > 0,
        focusVisible: style.outlineStyle !== "none" || style.boxShadow !== "none",
      };
    }));
  }
  return { samples, allVisible: samples.every((x) => x.visible), allFocusVisible: samples.every((x) => x.focusVisible) };
}
async function pageAudit(page, browserName, scenario, viewportName, screenshot) {
  const start = requestLog.length;
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${base}?scenario=${scenario}`, { waitUntil: "networkidle" });
  await waitForSettled(page);
  const requests = requestLog.slice(start);
  const summaryRequests = requests.filter((x) => x.path.endsWith("/api/homepage/summary"));
  const legacyRequests = requests.filter((x) => legacy.some((legacyPath) => x.path.endsWith(legacyPath)));
  const stateText = await page.locator("[data-state]").allTextContents();
  const healthText = await page.locator("[data-health-state]").textContent();
  const metricMeta = await page.locator("[data-metric] [data-meta]").allTextContents();
  const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  if (screenshot) {
    const dir = path.join(shotRoot, browserName);
    await fs.mkdir(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${scenario}-${viewportName}.png`), fullPage: true });
  }
  return { scenario, viewport: viewportName, summaryRequestCount: summaryRequests.length, legacyRequestCount: legacyRequests.length, stateText, healthText, metricMeta, overflow, consoleErrors, pageErrors };
}

const results = { generatedAt: new Date().toISOString(), boundary: "Local fixture-backed preview only; no production/backend contact.", engines: {} };
try {
  for (const [browserName, executablePath] of Object.entries(browsers)) {
    const browser = await chromium.launch({ executablePath, headless: true });
    const engine = { pages: [], keyboard: null, mobileNav: null, accessibility: null, reflow: [], reducedMotion: null };
    for (const [viewportName, viewport] of Object.entries(viewports)) {
      const page = await browser.newPage({ viewport });
      engine.pages.push(await pageAudit(page, browserName, "live", viewportName, true));
      if (viewportName === "desktop") {
        engine.keyboard = await keyboardAudit(page);
        engine.accessibility = await structuralAccessibility(page);
      }
      if (viewportName === "mobile") {
        await page.locator("[data-menu-toggle]").click();
        engine.mobileNav = await page.evaluate(() => {
          const button = document.querySelector("[data-menu-toggle]");
          const menu = document.querySelector("[data-mobile-menu]");
          const targets = [button, ...menu.querySelectorAll("a")].map((node) => {
            const rect = node.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          });
          return { expanded: button.getAttribute("aria-expanded"), hidden: menu.hidden, targets, allAtLeast44: targets.every((x) => x.width >= 44 && x.height >= 44) };
        });
      }
      await page.close();
    }
    for (const scenario of ["partial", "stale", "unavailable", "timeout", "malformed"]) {
      const page = await browser.newPage({ viewport: viewports.desktop });
      engine.pages.push(await pageAudit(page, browserName, scenario, "desktop", true));
      await page.close();
    }
    for (const [label, width] of [["200-percent", 640], ["400-percent", 320]]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${base}?scenario=live`, { waitUntil: "networkidle" });
      await waitForSettled(page);
      engine.reflow.push({ label, method: `WCAG equivalent CSS viewport width ${width}px`, ...(await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))) });
      await page.close();
    }
    {
      const page = await browser.newPage({ viewport: viewports.desktop, reducedMotion: "reduce" });
      await page.goto(`${base}?scenario=live`, { waitUntil: "networkidle" });
      engine.reducedMotion = await page.evaluate(() => {
        const probe = document.querySelector(".live-card");
        const style = getComputedStyle(probe);
        return { mediaMatches: matchMedia("(prefers-reduced-motion: reduce)").matches, transitionDuration: style.transitionDuration, animationDuration: style.animationDuration };
      });
      await page.close();
    }
    await browser.close();
    const desktopScenarios = Object.fromEntries(engine.pages.filter((x) => x.viewport === "desktop").map((x) => [x.scenario, x]));
    engine.assertions = {
      oneSummaryRequestEveryLoad: engine.pages.every((x) => x.summaryRequestCount === 1),
      noLegacyRequests: engine.pages.every((x) => x.legacyRequestCount === 0),
      noHorizontalOverflow: engine.pages.every((x) => x.overflow.scrollWidth <= x.overflow.clientWidth) && engine.reflow.every((x) => x.scrollWidth <= x.clientWidth),
      noConsoleErrors: engine.pages.every((x) => x.consoleErrors.length === 0),
      noPageErrors: engine.pages.every((x) => x.pageErrors.length === 0),
      keyboardVisible: engine.keyboard.allVisible,
      keyboardFocusVisible: engine.keyboard.allFocusVisible,
      mobileMenuWorks: engine.mobileNav.expanded === "true" && engine.mobileNav.hidden === false,
      mobileTargetsAtLeast44: engine.mobileNav.allAtLeast44,
      reducedMotionApplied: engine.reducedMotion.mediaMatches && parseFloat(engine.reducedMotion.transitionDuration) <= 0.01,
      structuralAccessibility: engine.accessibility.duplicateIds.length === 0 && engine.accessibility.unlabeledImages === 0 && engine.accessibility.unlabeledButtons === 0 && engine.accessibility.emptyLinks === 0 && Object.values(engine.accessibility.landmarks).every(Boolean),
      liveRendersLive: desktopScenarios.live.stateText.every((x) => x !== "Unavailable") && desktopScenarios.live.healthText === "Source live",
      partialIsCardScoped: desktopScenarios.partial.stateText.filter((x) => x === "Unavailable").length === 1 && desktopScenarios.partial.healthText === "Source live",
      staleIsExplicit: desktopScenarios.stale.metricMeta.filter((x) => x.includes("Stale snapshot")).length >= 2 && desktopScenarios.stale.stateText.every((x) => x !== "Unavailable"),
      unavailableRendersUnavailable: desktopScenarios.unavailable.stateText.every((x) => x === "Unavailable") && desktopScenarios.unavailable.healthText === "Unavailable",
      timeoutRendersUnavailable: desktopScenarios.timeout.stateText.every((x) => x === "Unavailable") && desktopScenarios.timeout.healthText === "Unavailable",
      malformedRendersUnavailable: desktopScenarios.malformed.stateText.every((x) => x === "Unavailable") && desktopScenarios.malformed.healthText === "Unavailable",
    };
    results.engines[browserName] = engine;
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
results.assertionsPassed = Object.values(results.engines).every((engine) => Object.values(engine.assertions).every(Boolean));
await fs.writeFile(path.join(here, "phase3b-browser-qa-results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ assertionsPassed: results.assertionsPassed, engines: Object.fromEntries(Object.entries(results.engines).map(([name, value]) => [name, value.assertions])) }, null, 2));
assert.equal(results.assertionsPassed, true);
