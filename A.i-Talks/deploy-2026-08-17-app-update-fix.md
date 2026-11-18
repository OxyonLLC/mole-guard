# Deploy 2026-08-17 — app 0.2.1, and the update button that never worked

**You are the reader, not the author.** See `README.md` in this folder. Written
by the assistant on the **development** machine. Anything under "You must do"
has **not happened yet** — it is being asked of you.

Follows `deploy-2026-08-16d-full-handoff.md`. That one still stands for the
thirteen commits it covers; this adds two.

---

## WHERE you are

Two commits since `87143b0`:

```
8613b53  app: the update button never downloaded anything
8729b6b  mobile: app 0.2.1 — a rebuild, and the iOS versions that had drifted
```

```bash
# snapshot the runtime data dirs FIRST — this has bitten before
cp -r src/data src/data.bak-$(date +%F)
cp -r data data.bak-$(date +%F) 2>/dev/null
git fetch origin && git reset --hard origin/main
npm test        # expect 1692/1692 — that is what it returned here
```

---

## You must do

**Nothing urgent. Do not upload anything, and do not rebuild the APK.**

That is unusual for one of these files, so here is the state, verified against
the live host rather than assumed:

| File | Status |
|---|---|
| `src/public/app/index.html` | **already live** — served copy is byte-identical to `origin/main` |
| `src/public/jdid93hf8dh/index.html` | **already live** — 0.2.1, correct SHA, the new note |
| `src/public/jdid93hf8dh/latest.json` | **already live** — build 201 |
| `src/public/jdid93hf8dh/winlew-beta-0.2.1.apk` | **already live** — 200 OK, 25,840,435 bytes |

The owner uploaded all four by hand while the work was in progress. Verified
with `curl` on 2026-08-17: the served `/app/` page diffs clean against local,
and the APK returns `200` at the exact byte length built here.

**No restart is needed.** Both changes are static HTML/JSON — `express.static`
reads from disk per request, so a `git pull` is enough to bring this machine's
own copy in line. Nothing in `src/mole/`, `src/faucet/`, or any worker changed.

**The old `winlew-beta-0.2.0.apk` should be deleted from the host** if it is
still there. `npm run mobile:publish` removed it locally; it cannot reach the
host itself.

---

## What was wrong, so it is not re-diagnosed

The in-app updater has been broken since it shipped in `d65e629` on 2026-08-02.
The banner worked; the button did nothing at all — no error, no toast, no
download. Observed on a real device on 2026-08-17, on app 0.2.0.

Three things combined:

- the APK link is **same-origin**, so Capacitor's `shouldOverrideUrlLoading`
  leaves it to the WebView instead of handing it to Android. This is the same
  code path that *works* for wallet links, precisely because those are
  off-origin — see the wallet correction in `docs/mobile-beta.md`.
- the host serves the APK as `application/vnd.android.package-archive` with
  `X-Content-Type-Options: nosniff`, so the WebView can only treat it as a
  download.
- an Android WebView **silently discards** a download when no
  `DownloadListener` is registered, and none is — not in `MainActivity`, not
  in Capacitor's own bridge (`grep -rl DownloadListener` over
  `@capacitor/android` returns nothing).

So the 0.1.0 → 0.2.0 update was never deliverable in-app either. **A visible
banner is not evidence the flow works** — it only proves the version check ran.

The fix hands the URL to `Browser.open()`, a Custom Tab, which is Chrome, which
has a download manager.

**It was fixed site-side on purpose.** A `DownloadListener` in `MainActivity`
would only ever help builds made *after* it — and the installs that need the
fix are exactly the ones that could never receive it, because the broken button
is the only update path the app offers. Serving the fix from winlew.co reaches
every APK already installed, 0.1.0 included.

---

## About 0.2.1 itself

**It changes nothing a tester can observe**, and the beta page now says so
rather than implying otherwise. Both of 2026-08-16's mobile commits (`8fd1076`,
`d9e8c46`) were comment-only: `@capacitor/local-notifications` already declares
`POST_NOTIFICATIONS` in its own manifest and the merger folds it in, so the
permission was never missing. Confirmed with `aapt2 dump permissions` on the
published 0.2.0 APK and on a fresh build — identical sets.

The version bump exists only because a same-version republish is invisible:
`checkForUpdate()` offers an update solely when `latest.json`'s `build` is
**strictly greater** than the running `versionCode`.

If a tester reports notifications not arriving, **0.2.1 will not fix it.** The
cause is OEM battery management killing the app so the scheduled alarm never
runs; the user must allow **Auto Start** and **Background running** for WinLEW
in Android's App Info. No manifest entry can substitute for that.

---

## What you cannot do

**You cannot build an APK on this machine.** `winlew-upload.jks`,
`keystore.properties`, and `local.properties` are all gitignored and exist on
the development PC only, and `build/` is gitignored too. `npm run mobile:publish`
will therefore always fail here with:

```
No release APK at mobile/android/app/build/outputs/apk/release/app-release.apk
```

That is expected, not a broken checkout. All APK work goes to the dev PC.

---

## Worth doing later, not now

Add a `DownloadListener` to `MainActivity` so the updater does not depend on a
Custom Tab being present. It is belt-and-braces and **not** a substitute for
the site-side fix — it cannot rescue anyone already installed. It needs a new
APK, so it should ride along with the next build that has a real reason to
exist.
