#!/usr/bin/env node
// Verify every module this codebase imports actually resolves against the
// installed dependency tree. `npm run verify:imports`.
//
// WHY THIS AND NOT JUST `npm test`:
//
// The test suite exercises a lot, but not everything. The Discord bots, the
// payout workers and the web server are started by pm2 and are largely NOT
// imported by any test — because importing them would connect to Discord and
// to the chain. So a green suite does not prove those entry points can even
// load, and a missing dependency in one of them would be discovered at deploy
// time, on the serving machine, when the bot fails to start.
//
// This walks every source file, extracts its bare-module imports, and checks
// each one resolves. It never EXECUTES the modules, so there are no side
// effects — no Discord login, no RPC call, no file written.
//
// Written after a dependency review removed a package and applied patches:
// the question "will everything still work" deserved an answer better than
// "the tests passed".

import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, extname } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const require = createRequire(join(ROOT, "package.json"));

const SKIP_DIRS = new Set(["node_modules", ".git", "public", "_legacy", "mobile", ".yarn", "dist", "build"]);
const EXTS = new Set([".js", ".mjs", ".cjs"]);

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      sourceFiles(full, out);
    } else if (EXTS.has(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

// Bare specifiers only — relative paths are the module graph's own business and
// a broken one would fail the test suite loudly anyway.
// A module specifier can never contain a newline or a quote. The first version
// of these patterns used [^"']* which DOES match newlines, so a quote opened in
// one place paired with one hundreds of lines below and produced garbage
// "specifiers" — including an entire test function body, and the fragment
// `doesn` from the word "doesn't" inside a comment.
const SPEC = `["']([^"'\\n]+)["']`;
const PATTERNS = [
  new RegExp(`\\bimport\\s+[^'"\\n]*?\\bfrom\\s*${SPEC}`, "g"), // import x from 'spec'
  new RegExp(`\\bimport\\s*${SPEC}`, "g"), // import 'spec'
  new RegExp(`\\brequire\\(\\s*${SPEC}\\s*\\)`, "g"), // require('spec')
  new RegExp(`\\bimport\\(\\s*${SPEC}\\s*\\)`, "g"), // await import('spec')
];

function bareImports(src) {
  const specs = new Set();
  for (const re of PATTERNS) {
    for (const m of src.matchAll(re)) {
      const spec = m[1];
      // Bare specifiers only. Relative and absolute paths are the module
      // graph's own business, and a broken one fails the test suite loudly.
      if (spec.startsWith(".") || spec.startsWith("/")) continue;
      // `import('${url}')` inside a template literal is code a test builds and
      // runs in a child process (test/faucet/service.test.mjs,
      // test/support/isolation-policy.cjs), not an import of this file; the
      // interpolated value is a file:// URL, never a package name.
      if (spec.includes("${")) continue;
      specs.add(spec);
    }
  }
  return [...specs];
}

const files = [...sourceFiles(join(ROOT, "src")), ...sourceFiles(join(ROOT, "test"))];
const missing = new Map(); // specifier -> [files]
const seen = new Set();
let checked = 0;

for (const file of files) {
  // Skip this file: its comments document the patterns it hunts for, so it
  // matches its own examples (`import 'spec'`) and reports itself.
  if (file.endsWith("verify-imports.js")) continue;

  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const spec of bareImports(src)) {
    if (spec.startsWith("node:")) continue;
    checked++;
    const key = spec;
    if (seen.has(key)) continue;
    try {
      require.resolve(spec);
      seen.add(key);
    } catch (err) {
      // Subpath imports of ESM-only packages can fail require.resolve while
      // being perfectly valid; only report a hard "not found".
      if (err.code === "MODULE_NOT_FOUND" || err.code === "ERR_MODULE_NOT_FOUND") {
        if (!missing.has(spec)) missing.set(spec, []);
        missing.get(spec).push(relative(ROOT, file));
      } else {
        seen.add(key);
      }
    }
  }
}

console.log(`  ${files.length} source files, ${checked} import sites, ${seen.size} distinct modules resolved`);

if (!missing.size) {
  console.log("  ✓ every imported module resolves against the installed tree");
  process.exit(0);
}

console.log(`\n  ✗ ${missing.size} module(s) imported but not installed:\n`);
for (const [spec, where] of missing) {
  console.log(`    ${spec}`);
  for (const f of where.slice(0, 3)) console.log(`        ${f}`);
  if (where.length > 3) console.log(`        …and ${where.length - 3} more`);
}
process.exit(1);
