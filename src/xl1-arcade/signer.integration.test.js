import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { prepareTransfer } from './signer-adapter.js';

test('GeoHackers SDK builds a recoverable XL1 transfer offline with exact amounts',
  { skip: process.env.XL1_ARCADE_SDK_TEST !== '1' }, async () => {
    await import('dotenv/config');
    const sdk = await import(pathToFileURL(process.env.XL1_SDK_MODULE).href);
    // Public BIP39 test vector only; never use this phrase for real funds.
    const base = await sdk.generateXyoBaseWalletFromPhrase(Array(11).fill('abandon').concat('about').join(' '));
    const account = await base.derivePath('0');
    const signer = await sdk.buildSimpleXyoSignerV2({ config: sdk.ConfigZod.parse({}), caches: {}, singletons: {} }, account);
    const to = '1'.repeat(40);
    const amount = 50000n * 1000000000000n;
    const prepared = await prepareTransfer({ sdk, signer, chainId: '0'.repeat(40), distributor: account.address, to, amount, nbf: 1 });
    const signed = JSON.parse(prepared.transaction);
    assert.match(prepared.hash, /^[a-f0-9]{64}$/);
    assert.equal(prepared.hash, signed[0]._hash);
    assert.equal(signed[1][0].transfers[to], amount.toString(16));
    assert.equal(prepared.exp, 11);
    assert.ok(BigInt(prepared.requiredAtto) > amount);
    assert.ok(BigInt(`0x${signed[0].fees.gasLimit}`) >= 10_000_000_000n);
  });
