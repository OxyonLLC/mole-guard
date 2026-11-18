import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection("https://solana-rpc.publicnode.com", "confirmed");
const MINT = new PublicKey("DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump");

const comps = [
  ["lock50m       (50M Jupiter)", "E8Pu1WNFqnAPbA9HDqxwgHz6xLvwBXQpekeNLRoiKzSo"],
  ["lock15mTeam   (15M Jupiter)", "zLHYYpKtXFnrwQ52PVxwSU7X87955i14RtgaGsE8SWA"],
  ["streamflow22m", "4XnVM4G2xLiKSTfmLeRXTcS1HBnSZPewv1aQcgtpYwv9"],
  ["streamflow7m ", "B4GJSLCH8F5EDXctPynP157FbbF1SbfZ2HsG3bWUYJpz"],
  ["burn wallet  ", "EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74"],
  ["X faucet res.", "GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp"],
  ["Discord/Web  ", "FcEtZqVowuhF2hdysy7qxJYRhu1eNZ8ws2JqHUDmPPjE"],
  ["developer res", "D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ"],
];

const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

for (const [label, addr] of comps) {
  const pk = new PublicKey(addr);
  let shown = "";
  // Try as a token account first (escrows are token accounts).
  try {
    const bal = await conn.getTokenAccountBalance(pk);
    shown = `token-account  WinLEW=${fmt(bal.value.uiAmount)}`;
  } catch {
    // Otherwise treat as a wallet and sum its WinLEW token accounts.
    try {
      const res = await conn.getParsedTokenAccountsByOwner(pk, { mint: MINT });
      const total = res.value.reduce((a, x) => a + Number(x.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
      const sol = (await conn.getBalance(pk)) / 1e9;
      shown = `wallet         WinLEW=${fmt(total)}  SOL=${sol.toFixed(4)}`;
    } catch (e) { shown = `ERROR ${e.message}`; }
  }
  console.log(`${label}  ${shown}`);
}
