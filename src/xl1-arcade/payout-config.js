import { isAbsolute } from 'node:path';
import { decimalToUnits } from './config.js';

export function getPayoutConfig(env = process.env) {
  const network = String(env.XL1_NETWORK || '').trim();
  if (!['beta', 'mainnet'].includes(network)) throw new Error('XL1_NETWORK_required');
  const rpcUrl = String(env.XL1_RPC_URL || '').trim();
  let url;
  try { url = new URL(rpcUrl); } catch { throw new Error('XL1_RPC_URL_required'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('XL1_RPC_URL_invalid');
  const chainId = String(env.XL1_CHAIN_ID || '').trim();
  if (!/^[a-f0-9]{40}$/.test(chainId)) throw new Error('XL1_CHAIN_ID_requires_40_hex_characters');
  const senderFile = String(env.XL1_SENDER_FILE || '').trim();
  if (!isAbsolute(senderFile)) throw new Error('XL1_SENDER_FILE_requires_absolute_path');
  if (env.XL1_SDK_MODULE && !isAbsolute(env.XL1_SDK_MODULE)) throw new Error('XL1_SDK_MODULE_requires_absolute_path');
  return { network, rpcUrl, chainId, senderFile, sdkModule: env.XL1_SDK_MODULE,
    lowBalanceUnits: decimalToUnits(env.DISTRIBUTOR_LOW_BALANCE_WARNING || '100', 'DISTRIBUTOR_LOW_BALANCE_WARNING'),
    pausedBalanceUnits: decimalToUnits(env.DISTRIBUTOR_PAYOUT_PAUSED_THRESHOLD || '20', 'DISTRIBUTOR_PAYOUT_PAUSED_THRESHOLD') };
}
