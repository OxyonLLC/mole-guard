#!/usr/bin/env node
// Generates /giveaways/ from src/mole/giveawayRecords.js — `npm run giveaways:build`.
//
// GENERATED STATIC, NOT CLIENT-RENDERED, for the same reason /news/ is (see the
// header of newsData.js): Apache 404s every /api/ path on winlew.co except the
// one proxy hop, and that hop has gone down before. A ledger that disappears
// during an outage is not a ledger. This page is a real file at a real URL and
// keeps working with the backend switched off entirely.
//
// SAFETY: reads the records, writes one file. No network, no credentials.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import {
  GIVEAWAY_ANNOUNCEMENTS,
  GIVEAWAY_PAYOUTS,
  GIVEAWAY_STATUSES,
  LINK_BASIS,
  GIVEAWAY_SOURCE_WALLET,
  giveawayTotals,
  announcementSummary,
  unmatchedPayouts,
  payoutExplorerUrl,
  validateGiveawayRecords,
} from "../mole/giveawayRecords.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "src/public/giveaways/index.html");

validateGiveawayRecords();

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const amount = (base) => (Number(base) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });
const day = (iso) => String(iso).slice(0, 10);
const shortWallet = (w) => `${w.slice(0, 6)}…${w.slice(-4)}`;
const shortSig = (s) => `${s.slice(0, 8)}…${s.slice(-6)}`;

const BASIS_LABEL = {
  [LINK_BASIS.VERIFIED]: ["Verified", "Amount, timing and a named winner agree — or the recipient published the address themselves."],
  [LINK_BASIS.INFERRED]: ["Inferred", "Lands in a cluster right after the deadline and the amount matches the prize. Probably right. Not proven."],
  [LINK_BASIS.NONE]: ["Unmatched", "A real transfer with no announcement to attach it to."],
};

const STATUS_LABEL = {
  [GIVEAWAY_STATUSES.PAID]: "Paid",
  [GIVEAWAY_STATUSES.PARTIALLY_PAID]: "Partly paid",
  [GIVEAWAY_STATUSES.NEVER_TRIGGERED]: "Never triggered",
  [GIVEAWAY_STATUSES.OPEN]: "Open",
};

const totals = giveawayTotals();

function payoutRow(p) {
  const [label] = BASIS_LABEL[p.linkBasis];
  // What became of the tokens, where the chain can say. Shown under the row it
  // belongs to rather than as a column, because it applies to almost none of
  // them — a column would be mostly empty and would imply we checked every row,
  // which we have not.
  const fate = p.fate
    ? `<tr class="fateRow"><td colspan="5">
        <span class="fateTag">Burned by recipient</span>
        ${esc(amount(p.fate.amountBaseUnits))} destroyed on ${esc(day(p.fate.dateIso))} —
        <a href="https://solscan.io/tx/${esc(p.fate.signature)}" rel="noopener noreferrer" target="_blank"><code>${esc(shortSig(p.fate.signature))}</code></a>.
        ${esc(p.fate.note || "")}
        <em>The burn is proven; that it was these tokens is inferred from the amount and the timing.</em>
      </td></tr>`
    : "";
  return `<tr>
      <td class="d">${esc(day(p.dateIso))}</td>
      <td class="a">${esc(amount(p.amountBaseUnits))}</td>
      <td><code>${esc(shortWallet(p.recipientWallet))}</code></td>
      <td><span class="basis b-${esc(p.linkBasis)}">${esc(label)}</span></td>
      <td><a href="${esc(payoutExplorerUrl(p))}" rel="noopener noreferrer" target="_blank"><code>${esc(shortSig(p.signature))}</code></a></td>
    </tr>${fate}`;
}

