// Android notification permissions and the app's own resume behaviour.
//
// A CORRECTION IS RECORDED HERE. This file was first written believing
// notifications failed because POST_NOTIFICATIONS was missing from the app
// manifest. That was wrong: @capacitor/local-notifications declares it in its
// own manifest and Android's merger folds it in, so the permission was never
// absent. The explicit declaration is kept as documentation, not as a fix.
//
// The real cause was OEM battery management killing the app, so the scheduled
// AlarmManager alarm never ran. A tester confirmed it by allowing Auto Start
// and Background running in App Info. No code change can grant that — but the
// app CAN stop lying about the cooldown when it is resumed, which is the
// second half of what these tests cover.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolve(repoRoot, p), "utf8");

const manifestRaw = read("mobile/android/app/src/main/AndroidManifest.xml");
// Strip XML comments. The manifest deliberately NAMES the exact-alarm
// permissions in a comment explaining why they are absent — matching that prose
// would fail the very test that documents the decision. This exact mistake
// (a guard matching its own explanation) has now happened more than once in
// this repo; strip first, match second.
const manifest = manifestRaw.replace(/<!--[\s\S]*?-->/g, "");
const variables = read("mobile/android/variables.gradle");
const plugins = JSON.parse(read("mobile/android/app/src/main/assets/capacitor.plugins.json"));
const notify = read("src/public/app/notify.js");

const targetSdk = Number((variables.match(/targetSdkVersion\s*=\s*(\d+)/) || [])[1]);

test("targetSdkVersion is readable — the rest of this file depends on it", () => {
  assert.ok(Number.isFinite(targetSdk) && targetSdk > 0, "could not parse targetSdkVersion");
});

test("POST_NOTIFICATIONS resolves from the app manifest or the plugin's", () => {
  if (targetSdk < 33) return; // not required below Android 13
  const pluginManifest = read("mobile/node_modules/@capacitor/local-notifications/android/src/main/AndroidManifest.xml");
  const declared =
    /uses-permission android:name="android\.permission\.POST_NOTIFICATIONS"/.test(manifest) ||
    /uses-permission android:name="android\.permission\.POST_NOTIFICATIONS"/.test(pluginManifest);
  assert.ok(
    declared,
    `targetSdkVersion is ${targetSdk}, so POST_NOTIFICATIONS is a runtime permission. It normally ` +
      "arrives from the plugin's own manifest via Android's merger — this fails only if BOTH the app " +
      "and the plugin stop declaring it."
  );
});

test("the local-notifications plugin is actually installed", () => {
  // The permission is useless without the plugin, and vice versa.
  assert.ok(
    plugins.some((p) => p.pkg === "@capacitor/local-notifications"),
    "@capacitor/local-notifications must be in capacitor.plugins.json"
  );
});

test("exact-alarm permissions are NOT declared", () => {
  // notify.js deliberately avoids `allowWhileIdle` so exact alarms are never
  // used. Both of these carry Play Store policy restrictions, and adding one
  // without needing it invites a review rejection. If exact timing is ever
  // required, that trade-off should be made deliberately — not by someone
  // adding permissions while debugging.
  for (const perm of ["SCHEDULE_EXACT_ALARM", "USE_EXACT_ALARM"]) {
    assert.ok(
      !manifest.includes(perm),
      `${perm} is declared but notify.js avoids exact alarms. Remove it, or change notify.js ` +
        "deliberately and update this test with the reason."
    );
  }
  assert.ok(!/allowWhileIdle:\s*true/.test(notify), "notify.js must not request allowWhileIdle");
});

test("notify.js still handles a denied permission rather than assuming success", () => {
  assert.match(notify, /checkPermissions\(\)/, "must check before requesting");
  assert.match(notify, /requestPermissions\(\)/, "must request when the state is prompt");
  assert.match(notify, /no_permission/, "must report a denial instead of pretending it scheduled");
});

// ── the cooldown label ───────────────────────────────────────────────────────

test("the cooldown is derived from an absolute time, not frozen at fetch", () => {
  // The bug: the countdown was computed once and written into textContent, so a
  // backgrounded app showed "~2h" for hours while the notification correctly
  // fired. Deriving it from Date.now() against a stored timestamp is what makes
  // it survive a suspended WebView.
  const app = read("src/public/app/index.html");
  assert.match(app, /function renderCooldown\(\)/, "a re-render function must exist");
  assert.match(app, /cooldownAt - Date\.now\(\)/, "the label must be derived from wall-clock time");
  assert.match(app, /setInterval\(renderCooldown/, "it must re-render on a tick, not only on fetch");
});

test("a lapsed cooldown asks the server rather than enabling the button locally", () => {
  // Local time can say the wait is over; only the faucet can say a claim is
  // allowed. Enabling the button on a local timer would offer a claim the
  // server may refuse.
  const app = read("src/public/app/index.html");
  const fn = app.slice(app.indexOf("function renderCooldown()"), app.indexOf("function startCooldownTicker"));
  assert.match(fn, /refreshFaucet\(\{ force: true \}\)/, "must re-check with the server when the timer lapses");
  assert.ok(!/btn\.disabled = false/.test(fn), "must NOT enable the claim button purely on local time");
});

test("resume re-renders before it refetches", () => {
  // The battery management that causes this bug is exactly what makes the
  // resume event unreliable, so the synchronous path must not wait on network.
  const app = read("src/public/app/index.html");
  assert.match(app, /isActive\) \{ renderCooldown\(\); refreshFaucet\(\); \}/, "appStateChange must re-render first");
  assert.match(app, /visible'\) \{ renderCooldown\(\); refreshFaucet\(\); \}/, "visibilitychange must re-render first");
});
