'use strict';
// Static source assembly only: never import or execute the application.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
module.exports = function assembleRuntime(repo, destination) {
  const files = {}, packages = new Set(), resources = new Set();
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  function visit(relative) {
    relative = relative.replaceAll('\\', '/');
    if (Object.hasOwn(files, relative)) return;
    if (!relative.startsWith('src/') || relative.startsWith('src/public/') || /(?:^|\/)data\//.test(relative)
      || !/\.(?:js|cjs|mjs)$/.test(relative)) throw new Error('Runtime source boundary requires review');
    const source = path.resolve(repo, relative);
    if (!source.startsWith(repo + path.sep)) throw new Error('Runtime source path refused');
    let part = repo;
    for (const name of path.relative(repo, source).split(path.sep)) {
      part = path.join(part, name);
      if (fs.lstatSync(part).isSymbolicLink()) throw new Error('Runtime source link refused');
    }
    const bytes = fs.readFileSync(source), text = bytes.toString('utf8');
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)
      || /(?:DISCORD_TOKEN|CLIENT_SECRET|API_KEY|PROXY_SECRET)\s*[:=]\s*["'][A-Za-z0-9_+/=-]{20,}["']/.test(text)) throw new Error('Runtime credential category requires review');
    files[relative] = { bytes: bytes.length, sha256: hash(bytes) };
    const target = path.join(destination, 'runtime', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    // Preserve directory-level CommonJS/ESM boundaries, not application data.
    let directory = path.dirname(source);
    while (directory.startsWith(repo + path.sep)) {
      const marker = path.join(directory, 'package.json');
      if (fs.existsSync(marker)) {
        if (fs.lstatSync(marker).isSymbolicLink()) throw new Error('Package marker link refused');
        const markerRelative = path.relative(repo, marker).replaceAll('\\', '/');
        if (!Object.hasOwn(files, markerRelative)) {
          const markerBytes = fs.readFileSync(marker);
          JSON.parse(markerBytes.toString('utf8'));
          const markerTarget = path.join(destination, 'runtime', markerRelative);
          fs.mkdirSync(path.dirname(markerTarget), { recursive: true }); fs.writeFileSync(markerTarget, markerBytes);
          files[markerRelative] = { bytes: markerBytes.length, sha256: hash(markerBytes) };
        }
      }
      directory = path.dirname(directory);
    }
    const imports = [...text.matchAll(/^\s*(?:import|export)\s+(?:[^;]*?\sfrom\s*)?["']([^"']+)["']/gm),
      ...text.matchAll(/\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/g),
      // The faucet uses this direct, still-literal CommonJS bridge from ESM.
      // Only collect the specifier; never execute the require or source.
      ...text.matchAll(/\bcreateRequire\(\s*import\.meta\.url\s*\)\(\s*["']([^"']+)["']\s*\)/g)];
    for (const match of imports) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) { packages.add(specifier); continue; }
      let dependencyPath = path.resolve(path.dirname(source), specifier);
      if (!path.extname(dependencyPath)) {
        const extension = ['.js', '.cjs', '.mjs'].find(suffix => fs.existsSync(dependencyPath + suffix));
        if (extension) dependencyPath += extension;
      }
      const dependency = path.relative(repo, dependencyPath).replaceAll('\\', '/');
      if (/\.(?:js|cjs|mjs)$/.test(dependency)) visit(dependency);
      else resources.add(dependency); // Metadata only: never read persistent/config resources.
    }
  }
  visit('src/index.js');
  for (const relative of ['package.json', 'package-lock.json']) {
    const source = path.join(repo, relative), bytes = fs.readFileSync(source);
    fs.writeFileSync(path.join(destination, 'runtime', relative), bytes);
    files[relative] = { bytes: bytes.length, sha256: hash(bytes) };
  }
  return { entry: 'src/index.js', files, externalModules: [...packages].sort(), resourceReferences: [...resources].sort(),
    limitations: 'Static literal-import closure; computed imports and filesystem runtime resources need existing owner runtime/configuration. Not executed.' };
};
