import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

// Protected-file integrity is checked by tools/test-audit/run.cjs, outside
// this guarded process. Only disposable paths are inspected here.
assert.equal(process.env.WINLEW_TEST_ISOLATED, "1", "run through the isolated audit wrapper");
const tempA = fs.mkdtempSync(path.join(os.tmpdir(), "winlew-profile-isolation-a-"));
const tempB = fs.mkdtempSync(path.join(os.tmpdir(), "winlew-profile-isolation-b-"));

process.env.MONGO_ENABLED = "false";
delete process.env.MONGO_URI;
process.env.DATA_DIR = tempA;
process.env.DISCORD_TOKEN = "phase4fr-local-only";
process.env.DISCORD_CLIENT_ID = "phase4fr-local-only";
process.env.DISCORD_CLIENT_SECRET = "phase4fr-local-only";
process.env.DISCORD_REDIRECT_URI = "http://127.0.0.1/phase4fr-callback";
process.env.WINLEW_MINT = "phase4fr-local-only";

const { saveProfilePrefs, getProfilePrefsByUser } = await import("../../src/mole/profilePrefs.js");

test.after(() => {
  for (const dir of [tempA, tempB]) {
    assert.ok(dir.startsWith(os.tmpdir()), "cleanup target must stay inside the OS temp directory");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("profile preferences follow the current configured DATA_DIR for reads and writes", () => {
  saveProfilePrefs({ discordUserId: "phase4fr-user-a", displayName: "Isolated A" });
  const fileA = path.join(tempA, "profile_prefs.json");
  assert.equal(fs.existsSync(fileA), true);
  assert.equal(getProfilePrefsByUser("phase4fr-user-a")?.displayName, "Isolated A");

  process.env.DATA_DIR = tempB;
  assert.equal(getProfilePrefsByUser("phase4fr-user-a"), null,
    "changing DATA_DIR must not retain an import-time path or read the first store");
  saveProfilePrefs({ discordUserId: "phase4fr-user-b", displayName: "Isolated B" });
  const fileB = path.join(tempB, "profile_prefs.json");
  assert.equal(fs.existsSync(fileB), true);
  assert.equal(getProfilePrefsByUser("phase4fr-user-b")?.displayName, "Isolated B");

  process.env.DATA_DIR = tempA;
  assert.equal(getProfilePrefsByUser("phase4fr-user-a")?.displayName, "Isolated A");
  assert.equal(getProfilePrefsByUser("phase4fr-user-b"), null);
});
