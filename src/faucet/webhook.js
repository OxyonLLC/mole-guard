import { fetchRaydiumPrice } from './raydium.js';
import { fetchPumpFunPrice } from './pumpfun.js';
import { Client, GatewayIntentBits, WebhookClient } from 'discord.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
if (!webhookUrl) {
  throw new Error('Missing DISCORD_WEBHOOK_URL in .env');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const webhookClient = new WebhookClient({ url: webhookUrl });

client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content === '!webhook') {
    return message.reply(`Webhook configured: ${Boolean(webhookUrl) ? 'yes' : 'no'}`);
  }

  if (message.content === '!testwebhook') {
    await webhookClient.send({ content: '👋 Hello from the webhook!' });
    return message.reply('Sent a test message via webhook!');
  }

  if (message.content === '!price') {
    try {
      const [ray, pump] = await Promise.all([fetchRaydiumPrice(), fetchPumpFunPrice()]);
      return message.reply(`🏷️ Prices:
• Raydium: $${Number(ray.price).toFixed(6)}
• PumpFun: $${Number(pump.price).toFixed(6)}`);
    } catch (err) {
      console.error(err);
      return message.reply('❌ Failed to fetch prices.');
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
