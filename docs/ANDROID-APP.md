# Putting it on your phones as a real Android app

Total cost: **₹0.**

This wraps the deployed web app in a Trusted Web Activity — a genuine Android package that renders your site with no browser interface at all. It is the same mechanism a number of production apps use. You install it directly on your two phones; no Play Store, no fees.

The app updates itself whenever you push to Vercel, because the APK is only a shell. You build it once and never rebuild unless you change the icon or the app name.

---

## Before you start

- The web app must be **deployed and working** at an HTTPS URL — follow `docs/SETUP.md` first. A TWA points at a live domain; it cannot wrap localhost.
- **Java JDK 17+** installed — `java -version`. Bubblewrap downloads the Android SDK itself but needs a JDK present.
- Node 20+.

Throughout, replace `YOUR-APP.vercel.app` with your real domain.

---

## Step 1 — Generate the PNG icons

Bubblewrap needs a raster 512×512 icon. The repo ships an SVG source; this turns it into the PNGs the manifest and the build both reference.

```bash
npm install
npm run icons
```

You should get three files in `public/icons/`:

```
icon-192.png
icon-512.png
icon-maskable-512.png
```

To use your own artwork instead, replace `public/icons/icon.svg` and re-run. Keep the important part of the design inside the middle 60% — Android crops maskable icons to whatever shape the launcher uses.

Commit and push so Vercel serves them:

```bash
git add public/icons public/manifest.webmanifest
git commit -m "Add PWA icons"
git push
```

Confirm `https://YOUR-APP.vercel.app/icons/icon-512.png` loads in a browser before continuing. Bubblewrap fetches these over the network, so a 404 here fails the build with a confusing error.

---

## Step 2 — Install Bubblewrap

```bash
npm install -g @bubblewrap/cli
```

First run will offer to download the Android SDK and JDK. Say yes; it puts them under your home directory and does not touch anything else.

---

## Step 3 — Initialise the project

Work outside the repo so the Android build output never mixes with your source:

```bash
mkdir ../together-android
cd ../together-android
bubblewrap init --manifest https://YOUR-APP.vercel.app/manifest.webmanifest
```

It will ask a series of questions. The answers that matter:

| Prompt | Answer |
|---|---|
| Application ID / package | `app.together.household` |
| App name | `Together` |
| Launcher name | `Together` |
| Display mode | `standalone` |
| Status bar colour | `#3b6ef5` |
| Include shortcuts | yes |
| Signing key — create new | yes |
| Key store password | **choose one and save it in your password manager** |

`android/twa-manifest.template.json` in the repo lists every value if you would rather set them explicitly.

### About the signing key

Bubblewrap creates `android.keystore`. **Back this file up somewhere safe, along with its password.**

If you lose it, Android will refuse to install any future build over the existing app — you would have to uninstall and reinstall, losing nothing in this case since all data lives in Supabase, but it is still an avoidable annoyance. If someone else gets it, they can sign packages that Android trusts as yours.

Do not put it in the git repo. The `.gitignore` already blocks `*.keystore`, `*.apk` and the generated `twa-manifest.json` (which contains your password in plain text).

---

## Step 4 — Build

```bash
bubblewrap build
```

First build takes a few minutes while Gradle downloads dependencies. You get:

```
app-release-signed.apk       ← install this on your phones
app-release-bundle.aab       ← only needed for the Play Store; ignore it
```

At the end, Bubblewrap prints your signing key's SHA-256 fingerprint — a long colon-separated hex string. **Copy it.** If you miss it:

```bash
keytool -list -v -keystore android.keystore -alias android
```

---

## Step 5 — Remove the URL bar

Without this step the app works but shows a browser address bar across the top, which rather defeats the point. Android hides it only once your domain confirms it trusts the package.

Open `public/.well-known/assetlinks.json` in the repo and replace the placeholder:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.together.household",
      "sha256_cert_fingerprints": ["AB:CD:EF:...your fingerprint..."]
    }
  }
]
```

Keep the colons and the uppercase hex exactly as `keytool` printed them.

Push it:

```bash
git add public/.well-known/assetlinks.json
git commit -m "Add Digital Asset Links for the Android app"
git push
```

Verify it is live — this URL must return the JSON, not a 404:

```
https://YOUR-APP.vercel.app/.well-known/assetlinks.json
```

Then check Google's validator agrees:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://YOUR-APP.vercel.app&relation=delegate_permission/common.handle_all_urls
```

You want `"maxAge"` present and no error. If it complains, the fingerprint or the package name does not match.

---

## Step 6 — Install on both phones

**Over USB** (most reliable):

```bash
adb install app-release-signed.apk
```

**Or just send the file.** Share `app-release-signed.apk` over WhatsApp or Google Drive, tap it on the phone, and allow "install unknown apps" for whichever app you shared it from. Android will warn about installing outside the Play Store; that is expected.

Open it. You should see your icon, a brand-coloured splash, and no address bar. If the address bar is still there, assetlinks has not propagated — force-stop the app, clear Chrome's cache, and reopen. It can take a few minutes.

---

## Afterwards

**You do not rebuild for content changes.** Push to Vercel and both phones pick it up on next launch. Rebuild only if you change the icon, app name, theme colour, or package ID.

**To ship an update to the shell**, bump `appVersionCode` in `twa-manifest.json`, run `bubblewrap build`, and install over the top with the same keystore.

---

## Known limitations of this approach

**No Play Store auto-updates.** Not an issue here, since the content updates itself and the shell almost never changes.

**Android will occasionally warn about the app's origin.** Sideloaded packages get a scarier install dialog. Nothing to be done about it.

**Notifications.** `enableNotifications` is on in the template, but the app does not yet send web push — see the *Known gaps* section of `ARCHITECTURE.md`. Realtime updates work while the app is open.

---

## The 2027 verification change

Google is introducing developer verification for sideloaded apps: Brazil, Indonesia, Singapore and Thailand from **30 September 2026**, expanding globally including India during **2027**. After that, unverified sideloaded packages will not install through the normal flow on certified devices.

This does not cost you anything. Google has committed to a free tier — no fee, no government ID, email address only, distribution to **up to 20 devices**. Two phones sits comfortably inside that, and `adb install` continues to work regardless.

Practically: nothing to do now. Around late 2026, register the free limited-distribution account and re-sign. Worth a calendar reminder, not worth worrying about.
