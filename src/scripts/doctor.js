import fs from 'fs';
import path from 'path';

const checks = [
  ['root env', '.env'],
  ['quiz env', 'src/quiz/.env'],
  ['faucet env', 'src/faucet/.env'],
  ['mole entry', 'src/index.js'],
  ['faucet entry', 'src/faucet/bot.js'],
  ['quiz entry', 'src/quiz/index.js'],
  ['watchdog entry', 'src/watchdog/index.js'],
  ['public entry', 'src/public-server.js'],
  ['dev launcher', 'src/scripts/dev-all.js'],
];

console.log(`Node ${process.version}`);
for (const [label, rel] of checks) {
  const ok = fs.existsSync(path.resolve(rel));
  console.log(`${ok ? '✅' : '❌'} ${label}: ${rel}`);
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
console.log(`\nProject: ${pkg.name}@${pkg.version}`);
console.log(`Discord.js range: ${pkg.dependencies['discord.js']}`);
console.log(`Solana web3 range: ${pkg.dependencies['@solana/web3.js']}`);
console.log(`SPL token range: ${pkg.dependencies['@solana/spl-token']}`);
