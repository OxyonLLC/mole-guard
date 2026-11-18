require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { REST, Routes } = require('discord.js');
const { commandData } = require('./command-data.cjs');

const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN (or DISCORD_BOT_TOKEN) or CLIENT_ID in env.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    if (guildId) {
      console.log(`Registering guild commands for guild ${guildId}...`);
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandData });
      console.log(`✅ Guild commands registered (fast). Count: ${commandData.length}`);
    } else {
      console.log('Registering global commands... (may take up to an hour to propagate)');
      await rest.put(Routes.applicationCommands(clientId), { body: commandData });
      console.log(`✅ Global commands registered. Count: ${commandData.length}`);
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
