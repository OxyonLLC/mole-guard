// Matches the XL1 SDK 1.30.3 API used by GeoHackers. Preparation and broadcast
// are deliberately separate: the signed bytes/hash must be durable first.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseSenderCredential } from './sender.js';
import { normalizeWallet } from './reward-engine.js';

export const ATTO_PER_REWARD_UNIT = 1_000_000_000_000n;
const hexInt = value => BigInt(`0x${String(value).replace(/^0x/, '') || '0'}`);

async function currentBlock(rpcUrl) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'xyoViewer_currentBlock', params: [] }),
  });
  if (!response.ok) throw new Error('xl1_rpc_unavailable');
  const body = await response.json();
  const block = body?.result?.[0];
  if (!block || !Number.isSafeInteger(block.block) || typeof block.chain !== 'string') {
    throw new Error('xl1_rpc_block_invalid');
  }
  return { number: block.block, chain: block.chain.replace(/^0x/i, '').toLowerCase() };
}

export async function createSignerAdapter(config, distributor) {
  let sdk, account, signer, gateway;
  try {
    sdk = await import(config.sdkModule ? pathToFileURL(config.sdkModule).href : '@xyo-network/xl1-sdk');
    const phrase = parseSenderCredential(await readFile(config.senderFile, 'utf8'));
    const base = await sdk.generateXyoBaseWalletFromPhrase(phrase);
    account = await base.derivePath('0');
    if (normalizeWallet(account.address) !== distributor) throw new Error();
    signer = await sdk.buildSimpleXyoSignerV2({ config: sdk.ConfigZod.parse({}), caches: {}, singletons: {} }, account);
    gateway = await new sdk.GatewayBuilder().name(config.network).rpcUrl(config.rpcUrl).build(signer);
  } catch { throw new Error('xl1_signer_initialization_failed'); }
  const viewer = gateway.connection.viewer;
  async function assertChain() {
    const block = await currentBlock(config.rpcUrl);
    if (block.chain !== config.chainId) throw new Error('xl1_chain_mismatch');
    return block;
  }
  await assertChain();
  return {
    async balance() {
      await assertChain();
      return BigInt(await viewer.account.balance.accountBalance(distributor));
    },
    async prepare(reward) {
      await assertChain();
      const to = normalizeWallet(reward.wallet);
      const amount = BigInt(reward.payoutUnits ?? reward.actualUnits) * ATTO_PER_REWARD_UNIT;
      if (!to || amount <= 0n) throw new Error('xl1_transfer_invalid');
      const { number: nbf } = await assertChain();
      return prepareTransfer({ sdk, signer, chainId: config.chainId, distributor, to, amount, nbf });
    },
    async confirmed(prepared) {
      await assertChain();
      // One read, no blocking SDK polling. A network error is retried next tick.
      return Boolean(await viewer.transaction.byHash(prepared.hash));
    },
    async expired(prepared) { return (await currentBlock(config.rpcUrl)).number > prepared.exp; },
    async broadcast(prepared) {
      await assertChain();
      if (prepared.chainId !== config.chainId) throw new Error('xl1_chain_mismatch');
      const [hash] = await gateway.addTransactionToChain(JSON.parse(prepared.transaction));
      if (String(hash) !== prepared.hash) throw new Error('xl1_broadcast_hash_mismatch');
      return hash;
    },
  };
}


export async function prepareTransfer({ sdk, signer, chainId, distributor, to, amount, nbf }) {
  const exp = nbf + 10;
  const payload = { schema: sdk.TransferSchema, epoch: Date.now(), from: distributor,
    transfers: { [to]: amount.toString(16) } };
  const build = fees => sdk.buildUnsignedTransaction(chainId, [payload], [], nbf, exp, distributor, fees);
  const estimate = await signer.signTransaction(await build());
  const gas = BigInt(sdk.transactionRequiredGas(estimate));
  // Beta admission enforces this protocol floor even when the calculated
  // transaction gas is smaller. Keep the larger value so the signed payload
  // is accepted by the mempool.
  const gasLimit = gas + gas / 5n + 1000n > 10_000_000_000n
    ? gas + gas / 5n + 1000n
    : 10_000_000_000n;
  const signed = await signer.signTransaction(await build({ ...sdk.defaultTransactionFees, gasLimit }));
  if (BigInt(sdk.transactionRequiredGas(signed)) > gasLimit) throw new Error('xl1_gas_estimate_invalid');
  const hash = signed[0]._hash;
  if (!/^[a-f0-9]{64}$/i.test(hash || '')) throw new Error('xl1_transaction_hash_invalid');
  const fees = signed[0].fees;
  const maxFee = hexInt(fees.base) + hexInt(fees.priority) + hexInt(fees.gasLimit) * hexInt(fees.gasPrice);
  return { hash, transaction: JSON.stringify(signed), exp, chainId, requiredAtto: String(amount + maxFee) };
}
