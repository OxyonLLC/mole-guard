// Every automated refusal has to carry a route back, because every one of
// these gates can be wrong about a real person. walletBans.js says so about its
// own cluster matching: "two people who share a funder look identical to one
// person with two wallets." Housemates and a friend who funded someone's first
// wallet both produce the abuser's exact signature.
//
// A refusal with no appeal route turns a false positive into a permanent,
// silent ban on someone who did nothing — so these tests treat a missing
// contact route as a defect, not a cosmetic gap.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APPEAL_EMAIL,
  APPEAL_CONTACT_URL,
  APPEAL_DISCORD_URL,
  appealLine,
  appealLineMarkdown,
  withAppeal,
} from "../../src/services/appealContact.js";
import { explainIdentityRefusal } from "../../src/mole/identityAge.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("the appeal line names all three routes", () => {
  const line = appealLine();
  for (const route of [APPEAL_EMAIL, APPEAL_CONTACT_URL, APPEAL_DISCORD_URL]) {
    assert.ok(line.includes(route), `the appeal line must name ${route}`);
  }
  // Without this, a moderator gets "I'm banned" with nothing to look up.
  assert.match(line, /wallet address/i, "must ask for the wallet address, or every appeal needs a round trip to get it");
});

test("the Discord flavour suppresses link embeds", () => {
  const md = appealLineMarkdown();
  assert.ok(md.includes(`<${APPEAL_CONTACT_URL}>`), "URLs in Discord messages need <> or every refusal spawns a preview card");
  assert.ok(md.includes(`<${APPEAL_DISCORD_URL}>`));
});

test("withAppeal joins cleanly and stands alone", () => {
  assert.equal(withAppeal("Refused."), `Refused. ${appealLine()}`);
  assert.equal(withAppeal(""), appealLine());
  assert.equal(withAppeal("  Refused.  "), `Refused. ${appealLine()}`);
});

test("every identity-gate refusal carries the appeal route", () => {
  // Reasons are enumerated from the module rather than hardcoded, so a new
  // refusal reason cannot be added without this test noticing it.
  const reasons = ["account_too_new", "guild_membership_too_new", "membership_screening_pending", "not_in_guild", "something_new"];
  for (const reason of reasons) {
    const msg = explainIdentityRefusal({ ok: false, reason, required: 30, actual: 3 });
    assert.ok(msg.includes(APPEAL_EMAIL), `the "${reason}" refusal must tell the user how to appeal`);
  }
  assert.equal(explainIdentityRefusal({ ok: true }), null, "a pass must not carry a refusal message");
});

test("the faucet web page's duplicated copy still matches the real address", () => {
  // src/public/ is a browser bundle and cannot import appealContact.js, so the
  // address is duplicated there by necessity. This is the guard that keeps the
  // duplicate honest — without it, changing SUPPORT_EMAIL would leave a dead
  // address on the page users actually hit when they are refused.
  const page = readFileSync(resolve(repoRoot, "src/public/faucet/js/app.js"), "utf8");
  const banMessages = page.split("\n").filter((l) => /wallet_banned:|linked_to_banned:/.test(l));
  assert.equal(banMessages.length, 2, "expected both faucet ban messages — if they moved, update this guard rather than deleting it");
  for (const line of banMessages) {
    assert.ok(line.includes(APPEAL_EMAIL), `faucet ban message must carry ${APPEAL_EMAIL}`);
    assert.ok(line.includes(APPEAL_CONTACT_URL), `faucet ban message must carry ${APPEAL_CONTACT_URL}`);
  }
});
