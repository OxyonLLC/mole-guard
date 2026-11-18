import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commandData } from './commands.js';

const token = process.env.GEOAGORA_DISCORD_BOT_TOKEN;
const clientId = process.env.GEOAGORA_DISCORD_CLIENT_ID;
const guildId = process.env.GEOAGORA_DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error('Missing GEOAGORA_DISCORD_BOT_TOKEN or GEOAGORA_DISCORD_CLIENT_ID in env.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    if (guildId) {
      console.log(`Registering GeoAgora guild commands for guild ${guildId}...`);
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandData });
      console.log(`✅ GeoAgora guild commands registered. Count: ${commandData.length}`);
    } else {
      console.log('Registering GeoAgora global commands...');
      await rest.put(Routes.applicationCommands(clientId), { body: commandData });
      console.log(`✅ GeoAgora global commands registered. Count: ${commandData.length}`);
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
