/**
 * WinLEW News Center — the article registry.
 *
 * This file is the ONLY source of truth for /news/. Both the index and every
 * article page are generated from it by `npm run news:build`, the same shape as
 * build-roadmap.mjs and build-sitemap.mjs, whose outputs are likewise committed.
 *
 * WHY GENERATED STATIC HTML, NOT CLIENT-SIDE RENDERING
 *
 * /modules/ renders from /api/modules/status and is the obvious precedent, but
 * it cannot work here for two reasons that are not stylistic:
 *
 *  1. Social previews. Discord and X read og: tags out of the raw HTML — they
 *     do not run JavaScript. A client-rendered article would share as a bare
 *     URL forever, which is most of what a news section is for.
 *  2. The archive has to outlive the backend. Apache 404s every /api/ path on
 *     winlew.co (only /verify/api-proxy.php reaches Node), and that hop has
 *     gone down. A permanent record that disappears during an outage is not a
 *     permanent record.
 *
 * So articles are real files at real URLs. No CMS, no runtime dependency, and
 * nothing to keep running for the archive to stay readable.
 *
 * ADDING AN ARTICLE
 *
 *   1. Add an entry below.
 *   2. `npm run news:build`
 *   3. Commit the generated files under src/public/news/.
 *
 * Set `status: "draft"` while writing. Drafts are never written to disk, never
 * listed, and have no URL — see test/mole/newsData.test.mjs, which fails if a
 * draft's slug appears anywhere under src/public/news/.
 */

export const NEWS_STATUSES = Object.freeze({
  DRAFT: "draft",
  PUBLISHED: "published",
});

/**
 * Categories. The emoji is decorative — every card also carries the text
 * label, so a platform without the glyph still says what the article is.
 */
export const NEWS_CATEGORIES = Object.freeze({
  announcements: { label: "Announcements", emoji: "📢" },
  development: { label: "Development", emoji: "🛠️" },
  security: { label: "Security", emoji: "🔐" },
  burns: { label: "Burns", emoji: "🔥" },
  governance: { label: "Governance", emoji: "🏛️" },
  ecosystem: { label: "Ecosystem", emoji: "🌎" },
  milestones: { label: "Milestones", emoji: "🏆" },
  community: { label: "Community", emoji: "🤝" },
});

/** Recommended hero ratio. Kept here so future graphics use one template. */
export const NEWS_HERO_RATIO = "16 / 9";

/**
 * Reading time, computed rather than authored.
 *
 * A hand-typed "4 min read" is the RELEASE_VERSION bug in miniature: right on
 * the day it ships, wrong after the first edit, and nobody notices. 200 wpm is
 * the usual prose estimate; the floor of 1 stops a short notice reading
 * "0 min read".
 */
