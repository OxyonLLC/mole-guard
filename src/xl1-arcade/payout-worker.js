import { ATTO_PER_REWARD_UNIT } from './signer-adapter.js';

// Exactly one unresolved transfer is processed at a time per distributor.
// A timeout after broadcast is recovered using its DURABLY STORED hash/bytes.
// Expired/ambiguous transfers are held for review, never signed a second time.
export async function processPayout({ job, adapter, save, assertLease, config, enabled = true }) {
  if (!enabled) return { state: 'PAUSED' };
  if (job.mode !== 'live') throw new Error('xl1_worker_rejects_simulated_reward');
  if (job.status === 'PAID' || job.status === 'REVIEW') return job;
  let current = job;
  if (current.prepared) {
    if (await adapter.confirmed(current.prepared)) {
      return save({ status: 'PAID', paidAt: new Date(), transactionHash: current.prepared.hash });
    }
    if (await adapter.expired(current.prepared)) {
      return save({ status: 'REVIEW', reason: 'expired_unconfirmed', transactionHash: current.prepared.hash });
    }
  }
  const balance = await adapter.balance();
  const reserve = config.pausedBalanceUnits * ATTO_PER_REWARD_UNIT;
  const warning = balance < config.lowBalanceUnits * ATTO_PER_REWARD_UNIT;
  const required = current.prepared ? BigInt(current.prepared.requiredAtto) : BigInt(current.payoutUnits ?? current.actualUnits) * ATTO_PER_REWARD_UNIT;
  if (balance < reserve + required) return { state: 'LOW_BALANCE', warning, balanceAtto: String(balance) };
  if (!current.prepared) {
    const prepared = await adapter.prepare(current);
    current = await save({ status: 'PREPARED', prepared, transactionHash: prepared.hash });
    if (balance < reserve + BigInt(prepared.requiredAtto)) return { state: 'LOW_BALANCE', warning, balanceAtto: String(balance) };
  }
  await assertLease();
  // A broadcast exception leaves PREPARED intact. The next tick checks chain
  // confirmation first and may only rebroadcast these exact same signed bytes.
  await adapter.broadcast(current.prepared);
  return save({ status: 'SUBMITTED', submittedAt: new Date(), transactionHash: current.prepared.hash });
}