const announcements = GIVEAWAY_ANNOUNCEMENTS.map((a) => announcementSummary(a))
  .sort((x, y) => Date.parse(y.announcedIso) - Date.parse(x.announcedIso))
  .map((a) => {
    const [basisLabel, basisWhy] = BASIS_LABEL[a.weakestLinkBasis];
    const rows = a.payouts.map(payoutRow).join("\n");
    return `<article class="card">
      <div class="cardTop">
        <h3>${esc(a.title)}</h3>
        <span class="status s-${esc(a.status)}">${esc(STATUS_LABEL[a.status])}</span>
      </div>
      <p class="meta">Announced ${esc(day(a.announcedIso))}${a.url ? ` · <a href="${esc(a.url)}" rel="noopener noreferrer" target="_blank">the post</a>` : " · no post URL kept"}</p>
      <p class="cond"><strong>Condition:</strong> ${esc(a.condition)}</p>
      <p class="cond"><strong>Promised:</strong> ${esc(a.prize)}</p>
      ${a.payouts.length ? `<p class="cond"><strong>Actually paid:</strong> ${esc(amount(a.paidBaseUnits))} WinLEW across ${a.payouts.length} transfer${a.payouts.length === 1 ? "" : "s"} · <span class="basis b-${esc(a.weakestLinkBasis)}">${esc(basisLabel)}</span> <span class="why">${esc(basisWhy)}</span></p>` : ""}
      <p class="note">${esc(a.note)}</p>
      ${rows ? `<div class="tableWrap"><table><thead><tr><th>Date</th><th class="a">WinLEW</th><th>To</th><th>Link basis</th><th>Transaction</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
    </article>`;
  })
  .join("\n");

const unmatched = unmatchedPayouts()
  .slice()
  .sort((x, y) => Date.parse(y.dateIso) - Date.parse(x.dateIso))
  .map(payoutRow)
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="en" data-api-base="/verify/api-proxy.php">
<head>
  <meta charset="UTF-8" />
  <title>WinLEW Giveaway Records — Promised, Paid, Proven</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0,viewport-fit=cover" />
  <meta name="description" content="Every WinLEW giveaway: what was promised, what was actually paid, and the transaction for each. Reconstructed from the chain, including the ones that never triggered." />
  <link rel="canonical" href="https://winlew.co/giveaways/" />
  <meta property="og:title" content="WinLEW Giveaway Records — Promised, Paid, Proven" />
  <meta property="og:description" content="${esc(amount(totals.givenAwayBaseUnits))} WinLEW given away across ${totals.giveawayCount} transfers to ${totals.distinctGiveawayWallets} wallets — every one with a transaction you can check." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://winlew.co/giveaways/" />
  <link rel="icon" type="image/x-icon" href="/images/favicon.ico" />
  <link rel="stylesheet" href="/assets/nav.css" />
  <link rel="stylesheet" href="/assets/premium.css" />
  <style>
    html { overflow-x: hidden; }
    body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: radial-gradient(circle at top, #20120c, #130b08 70%); color:#f6efe8; line-height:1.7; }
    .wlPageShell { max-width:1120px; margin:0 auto; padding:32px; }
    h1,h2,h3 { color:#e7c18f; margin:0 0 10px; }
    h1 { font-size: clamp(32px,4.8vw,50px); }
    h2 { font-size: clamp(20px,2.8vw,28px); margin-top:38px; }
    h3 { font-size: clamp(17px,2.2vw,21px); }
    a { color:#8fd6a0; text-decoration:none; }
    a:hover { text-decoration:underline; }
    p { margin:0 0 12px; }
    code { background:rgba(0,0,0,.34); padding:2px 6px; border-radius:6px; font-size:.9em; }
    .lede { color:rgba(246,239,232,.86); max-width:74ch; }
    .statRow { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:14px; margin:26px 0 8px; }
    .stat { background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.02));
      border:1px solid rgba(255,255,255,.12); border-radius:16px; padding:16px 18px; }
    .stat b { display:block; font-size:clamp(21px,3vw,29px); color:#8fd6a0; line-height:1.2; }
    .stat span { font-size:13px; color:rgba(246,239,232,.72); }
    .card { background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));
      border:1px solid rgba(255,255,255,.12); border-radius:18px; padding:20px; margin:16px 0; }
    .cardTop { display:flex; gap:12px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; }
    .meta,.cond,.note { font-size:14.5px; color:rgba(246,239,232,.8); }
    .note { border-left:3px solid rgba(143,214,160,.5); padding-left:12px; margin-top:14px; color:rgba(246,239,232,.72); }
    .status { font-size:12px; font-weight:900; letter-spacing:.08em; text-transform:uppercase;
      padding:6px 12px; border-radius:999px; white-space:nowrap; border:1px solid; }
    .s-paid { color:#8fd6a0; border-color:rgba(143,214,160,.5); background:rgba(143,214,160,.1); }
    .s-partially-paid { color:#e0c66a; border-color:rgba(224,198,106,.5); background:rgba(224,198,106,.1); }
    .s-never-triggered { color:rgba(246,239,232,.66); border-color:rgba(255,255,255,.2); background:rgba(255,255,255,.05); }
    .s-open { color:#7fb2d9; border-color:rgba(127,178,217,.5); background:rgba(127,178,217,.1); }
    .basis { font-size:11.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase;
      padding:3px 9px; border-radius:999px; border:1px solid; white-space:nowrap; }
    .b-verified { color:#8fd6a0; border-color:rgba(143,214,160,.45); }
    .b-inferred-timing { color:#e0c66a; border-color:rgba(224,198,106,.45); }
    .b-none { color:rgba(246,239,232,.6); border-color:rgba(255,255,255,.18); }
    /* What became of a payout, attached under its own row. Green because a
       destroyed token is a fact in the reader's favour, and indented so it
       reads as a footnote to the row above rather than another payout. */
    .fateRow td { font-size:13px; color:rgba(246,239,232,.82); padding-left:22px;
      border-left:3px solid rgba(61,220,132,.45); background:rgba(61,220,132,.05); }
    .fateRow em { color:rgba(246,239,232,.62); }
    .fateTag { display:inline-block; margin-right:8px; font-size:11px; font-weight:800;
      letter-spacing:.06em; text-transform:uppercase; color:#8fe3b0;
      background:rgba(61,220,132,.10); border:1px solid rgba(61,220,132,.28);
      padding:3px 8px; border-radius:999px; }
    .why { font-size:13px; color:rgba(246,239,232,.62); font-weight:400; text-transform:none; letter-spacing:0; }
    .tableWrap { overflow-x:auto; margin-top:14px; }
    table { border-collapse:collapse; width:100%; min-width:640px; font-size:14px; }
    th,td { text-align:left; padding:9px 12px; border-bottom:1px solid rgba(255,255,255,.09); }
    th { color:#e7c18f; font-size:12px; letter-spacing:.06em; text-transform:uppercase; }
    td.a, th.a { text-align:right; font-variant-numeric:tabular-nums; }
    td.d { white-space:nowrap; color:rgba(246,239,232,.75); }
  </style>
</head>
<body>
<div class="nav">
  <div class="navInner">
    <a class="navBrand" href="/">WinLEW</a>
    <div class="navLinks" id="siteNavLinks">
        <!-- Rebuilt by nav.js from NAV_GROUPS. The element must stay; nav.js
             bails out entirely if .navLinks is absent. -->
      </div>
    <div class="navRight">
      <a class="pill navProfile" href="/verify/profile.html">📊 Dashboard</a>
      <div class="navBalanceChip" aria-label="Your WinLEW balance"><span class="navBalanceIcon">◎</span><span id="navWalletAmount">—</span><span class="navBalanceTicker">LEW</span></div>
      <button id="navWalletConnect" class="pill" type="button" title="Connect your wallet (links to your Discord-verified wallet)">Connect wallet</button>
      <button class="navToggle" type="button" aria-expanded="false" aria-controls="siteNavLinks" aria-label="Toggle navigation">☰</button>
    </div>
  </div>
</div>

<div class="wlPageShell">
  <header class="wlHero">
    <div class="wlHeroMain">
      <span class="wlKicker">PROMISED • PAID • PROVEN</span>
      <h1 class="wlHeroTitle">Giveaway<br><span class="wlHeroTitleAccent">Records</span></h1>
      <p class="lede">Every giveaway this project has run — what was promised, what was actually paid, and the transaction for each one. Including the ones that were never paid, and why.</p>
      <p class="lede">These records were <strong>not kept at the time</strong>. They were reconstructed in August 2026 by walking the paying wallet's complete history on Solana — all 82 transactions of it, back to two days after launch. The chain kept what we didn't.</p>
    </div>
  </header>

  <div class="statRow">
    <div class="stat"><b>${esc(amount(totals.givenAwayBaseUnits))}</b><span>WinLEW given to people</span></div>
    <div class="stat"><b>${totals.giveawayCount}</b><span>payouts, to ${totals.distinctGiveawayWallets} distinct wallets</span></div>
    <div class="stat"><b>${totals.byLinkBasis.verified}</b><span>tied to an announcement, verified</span></div>
    <div class="stat"><b>${totals.byLinkBasis.none}</b><span>real transfers we cannot explain</span></div>
  </div>

  <h2>Evidence over assumptions</h2>
  <p class="lede">A payout is a fact — it has a signature. Its <em>association</em> with an announcement usually is not: for most of these, the only thing tying a transfer to a promise is that they happened near each other. Rather than quietly merge the two, every payout says which it is.</p>
  <p class="lede"><span class="basis b-verified">Verified</span> the amount, the timing and a named winner all agree, or the recipient published the address themselves. <span class="basis b-inferred-timing">Inferred</span> it lands in a cluster right after a deadline and the amount matches the prize — probably right, not proven. <span class="basis b-none">Unmatched</span> a real transfer with no announcement to attach it to.</p>
  ${totals.faucetTopupCount ? `<p class="lede" style="border-left:3px solid rgba(214,168,102,.5);padding-left:14px;"><strong>${esc(amount(totals.faucetPaidBaseUnits))} WinLEW is also not counted above</strong> — ${totals.faucetTopupCount} faucet claims the owner paid by hand from winlew.sol on days the faucet's own wallet had run dry. Somebody had already earned those by claiming; counting them here would pad this ledger with rewards that are tracked and paid somewhere else.</p>` : ""}
  ${totals.exchangeCount ? `<p class="lede" style="border-left:3px solid rgba(214,168,102,.5);padding-left:14px;"><strong>${esc(amount(totals.exchangedBaseUnits))} WinLEW is deliberately NOT counted above.</strong> It was an <strong>exchange, not a gift</strong> — the project received 1,000,000 2BRZ for it 55 minutes earlier, in a token swap with a partner project. Counting what you were paid for as generosity is the one failure mode a giveaway ledger must not have, so it is listed separately and still shown.</p>` : ""}
  <p class="lede"><strong>${totals.byLinkBasis.none} of ${totals.payoutCount} payouts are unmatched.</strong> That is not a hole in the record — it <em>is</em> the record. Tokens were given away for two years without notes. The chain preserved the transfers; it does not store reasons.</p>
  <p class="lede">Wallets are shown because they are public on-chain regardless. Winners are named only where they published the link between themselves and their wallet — nothing here identifies anyone who didn't.</p>

  <h2>Nothing is owed</h2>
  <p class="lede">Some giveaways below never triggered, because they were tied to a milestone — a follower count, a holder count — that was never reached. They are listed anyway, with their conditions intact, because deleting a promise that went unmet is worse than leaving it standing.</p>
  <p class="lede">To be plain: <strong>a giveaway conditioned on a milestone that did not happen is not a debt.</strong> Nothing is owed to anyone from these records. They are published so the history is complete, not because there is a bill outstanding.</p>

  <h2>Every announcement</h2>
  ${announcements}

  <h2>Unmatched payouts</h2>
  <p class="lede">Real transfers from the same wallet, to real people, that no surviving announcement explains. Listed rather than dropped — an unexplained payment is still a payment, and hiding it would make the total a lie.</p>
  <p class="lede">The largest of them, <strong>3,500,000 on 2025-04-01</strong>, was investigated rather than left as a question mark. It was a gift and not a sale: the reserve itself signed the transfer and the only SOL that moved was the reserve <em>paying</em> to create the recipient's token account — nothing came back. The recipient then bought roughly <strong>5.7 million more WinLEW on the open market with their own money</strong>, held for nine months, moved exactly 12,000,000 out in January 2026 and closed the account. What the chain cannot settle is <em>why</em> it was sent, and no announcement from that date accounts for the amount. So it stays unmatched.</p>
  <p class="lede">That is the honest shape of this section: we can usually prove what a transfer <em>was</em>, and often not what it was <em>for</em>.</p>
  <div class="tableWrap"><table><thead><tr><th>Date</th><th class="a">WinLEW</th><th>To</th><th>Link basis</th><th>Transaction</th></tr></thead><tbody>
${unmatched}
  </tbody></table></div>

  <h2>How to check this yourself</h2>
  <p class="lede">Every payout came from <code>${esc(GIVEAWAY_SOURCE_WALLET)}</code>. Open it in any explorer, walk its token transfers, and compare. The complete walk this page is built from is committed in the project repository alongside the code that produced it.</p>
  <p class="lede">Related: <a href="/transparency/">Transparency Center</a> · <a href="/burn/">Burn Center</a> · <a href="/events/">Community Events</a> · <a href="/news/">News</a></p>
</div>

<script src="/assets/wallet-auth.js"></script>
<script defer src="/assets/nav.js"></script>
</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote src/public/giveaways/index.html`);
console.log(`  ${GIVEAWAY_ANNOUNCEMENTS.length} announcements · ${totals.payoutCount} payouts · ${amount(totals.givenAwayBaseUnits)} given away + ${amount(totals.exchangedBaseUnits)} exchanged + ${amount(totals.faucetPaidBaseUnits)} faucet`);
