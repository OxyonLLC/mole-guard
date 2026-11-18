#!/usr/bin/env node
// WinLEW Modules Registry validator — repository-native drift detection.
// Run via `npm run modules:validate`. Exits non-zero on any failure so it
// can gate CI the same way `node --test` already does. See
// docs/modules-system.md for what each check catches and why.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODULES, ROADMAP_PHASES, validateModulesRegistry } from "../mole/modulesData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

function routeToFilePath(route) {
  // "/quiz/" -> src/public/quiz/index.html ; "/health/" -> src/public/health/index.html
  // "/modules/core-infrastructure.html" -> src/public/modules/core-infrastructure.html
  const clean = route.replace(/^\//, "");
  if (clean.endsWith(".html") || clean.endsWith(".php")) {
    return path.join(PUBLIC_DIR, clean);
  }
  return path.join(PUBLIC_DIR, clean, "index.html");
}

function main() {
  const errors = [];
  const warnings = [];

  const registryResult = validateModulesRegistry(MODULES);
  errors.push(...registryResult.errors);

  for (const m of MODULES) {
    if (!m.route) continue;
    if (!m.route.startsWith("/")) continue; // external/absolute URLs aren't local routes
    const filePath = routeToFilePath(m.route);
    if (!fs.existsSync(filePath)) {
      errors.push(`${m.id}: route "${m.route}" has no matching file (expected ${path.relative(process.cwd(), filePath)})`);
    }
  }

  // Internal doc links (same-origin, not github.com) should also resolve.
  for (const m of MODULES) {
    for (const doc of m.docs || []) {
      if (!doc.url || !doc.url.startsWith("/")) continue;
      const filePath = routeToFilePath(doc.url.split("#")[0]);
      if (!fs.existsSync(filePath)) {
        errors.push(`${m.id}: doc link "${doc.url}" has no matching file`);
      }
    }
  }

  // A retired/historical module must never be the target of a "live"
  // module's primary route (that would mean a shipped feature secretly
  // points at dead content).
  const liveRoutes = new Set(MODULES.filter((m) => m.status === "live" && m.route).map((m) => m.route));
  for (const m of MODULES) {
    if ((m.status === "retired" || m.status === "historical") && liveRoutes.has(m.route)) {
      errors.push(`${m.id}: retired/historical module shares a route with a live module ("${m.route}")`);
    }
  }

  if (errors.length) {
    console.error(`\n❌ Modules registry validation FAILED (${errors.length} error${errors.length === 1 ? "" : "s"}):\n`);
    for (const e of errors) console.error(`  - ${e}`);
    if (warnings.length) {
      console.warn(`\n⚠️  ${warnings.length} warning(s):\n`);
      for (const w of warnings) console.warn(`  - ${w}`);
    }
    console.error("");
    process.exit(1);
  }

  console.log(`✅ Modules registry valid — ${MODULES.length} modules, ${ROADMAP_PHASES.length} roadmap phases, 0 errors.`);
  if (warnings.length) {
    console.warn(`⚠️  ${warnings.length} warning(s):`);
    for (const w of warnings) console.warn(`  - ${w}`);
  }
}

main();
