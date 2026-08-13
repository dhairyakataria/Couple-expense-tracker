# Mobile App Plan — Together (Couple Expense Tracker)

**Goal:** turn this app into a real installable Android app (APK), at zero cost, with a path to Play Store later if you want it.

**Bottom line:** this app is already 90% of the way there. It's a Next.js PWA with a proper `manifest.webmanifest`, service worker, icons, and even a stub `assetlinks.json` — someone already planned for this. The fastest, free, zero-code-rewrite path is to wrap the deployed web app in a **TWA (Trusted Web Activity)**, not to rebuild it in React Native or Capacitor.

---

## 1. Why TWA, and not Capacitor / React Native

| Option | Verdict | Why |
|---|---|---|
| **TWA (Trusted Web Activity)** | ✅ Recommended | Wraps your *already-deployed* PWA in a real Chrome instance inside an Android app shell. Zero code rewrite. Real installable APK. Free tooling. |
| **Capacitor** | ❌ Not worth it here | Would still just point a WebView at your hosted URL (this app needs a live Next.js server for Server Actions — it can't be statically bundled inside the app). You'd get the same result as TWA but with more setup, and **Google blocks OAuth login inside embedded WebViews** (`disallowed_useragent` error) — which breaks your Google Sign-In. TWA uses real Chrome under the hood, so this problem doesn't exist. |
| **React Native / Flutter rewrite** | ❌ Overkill | Would mean rebuilding the entire UI, settlement logic, and Supabase integration from scratch. Weeks of work for something the PWA wrapper solves in a day. |

Your app uses Next.js Server Components + Server Actions (see `docs/ARCHITECTURE.md`) — it needs a live server, so "fully offline native app" isn't the right target anyway. TWA is the correct fit.

---

## 2. Cost check

Everything below is **$0** until you explicitly decide to publish on the Play Store:

- Vercel Hobby hosting — free, no card required
- Supabase free tier — free, no card required
- Google Cloud OAuth client — free
- Android signing key (keytool) — free, built into any JDK
- PWABuilder.com (APK generation) — free, no install required
- Installing the APK on your own phone (sideloading) — free

**The only paid item in this entire plan** is the Google Play Console registration fee — **$25, one-time**, only needed in Phase 10 if/when you decide to publish. You said to defer that, so it's last and optional.

---

## 3. Phase 0 — Accounts you'll need (all free)

1. GitHub — you already have this (repo: `dhairyakataria/Couple-expense-tracker`)
2. [Vercel](https://vercel.com) — sign up with GitHub
3. [Supabase](https://supabase.com) — sign up with GitHub
4. [Google Cloud Console](https://console.cloud.google.com) — for the Google Sign-In OAuth client (you likely already have a Google account)
5. [PWABuilder.com](https://www.pwabuilder.com) — no account needed at all

---

## 4. Phase 1 — Stand up the backend (Supabase)

1. Go to supabase.com → **New Project**. Pick the **Mumbai (ap-south-1)** region (lowest latency for India, matches the PRD's Asia/Kolkata assumption).
2. Once created, open **SQL Editor** and run the three migration files **in this exact order**, pasting the full contents of each:
   - `supabase/migrations/0001_schema.sql`
   - `supabase/migrations/0002_functions.sql`
   - `supabase/migrations/0003_rls.sql`
3. Go to **Project Settings → API**. Copy:
   - `Project URL` → this is `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → this is `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Keep these somewhere safe — you'll paste them into Vercel in Phase 2.
4. Enable Google login: **Authentication → Providers → Google** → toggle on. Leave this tab open — you'll come back after Phase 1b with a Client ID/Secret.

### 1b. Google OAuth client (for "Sign in with Google")

1. Go to console.cloud.google.com → create a new project (any name, e.g. "Together App").
2. **APIs & Services → OAuth consent screen** → External → fill app name "Together", your email, save.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → Application type: **Web application**.
4. Under **Authorized redirect URIs**, add exactly:
   ```
   https://<your-supabase-project-ref>.supabase.co/auth/v1/callback
   ```
   (Find `<your-supabase-project-ref>` in your Supabase project URL.)
5. Click Create. Copy the **Client ID** and **Client Secret**.
6. Back in Supabase → **Authentication → Providers → Google** → paste Client ID + Secret → Save.

*(Manual step — only you can do this; it's tied to your Google/Supabase accounts.)*

---

## 5. Phase 2 — Deploy the frontend (Vercel)

1. Go to vercel.com → **Add New → Project** → import `dhairyakataria/Couple-expense-tracker` from GitHub.
2. Framework preset: Vercel auto-detects Next.js — leave as is.
3. Under **Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | (from Phase 1, step 3) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (from Phase 1, step 3) |
   | `NEXT_PUBLIC_SITE_URL` | your Vercel URL, e.g. `https://together-app.vercel.app` (you'll know this after first deploy — redeploy once to set it correctly) |

4. Click **Deploy**. Wait for the build to finish.
5. Once deployed, go back to Google Cloud Console → your OAuth client → **Authorized JavaScript origins** → add your Vercel URL (e.g. `https://together-app.vercel.app`). Save.
6. Open the deployed URL on your **phone's Chrome browser**. Confirm you can sign up, log in, and add a transaction.

*(Manual step — account linking, clicking through Vercel's UI. I can prep code/config, but the actual deploy click has to be you.)*

---

## 6. Phase 3 — Confirm the PWA is installable

On your Android phone, in Chrome, open the deployed URL:

1. You should see a banner or the "⋮ menu → Install app" option. Tap it.
2. Confirm it installs a "Together" icon on your home screen, opens full-screen (no browser address bar), and works.

If this works, the hard part (PWA correctness) is already done — the manifest and icons in this repo are already correctly configured for this.

---

## 7. Phase 4 — Decide the Android package ID

The repo already has a placeholder in `public/.well-known/assetlinks.json`:

```
app.together.household
```

This is a fine package ID to keep (it doesn't need to be registered anywhere until you eventually publish to Play Store). If you'd rather use something else (e.g. `com.yourname.together`), decide now — it's used in the next two phases.

---

## 8. Phase 5 — Generate the APK (recommended: PWABuilder, zero install)

This is the easiest path — everything happens in a browser, nothing to install.

1. Go to **pwabuilder.com**.
2. Paste your deployed URL (e.g. `https://together-app.vercel.app`) into the box → click **Start**.
3. PWABuilder scores your PWA (manifest, service worker, icons). It should score well already — this repo's manifest is solid.
4. Click **Package for stores** → choose **Android**.
5. Fill in the form:
   - **Package ID:** `app.together.household` (from Phase 4)
   - **App name:** `Together`
   - **Launcher name:** `Together`
   - **Display mode:** `standalone`
   - **Signing key:** choose **"Create new signing key"** (PWABuilder generates one for you — no JDK needed). Fill in a name/org (anything, e.g. Org: "Together", Country: "IN").
6. Click **Generate**. Download the resulting `.zip`.
7. Unzip it. You'll find:
   - `app-release-signed.apk` — the actual installable app
   - `signing.keystore` (or similar) — **save this file somewhere safe and permanent.** You need the exact same key for every future update, and for eventual Play Store publishing.
   - A file/section showing the **SHA-256 fingerprint** and the exact `assetlinks.json` content to use.

### Alternative: Bubblewrap CLI (if you prefer full local control)

Only do this if you want the build to happen on your own machine instead of PWABuilder's servers. Requires Node.js (free) + a JDK (free, e.g. Temurin 17) + Android SDK command-line tools (free, downloaded by Bubblewrap itself).

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://together-app.vercel.app/manifest.webmanifest
# Answer prompts: package ID app.together.household, etc.
bubblewrap build
```

This produces `app-release-signed.apk` and prints the SHA-256 fingerprint directly. Same end result as PWABuilder, more setup.

---

## 9. Phase 6 — Wire up Digital Asset Links (removes the browser address bar)

Without this step, the app still works but shows a thin Chrome URL bar at the top (it falls back to a plain Custom Tab). With it, it looks 100% like a native app.

1. From Phase 5, copy the real **SHA-256 fingerprint** PWABuilder/Bubblewrap gave you.
2. Send me that fingerprint (and confirm the package ID). I'll update `public/.well-known/assetlinks.json` in this repo to:
   ```json
   [
     {
       "relation": ["delegate_permission/common.handle_all_urls"],
       "target": {
         "namespace": "android_app",
         "package_name": "app.together.household",
         "sha256_cert_fingerprints": ["<your real fingerprint>"]
       }
     }
   ]
   ```
3. Commit + push. Vercel auto-redeploys.
4. Verify it's live and correct: paste your domain into Google's checker →
   `https://developers.google.com/digital-asset-links/tools/generator`
   (choose "Statement List", enter your site + package name + fingerprint, click "Generate statement" then "Test statement" — it should say your file matches.)

---

## 10. Phase 7 — Install and test the APK on your phone

Two ways, both free:

**A. Direct transfer (simplest)**
1. Send `app-release-signed.apk` to your phone (email to yourself, Google Drive, USB cable, WhatsApp to yourself — anything).
2. On the phone, open the file. Android will ask to allow installs from that source once — allow it.
3. Install. Open "Together" from the app drawer.

**B. Via `adb` (if you have Android Studio / platform-tools installed)**
```bash
adb install app-release-signed.apk
```

**Test checklist** (walk through the real flows):
- Sign up / log in (including Google Sign-In — this is the step that would break in Capacitor but should work fine here)
- Add a transaction, confirm it appears on the dashboard
- Check the settlement headline calculates
- Pull to refresh / foreground refresh works
- Rotate/close/reopen the app — session persists
- No browser address bar visible (confirms Phase 6 worked)

---

## 11. Phase 8 — iOS note

Native iOS packaging is **not zero-cost**: it requires a Mac, Xcode (free), and an Apple Developer Program membership (**$99/year**) — there's no free way to get an installable `.ipa` onto an iPhone outside 7-day developer sideloading.

The zero-cost iOS path is what's already built: on iPhone Safari, **Share → Add to Home Screen** installs this PWA as a full-screen app icon today, no App Store needed. This repo's `layout.tsx` already has `appleWebApp` metadata configured for exactly this. Recommend treating this as "the iOS app" for now and revisiting native iOS only if you later decide the $99/year and Play Store route are both worth it.

---

## 12. Phase 9 — Known gaps worth closing before heavy daily use (optional, not blocking)

From `docs/ARCHITECTURE.md`'s own "Known gaps" section — these affect the *mobile experience* specifically, so worth flagging here even though they're not required to get an APK working:

- **Offline entry:** adding a transaction with no signal currently fails outright (service worker caches the shell only, not writes). On mobile data this will bite. Fix = IndexedDB outbox + sync on reconnect. I can build this if you want it before daily use.
- **Push notifications:** partner-activity notifications only fire while the app is open (Realtime), not as real push. Needs a VAPID key + Supabase Edge Function. Doable free, just not built yet.

Neither blocks Phases 1–7. Flagging so you can decide whether to do these before or after you start using the APK day to day.

---

## 13. Phase 10 — Play Store (later, when you're ready — the one paid step)

Do this only once the APK has been tested and used for real. Skipping details since you said this is a "later" decision, but the shape of it:

1. Play Console signup — **$25 one-time** fee, personal or organization account.
2. Rebuild as an **`.aab`** (Android App Bundle) instead of APK — same PWABuilder/Bubblewrap flow, just choose AAB output, same signing key you saved in Phase 5.
3. Store listing: app name, short/full description, screenshots (from your phone), feature graphic, privacy policy URL (needs a real `/privacy` page — I can write one), category (Finance), content rating questionnaire, data safety form (declare: collects email, financial transaction data; used for account functionality; not shared with third parties).
4. New developer accounts must run a **closed testing track** with real testers for a period before Google grants production access — requirements change, so check current Play Console guidance at submission time rather than trusting this document.
5. Submit for review, wait for approval (typically a few days).

---

## 14. Who does what — manual vs. automatable

| Step | Who |
|---|---|
| Create Vercel/Supabase/Google Cloud accounts | **You** (needs your identity/login) |
| Run the 3 SQL migrations in Supabase | **You**, via Supabase's SQL Editor (copy-paste, 2 minutes) — or ask me to do it, I have a connected Supabase tool that can provision the project and run migrations directly if you'd rather I handle it |
| Set Vercel env vars, click Deploy | **You** (Vercel dashboard) |
| Configure Google OAuth client + redirect URIs | **You** (tied to your Google account) |
| Generate APK via PWABuilder | **You** (a few form fields, then download) |
| Update `assetlinks.json` with the real fingerprint | **Me** — send me the fingerprint and I'll edit + commit the file |
| Install/test APK on your phone | **You** (physical device) |
| Play Store submission, screenshots, listing copy | Mostly **you** (account + review process); I can write the description, privacy policy page, and prep the AAB-ready config |

---

## 15. Suggested order to actually do this

1. Phase 1 (Supabase) → Phase 1b (Google OAuth) → Phase 2 (Vercel deploy). *Tell me if you want me to provision Supabase + run migrations for you — I can do that directly.*
2. Phase 3 — confirm PWA installs on your phone via Chrome.
3. Phase 4 (package ID — just confirm you're keeping `app.together.household`).
4. Phase 5 — generate the APK via PWABuilder.
5. Send me the SHA-256 fingerprint → I update and redeploy `assetlinks.json` (Phase 6).
6. Phase 7 — install and run through the test checklist on your phone.
7. Decide on Phase 9 (offline queue / push) before or after daily use.
8. Phase 10 (Play Store) whenever you're ready — separate conversation, $25 step.
