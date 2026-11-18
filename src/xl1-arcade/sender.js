// Server-only, read-only credential validation. Never import the credential file
// as JavaScript: the supplied file is an assignment plus an address comment.
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeWallet } from './reward-engine.js';

export function parseSenderCredential(source) {
  const match = String(source).match(/^\s*XL1_Sender\s*=\s*["']([^"'\r\n]+)["']\s*;?\s*$/m);
  const phrase = match?.[1]?.trim().replace(/\s+/g, ' ');
  if (!phrase || ![12, 15, 18, 21, 24].includes(phrase.split(' ').length)) {
    throw new Error('xl1_sender_file_invalid');
  }
  return phrase;
}

export async function checkSender({ file, sdkModule, expectedAddress }) {
  if (!file || !isAbsolute(file)) throw new Error('XL1_SENDER_FILE_requires_absolute_path');
  if (sdkModule && !isAbsolute(sdkModule)) throw new Error('XL1_SDK_MODULE_requires_absolute_path');
  try {
    const sdk = await import(sdkModule ? pathToFileURL(sdkModule).href : '@xyo-network/xl1-sdk');
    const phrase = parseSenderCredential(await readFile(file, 'utf8'));
    const base = await sdk.generateXyoBaseWalletFromPhrase(phrase);
    const account = await base.derivePath('0');
    const address = normalizeWallet(account.address);
    if (!address || address !== normalizeWallet(expectedAddress)) {
      throw new Error('xl1_sender_address_mismatch');
    }
    return { address, matchesDistributor: true, transactionSubmitted: false };
  } catch (error) {
    // SDK/parser errors can contain input values; do not forward their text.
    if (error.message === 'xl1_sender_address_mismatch') throw error;
    throw new Error('xl1_sender_check_failed');
  }
}
