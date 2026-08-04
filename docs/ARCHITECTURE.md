# Architecture

## The shape of the thing

```
  Phone (PWA)  ─────►  Next.js on Vercel  ─────►  Supabase Postgres
   installed            Server Components            RLS enforced
   to homescreen        Server Actions               at the row level
        ▲                     │
        └──── realtime ───────┴──── Supabase Realtime (websocket)
```

Three deliberate choices sit underneath this:

**Postgres does the security, not the app.** Every table has Row Level Security keyed on household membership. Even if a bug leaked the anon key or a query forgot a `WHERE household_id = ...`, another household's data is unreachable. The `service_role` key is never used anywhere in the codebase.

**The settlement engine is a pure function.** `src/lib/settlement/engine.ts` takes data in and returns balances out. No database, no clock, no I/O. That is what makes it exhaustively testable, and settlement is the one part of this app that absolutely must be right.

**Server Actions for every write.** No REST API layer to keep in sync. Mutations are typed end to end, validated with Zod at the boundary, and revalidate the page cache on success.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15, App Router | Server Components mean the settlement calculation runs server-side and ships no engine code to the phone |
| Language | TypeScript, strict | |
| Database | Supabase Postgres | RLS, auth, realtime and a free tier in one place |
| Auth | Supabase Auth | Email/password and Google, both required by the PRD |
| Styling | Tailwind v4 | No config file, no runtime |
| Charts | Recharts | Only two charts; not worth a heavier library |
| Validation | Zod | Same schemas for form input and server action boundary |
| Tests | Vitest | Settlement engine only — that is where the risk is |
| Hosting | Vercel + Supabase | Free at this scale, Mumbai region for both |

---

## Data model

The full annotated schema is in `supabase/migrations/0001_schema.sql`. The decisions worth understanding:

### Payer and beneficiary, not "owner"

A transaction stores **who paid** and **who consumed it**. The three user-facing types are a generated column:

```sql
txn_type generated always as (
  case
    when beneficiary_kind = 'household' then 'household'
    when beneficiary_user_id = payer_user_id then 'personal'
    else 'partner'
  end
) stored
```

This means the stored facts and the displayed label can never disagree, settlement is one formula instead of three special cases, and adding a third household member later needs no migration.

### Money is integer paise

`bigint` everywhere. Floats are never used for money at any layer. `src/lib/money.ts` is the only place rupee strings are parsed or formatted.

### Refunds are negative transactions

A refund is a row with `kind = 'refund'` and a negative `amount_paise`, optionally linked to the original. Every `SUM()` in the system is then correct for free — no special casing in reports, dashboards or the settlement engine.

```sql
constraint amount_sign check (
  (kind = 'expense' and amount_paise > 0)
  or (kind = 'refund' and amount_paise < 0)
)
```

### Settlement transfers are not transactions

Money moving between partners lives in `settlement_transfers`. If it were a transaction it would inflate household spending, which is the most common way apps like this quietly go wrong.

### transaction_splits exists but is not yet used by the UI

A trigger mirrors every transaction into exactly one `is_auto = true` split row. When partial splits ship ("₹1,200 of this ₹3,000 dinner was my friend's"), the UI writes `is_auto = false` rows and the trigger steps aside. No schema change, no backfill. This is the single most expensive thing to retrofit, which is why it exists on day one despite being invisible.

### Everything is soft-deleted

There is no `DELETE` policy on `transactions` at all. Deletion is an `UPDATE` setting `deleted_at`. Hard deletes are impossible from the client by construction.

### Audit log

A generic trigger records every create, edit and delete with full before/after JSON. This is a relationship feature, not an engineering one — it settles "I definitely entered that" without either partner needing to be right from memory.

---

## Settlement

### The model: rolling balance, optional close

```
balance(X) = Σ household delta across ALL periods
           + reimbursable partner expenses X paid for others
           - reimbursable partner expenses others paid for X
           + settlement transfers X sent
           - settlement transfers X received
```

Closing a period does **not** zero the balance. Only an actual transfer of money does. Closing exists to lock a period against edits, and to snapshot the numbers so a month is still explainable a year later after the ratio has changed twice.

### Per period

```
settleable_total = Σ household transactions NOT paid from a joint method
expected(X)      = weighted share of settleable_total under the active config
actual(X)        = Σ household transactions in the period where payer = X
                   (joint-method ones excluded entirely)
delta(X)         = actual(X) - expected(X)
```

### Joint accounts net to exactly zero

Spending from a payment method flagged `is_joint` is removed from **both** sides of the equation rather than being split and then credited back. Splitting-then-crediting leaves a few paise of rounding noise per transaction; removing it is exact. Joint spending still appears in household totals — it just never makes one partner owe the other.

### Rounding

Shares are rounded to whole rupees, and the remainder is assigned to the member with the largest share so the parts always sum to the total exactly. Rounding is applied **per period**, not per transaction — per-transaction rounding accumulates into a discrepancy the couple cannot reconcile by hand.

