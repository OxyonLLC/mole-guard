import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { getConfig } from './mole/config.js';
import { commandData } from './mole/commands.js';

const cfg = getConfig();
const rest = new REST({ version: '10' }).setToken(cfg.DISCORD_TOKEN);

async function run() {
  console.log('Registering slash commands...');
  if (cfg.DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(cfg.DISCORD_CLIENT_ID, cfg.DISCORD_GUILD_ID), { body: commandData });
    console.log('✅ Registered to guild:', cfg.DISCORD_GUILD_ID);
  } else {
    await rest.put(Routes.applicationCommands(cfg.DISCORD_CLIENT_ID), { body: commandData });
    console.log('✅ Registered globally (can take up to ~1h).');
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
