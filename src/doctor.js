import fs from 'fs';
import path from 'path';

const checks = [
  ['root env', '.env'],
  ['quiz env', 'src/quiz/.env'],
  ['mole entry', 'src/index.js'],
  ['quiz entry', 'src/quiz/index.js'],
  ['watchdog entry', 'src/watchdog/index.js'],
  ['public entry', 'src/public-server.js'],
];

let failed = false;
console.log(`Node ${process.version}`);

for (const [label, relPath] of checks) {
  const abs = path.resolve(relPath);
  const ok = fs.existsSync(abs);
  console.log(`${ok ? '✅' : '❌'} ${label}: ${relPath}`);
  if (!ok) failed = true;
}

const rootPkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
console.log(`\nProject: ${rootPkg.name}@${rootPkg.version}`);
console.log(`Discord.js range: ${rootPkg.dependencies['discord.js']}`);
console.log(`Solana web3 range: ${rootPkg.dependencies['@solana/web3.js']}`);

if (failed) {
  process.exitCode = 1;
} else {
  console.log('\nAll core files are present.');
}

console.log('ℹ️ start:all launches only WinLEW-owned services. GeoAgora and GeoHackers run from their own repositories.');