```ts
expect(out[A] + out[B]).toBe(total)  // holds for every total, including negatives
```

### Effective-dated configuration

The config for a period is the latest one whose `effective_from` is on or before the period **start**. Changes always take effect from the start of the next period, so a single period is never computed under two different rules.

### The fixed model

`equal` and `ratio` are a straight weighted split. `fixed` is meaningfully different:

- Household spends **≤** the committed total → commitments scale down proportionally. There is no shared pot in this product for a surplus to sit in, so expecting someone to "owe" money that went nowhere would be wrong.
- Household spends **more** → each covers their commitment, and the overspend is split **equally** on top. "We each put in our number, and whatever it runs over we split down the middle."

Without that second rule, `fixed` collapses into `ratio` and the model has no reason to exist.

---

## Periods

`period_start_day` is constrained to **1–28**. That single constraint removes every month-length edge case from the system — no "what happens on the 31st of February" logic anywhere, in SQL or TypeScript.

The maths exists twice, deliberately: `period_start_for()` in Postgres (used by the insert trigger) and `periodStartFor()` in TypeScript (used by the UI). They are tested against each other's behaviour in `engine.test.ts`, including year boundaries and February.

### Back-dating into a closed period

Permitted, and history is never rewritten. The insert trigger detects the closed period and assigns the transaction to the **current open period** with `is_adjustment = true`. The original date stays on the row, the UI labels it as an adjustment, and the user is told what happened rather than silently getting a different answer.

---

## Security

| Concern | Handling |
|---|---|
| Cross-household access | RLS on all 14 tables, keyed on `is_household_member()` |
| Policy recursion | All membership helpers are `SECURITY DEFINER` — this is load-bearing |
| Session validity | Middleware calls `getUser()` (revalidates with Supabase), never `getSession()` (trusts the cookie) |
| Privilege escalation | `service_role` key not present in the codebase |
| Invite tokens | 24 random bytes, single use, 14-day expiry |
| CSV formula injection | Fields starting `= + - @` are prefixed in the export |
| Hard deletes | Structurally impossible from the client |

### The privacy decision

Both partners see everything, including each other's personal transactions. Personal spending is excluded from settlement but not from view.

This was a product decision, not a technical default. Partial visibility — "you can see the amount but not what it was" — creates a worse dynamic than transparency in a shared finance app. There is no private-transaction flag.

---

## Realtime

Supabase Realtime pushes changes on `transactions`, `settlement_transfers` and `settlement_periods`; the client calls `router.refresh()`. The app also refreshes on foreground.

This is deliberately **not** collaborative editing. Two people almost never edit the same transaction simultaneously, and CRDT-style infrastructure would be a large cost for a problem that does not exist here. Conflicts resolve last-write-wins, with the audit log preserving what was overwritten.

---

## Performance

The settlement engine loads a household's entire history on every dashboard render. At two people logging perhaps 200 transactions a month, that is ~2,400 rows a year — trivially fast, and far simpler than incremental aggregation with its attendant staleness bugs.

Revisit only past roughly 50,000 transactions, at which point the fix is to fold closed periods into their existing `balance_snapshot` and only compute open ones.

---

## Known gaps

Honest list of what is not built:

**Offline entry.** The service worker caches the shell but does not queue writes. Adding a transaction with no signal fails. The fix is an IndexedDB outbox flushed on reconnect — worth doing, since Indian mobile data is not uniformly reliable.

**Web push.** Realtime only fires while the app is open. Real push notifications require a VAPID setup and a Supabase Edge Function, and on iOS work only for an installed PWA. Deferred deliberately; the in-app refresh covers most of the value.

**Partial splits.** Table exists, UI does not.

**Recurring expenses.** `recurring_templates` exists with an `rrule` column. No generator runs.

**Multi-member.** The engine handles N members correctly. The UI assumes two — most obviously in the settlement headline, which reports the single largest debt rather than a full N-way simplification.

**Automatic import.** Every future source (SMS, email, statements, UPI APIs) writes through the same transaction model using the `source` and `external_ref` columns, which exist for exactly this purpose. `external_ref` is uniquely constrained per `(household, source)` so re-importing the same statement cannot create duplicates.

---

## File map

```
supabase/migrations/
  0001_schema.sql        tables, constraints, indexes
  0002_functions.sql     triggers, period maths, RPCs
  0003_rls.sql           policies, grants, realtime

src/lib/
  money.ts               the only place rupees become paise
  data.ts                all server-side reads
  settlement/
    engine.ts            the pure function
    engine.test.ts       47 cases
    periods.ts           period maths, mirrors the SQL
    types.ts

src/app/
  (app)/                 authenticated shell with bottom nav
    page.tsx             dashboard
    add/                 fast entry
    transactions/        history, search, edit
    reports/             per-period breakdown, close, export
    settings/            split config, categories, invites, data
  actions/               all writes
  api/export/            CSV
  login/ onboarding/ invite/
```