export function readingTimeMinutes(html) {
  const words = String(html || "")
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/**
 * ARTICLES, newest first.
 *
 * Fields:
 *   slug       URL segment. /news/<slug>/ — permanent, never rename a published one.
 *   status     draft | published
 *   featured   at most one true; the builder throws on more than one.
 *   category   key of NEWS_CATEGORIES
 *   title      headline
 *   subtitle   one-line standfirst, also the og:description
 *   date       ISO date (publication)
 *   image      hero, from /images/news/ — omit rather than reuse an unrelated one
 *   imageAlt   required whenever image is set
 *   body       article HTML
 *   sources    optional [{label, url}] — the "Verify / Sources" block
 *   related    optional [{label, path}] — existing WinLEW pages
 */
export const NEWS_ARTICLES = Object.freeze([
  {
    // Introduces Oxyon to WinLEW readers. ANNOUNCEMENT, published 2026-10-03.
    //
    // WORDING RULES (owner decisions, 2026-10-03), because this is the article
    // other pages will link to as the explanation:
    //   - "built by the team behind" / "the same team". Never "parent", "owned
    //     by" or "acquired": there is no legal ownership structure to claim.
    //   - No XYO partnership is implied. The /xyo/ disclaimer is repeated.
    //   - History stays history: the wallet LAUNCHED as GeoWallet.
    //
    // FACTS, AND WHERE EACH ONE WAS CHECKED:
    //   - Oxyon Wallet 1.2.0 was submitted to the Chrome Web Store as an update
    //     to the existing GeoWallet listing (same extension id, so installed
    //     users keep their wallets). Submitted, not yet approved, so the text
    //     says "submitted", not "live in the store".
    //   - The web wallet at wallet.oxyon.io serves the extension's own screens
    //     (OxyonWallet repo, apps/web). The mobile app runs in testing and is
    //     not published, so it is "in development".
    //   - Wallets created in the old web app on winlew.co live in that browser's
    //     storage for winlew.co only; they do not appear on wallet.oxyon.io.
    //     Recovery-phrase import is the move path. This warning goes out BEFORE
    //     the old app is retired (see the sprint plan, item F1).
    //   - Module statuses are the ones oxyon.io itself publishes.
    //   - Nothing about $WinLEW changes in this announcement. The article does
    //     not promise anything about future tokens either way.
    slug: "winlew-isnt-going-away",
    status: NEWS_STATUSES.PUBLISHED,
    featured: false,
    category: "announcements",
    image: "/images/news/generated/winlew-isnt-going-away.png",
    imageAlt:
      "Generated cover for the Oxyon announcement: the category label and headline set on the WinLEW dark gradient.",
    title: "WinLEW Isn't Going Away — We're Building Around It",
    subtitle:
      "Some of what we build turned out to be useful beyond WinLEW. That technology now has its own name — Oxyon — and the wallet you know as GeoWallet is now Oxyon Wallet. Here is what changes, and what does not.",
    date: "2026-10-03",
    body: `
<p>WinLEW started in 2024 as a community, a token and a simple idea: participation should be provable. Along the way we built the tools that idea needed: a wallet, verification, block producers on XYO's XL1, proof systems. Some of them turned out to be useful to people who have never held $WinLEW.</p>

<p>That technology now has its own name: <strong><a href="https://oxyon.io/" target="_blank" rel="noopener">Oxyon</a></strong>.</p>

<h2>The short version</h2>
<p><strong>WinLEW is the community, token and participation ecosystem. Oxyon is the technology, built by the same team.</strong> WinLEW is not being replaced, renamed or absorbed. It is where a lot of Oxyon's technology gets used first, and where it is proven.</p>

<h2>What stays WinLEW</h2>
<ul>
  <li><strong>$WinLEW</strong>: same token, same contract. Nothing about it changes in this announcement.</li>
  <li><a href="/proof-of-value/">Proof of Value</a>, <a href="/hodl/">HODL Rewards</a>, the <a href="/faucet/">faucet</a>, the quiz, the arcade and the games.</li>
  <li><a href="/governance/">Governance</a>, <a href="/transparency/">transparency</a>, <a href="/burn/">burns</a> and the community itself.</li>
</ul>

<h2>What is Oxyon</h2>
<p>Oxyon builds the general-purpose pieces: the wallet, the proof and verification systems, and the XL1 infrastructure we run. Its principle is <em>every decision deserves evidence</em>. Its projects, with the status oxyon.io itself publishes, are:</p>
<ul>
  <li><strong>Oxyon Wallet</strong>: live, in beta (below).</li>
  <li><strong>GeoProof</strong>: the proof protocol, an open specification.</li>
  <li><strong>GeoJustice</strong>, <strong>GeoPresence</strong>, <strong>GeoAgora</strong> and <strong>GeoForge</strong>: at different stages, from active to early design. None of them is presented as finished.</li>
</ul>
<p>The rules Oxyon builds by are public too: <a href="https://oxyon.io/#principles" target="_blank" rel="noopener">the Seven Laws</a>.</p>

<h2>GeoWallet is now Oxyon Wallet</h2>
<p>The wallet launched as GeoWallet, and <a href="/news/geowallet-winlew-pieces-connect/">its first milestone</a> is part of WinLEW's history. It now carries the Oxyon name.</p>
<ul>
  <li><strong>Same wallet, same keys.</strong> Your recovery phrase and addresses do not change.</li>
  <li><strong>Browser extension:</strong> version 1.2.0 has been submitted to the Chrome Web Store as an update to the existing GeoWallet listing. Once approved it updates in place, and you keep your wallet without re-importing anything.</li>
  <li><strong>Web wallet:</strong> now at <a href="https://wallet.oxyon.io/" target="_blank" rel="noopener">wallet.oxyon.io</a>, with the same screens as the extension, including wallet-to-wallet messages on XL1.</li>
  <li><strong>Mobile app:</strong> in development.</li>
</ul>

<h2>One thing to do if you used the old web wallet on winlew.co</h2>
<p>A wallet created in the old web app on winlew.co is stored in your browser for winlew.co only. It will not appear on wallet.oxyon.io. To move it, open <a href="https://wallet.oxyon.io/" target="_blank" rel="noopener">wallet.oxyon.io</a> and import your recovery phrase. The old app on winlew.co will be retired later. Make sure you have your phrase before then.</p>
<p>Nobody from WinLEW or Oxyon will ever ask you for your recovery phrase. Anyone who does is trying to steal your wallet.</p>

<h2>What this is not</h2>
<p>Neither WinLEW nor Oxyon is affiliated with, sponsored by or endorsed by XYO Network. We build on XYO's XL1 as an independent team. The <a href="/xyo/">XYO page</a> says the same, and that has not changed.</p>
`,
    sources: [
      { label: "Oxyon", url: "https://oxyon.io/" },
      { label: "Oxyon Wallet", url: "https://oxyon.io/products/oxyon-wallet" },
      { label: "The web wallet — wallet.oxyon.io", url: "https://wallet.oxyon.io/" },
      { label: "The Seven Laws of Oxyon", url: "https://oxyon.io/#principles" },
      { label: "WinLEW and XYO — independence disclaimer", url: "/xyo/" },
    ],
    related: [
      { label: "Oxyon Wallet (formerly GeoWallet)", path: "/ecosystem/geowallet/" },
      { label: "The Pieces Are Starting to Connect", path: "/news/geowallet-winlew-pieces-connect/" },
      { label: "In the XYO Ecosystem", path: "/xyo/" },
    ],
  },

  {
    // GeoWallet × WinLEW. A MILESTONE record, published 2026-08-21.
    //
    // EVERY TECHNICAL CLAIM HERE WAS READ OUT OF SOURCE, not from the owner's
    // announcement. The GeoWallet extension lives in a separate repository on
    // the development machine (2027/GeoWallet); its package.json, its
    // quantum.ts, its store.ts and its git log were all read directly. The
    // WinLEW half — challenge, signature check, role sync — is in this repo.
    //
    // THE ONE CORRECTION THAT MATTERS. The announcement showcased GeoWallet's
    // Quantum Identity panel with "Attestation verified". That code is real and
    // it works — but it is gated behind
    //   EXPERIMENTAL_QUANTUM_ENABLED = import.meta.env.DEV && VITE_ENABLE_EXPERIMENTAL_QUANTUM === 'true'
    // and GeoWallet commit 45baaab (2026-06-26) is literally titled "Disable
    // experimental quantum features in production". In a production build
    // import.meta.env.DEV is false, so quantumIdentity() returns null and the
    // panel never renders. The screenshot came from a dev build. The article
    // says so plainly and files it under BUILT, not LIVE — describing it as
    // shipped would be the single easiest way for this record to be wrong.
    //
    // DATES ARE DECODED, NOT REMEMBERED. X post ids encode their creation time:
    // 2090612200029421591 -> 2026-08-21T01:29:24Z, 2090644887066804646 ->
    // 2026-08-21T03:39:18Z. 130 minutes apart, which is the spine of the story
    // and is arithmetic on the posts rather than anyone's recollection. Both
    // are the evening of August 20 in the project's own timezone.
    slug: "geowallet-winlew-pieces-connect",
    status: NEWS_STATUSES.PUBLISHED,
    featured: false,
    category: "milestones",
    image: "/images/news/geowallet-banner.png",
    imageAlt:
      "GeoWallet banner artwork — the purple GeoWallet mark over a dark gradient, the wallet's own release image.",
    title: "The Pieces Are Starting to Connect",
    subtitle:
      "GeoWallet v1.1.4 went live, and 130 minutes later it completed WinLEW's real verification flow end to end — wallet, signature, identity, holdings, roles. What was verified, what was not, and why one evening in August mattered.",
    date: "2026-08-21",
    body: `
<div class="glance">
  <h2 class="glanceTitle">The milestone in one box</h2>
  <ul class="glanceList">
    <li><strong>GeoWallet v1.1.4</strong> published to the Chrome Web Store — reviewed, approved, live</li>
    <li><strong>130 minutes later</strong>, GeoWallet completed WinLEW's wallet verification end to end</li>
    <li>One <strong>message signature</strong> — no transaction, no funds moved, no key or seed phrase shared</li>
    <li>Result: wallet verified, Discord identity linked, $WinLEW balance detected, roles unlocked</li>
    <li><em class="cond">Quantum Identity is built and working, but disabled in production builds — see below</em></li>
  </ul>
  <p class="glanceFoot">Every claim below was checked against source code. Where the announcement and the code disagree, the code wins and the difference is stated.</p>
</div>

<p>On the evening of <strong>20 August 2026</strong>, two things happened about two hours apart. The first was a release. The second was the reason this article exists.</p>

<h2>The spoiler is over</h2>

<p>GeoWallet had been built quietly for months. On 20 August it stopped being a teaser: version <strong>1.1.4</strong> was reviewed, approved and published to the Chrome Web Store. The <a href="https://x.com/LewSales/status/2090612200029421591" target="_blank" rel="noreferrer noopener">announcement</a> was short — <em>"Reviewed. Approved. Published."</em> — and it carried a line worth keeping, because it describes the design rather than selling it:</p>

<blockquote class="pullQuote">Built for #XYO users. Designed for everyone.</blockquote>

<p>You can install it from the <a href="https://chromewebstore.google.com/detail/geowallet/dmppahjigfpdddppjhnekgealjbkbljn" target="_blank" rel="noreferrer noopener">Chrome Web Store</a>, or read what it is at <a href="/wallet/">winlew.co/wallet</a>.</p>

<figure class="figure">
  <img src="/images/news/geowallet-ui.png" alt="The GeoWallet interface: a multi-chain self-custody wallet showing account balances and network selection across Ethereum, Solana and XL1." loading="lazy" decoding="async" />
  <figcaption>GeoWallet's own interface. One wallet, several chains — the design premise the rest of this story depends on.</figcaption>
</figure>

<h2>Then something bigger happened</h2>

<p>The ordinary version of this story ends there: a project ships a wallet, posts a screenshot, moves on.</p>

<p>Instead, <strong>130 minutes later</strong>, GeoWallet was pointed at WinLEW's own verification page and asked to prove a wallet. Not a mock-up. The live flow, the one that hands out real Discord roles.</p>

<p>That gap is not a guess. X post ids encode the moment they were created, so both timestamps are arithmetic on the posts themselves: the release at <strong>01:29:24 UTC</strong>, the <a href="https://x.com/LewSales/status/2090644887066804646" target="_blank" rel="noreferrer noopener">result</a> at <strong>03:39:18 UTC</strong> on 21 August — the evening of 20 August in the project's own timezone.</p>

<p>It worked.</p>

<h2>One wallet. One signature.</h2>

<p>Here is the actual sequence, read from the code rather than from the announcement.</p>

<div class="flow">
  <div class="flowStep"><span class="flowNum">1</span><div><strong>GeoWallet injects a Solana provider.</strong> The page looks for <code>window.geowallet.solana</code>. This is the part that made the whole thing possible, and it is version-specific: WinLEW's own connector tells users outright that if it is missing, they should <em>"update GeoWallet to version 1.1.4 or newer"</em>. <strong>1.1.4 is the release that added Solana website connections.</strong></div></div>
  <div class="flowStep"><span class="flowNum">2</span><div><strong>You approve a connection.</strong> GeoWallet shows the requesting origin and the address the site will see. Nothing is signed yet.</div></div>
  <div class="flowStep"><span class="flowNum">3</span><div><strong>WinLEW generates a one-time challenge.</strong> Sixteen random bytes become a 32-character nonce, stored server-side with a five-minute expiry and a <code>used</code> flag.</div></div>
  <div class="flowStep"><span class="flowNum">4</span><div><strong>You sign a message.</strong> Not a transaction — a plain text message, shown in full before you agree to it.</div></div>
  <div class="flowStep"><span class="flowNum">5</span><div><strong>The Mole Guard verifies the signature</strong> against the wallet's own public key, and checks the message really is the challenge it issued.</div></div>
  <div class="flowStep"><span class="flowNum">6</span><div><strong>The wallet is linked to a Discord identity</strong>, its $WinLEW balance is read from the chain, and roles are synced to match.</div></div>
</div>

<h2>What did the user actually sign?</h2>

<p>This is the part worth slowing down for, because "SIGN" is a word that frightens people for good reasons. Plenty of real money has been lost by people clicking approve on things they did not read.</p>

<p>So: here is the exact message WinLEW asks for, reproduced from the code that builds it.</p>

<pre class="codeBlock">WinLEW Wallet Link Verification
Discord: &lt;your Discord user id&gt;
Nonce: &lt;32 hex characters&gt;
Expires: &lt;unix timestamp&gt;

Only sign this message if you are linking your wallet to The WinLEW Discord.</pre>

<p>That is the whole thing. A signature over that text proves one fact — that you hold the private key for that Solana address — and authorises <strong>nothing else</strong>. It is not a transaction. It cannot move a token, because there is no token transfer in it to approve.</p>

<p><strong>What this signature does not do:</strong></p>
<ul>
  <li>It does not transfer SOL or $WinLEW.</li>
  <li>It does not approve a token allowance or spending permission.</li>
  <li>It does not reveal your private key. Signing uses the key; it never discloses it.</li>
  <li>It does not reveal your seed phrase. WinLEW never sees one, and never asks.</li>
</ul>

<p><strong>Why the nonce exists.</strong> Without one, a signature captured once could be replayed forever. The nonce makes each challenge unique, it is generated server-side rather than by the page, and it is marked <code>used</code> the moment it succeeds — so the same signed message cannot be presented twice.</p>

<p><strong>Why it expires.</strong> Five minutes. A signature that stays valid indefinitely is a credential lying around; a short window means an intercepted message is worthless almost immediately.</p>

<p><strong>What actually gets checked.</strong> The server does not simply verify that <em>something</em> was signed. It re-reads the returned message and confirms it contains the exact nonce it issued, the correct Discord id, and the matching expiry, before the cryptographic check runs at all. A valid signature over the wrong text is rejected.</p>

<p class="updateNote"><strong>One honest limit.</strong> The signed message binds your Discord id, a nonce and an expiry — it does <em>not</em> contain the site's domain. GeoWallet displays the requesting origin in its own UI, which is where you should read it, but domain binding is not part of the signed text itself. That is a real difference from standards like Sign-In With Ethereum, and it is written here rather than left for someone to discover.</p>

<h2>Enter the Mole Guard</h2>

<p>The Mole Guard is the Discord side of WinLEW — the service that holds the link between a wallet and a person. When the signature checks out, it does four things, and each one is a separate, verifiable step:</p>

<ul>
  <li><strong>Records the link.</strong> The wallet is attached to the Discord account, with its own verification clock.</li>
  <li><strong>Reads the balance from the chain.</strong> Not from a form, not from a screenshot — a live SPL token balance lookup against the $WinLEW mint.</li>
  <li><strong>Computes holder flags.</strong> <code>token_holder</code> is simply "balance greater than zero". Larger tiers exist for 1M, 10M and 100M holdings.</li>
  <li><strong>Syncs Discord roles</strong> to match what the chain actually says, granting and revoking to fit.</li>
</ul>

<h2>The result</h2>

<p>The verification that closed the loop returned, in Discord:</p>

<div class="resultCard">
  <div class="resultRow"><span class="resultTick">✅</span> <strong>Wallet Verified</strong></div>
  <div class="resultRow"><span class="resultTick">👤</span> Discord account linked</div>
  <div class="resultRow"><span class="resultTick">💼</span> Wallet recognised</div>
  <div class="resultRow"><span class="resultTick">💰</span> $WinLEW balance detected — <strong>502,300 $WinLEW</strong></div>
  <div class="resultRow"><span class="resultTick">🏅</span> Verified Wallet role unlocked</div>
  <div class="resultRow"><span class="resultTick">🪙</span> Holder role unlocked</div>
</div>

<p>Six lines. Every one of them the output of a different system, and all six produced by a single signature.</p>

<h2>Why this is different</h2>

<p>It would be easy, and wrong, to file this as "GeoWallet added WinLEW support". Adding support is a feature. What happened here is that several things built separately turned out to fit together without being redesigned to.</p>

<p>GeoWallet did not learn anything about WinLEW. It exposes a standard Solana provider and signs messages — the same thing it would do for any site. WinLEW did not learn anything about GeoWallet either: the verification flow it used is the one already live for Phantom, Solflare, and any other Wallet Standard wallet.</p>

<p>They met at an interface neither of them owns. That is what makes it infrastructure rather than a partnership.</p>

<h2>GeoWallet v1.1.4</h2>

<p>GeoWallet is a <strong>self-custody</strong> wallet: your recovery phrase and keys are encrypted locally, and the project runs no user accounts. The premise is one wallet across several chains — Ethereum, Solana, XL1 — with tokens, NFTs and dApp connections in one place, and requests shown clearly before you approve them.</p>

<p>It was built with XYO's ecosystem in mind, which is the honest meaning of "built for XYO users": XL1 is a first-class chain in it, not an afterthought. "Designed for everyone" is the other half — nothing about it requires you to care about XYO to use it on Solana.</p>

<p>A note this record should carry: <a href="/wallet/">the wallet's own page</a> describes GeoWallet as in active development, with some capabilities current and others release-stage dependent. That framing is the project's, and it is the accurate one.</p>

<h2>Quantum Identity — built, and not switched on</h2>

<p>The announcement showed a panel in GeoWallet reading <em>"Quantum identity — a post-quantum (ML-DSA-65) keypair derived from your seed, with a signed attestation binding it to your XL1 address"</em>, with the status <em>"Attestation verified"</em>.</p>

<p>That code is real. It is also, in the published build, <strong>turned off</strong> — and that distinction is the most important sentence in this article.</p>

<p><strong>What is genuinely built.</strong> GeoWallet derives an <strong>ML-DSA-65</strong> keypair — the signature scheme standardised as FIPS 204, one of the algorithms selected because it is believed to resist attack by a sufficiently large quantum computer. It is derived deterministically from the wallet's existing seed, so it needs no separate backup: the same recovery phrase reproduces it. It then builds an <strong>attestation</strong> — a signed statement binding your ordinary XL1 address to that quantum public key — and verifies that attestation against itself. The secret key is generated in memory and <strong>zeroed immediately after use</strong>, which is stronger than "never leaves your device": it does not stay on the device either.</p>

<p><strong>What is not true today.</strong> The feature sits behind a flag that requires a development build. A GeoWallet commit dated <strong>26 June 2026</strong> is titled, in plain words, <em>"Disable experimental quantum features in production"</em>, and the code carries the matching message: <em>"Experimental quantum features are disabled in this production build."</em> In the extension you install from the Chrome Web Store, the panel does not render.</p>

<p>So the screenshot was taken in a development build. That is a normal thing for a developer to show, and it is a normal thing for a permanent record to state precisely.</p>

<p class="updateNote"><strong>And a phrase to avoid.</strong> GeoWallet is not "quantum proof", and this article will not say it is. Post-quantum cryptography means specific algorithms chosen to resist specific attacks. Your Solana address is still secured by ordinary Ed25519, exactly like every other wallet. What is being built is an additional, verifiable identity layer alongside it — which is a real and interesting thing, and smaller than the phrase people reach for.</p>

<h2>WinLEW v4.0.0</h2>

<p>On the WinLEW side, this landed during <strong>v4.0.0</strong> — the release where things that were built separately started being wired to each other. Wallet verification, Discord identity, holder recognition, roles, and the participation record are not new individually. What changed is that they now feed one another.</p>

<h2>The pieces</h2>

<p>Here is the honest state of the map, with nothing promoted beyond what it does today.</p>

<div class="pieceGrid">
  <div class="piece live"><span class="pieceBadge">🟢 Live</span><strong>GeoWallet v1.1.4</strong><span>Published, self-custody, injects a Solana provider for websites.</span></div>
  <div class="piece live"><span class="pieceBadge">🟢 Live</span><strong>Wallet verification</strong><span>Nonce, five-minute expiry, single use, signature checked server-side.</span></div>
  <div class="piece live"><span class="pieceBadge">🟢 Live</span><strong>The Mole Guard</strong><span>Holds the wallet-to-identity link and drives Discord roles.</span></div>
  <div class="piece live"><span class="pieceBadge">🟢 Live</span><strong>Holder recognition</strong><span>Balance read live from the chain; roles follow it.</span></div>
  <div class="piece live"><span class="pieceBadge">🟢 Live</span><strong>Proof of Value</strong><span>Participation scoring, already running.</span></div>
  <div class="piece built"><span class="pieceBadge">🟡 Built, not enabled</span><strong>Quantum Identity</strong><span>ML-DSA-65 attestation. Works in development; disabled in production builds.</span></div>
  <div class="piece future"><span class="pieceBadge">🔵 Direction</span><strong>Verified identity, used more widely</strong><span>The same verified link could inform governance and community permissions. Not built as a single joined-up system yet.</span></div>
</div>

<h2>What comes next</h2>

<p>Nothing here is a roadmap promise. The direction the code already points in is narrower and more useful than a promise: one verified identity, reusable by more than one part of the ecosystem, so that proving something once is enough.</p>

<p>The honest summary of the evening of 20 August is not that a feature shipped. It is that a wallet, an identity service, a chain lookup and a permissions system — four things with no shared code — completed one job together, on the first try, in public.</p>

<h2>Proof of Value, not Proof of Wealth</h2>

<p>The balance mattered in that verification only as a fact to be read, not as a score. A wallet with one token verifies exactly as successfully as a wallet with millions; it simply unlocks a different role. What the flow actually proves is control, not wealth.</p>

<p>The pieces are starting to connect.</p>

<p>Let everyone win.</p>
`,
    sources: [
      { label: "GeoWallet v1.1.4 release announcement (X, 21 Aug 2026 01:29 UTC)", url: "https://x.com/LewSales/status/2090612200029421591" },
      { label: "The integration milestone announcement (X, 21 Aug 2026 03:39 UTC)", url: "https://x.com/LewSales/status/2090644887066804646" },
      { label: "GeoWallet on the Chrome Web Store", url: "https://chromewebstore.google.com/detail/geowallet/dmppahjigfpdddppjhnekgealjbkbljn" },
      { label: "GeoWallet — what it is", url: "/wallet/" },
      { label: "Verify your wallet with WinLEW", url: "/verify/" },
    ],
    related: [
      { label: "GeoWallet in the ecosystem", path: "/ecosystem/geowallet/" },
      { label: "Verify your wallet", path: "/verify/" },
      { label: "Proof of Value", path: "/proof-of-value/" },
      { label: "Discord Bots", path: "/discord-bots/" },
    ],
  },
  {
    slug: "security-update-august-16-2026",
    status: NEWS_STATUSES.PUBLISHED,
    // Unfeatured 2026-08-20 in favour of the live campaign — exactly one
    // article may be featured, and a running campaign that closes on a date
    // outranks a four-day-old security note. The article itself is unchanged.
    featured: false,
    category: "security",
    title: "The Guard Was Watching.",
    subtitle:
      "How The Mole Guard detected abnormal wallet activity in real time — and what WinLEW did next.",
    date: "2026-08-16",
    image: "/images/news/security-update-august-16-2026.png",
    // Alt describes what is actually in the frame. The source is 1024x1024 and
    // the hero renders 16:9, so object-fit centre-crops it — the mole's face
    // and the dog stay in view and the baked-in banner text falls outside.
    imageAlt:
      "The WinLEW Watch Dog \u2014 an armoured mole in a visored helmet holding a snarling guard dog, against a starfield",
    // Deliberately narrow. Everything below is established by the incident
    // record; nothing is inferred, and no detection threshold, time window or
    // configuration value appears anywhere — publishing those would tell the
    // next person exactly how to stay under them.
    body: `
<p>In the early hours of <strong>August 16, 2026</strong>, WinLEW's monitoring reported an unusual pattern: the same wallet signing in over and over, and then, in short bursts, a run of wallets that had never been seen before.</p>

<p>None of it looked like people using the site.</p>

<h2>What was observed</h2>
<p>Three things stood out, all of them visible in the live log as they happened:</p>
<ul>
  <li>repeated wallet-only sessions from the same wallet in quick succession</li>
  <li>bursts of newly created wallets signing in for the first time</li>
  <li>the two patterns repeating over roughly forty minutes</li>
</ul>

<p>A wallet-only session is the lightest form of access WinLEW offers. It lets someone connect and look around without linking a Discord account, and deliberately unlocks nothing that pays out. That distinction turned out to matter.</p>

<h2>What was done</h2>
<p>The activity was watched in real time rather than discovered afterwards. While it was ongoing, the bot was taken offline so that changes could be made without racing whoever was generating the wallets, and the logs and on-chain evidence were preserved before anything was modified.</p>

<p>The Mole Guard — WinLEW's own monitoring bot — was the tool used throughout the response, both to see the pattern and to check it against records afterwards.</p>

<h2>What was not reached</h2>
<p>This is the part worth stating plainly, because it is the part that was checked rather than assumed. Every wallet involved was compared against WinLEW's own records:</p>
<ul>
  <li><strong>No funds were taken.</strong></li>
  <li>None of the wallets reached the <a href="/faucet/">faucet claim system</a>.</li>
  <li>None of them appeared in faucet registrations.</li>
  <li>Nothing was paid out to any of them.</li>
</ul>

<p>Signing in cost the project nothing. The systems that move tokens sit behind separate checks, and those checks held.</p>

<h2>What changed afterwards</h2>
<p>The response did not stop at "nothing was taken." Several protections were strengthened in the days that followed:</p>
<ul>
  <li>Wallet verification now measures how long an identity has <em>existed</em>, not merely that it exists.</li>
  <li>Every path that releases tokens — faucet, rewards and game payouts alike — now passes through a single shared block list. One of them previously did not.</li>
  <li>Bursts of anonymous sign-ins are now detected automatically rather than by someone happening to watch the channel.</li>
  <li>Every automated refusal now tells the person how to appeal it, because these checks can be wrong about real people.</li>
</ul>

<p>The investigation continued after the immediate response, including tracing the on-chain funding relationships between the wallets involved. That work is ongoing.</p>

<h2>What we are not saying</h2>
<p>WinLEW is not naming anyone, and is not calling this an attack by a named party. What is established is a pattern of automated wallet creation and sign-ins. Intent is not something a log can prove, and we would rather publish less than publish something we cannot stand behind.</p>

<p>We are also not publishing the specific thresholds, timings or configuration involved in detection. Those details would help the next attempt more than they would help anyone reading this.</p>

<h2>Why this is published at all</h2>
<p>Nothing was lost, so nothing obliged us to write this. We are publishing it because a project that only reports its good days is not being transparent — it is marketing. The record should show what happened and how it was handled, including the part where a gap was found in the payout checks and closed.</p>
`,
    sources: [
      {
        label: "View the original announcement on X",
        url: "https://x.com/LewSales/status/2088920058508484742",
      },
      { label: "Transparency Center — reserves, locks and burns", url: "/transparency/" },
      { label: "How abuse is detected and decided", url: "/policies/abuse/" },
    ],
    related: [
      { label: "Transparency Center", path: "/transparency/" },
      { label: "Discord Bots", path: "/discord-bots/" },
      { label: "System Status", path: "/health/" },
    ],
  },

  {
    // The campaign announcement, published 2026-08-20 after running as a draft
    // since 2026-08-16. This is the CANONICAL statement of the rules: /events/
    // carries the machine-readable record and links here, and nothing else on
    // the site restates the rules, so there is one copy to keep correct.
    //
    // THREE THINGS THE OWNER'S BRIEF GOT WRONG, corrected here rather than
    // transcribed, and reported to them rather than fixed silently:
    //
    //  1. "The snapshot occurred immediately AFTER the Burn Wallet completed
    //     its token locks." It did not. The locks were 2026-08-16; the baseline
    //     is 2026-08-18T02:31Z, two days later. The same sentence was already
    //     cut from the X post for the same reason (86cf001). The locked tokens
    //     are excluded either way, so the claim buys nothing and costs the one
    //     thing this site sells.
    //  2. "Maximum eligibility is TWO entries per qualifying WALLET." The live
    //     rule is per verified ACCOUNT. Per-wallet would mean one person with
    //     twenty wallets holds twenty entries, which is the exact vector the
    //     2026-08-16 sybil run was positioning for. Owner confirmed: account.
    //  3. "ADD LIQUIDITY = 1 entry." The live rule is that liquidity counts as
    //     BOTH, because depositing spends the WinLEW a position increase would
    //     otherwise be measured in — under a 1-entry reading, providing
    //     liquidity would cost you the position entry. Owner confirmed: both.
    //
    // The brief also omitted the 1,500 minimum increase and the wallet
    // verification requirement, both of which are live. Both confirmed kept.
    //
    // "Increase your position" rather than "buy" is deliberate and is NOT a
    // stylistic choice: a snapshot diff shows that a balance went up, never
    // why. A purchase, a faucet claim and a gift from a friend are identical to
    // it. The article says what the measurement can actually see.
    slug: "liquidity-and-hodl-campaign",
    status: NEWS_STATUSES.PUBLISHED,
    featured: true,
    category: "announcements",
    image: "/images/news/generated/liquidity-and-hodl-campaign.png",
    imageAlt:
      "Generated cover for the HODL + Liquidity Campaign announcement: the category label and headline set on the WinLEW dark gradient.",
    title: "The Liquidity Call Nobody Answered — So We Rebuilt It",
    subtitle:
      "1,000,000 $WinLEW goes to one participant, and you no longer have to become a liquidity provider to qualify. The HODL + Liquidity Campaign has been running since August 18 and closes October 1.",
    date: "2026-08-20",
    body: `
<div class="glance">
  <h2 class="glanceTitle">Campaign at a glance</h2>
  <ul class="glanceList">
    <li><strong>Increase your $WinLEW position by 1,500+</strong> → <strong>1 entry</strong></li>
    <li><strong>Add liquidity to the $WinLEW/SOL pool</strong> → <strong>1 entry, and it also earns the position entry</strong></li>
    <li><strong>Two entries maximum</strong>, per verified account — not per wallet, and not per transaction</li>
    <li><strong>1,000,000 $WinLEW</strong> to one randomly drawn participant — <em>committed</em></li>
    <li><strong>Up to 6,000,000</strong> across three winners — <em class="cond">conditional, discretionary, and not promised</em></li>
    <li>Running since <strong>18 August 2026</strong> · closes <strong>1 October 2026</strong></li>
  </ul>
  <p class="glanceFoot">Only the 1,000,000 is committed. Everything marked conditional above may not happen at all.</p>
</div>

<p>The last $WinLEW liquidity push didn't exactly move mountains. We asked the community to help deepen the $WinLEW/SOL pool, and offered a Raydium farm as the reward for doing it. Almost nobody moved.</p>

<p>There are two things a project can do at that point. It can ask again, louder. Or it can accept that the answer was information, and go back and build a better reason to take part.</p>

<h2>What the original liquidity call asked for</h2>
<p>The first challenge had one route in: provide liquidity to the $WinLEW/SOL Raydium pool. Do enough of it, and the project would reopen a 90-day Raydium farm paying 300,000 $WinLEW per week — roughly 3,857,143 $WinLEW in total rewards.</p>
<p>That offer was fair. It was also, on reflection, a narrow door. Providing liquidity means holding both sides of a pair, understanding what an LP position is, and accepting impermanent loss — the risk that you withdraw less value than you put in, even if the price went up. Plenty of people who want to support $WinLEW have neither the spare SOL nor the appetite for that, and nobody should take on a risk they don't understand in order to be counted.</p>
<p>So the response to a quiet challenge was not to repeat it. It was to widen it.</p>

<h2>What changed</h2>
<p>The campaign now has <strong>two</strong> qualifying routes, and only one of them involves becoming a liquidity provider.</p>
<ul>
  <li><strong>Increase your $WinLEW position by at least 1,500 $WinLEW</strong> — one entry.</li>
  <li><strong>Add liquidity to the $WinLEW/SOL Raydium pool</strong> — one entry.</li>
</ul>
<p>Adding liquidity <em>spends</em> the $WinLEW that a position increase would otherwise be measured in. So providing liquidity counts as <strong>both</strong> entries — you cannot lose your position entry by using it to support the pool. That rule is printed here rather than applied quietly, because a rule that only helps people is still a rule they are owed.</p>
<p>One piece of wording is worth admitting to. It says "increase your position" rather than "buy", because comparing two snapshots proves your balance went up — never <em>why</em> it went up. A purchase, a faucet claim and a gift from a friend look identical from the chain. The campaign measures what it can actually see, and says so instead of implying a precision it does not have.</p>

<h2>Two entries. That is the ceiling.</h2>
<p>Each entry is a yes/no test, never a count:</p>
<ul>
  <li>Buying ten times is the same one entry as buying once.</li>
  <li>Ten liquidity deposits are the same one entry as one.</li>
  <li>Twenty wallets are <strong>not</strong> twenty entries — qualification is per verified account.</li>
</ul>
<p>Entry is not weighted by size and not weighted by time. A large participant and a small one hold the same entries. Someone who joined in the first hour and someone who joins in the last week hold the same entries.</p>
<p>And one requirement that belongs above the fold rather than in the small print: <strong>your wallet has to be verified at <a href="/verify/">winlew.co</a></strong>. Qualification is per account, and "per account" means nothing unless wallets can be tied to one. That is what stops a single person entering twenty times — which is to say, it is what makes everyone else's odds real.</p>

<h2>You have to still hold it at the close</h2>
<ul>
  <li>Increase your position, then sell before the closing snapshot — no position entry.</li>
  <li>Add liquidity, then withdraw it before the closing snapshot — no liquidity entry.</li>
</ul>
<p>The campaign is settled by comparing the opening snapshot to a closing one. A position that is gone by the close was never a position the close can see.</p>

<h2>The starting snapshot, and what it does and does not prove</h2>
<p>A holder snapshot marks the campaign's starting point, so that nobody has to prove anything afterwards with screenshots or claims. It is read from the chain.</p>
<p><strong>The baseline is a pair</strong>, taken twelve seconds apart so both entry routes start at the same instant:</p>
<ul>
  <li>$WinLEW holders — <strong>slot 439971290</strong>, SHA-256 <code>22391a97&hellip;4f59b</code></li>
  <li>Pool LP holders — <strong>slot 439971320</strong>, SHA-256 <code>aaba0d8f&hellip;b6c0a</code></li>
  <li>Both at <strong>2026-08-18 02:31 UTC</strong></li>
</ul>
<p>Both files are published under <code>docs/holder-snapshots/</code> and both are reproducible: the tool reads the same public chain you can read, and sorts its output canonically, so two people running it independently get byte-identical files. Compare your hash to ours.</p>
<p>Every balance in the opening snapshot sums to <strong>exactly 950,000,000 $WinLEW</strong> — the token's entire supply at that slot. That is not a formatting detail, it is the proof of completeness: if even one holder had been missed, the total would not add up. Nobody can be skipped without the arithmetic saying so.</p>
<p class="updateNote"><strong>Note, August 19, 2026.</strong> Total supply has since fallen to 949,999,960.615828 — two holders burned 39.384172 of dust on August 18, after the baseline was taken. That does not weaken the check above: a snapshot is a statement about a slot, and at slot 439971290 the balances did sum to exactly 950,000,000. Anyone reproducing it today should expect the newer supply figure and reach the same conclusion.</p>
<p><strong>The Burn Wallet's token locks are not liquidity and are not participation.</strong> The 40,000,000 locked on August 16 is a lock: the tokens are immobilised, not deposited into a pool, and they earn nothing here. Project wallets, reserves, pools, locked accounts and program-owned addresses are all excluded from the draw and cannot win.</p>
<p>The locks came <em>first</em> and the baseline came after — but not, as an earlier draft of this announcement put it, "immediately after". The locks completed on <strong>August 16</strong>; the baseline was taken on <strong>August 18</strong>, two days later. The gap changes nothing about eligibility, and the correct sequence is printed anyway, because a site that asks you to check its claims should not round its own timeline.</p>
<p>One honest limit on all of this. Public Solana activity is <strong>verifiable</strong>, which is why the campaign is settled this way — anyone can recompute it and nobody has to be trusted. What it is not is proof of <em>intent</em> or of <em>identity</em>. The chain shows that a balance moved. It cannot show who moved it or why, and this campaign does not claim otherwise; that is exactly why account verification carries the identity half of the question rather than the chain being asked to do a job it cannot do.</p>

<h2>The reward: 1,000,000 $WinLEW</h2>
<p>One eligible participant, drawn at random, receives <strong>1,000,000 $WinLEW</strong>. That part is committed.</p>
<p>Not the largest holder. Not the earliest. Not the person who bought the most times. One entry per route, drawn at random from everyone who qualified.</p>

<h2>If participation grows — and only if</h2>
<p>The prize pool <em>may</em> expand to three winners:</p>
<ul>
  <li>🥇 3,000,000 $WinLEW</li>
  <li>🥈 2,000,000 $WinLEW</li>
  <li>🥉 1,000,000 $WinLEW</li>
</ul>
<p><strong>6,000,000 $WinLEW total — and that is conditional, discretionary, and not a promise.</strong> It is decided by the project, based on whether participation warrants it. If you are reading this and deciding whether to take part, decide on the 1,000,000, because that is the only figure that is committed. No threshold for the expansion has been published, and none is implied here.</p>

<h2>The 90-day farm is still on the table — and is not running</h2>
<p>The original liquidity offer did not disappear when the campaign was rebuilt. With enough meaningful community liquidity, the proposed Raydium farm still goes ahead:</p>
<ul>
  <li>🌾 90 days</li>
  <li>💰 300,000 $WinLEW per week</li>
  <li>⛏️ approximately 3,857,143 $WinLEW in total farm rewards</li>
</ul>
<p><strong>The farm is not active today.</strong> It is proposed. If you go looking for it on Raydium expecting to stake, you will not find an open round — and this announcement is not the one that opens it. What "enough" means has not been quantified publicly, and this article will not invent a number for it.</p>
<p>Note the sequencing, because it is deliberate: the campaign's closing snapshot is set for <strong>October 1</strong>, the same day the next farm round is planned to open. Staking LP tokens moves them out of your wallet, so the close is timed <em>ahead</em> of the farm rather than across it. Nobody should lose a liquidity entry by staking on the day it becomes possible.</p>

<h2>Three things that are not the same thing</h2>
<ul>
  <li><strong>HODLing</strong> is holding $WinLEW in your own wallet. Your tokens stay yours, and price risk is the only risk.</li>
  <li><strong>Providing liquidity</strong> is depositing $WinLEW <em>and</em> SOL into the pool so other people can trade against it. It carries <strong>impermanent loss</strong>: you can withdraw less value than you deposited even if the price rose.</li>
  <li><strong>A token lock</strong> is neither. Locked tokens are immobilised — they are not in a pool, they earn no fees, and they are not participation in this campaign. The project's own locks are excluded from the draw.</li>
</ul>

<h2>Risks, plainly</h2>
<ul>
  <li>Nothing here is a promise of profit, and buying a token is not an investment recommendation.</li>
  <li>Providing liquidity carries additional risk, including impermanent loss.</li>
  <li>The prize is a fixed number of $WinLEW, not a fixed value. $WinLEW's price can fall, including after a draw.</li>
  <li>Only the 1,000,000 prize is committed. The 6,000,000 structure and the farm are both conditional.</li>
  <li>Participate within your means, and do your own research.</li>
</ul>

<h2>I went first</h2>
<p>Thirty-seven minutes before the opening snapshot, the Developer Reserve added liquidity to the pool: <strong>9,750,277.897588 $WinLEW and 1.353687328 SOL</strong>, for 114.303612101 LP tokens (<code>36TMoVQq&hellip;zbGXa</code>).</p>
<p>It buys nothing. That deposit landed <em>inside</em> the baseline, so it counts as a starting position rather than participation, and the Developer Reserve is an excluded address that cannot win in any case. It is there because asking people to put liquidity into a pool you have not put liquidity into is a poor way to ask.</p>
<p>One small thing happened while recording it that says more about this site than the deposit does. From memory, the deposit was "about 9,999,000 $WinLEW and 1.2 SOL." The chain says 9,750,277.897588 and 1.353687328 — high on the token, low on the SOL, wrong in both directions by a little. Nobody was being careless. That is simply what remembering a number is worth against reading one, and it is the entire reason this campaign is settled by snapshots and checksums instead of by anybody's recollection, including ours.</p>

<h2>Still to be decided</h2>
<p>Two parts of this campaign are genuinely not settled, and are listed rather than glossed:</p>
<ul>
  <li><strong>The draw method has not been published.</strong> The intent is that it will be fixed <em>before</em> the eligible list exists and derived from a future Solana block, so that nobody — including the project — can steer it, and anyone can recompute the winner afterwards. That method is not published yet, and until it is, it is an intention rather than a guarantee.</li>
  <li><strong>The thresholds are not quantified.</strong> Neither "enough participation" for the 6,000,000 pool nor "enough liquidity" for the farm has a published number.</li>
</ul>
<p>Both are stated here because a campaign that hides its undecided parts until they are convenient is not being run in the open.</p>

<h2>Official information</h2>
<ul>
  <li><strong>$WinLEW contract:</strong> <code>DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump</code></li>
  <li><strong>Raydium pool ID:</strong> <code>5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx</code></li>
  <li><strong>Add liquidity:</strong> <a href="https://raydium.io/liquidity/increase/?mode=add&amp;pool_id=5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx" target="_blank" rel="noreferrer noopener">Raydium $WinLEW / SOL pool ↗</a></li>
  <li><strong>Verify your wallet:</strong> <a href="/verify/">winlew.co/verify/</a></li>
</ul>
<p>Check the contract address against a second source before you trade. A counterfeit $WinLEW was minted in March 2025 specifically to be mistaken for the real one by anyone searching the name instead of the address — <a href="/news/the-fake-winlew/">that story is here</a>, and eight wallets are still holding the fake.</p>

<h2>Proof of Value, not Proof of Wealth</h2>
<p>That line is the whole point of the redesign, so it is worth being straight about the tension left in it: both entry routes currently involve spending money, which is closer to Proof of Wealth than the phrase suggests. What the campaign does fix is the part that was worse — the biggest wallet does not get more entries than the smallest, and thirty transactions do not beat one. If a free participation route is added, it will be listed here.</p>
<p>We asked for liquidity. Nobody moved. So we built a better reason instead of a louder ask.</p>

<p>Let everyone win.</p>
`,
    sources: [
      { label: "Raydium $WinLEW / SOL pool — add liquidity", url: "https://raydium.io/liquidity/increase/?mode=add&pool_id=5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx" },
      { label: "$WinLEW contract on Solscan", url: "https://solscan.io/token/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump" },
      { label: "Community Events — the machine-readable campaign record", url: "/events/" },
      { label: "Transparency Center — reserves, locks and burns", url: "/transparency/" },
    ],
    related: [
      { label: "Community Events", path: "/events/" },
      { label: "Transparency Center", path: "/transparency/" },
      { label: "Proof of Value", path: "/proof-of-value/" },
      { label: "Verify your wallet", path: "/verify/" },
    ],
  },

  {
    // DRAFT. Historical record, written from the owner-supplied material plus
    // the two records the repo already holds (partnersData.js id: 2brz and
    // eventsData.js id: 2brz-partnership-announcement-2025).
    //
    // The date here is 2025-04-02 and that is a CORRECTION, not a transcription:
    // both existing records said April 1 while citing an X post whose id decodes
    // to 2025-04-03T02:18:46.624Z — 8:18 PM Mountain on April 2. Both were fixed
    // in the same change, and test/shared/snowflake.test.mjs now re-derives the
    // date from the evidence URL so it cannot drift back.
    //
    // Status is deliberately not overstated: partnersData records this partner
    // as STATUS_UNCONFIRMED / "Historical Community Partner". The article says
    // the same rather than implying an ongoing relationship.
    slug: "2brz-partnership",
    status: NEWS_STATUSES.PUBLISHED,
    featured: false,
    category: "ecosystem",
    image: "/images/2brz-partnership.jpg",
    imageAlt:
      "The original 2BRZ x WinLEW announcement graphic: 'PartnerShips Matter' above the $2BRZ and $WINLEW token logos either side of a handshake, with a rocket between them.",
    title: "WinLEW x 2BRZ",
    subtitle:
      "April 2025: a community collaboration between WinLEW and 2 Brotherz — and what the record actually shows.",
    date: "2025-04-02",
    body: `
<p>On the evening of <strong>April 2, 2025</strong>, WinLEW publicly announced a collaboration with <strong>2BRZ (2 Brotherz)</strong>.</p>

<h2>What was announced</h2>
<p>The framing at the time was complementary strengths: 2 Brotherz brought bold community energy and creativity, WinLEW brought a utility-first, transparency-focused approach. The collaboration centred on shared goals, community and execution — the idea that projects can build alongside each other rather than only compete for the same attention.</p>

<h2>What the record shows now</h2>
<p>WinLEW's own partner register lists 2BRZ as a <strong>Historical Community Partner</strong> with an <em>unconfirmed</em> current status. That is deliberate and it is not a slight: it means the announcement is documented and the collaboration happened, but nothing in the record establishes an ongoing formal relationship today. Rather than quietly drop the entry or imply more than can be shown, it stays listed with its status stated plainly.</p>

<h2>The 500,000 $WinLEW giveaway</h2>
<p>The partnership was not only an announcement. Alongside it, the @WinLewToken account ran a giveaway for <strong>500,000 WinLEW</strong> — one winner, drawn from people who showed support for <em>both</em> communities, with the draw set for April 10, 2025.</p>
<p>It was paid. That is checkable rather than asserted:</p>
<ul>
  <li><strong>Exactly 500,000.000000 WinLEW</strong> left the project's X Faucet Reserve (<code>GFxz42bi…C7EhAp</code>) and arrived in the winner's wallet in a single transfer.</li>
  <li>Signature <code>57yz552Q…FDjr4Y</code>, at <code>2025-04-11T02:38:33Z</code> — which is the evening of April 10 in the project's own timezone, matching the "Paid ..!!" post to the day.</li>
</ul>
<p>The winner, <strong>@_zrago</strong>, published their own wallet address when they entered, which is the only reason it can be named here — the record is theirs, not something disclosed on their behalf.</p>
<p>Two things stand out reading the chain back today. The winner was not only entering: in the days either side of the draw they bought roughly <strong>1.5 million WinLEW</strong> on the open market with their own money. And they are still here — that wallet held <strong>1,595,146.428 WinLEW</strong> at the campaign snapshot on August 18, 2026, sixteen months later.</p>
<p>A giveaway that pays, to someone who then stays, is a better argument for the thing than the announcement was.</p>

<h2>A note on the date</h2>
<p>This article is dated April 2, 2025, which corrects WinLEW's own earlier records. Both the partner entry and the event entry previously read April 1. X post IDs encode the moment they were created, and the announcement's ID decodes to <code>2025-04-03T02:18:46Z</code> — which is 8:18 PM on April 2 in the project's own timezone.</p>
<p>The proof was inside the link those records already stored. It is corrected in both places, and a test now re-derives the date from that link so it cannot slip back.</p>
`,
    sources: [
      { label: "Original announcement on X (April 2, 2025)", url: "https://x.com/LewSales/status/1907618750523736507" },
      { label: "The 500,000 WinLEW giveaway announcement on X", url: "https://x.com/WinLewToken/status/1907256355477500314" },
      { label: "Payout transaction on Solscan (exactly 500,000 WinLEW)", url: "https://solscan.io/tx/57yz552QCvVDNqfg5d5YXqgeqMF8TCLEb39toEmgRN7SDYHUM3PLXPLCT9A4tQzxezSjzAkc5je88oQ2CYFDjr4Y" },
      { label: "2BRZ token on Pump.fun", url: "https://pump.fun/coin/3oB7hyAZXqrzzbSebt3XykCrXqAX6Vv57Qdin3bVpump" },
      { label: "2brz.com", url: "http://2brz.com" },
      { label: "WinLEW partner register", url: "/partners/" },
    ],
    related: [
      { label: "Sponsors & Partners", path: "/partners/" },
      { label: "Community Events", path: "/events/" },
    ],
  },

  {
    // DRAFT — the Dec 7 tease. The anniversary claim is EVIDENCED: pump.fun's
    // coin page reads "Created Dec 7, 2024, 1:55 PM" (owner screenshot,
    // 2026-08-16), corroborated by /who-we-are/'s existing "live on Solana
    // mainnet since December 2024".
    //
    // Carries NO mechanics on purpose. No amount, no snapshot, no eligibility —
    // none have been decided, and an airdrop article that implies otherwise is
    // a promise of tokens. See eventsData.js id: two-year-anniversary-airdrop-2026.
    slug: "two-year-anniversary-airdrop",
    status: NEWS_STATUSES.PUBLISHED,
    featured: false,
    category: "milestones",
    image: "/images/news/generated/two-year-anniversary-airdrop.png",
    imageAlt:
      "Generated cover for the two-year anniversary airdrop: the category label and headline set on the WinLEW dark gradient.",
    title: "Two Years. December 7.",
    subtitle:
      "$WinLEW was created on December 7, 2024. On December 7, 2026, every registered wallet receives 10,000 $WinLEW.",
    date: "2026-08-16",
    // Mechanics added 2026-11-14 (owner decisions, same day): 10,000 per registration; wallets registered by
    // 2026-11-14 count once each (frozen list, 156 wallets, canonical SHA-256 below); later registrations count
    // once per Discord account; registration closes 2026-12-06 00:00 UTC; sent 2026-12-07 from diglew.sol.
    // The original August text is kept below, unchanged, under its own heading.
    body: `
<div class="glance">
<p class="glanceTitle">Update — November 14, 2026: the mechanics</p>
<ul class="glanceList">
<li><strong>Amount:</strong> 10,000 $WinLEW per registration. It does not depend on how much you hold, and holding is not required.</li>
<li><strong>How to register:</strong> in the WinLEW Discord, run <code>!register &lt;your Solana wallet or .sol name&gt;</code>.</li>
<li><strong>Already registered?</strong> The 156 wallets registered as of November 14, 2026 are already in, and each counts once. You don't need to do anything.</li>
<li><strong>New registrations</strong> count <strong>once per Discord account</strong>: the wallet your account has saved when registration closes. Registering more wallets adds nothing.</li>
<li><strong>Registration closes:</strong> December 6, 2026 at 00:00 UTC. The list is fixed at that moment.</li>
<li><strong>Sent:</strong> December 7, 2026, from the WinLEW treasury (<a href="https://solscan.io/account/FcEtZqVowuhF2hdysy7qxJYRhu1eNZ8ws2JqHUDmPPjE">diglew.sol</a>).</li>
</ul>
<p class="glanceFoot">Project-owned addresses and wallets banned from the faucet are left out.</p>
</div>

<p>$WinLEW was created on Solana on <strong>December 7, 2024</strong>. Its pump.fun page still says so, and anyone can check it. On <strong>December 7, 2026</strong> — two years to the day — every registered wallet receives <strong>10,000 $WinLEW</strong>.</p>

<h2>How you can check it</h2>
<p>The same standard as every other WinLEW claim: don't take our word for it.</p>
<ul>
<li><strong>The list can't grow quietly.</strong> The 156 wallets registered as of November 14 are frozen. Sorted, one per line, their SHA-256 is <code>dfb9a484e71ba1dca699f3ebb3e4197b9d059e69c42d8e297a9bcbfea0a13733</code>. The full list will be published with the snapshot, so anyone can recompute it.</li>
<li><strong>The snapshot is public before anything is sent.</strong> When registration closes, the final list is committed to the XL1 blockchain and shown on the <a href="https://oxyon.io/evidence/">Oxyon Evidence Explorer</a> before any token moves.</li>
<li><strong>Every payout is on Solscan.</strong> After December 7, each payout's Solana transaction is listed and checked against the snapshot, wallet by wallet. Open any of them on <a href="https://solscan.io/">Solscan</a> yourself.</li>
</ul>

<h2>The original announcement (August 16, 2026)</h2>
<p><em>Kept as published. When it was written, the mechanics had not been decided.</em></p>

<h2>What is being announced</h2>
<p>The date. That is genuinely all, and saying so now is the point: the date goes on the public record months ahead of the event rather than appearing afterwards.</p>

<h2>What is not being announced</h2>
<p>No amount. No snapshot. No eligibility rules. None of those have been decided, so none of them are being hinted at.</p>
<p>This matters more than it might seem. An airdrop post that implies a size, or suggests holding a particular amount will qualify you, is a promise of tokens — and once made, people act on it. Nothing here should be read as one. When the mechanics are set, they will be published here and recorded on <a href="/events/">Community Events</a>, with the same detail every other WinLEW event carries.</p>

<h2>Why the date is checkable</h2>
<p>WinLEW's whole position is that claims should be verifiable, and "it's our anniversary" is a claim like any other. The creation date comes from the token's own pump.fun page, and it matches what <a href="/who-we-are/">Who We Are</a> has said all along — that the token has been live on Solana mainnet since December 2024.</p>

<p>Two years of building. See you on the 7th.</p>
`,
    sources: [
      { label: "Token creation date — pump.fun coin page", url: "https://pump.fun/coin/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump" },
      { label: "$WinLEW mint on Solscan", url: "https://solscan.io/token/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump" },
      { label: "Community Events — the scheduled record", url: "/events/" },
    ],
    related: [
      { label: "Community Events", path: "/events/" },
      { label: "Who We Are", path: "/who-we-are/" },
      { label: "Transparency Center", path: "/transparency/" },
    ],
  },

  {
    // DRAFT — HODL Rewards launch. Every number below is read out of
    // src/mole/hodlEpochs.js (DEFAULT_EPOCH_PARAMS and LIMITS), not from
    // memory or a changelog summary. If those constants change, this article
    // is wrong and must be updated with them.
    //
    //   weeklyPool 10_000 · minHold 1_000 · payoutDay 2 (Tuesday)
    //   povBonusTiers 1.0 / 1.05 @40 / 1.1 @70 / 1.15 @90
    //   LIMITS: MAX_WEEKLY_POOL 25_000 · MAX_PER_PARTICIPANT_WEEK 2_500
    //           MAX_POV_BONUS_MULTIPLIER 1.15 · epoch 1-15 weeks
    slug: "hodl-rewards-opens",
    status: NEWS_STATUSES.PUBLISHED,
    featured: false,
    category: "development",
    image: "/images/news/generated/hodl-rewards-opens.png",
    imageAlt:
      "Generated cover for the HODL Rewards launch: the category label and headline set on the WinLEW dark gradient.",
    title: "HODL Rewards Is Open.",
    subtitle:
      "A weekly payout for holding and taking part — with hard limits a governance vote cannot raise.",
    date: "2026-08-16",
    body: `
<p class="updateNote"><strong>Update, November 2026:</strong> this article describes the rules at launch. From epoch E1 (scheduled to start on 17 November 2026), each reward is 0.10% to 0.15% of a verified holder's balance, depending on how many days they took part in the week before, with caps on the counted balance and on each person's weekly reward. The Proof of Value bonus described below no longer applies. <a href="/hodl/">Current rules: HODL Rewards</a>.</p>

<p><a href="/hodl/">HODL Rewards</a> is live. It pays weekly, on Tuesdays, to people who hold $WinLEW and stay verified.</p>

<h2>How it works</h2>
<ul>
  <li><strong>10,000 $WinLEW per week</strong> is the starting pool.</li>
  <li><strong>1,000 $WinLEW</strong> is the holding requirement — deliberately low. It exists to mean "a holder", not to sort people by wealth.</li>
  <li>Payouts run on <strong>Tuesdays</strong>, once per week.</li>
  <li>Your <a href="/proof-of-value/">Proof of Value</a> score can increase your share, up to <strong>1.15x</strong> at a score of 90. The bonus redistributes within the pool — it never enlarges it.</li>
</ul>

<p>You must be verified, hold the minimum, and have a payout wallet linked. Wallet-only profiles do not qualify, and neither do banned accounts.</p>

<h2>The part worth reading twice</h2>
<p>Governance sets the parameters for each new epoch — the weekly pool, the length, the bonus tiers. But it can only choose <em>within</em> hard bounds, and <strong>those bounds are not themselves votable</strong>:</p>
<ul>
  <li>Maximum <strong>25,000</strong> $WinLEW per week</li>
  <li>Maximum <strong>2,500</strong> to any one participant in a week</li>
  <li>Maximum <strong>1.15x</strong> Proof of Value bonus</li>
  <li>Epochs between <strong>1 and 15 weeks</strong></li>
</ul>

<p>The reasoning is blunt: a governance vote must never be able to authorise an unbounded payout — not by mistake, not by a decimal in the wrong place, and not by everyone getting exactly what they voted for. Every epoch is validated against those limits before it can go active, and one that fails validation cannot be activated at all.</p>

<p>The per-participant cap matters for a reason that is easy to miss. Without it, a single qualifying wallet in a quiet week would take the entire pool.</p>

<h2>Why it pays for consistency, not size</h2>
<p>The holding requirement is 1,000 — low enough that it is a participation floor rather than a wealth filter. What actually moves your share is showing up: staying verified, and building a Proof of Value record over time. That is the same principle the rest of the project runs on, applied to holding.</p>

<p>It is not an investment product, it does not promise a return, and the pool is a fixed number of tokens rather than a fixed value.</p>

<p>Details and your own status are on the <a href="/hodl/">HODL Rewards page</a>.</p>
`,
    sources: [
      { label: "HODL Rewards", url: "/hodl/" },
      { label: "Proof of Value — how the score is built", url: "/proof-of-value/" },
      { label: "Governance — where epoch parameters are set", url: "/governance/" },
      { label: "Transparency Center", url: "/transparency/" },
    ],
    related: [
      { label: "HODL Rewards", path: "/hodl/" },
      { label: "Proof of Value", path: "/proof-of-value/" },
      { label: "Governance", path: "/governance/" },
    ],
  },

  {
    // Every figure below is read from src/mole/burnEvents.js, not retyped.
    //
    //   summarizeBurnEvents().confirmedBurnedBaseUnits = 49707077187484
    //     -> 49,707,077.187484 across 32 confirmed events
    //   the three spl-token-burn-instruction rows:
    //     2025-02-22   1,829,373.21          sig 3NTpyg1haByfK7…
    //     2025-08-02  10,077,932.510911      sig 2KmuXS7CWQskiU…
    //     2026-08-01  14,878,231.210253      sig 2ixvHEKgdq71C4…
    //
    // Those three sum to 26,785,536.931164 — a SUBSET, not the total. Writing
    // the subset as the headline would contradict /burn/, which publishes the
    // 49.7M figure. Stated carefully below for that reason.
    //
    // NOTE FOR THE RECORD: the build brief's own §13 example quoted the 2026
    // burn as 14,878,258.333854. The ledger says 14,878,231.210253 and carries
    // the signature; the brief's figure does not. The record wins.
    slug: "burn-history",
    status: NEWS_STATUSES.PUBLISHED,
    featured: false,
    category: "burns",
    image: "/images/news/generated/burn-history.png",
    imageAlt:
      "Generated cover for the full burn history: the category label and headline set on the WinLEW dark gradient.",
    title: "Every WinLEW Burn, In Order.",
    subtitle:
      "50,000,000 WinLEW no longer exists — half the long-term target. Here is every burn, and why our own ledger says a smaller number.",
    date: "2026-08-01",
    body: `
<p>Supply started at one billion. It is now 950 million. Here is where the missing 50,000,000 went — starting with the three transactions anyone can open.</p>

<table>
  <tr><th>Date</th><th>Destroyed</th></tr>
  <tr><td>February 22, 2025</td><td>1,829,373.21</td></tr>
  <tr><td>August 2, 2025</td><td>10,077,932.510911</td></tr>
  <tr><td>August 1, 2026</td><td>14,878,231.210253</td></tr>
</table>

<h2>The real number is 50,000,000 — and half of it is the target</h2>
<p>$WinLEW launched with <strong>1,000,000,000</strong> tokens. The mint reported <strong>950,000,000</strong> when this article was written. That difference is not an estimate or a running tally — it is the supply itself, and anyone can check it in one call:</p>
<p><strong>50,000,000 WinLEW no longer exists.</strong></p>
<p>That is <strong>50% of the long-term 100M burn target</strong>, reached.</p>
<p class="updateNote"><strong>Updated August 19, 2026.</strong> Supply is no longer a round number: it now reads <strong>949,999,960.615828</strong>. Two holders burned 39.384172 between them on August 18 — dust left in wallets they were closing. Nothing else moved, and the arithmetic below has been updated to match. This is what it looks like when a live number is published honestly instead of frozen at the moment it flattered us.</p>

<h2>Why our own ledger says 49.7M</h2>
<p>WinLEW's <a href="/burn/">Burn Center</a> confirms <strong>49,707,077.187484</strong> across 32 events. Against the on-chain total, that left <strong>292,922.812516</strong> unaccounted for in our records.</p>
<p>The gap is not missing tokens. It is <strong>burns we did not perform</strong> — holders who destroyed their own $WinLEW, some of it before the project began keeping this ledger at all. At least one was remembered: tokens sent out through the X faucet that the recipient burned the following day, entirely of their own accord.</p>
<p><strong>That memory now has a transaction behind it.</strong> On August 19, 2026 we walked every wallet our own <a href="/giveaways/">giveaway ledger</a> names — 21 addresses the X Faucet Reserve has ever paid — and checked each one for burn instructions. Six turned up, totalling <strong>100,830.472170 $WinLEW</strong>. The largest is the one that was remembered: a wallet received exactly 100,000 on January 1, 2025 and destroyed exactly 100,000 on January 3, <a href="https://solscan.io/tx/TVegUSjUPK7tkNu9gLCQANpeEWyTwacgDuaWXiJt4Zm6vCzYhVRB7SUqKR1fTit4DZ2GQiuQeEd9bV7Nu4PYGKy" target="_blank" rel="noreferrer noopener">signature here</a>.</p>
<p>So the unexplained residual is now <strong>192,131.724518</strong>, not 292,922.812516. It shrank because evidence arrived, not because we revised a guess.</p>
<p>Two things we will not dress up. These were <strong>account sweeps</strong>, not tributes — each one burns a leftover balance and closes the account to reclaim the rent, and the 100,000 was destroyed alongside two unrelated tokens in the same transaction. And the list is <strong>not complete and never can be</strong>: it covers wallets we paid, so anyone who bought on the open market and burned is still invisible to us. 100,830.472170 is a floor.</p>
<p>We could close the gap by simply publishing the 50M and saying nothing further. We publish both because they answer different questions. <em>50,000,000</em> is what the chain proves was destroyed. <em>49,707,077.187484</em> is what WinLEW can produce a transaction for. The second number is smaller precisely because it is the stricter claim, and the difference is other people choosing to burn tokens we never asked them to.</p>

<h2>The three we executed</h2>
<p>Of the destruction WinLEW carried out directly, three transactions used Solana's token <code>burn</code> instruction. They are listed above, and they total 26,785,536.931164 — the largest deliberate acts, not the whole story.</p>

<h2>Moved is not burned</h2>
<p>This is the distinction that matters most, and the one most easily blurred. Tokens sitting in the burn wallet are <em>staged</em> — still part of total supply, and still, in principle, moveable. Only the <code>burn</code> instruction actually reduces the mint's supply.</p>
<p>WinLEW's burn ledger records both, separately, and the progress bar counts only the second. That is why the "awaiting burn" figure and the "destroyed" figure are different numbers and always will be.</p>

<h2>What changed in 2026</h2>
<p>On August 16, 2026, <strong>40,000,000</strong> WinLEW was moved out of the burn wallet into two locks, leaving exactly <strong>10,000,000</strong> staged. The reason was tamper-proofing: burn-staged tokens used to sit somewhere the project could still spend from, and now they cannot be touched before their unlock dates.</p>
<p><strong>Locked is still not burned.</strong> All 40M remains part of total supply and none of it counts toward burn progress.</p>

<h2>The plan has changed, and the record shows it</h2>
<p>Burn amounts have not followed a fixed schedule. Each has been larger than the last, and the long-term 100M target remains a goal rather than tokens already set aside anywhere. Where an earlier announcement said one thing and the outcome was another, the <a href="/burn/">Burn Center</a> keeps both — the announcement and what actually happened.</p>
<p>The next decision is due at the annual mark. Nothing has been committed beyond the 10,000,000 currently staged.</p>
`,
    sources: [
      { label: "Burn Center — every event, with its transaction", url: "/burn/" },
      { label: "Transparency Center — reserves and locks", url: "/transparency/" },
      // All three read out of burnEvents.js explorerUrl. An earlier draft of
      // this article carried an INVENTED signature for the 2026 burn — a
      // fabricated proof URL on a page whose entire purpose is proof. Caught
      // before publish; never retype a signature, copy it from the record.
      { label: "Feb 22, 2025 burn — 1,829,373.21 on Solscan", url: "https://solscan.io/tx/3NTpyg1haByfK74zJp8dNnYtRRUZqNHHydaFgDHZkB1hYFCRTSNnKqVHKEmXTSsbgZSMqTs6vFPKBoYePMjTa5Br" },
      { label: "Aug 2, 2025 burn — 10,077,932.510911 on Solscan", url: "https://solscan.io/tx/2KmuXS7CWQskiU6MxyuwfhYfjvyfckQ47u9obQeLpLRWUz4t2eXZwMeU24gNoFp4P4KZDH43FGikhwdWfGspkoNY" },
      { label: "Aug 1, 2026 burn — 14,878,231.210253 on Solscan", url: "https://solscan.io/tx/2ixvHEKgdq71C41QKy6Fr4JNCeuh8Borsq2YLLUdLEG3VYg9Y5NTCa824oa7KiSu7EikQsfCk1wvU2q7AnoPHcD1" },
      { label: "$WinLEW mint on Solscan", url: "https://solscan.io/token/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump" },
    ],
    related: [
      { label: "Burn Center", path: "/burn/" },
      { label: "Transparency Center", path: "/transparency/" },
    ],
  },

  // ── Draft ────────────────────────────────────────────────────────────────
  // Present on purpose: it exercises the draft path (never written to disk,
  // never listed, no URL) and gives the v4 announcement somewhere to be
  // written before it is approved. Per the build brief, historical articles
  // are NOT manufactured from repository text — real backfill happens later,
  // deliberately, with approved wording.
  {
    slug: "winlew-v4",
    status: NEWS_STATUSES.DRAFT,
    featured: false,
    category: "development",
    image: "/images/news/generated/winlew-v4.png",
    imageAlt:
      "Generated cover for the v4 release: the category label and headline set on the WinLEW dark gradient.",
    title: "WinLEW v4.0.0",
    subtitle: "Placeholder — not yet approved for publication.",
    date: "2026-08-16",
    body: "<p>Draft. Not published.</p>",
  },
  {
    // The listing was VERIFIED, not taken on trust. solpitch.com is a hash-route
    // SPA, so its raw HTML contains no project content at all and an HTTP 200
    // proves nothing — the same trap documented in docs/community-liquidity.md
    // §4.1 for Raydium's farm URLs. Checked instead with a real headless browser
    // render on 2026-08-18, which returned the live listing: "Lets EveryOne Win
    // $WinLEW", category Memecoin, a Featured badge, and a vote count of 6.
    //
    // THE VOTE COUNT IS DELIBERATELY DATED in the body. It is a live number that
    // will be wrong tomorrow, and an undated live number is a claim that rots.
    slug: "solpitch-listing",
    status: NEWS_STATUSES.PUBLISHED,
    featured: false,
    category: "ecosystem",
    image: "/images/news/generated/solpitch-listing.png",
    imageAlt:
      "Generated cover for the SolPitch listing announcement: the category label and headline set on the WinLEW dark gradient.",
    title: "We Built It First. Now We're Showing People.",
    subtitle:
      "$WinLEW is listed on SolPitch — a directory where the community votes. A listing is exposure, not a seal of approval, and the difference matters.",
    date: "2026-08-17",
    body: `
<p>$WinLEW is now listed on <strong>SolPitch</strong>, a Solana project directory where visitors discover projects and vote on them.</p>

<p>Verified rather than announced: the listing was checked on <strong>August 18, 2026</strong> with a real browser, because SolPitch is a single-page app whose raw HTML contains no project content — an HTTP 200 on that URL would prove nothing at all. The render returned the live page: <em>Lets EveryOne Win $WinLEW</em>, tagged <em>Memecoin</em>, carrying a <em>Featured</em> badge, with <strong>6 votes</strong> at the moment it was checked.</p>

<p>That number is dated on purpose. It is a live counter and it will be wrong by the time you read this — which is exactly why it carries a timestamp instead of being quoted as a fact about the present.</p>

<h2>What a listing is, and what it is not</h2>
<p>Being listed somewhere is <strong>visibility</strong>. It is not verification, it is not an endorsement, and it is not a judgement by anyone that this project is good. A directory listing means a form was filled in and accepted.</p>
<p>This is worth saying plainly because plenty of projects present a listing as though it were a credential. It is not one, and a site that argues for checkable claims should be the first to say so about its own good news.</p>
<p>What it <em>does</em> do is put the work in front of people who have never seen it. That is the entire point.</p>

<h2>Why this is late, and deliberately so</h2>
<p>The order matters here. This project spent a long time building before asking for attention — a faucet, games, quizzes, Proof of Value, wallet verification, governance, burns, liquidity, security work, Discord bots, a transparency centre.</p>
<p>None of that is a claim you have to take on faith. Every one of those has a page on this site with the receipts attached: the <a href="/burn/">burn ledger</a> with a transaction for every burn, the <a href="/transparency/">transparency centre</a> with the wallets named, the <a href="/giveaways/">giveaway records</a> showing 12,228,500 $WinLEW given away across 30 transfers — including the eighteen we cannot explain, listed anyway.</p>
<p>A landing page was not called an ecosystem. The thing was built, and it is checkable, and that is why showing it to people now is not the same as asking them to believe a pitch.</p>

<h2>You can actually participate in this one</h2>
<p>SolPitch is voted on by whoever turns up. So this one is genuinely open: <a href="https://solpitch.com/#/project/lets-everyone-win-winlew-7a7219" rel="noopener noreferrer" target="_blank">find the listing</a>, read it, and vote if you think it deserves it.</p>
<p>Read it first. If a directory listing convinces you of anything on its own, the problem is the directory.</p>

<p><strong>Proof of Value — not Proof of Wealth.</strong></p>
`,
    sources: [
      { label: "The announcement on X (August 17, 2026)", url: "https://x.com/LewSales/status/2089392824743768515" },
      { label: "The $WinLEW listing on SolPitch", url: "https://solpitch.com/#/project/lets-everyone-win-winlew-7a7219" },
    ],
    related: [
      { label: "Giveaway Records", path: "/giveaways/" },
      { label: "Transparency Center", path: "/transparency/" },
      { label: "Burn Center", path: "/burn/" },
    ],
  },
  {
    // EVERY FIGURE HERE WAS READ OFF MAINNET on 2026-08-18, not taken from the
    // announcement: the counterfeit mint's own account state, its full 449-
    // signature history, and its current token accounts. The six-hour gap is
    // derived from two independent sources — the mint's first signature
    // (2025-03-26T16:16:36Z) and the X post id 1905021219067285813, which
    // decodes to 2025-03-26T22:17:06.865Z. Neither number came from memory.
    //
    // CAUSATION IS ATTRIBUTED, NOT ASSERTED. That the counterfeit stalled the
    // project's growth is the owner's own reading of what happened. The chain
    // proves the fake existed and when; it cannot prove what it cost. The
    // article says which is which.
    slug: "the-fake-winlew",
    status: NEWS_STATUSES.PUBLISHED,
    featured: false,
    category: "security",
    image: "/images/news/generated/the-fake-winlew.png",
    imageAlt:
      "Generated cover for the counterfeit-token warning: the category label and headline set on the WinLEW dark gradient.",
    title: "Someone Minted A Fake $WinLEW. We Had Six Hours.",
    subtitle:
      "March 26, 2025: a counterfeit $WinLEW appeared. The warning went out six hours later — and it changed how this project proves who it is.",
    date: "2025-03-26",
    body: `
<p>On <strong>March 26, 2025</strong>, someone created a counterfeit $WinLEW token.</p>

<p>Not a similar name. Not a parody. A deliberate impersonation, minted to be mistaken for this project's token by anyone who searched the name and did not check the address.</p>

<h2>Six hours</h2>
<p>Two timestamps tell that part of the story, and both can be checked without trusting us:</p>
<ul>
  <li>The counterfeit mint's <strong>first transaction</strong> on Solana: <code>2025-03-26T16:16:36Z</code>.</li>
  <li>The <strong>warning post</strong> on X: post id <code>1905021219067285813</code>, which decodes to <code>2025-03-26T22:17:06Z</code>.</li>
</ul>
<p>Six hours and one minute. X post ids encode the instant they were created, so that second figure is not a claim about when we noticed — it is arithmetic on the post itself.</p>

<h2>What the fake actually was</h2>
<p>The counterfeit is <code>GzMm4iuxoCU3NUAyvr1kxTbQY7U8SzEBP4F5vEQAvPoB</code>. The real $WinLEW is, and has always been, <code>DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump</code>.</p>
<p>Read off the chain today:</p>
<ul>
  <li>Total supply <strong>2,818,962.425</strong> — it did not even imitate the real token's supply.</li>
  <li>Mint authority revoked, no freeze authority — dressed to pass a quick safety check.</li>
  <li><strong>449 transactions in its entire life</strong>, the last on 2025-12-20. It has been inert since.</li>
  <li><strong>13 token accounts ever existed. 8 wallets still hold a balance.</strong></li>
</ul>
<p>That last line is the part worth sitting with. Eight wallets are still holding a counterfeit token that will never be worth anything, and some of those people probably still believe they own $WinLEW.</p>

<h2>What it changed</h2>
<p>The response was not to post louder. It was to make the real token <em>checkable in the places people actually look</em> — registered and verified across the platforms a buyer checks before buying, so that "which one is real" stops being a judgement call and becomes a lookup.</p>
<p>That is the reason this site is built the way it is. The burn ledger, the transparency centre, the snapshot tooling, the refusal to publish a number that cannot be traced to a transaction — all of it descends from a day when the difference between the real thing and a fake one was a string of characters most people would never compare.</p>

<h2>What it cost</h2>
<p>Here the honest answer is that the chain cannot settle it, so this is the project's own reading rather than a proven fact: the counterfeit landed at the worst possible moment, during the push that the March and April 2025 giveaways were built around, and the momentum did not recover.</p>
<p>Several giveaways from that period were tied to milestones — a follower count, a holder count — and those milestones were never reached. Which means the giveaways never triggered.</p>
<p><strong>Nothing is owed.</strong> A giveaway conditioned on a milestone that did not happen is not a debt, and pretending otherwise would be its own kind of dishonesty. Those records stay published exactly as they were written, with their conditions and their status intact, because deleting an unfulfilled promise is worse than leaving it standing unmet.</p>
<p>The December 7, 2026 airdrop exists to close that chapter deliberately rather than let it hang — not to settle a debt, because there is not one, but because a project that keeps a list of things that never happened should eventually do something instead.</p>

<h2>The line that stuck</h2>
<blockquote><p>"Scammers don't just go after any crypto. They target the ones where they see the potential of $. This tells me #WinLEW is in the correct path to a successful future."</p></blockquote>
<p>— Jim (@jim_xyo), the same day.</p>
<p>That is a generous way to read being counterfeited, and it is not the whole truth — being targeted is not an achievement, and it cost this project more than it gave. But there is something in it. Nobody bothers to forge a thing that nobody wants.</p>

<h2>If you take one thing from this</h2>
<p><strong>Check the contract address. Every time.</strong> Not the name, not the logo, not the ticker, not who posted the link — all four of those were copied. The address is the only part that cannot be.</p>
<p>The real one is <code>DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump</code>. Verify it on RugCheck, on Solscan, on any explorer you like. Do not take our word for it — that is the entire point.</p>
`,
    sources: [
      { label: "The original warning on X (March 26, 2025)", url: "https://x.com/LewSales/status/1905021219067285813" },
      { label: "The counterfeit mint on RugCheck", url: "https://rugcheck.xyz/tokens/GzMm4iuxoCU3NUAyvr1kxTbQY7U8SzEBP4F5vEQAvPoB" },
      { label: "The real $WinLEW on RugCheck", url: "https://rugcheck.xyz/tokens/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump" },
    ],
    related: [
      { label: "Transparency Center", path: "/transparency/" },
      { label: "Burn Center", path: "/burn/" },
      { label: "Community Events", path: "/events/" },
    ],
  },
]);

/** Published only, newest first. The one accessor every consumer should use. */
export function publishedArticles(articles = NEWS_ARTICLES) {
  return articles
    .filter((a) => a.status === NEWS_STATUSES.PUBLISHED)
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * The featured article, or null.
 *
 * Throws on more than one rather than silently picking: two featured articles
 * is an authoring mistake, and quietly choosing one hides it until someone
 * notices the wrong story on the front page.
 */
export function featuredArticle(articles = NEWS_ARTICLES) {
  const featured = publishedArticles(articles).filter((a) => a.featured === true);
  if (featured.length > 1) {
    throw new Error(
      `multiple_featured_articles:${featured.map((a) => a.slug).join(",")} — exactly one article may set featured: true`
    );
  }
  return featured[0] || null;
}

/** Previous/next within the published, date-sorted list. */
export function articleNeighbours(slug, articles = NEWS_ARTICLES) {
  const list = publishedArticles(articles);
  const i = list.findIndex((a) => a.slug === slug);
  if (i === -1) return { previous: null, next: null };
  return {
    // "Previous" reads as older to a person, and the list is newest-first.
    previous: list[i + 1] || null,
    next: list[i - 1] || null,
  };
}

/** Up to `limit` other published articles, preferring the same category. */
export function relatedArticles(slug, { limit = 3, articles = NEWS_ARTICLES } = {}) {
  const list = publishedArticles(articles).filter((a) => a.slug !== slug);
  const self = NEWS_ARTICLES.find((a) => a.slug === slug);
  const sameCategory = list.filter((a) => a.category === self?.category);
  const rest = list.filter((a) => a.category !== self?.category);
  return [...sameCategory, ...rest].slice(0, limit);
}

/** Categories that actually have published articles, for the filter row. */
export function activeCategories(articles = NEWS_ARTICLES) {
  const used = new Set(publishedArticles(articles).map((a) => a.category));
  return Object.entries(NEWS_CATEGORIES)
    .filter(([key]) => used.has(key))
    .map(([key, meta]) => ({ key, ...meta }));
}

export function formatArticleDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
