# Prompt — build the Android APK

**How to use this:** open a terminal in `E:\codes and projects\Couple expense tracker`, run `claude`, and paste everything below the line. Claude Code runs on your actual machine, so it can execute the builds and talk to your phone over USB.

Do not paste this into a Cowork chat — that sandbox is a separate Linux VM with no JDK and no access to your phone.

---

I want to package this project as an installable Android APK. Work through it with me step by step, running the commands yourself.

## Context

This is a Next.js 15 + Supabase PWA called "Together" — a shared expense tracker for a couple. It is already built and the web app works. I want a real Android app on two phones, at zero cost, without the Play Store.

The approach is a Trusted Web Activity built with Bubblewrap. The plan, the exact values, and the reasoning are all in `docs/ANDROID-APP.md` — **read that first and follow it**. This prompt is only about how I want you to work through it.

Environment: Windows. My shell is PowerShell.

## What I want at the end

`app-release-signed.apk`, built and verified, installed on my phone, opening with no browser address bar.

## How to work

Go one phase at a time. After each phase, tell me what happened in a sentence or two and confirm before moving on. Do not chain the whole thing and report at the end — if step 3 fails I want to know before step 6 runs.

Run commands yourself rather than telling me to run them, except where I have to physically do something (unlock the phone, tap a dialog, log into Vercel).

If a command fails, diagnose it before retrying. Do not retry the same command hoping for a different result.

## Phase 1 — Prerequisites

Check and report on:

- `node -v` (need 20+)
- `java -version` (need JDK 17+ — this is the one most likely to be missing)
- `adb version` (optional; only needed for USB install)
- whether `npm install` has been run in this project

If the JDK is missing, tell me how to install it on Windows and stop until I have done it. Do not try to install it silently.

## Phase 2 — Icons

Run `npm run icons` and confirm the three PNGs appear in `public/icons/`. Show me the file sizes so I know they are not empty.

If `sharp` fails to install on Windows, say so and suggest the fallback rather than working around it silently.

## Phase 3 — Deployment check

The TWA needs a live HTTPS URL. **Ask me for my Vercel URL.** Do not guess it or assume one.

Then verify these all return 200 and the right content type:

- `https://<url>/manifest.webmanifest`
- `https://<url>/icons/icon-512.png`
- `https://<url>/icons/icon-maskable-512.png`

If the icons 404, the icons have not been pushed. Commit and push them, wait for the deploy, and re-check. Do not proceed to Bubblewrap with broken icon URLs — it fails with a misleading error.

## Phase 4 — Bubblewrap

Install `@bubblewrap/cli` globally, then initialise in a folder **outside** this repo — use `..\together-android`.

Use the values from `android/twa-manifest.template.json`:

- packageId `app.together.household`
- name and launcher name `Together`
- theme colour `#3b6ef5`
- display `standalone`, orientation `portrait`

Bubblewrap will prompt for a keystore password. **Stop and ask me for it** — do not invent one, and do not echo it back in your output afterwards.

## Phase 5 — Build

Run `bubblewrap build`.

When it finishes, tell me:

- the full path to `app-release-signed.apk` and its size
- the SHA-256 signing fingerprint (get it from `keytool -list -v` if the build output has scrolled past)

Then remind me, once, to back up `android.keystore` and its password somewhere safe.

## Phase 6 — Digital Asset Links

Fill in `public/.well-known/assetlinks.json` in this repo with the real fingerprint, keeping the colons and uppercase hex exactly as `keytool` printed them.

Commit and push. Wait for the Vercel deploy, then verify:

1. `https://<url>/.well-known/assetlinks.json` returns the JSON
2. Google's validator accepts it:
   `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<url>&relation=delegate_permission/common.handle_all_urls`

If the validator errors, fix it before we install. An APK installed against broken assetlinks shows a browser bar and is confusing to debug later.

## Phase 7 — Install

Ask whether I want USB (`adb install`) or to sideload the file manually. If USB, walk me through enabling USB debugging.

After install, ask me to open it and confirm: my icon on the home screen, a blue splash, and **no address bar at the top**.

If the address bar is there, the assetlinks check has not propagated — tell me to force-stop the app and clear Chrome's cache rather than rebuilding anything.

## Rules

- Never `git add` the keystore, the generated `twa-manifest.json`, or any `.apk`. The `.gitignore` covers these — verify with `git status` before any commit rather than trusting it.
- Never print the keystore password.
- Do not modify anything in `src/` or `supabase/`. This task touches only icons, `assetlinks.json`, and the external Android folder.
- Do not run `npm run build` or the test suite; they are unrelated to this task.
- If you find yourself wanting to change the app's code to make the build work, stop and tell me instead.

Start with Phase 1.
