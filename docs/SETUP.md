# Setup and deployment

Everything here fits inside the free tier of both services. For two people it will stay there indefinitely.

| Piece | Service | Cost |
|---|---|---|
| Database, auth, realtime | Supabase | Free |
| Web app hosting | Vercel | Free (Hobby) |
| Domain (optional) | Any registrar | ~₹900/year |

Total: ₹0 unless you want a custom domain.

---

## 1. Prerequisites

- Node.js 20 or newer — `node -v`
- A GitHub account (Vercel deploys from it)
- A Supabase account — https://supabase.com

Install the Supabase CLI:

```bash
npm install -g supabase
```

---

## 2. Create the Supabase project

1. Go to https://supabase.com/dashboard → **New project**
2. Name: `couple-finance`
3. Database password: generate one and save it in your password manager
4. Region: **Mumbai (ap-south-1)** — closest to Pune, and it matters for latency
5. Wait ~2 minutes for provisioning

From **Project Settings → API**, copy:
- Project URL
- `anon` `public` key

The `service_role` key is not used anywhere in this app. Do not put it in the project.

---

## 3. Run the migrations

From the project folder:

```bash
npm install
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

`<your-project-ref>` is the subdomain in your project URL — the `abcdefgh` in `https://abcdefgh.supabase.co`.

This applies, in order:

| File | What it does |
|---|---|
| `0001_schema.sql` | Tables, enums, constraints, indexes |
| `0002_functions.sql` | Triggers, period maths, `create_household`, `accept_invite` |
| `0003_rls.sql` | Row Level Security policies and realtime publication |

### If you would rather not use the CLI

Open **SQL Editor** in the Supabase dashboard and paste each file in order, running one at a time. Order matters — `0003` depends on functions defined in `0002`.

### Verifying it worked

In the SQL editor:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
```

Every table must show `rowsecurity = true`. If any shows false, RLS did not apply and the data is not protected — re-run `0003_rls.sql`.

---

## 4. Configure auth

**Authentication → Providers → Email**
- Enable Email
- For a two-person app, turn **Confirm email** OFF during setup so you are not waiting on inbox delivery. Turn it back on afterwards if you like.

**Authentication → Providers → Google**

1. Go to https://console.cloud.google.com → APIs & Services → Credentials
2. Create an **OAuth client ID** → Web application
3. Authorised redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
4. Copy the Client ID and Client Secret into Supabase and enable the provider

**Authentication → URL Configuration**
- Site URL: `http://localhost:3000` for now; change to your Vercel URL after step 6
- Additional redirect URLs: add both
  - `http://localhost:3000/auth/callback`
  - `https://your-app.vercel.app/auth/callback`

Missing the redirect URL is the single most common cause of a failed Google sign-in.

---

## 5. Run it locally

```bash
cp .env.example .env.local
```

Fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your anon key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Then:

```bash
npm run test       # settlement engine — should be all green
npm run dev
```

Open http://localhost:3000, create an account, and set up your household.

To test the two-person flow properly, open a second browser profile (or an incognito window) and accept the invite link there as your partner. One browser cannot hold two sessions.

---

## 6. Deploy to Vercel

```bash
git init
git add .
git commit -m "Initial commit"
```

Push to a **private** GitHub repository, then:

1. https://vercel.com/new → import the repo
2. Framework preset: Next.js (detected automatically)
3. Environment variables — add all three:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL` → `https://your-app.vercel.app`
4. Deploy

Then go back to Supabase → **Authentication → URL Configuration** and set the Site URL to your Vercel URL, keeping both callback URLs in the allow list.

Every push to `main` redeploys automatically.

---

## 7. Install it on your phones

Because it is a PWA, there is no app store step.

**Android (Chrome)** — open the site, menu ⋮ → *Add to Home screen*. It gets its own icon and opens without browser chrome.

**iPhone (Safari)** — open the site, Share → *Add to Home Screen*. It must be Safari; Chrome on iOS cannot install PWAs.

Do this on both phones before you start using it properly. An app behind three taps in a browser does not get used.

---

## 8. Regenerating types (optional)

`src/types/app.ts` is hand-written so the app compiles before the database exists. Once you are running, you can generate real types:

```bash
npm run db:types
```

This writes `src/types/database.ts`. Adopting them is optional and can be done gradually.

---

## Troubleshooting

**"new row violates row-level security policy"**
You are inserting with a `created_by` that is not `auth.uid()`, or your session expired. Sign out and back in.

**"infinite recursion detected in policy"**
A policy is querying a table that has its own policy referencing back. All the helper functions (`is_household_member`, `shares_household_with`, `config_household`, `transaction_household`) are `SECURITY DEFINER` precisely to prevent this — check none of them were changed to `SECURITY INVOKER`.

**Google sign-in returns to /login with an error**
The redirect URL is not in Supabase's allow list, or `NEXT_PUBLIC_SITE_URL` does not match the deployed domain.

**"This transaction is in a settled period"**
Working as designed. Reopen the period from Settings → Settled periods.

**Partner's changes are not appearing**
Realtime needs the tables in the publication. Check:

```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
```

`transactions`, `settlement_transfers` and `settlement_periods` should all be listed. The app also refreshes whenever it returns to the foreground, so this only affects live updates while both phones are open.

---

## Backups

Supabase's free tier keeps daily backups for 7 days. That is thin for financial history. Either:

- Download the CSV export from Settings once a month, or
- Upgrade to the ₹2,000/month Pro tier for point-in-time recovery

The CSV export is deliberately complete — it is a genuine escape hatch, not a token feature.
