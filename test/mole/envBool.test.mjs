// Environment booleans must mean what they say: "false" is false.
// (z.coerce.boolean() made MAINTENANCE_MODE=false report planned maintenance.)
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { envBool } from "../../src/shared/envBool.js";

const parse = (def, value) => z.object({ X: envBool(def) }).safeParse(value === undefined ? {} : { X: value });

test("unset uses the default", () => {
  assert.equal(parse(true).data.X, true);
  assert.equal(parse(false).data.X, false);
});

test("false-like strings are false, whatever the default", () => {
  for (const v of ["false", "FALSE", " False ", "0", "no", "off", ""]) {
    assert.equal(parse(true, v).data.X, false, JSON.stringify(v));
  }
});

test("true-like strings are true, whatever the default", () => {
  for (const v of ["true", "TRUE", " True ", "1", "yes", "on"]) {
    assert.equal(parse(false, v).data.X, true, JSON.stringify(v));
  }
});

test("anything else is a validation error, not silently true", () => {
  for (const v of ["ture", "enabled", "2", "-1", "y"]) {
    const r = parse(false, v);
    assert.equal(r.success, false, JSON.stringify(v));
  }
});

test("MAINTENANCE_MODE=false no longer reports maintenance (the production case)", async () => {
  const saved = process.env;
  process.env = { ...saved, DISCORD_TOKEN: "t", DISCORD_CLIENT_ID: "c", DISCORD_CLIENT_SECRET: "s",
    DISCORD_REDIRECT_URI: "https://winlew.co/callback", WINLEW_MINT: "So11111111111111111111111111111111111111112",
    MAINTENANCE_MODE: "false", DISCORD_ACTIVITY_ENABLED: "true", GUILD_ROLE_SYNC_ENABLED: "true", GUILD_ROLE_DIAGNOSTICS_ON_START: "true" };
  try {
    const { getConfig } = await import("../../src/mole/config.js");
    const cfg = getConfig();
    assert.equal(cfg.MAINTENANCE_MODE, false);
    assert.equal(cfg.DISCORD_ACTIVITY_ENABLED, true);
    assert.equal(cfg.GUILD_ROLE_SYNC_ENABLED, true);
  } finally { process.env = saved; }
});
