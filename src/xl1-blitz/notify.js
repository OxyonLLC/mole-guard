// Discord log lines for the Blitz bridge (site activity log, siteLog.js). Amounts, masked wallets and transaction hashes only.
import { logSiteEvent } from '../mole/siteLog.js';

// States in which Blitz cash-outs are not going out; each is posted once when the bridge enters it.
export const STOPPED_STATES = { PAUSED: 'Payouts are paused (pause switch)', LOW_BALANCE: 'Reserve too low: would dip below the pause threshold',
  DAILY_CEILING: 'Daily ceiling reached: the rest go out after 00:00 UTC', BATCH_REVIEW: 'A batch expired unconfirmed: needs a person (nothing is re-signed)',
  ERROR: 'Bridge cycles are failing (3 in a row)' };
const xl1 = units => `${(Number(units) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 })} XL1`;
const shortHash = h => (h ? '`' + String(h).slice(0, 10) + '…' + String(h).slice(-6) + '`' : '');

/** Posts bridge events to the Discord site activity log (fire-and-forget; never blocks a payout). */
export function discordNotifier(network, mode, post = logSiteEvent) {
  const net = `${network}${mode === 'live' ? '' : ' (dry-run)'}`;
  const plural = n => `${n} wallet${n === 1 ? '' : 's'}`;
  return event => {
    const base = { source: 'BLITZ', trace: event.requestId?.slice(0, 8) || event.batchId?.slice(-8) };
    if (event.kind === 'auto_approved') return post({ ...base, type: 'blitz-auto-approved', icon: '✅', wallet: event.wallet,
      title: `Blitz cash-out ${xl1(event.units)} auto-approved`, fields: { Flag: event.reason || 'review', Network: net, Pays: 'this payout run' } });
    if (event.kind === 'submitted') return post({ ...base, type: 'blitz-batch-sent', icon: '📤',
      title: `Blitz payout sent: ${xl1(event.totalUnits)} to ${plural(event.recipients)}`, fields: { Network: net, Tx: shortHash(event.txHash) } });
    if (event.kind === 'paid') return post({ ...base, type: 'blitz-batch-paid', icon: '💸',
      title: `Blitz payout confirmed on chain: ${xl1(event.totalUnits)} to ${plural(event.recipients)}`, fields: { Network: net, Tx: shortHash(event.txHash) } });
    if (event.kind === 'declined') return post({ ...base, type: 'blitz-declined', outcome: 'refused', wallet: event.wallet,
      title: `Blitz cash-out ${xl1(event.units)} declined`, fields: { Reason: event.reason } });
    if (event.kind === 'stopped') return post({ ...base, type: `blitz-stopped-${event.state}`, outcome: 'fail',
      title: `Blitz payouts stopped: ${STOPPED_STATES[event.state] || event.state}`, fields: { Network: net, Batch: event.batchId } });
  };
}

