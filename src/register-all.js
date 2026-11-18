import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { REST, Routes } from 'discord.js';
import { commandData as moleCommandData } from './mole/commands.js';
import quizCommandModule from './quiz/command-data.cjs';

const { commandData: quizCommandData = [] } = quizCommandModule;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function parseDotEnv(contents) {
  const out = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function loadEnvFile(relPath) {
  const abs = path.resolve(projectRoot, relPath);
  if (!fs.existsSync(abs)) return {};
  return parseDotEnv(fs.readFileSync(abs, 'utf8'));
}

function loadMergedEnv(relPath) {
  dotenv.config({ path: path.resolve(projectRoot, '.env'), override: false });
  return { ...process.env, ...loadEnvFile(relPath) };
}

function registerRoute(clientId, guildId) {
  return guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);
}

async function registerTarget({ label, token, clientId, guildId, commandData }) {
  if (!token || !clientId) {
    throw new Error(`${label}: missing token or client ID.`);
  }
  const rest = new REST({ version: '10' }).setToken(token);
  const route = registerRoute(clientId, guildId);
  await rest.put(route, { body: commandData });
  console.log(`✅ ${label}: registered ${commandData.length} slash commands ${guildId ? `to guild ${guildId}` : 'globally'}.`);
}

async function main() {
  const rootEnv = loadMergedEnv('.env');
  const quizEnv = loadMergedEnv('src/quiz/.env');

  await registerTarget({
    label: 'Mole Guard',
    token: rootEnv.DISCORD_TOKEN,
    clientId: rootEnv.DISCORD_CLIENT_ID,
    guildId: rootEnv.DISCORD_GUILD_ID,
    commandData: moleCommandData,
  });

  await registerTarget({
    label: 'Quiz / Utility',
    token: quizEnv.DISCORD_TOKEN || quizEnv.DISCORD_BOT_TOKEN,
    clientId: quizEnv.CLIENT_ID,
    guildId: quizEnv.GUILD_ID,
    commandData: quizCommandData,
  });

  console.log('🎯 register-all complete. Mole Guard and Quiz / Utility are aligned with the current code.');
  console.log('ℹ️ GeoAgora commands are owned and registered by the GeoAgora repository.');
}

main().catch((error) => {
  console.error('register-all failed:', error);
  process.exit(1);
});
