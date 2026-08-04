# Together

Shared household finance for two people who both earn.

Existing apps solve pieces of this. Expense trackers handle individual spending. Splitwise handles settlement but not personal finance. Neither answers the question a working couple actually asks at the end of the month: **given everything we both paid, from all our different accounts, who owes whom?**

---

## What it does

- **Three kinds of spending.** Personal, household, and things bought for each other — the last one asking explicitly whether it is a gift or something owed back.
- **Automatic settlement.** Equal, ratio-based, or fixed contributions. One sentence on the dashboard: *"Ankit owes you ₹3,240."*
- **A rolling balance.** Unsettled amounts carry forward until money actually changes hands. No monthly reset that quietly drifts from reality.
- **Sub-10-second entry.** Amount keypad, four type chips, save. Everything else is optional and inferred from history.
- **Real settlement machinery.** Refunds, joint accounts, back-dated corrections into closed months, and an audit log of every change.

Built for two, designed so a third member needs no migration.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in your Supabase keys
npm run test                   # settlement engine
npm run dev
```

Full instructions, including the Supabase and Vercel setup, are in **[docs/SETUP.md](docs/SETUP.md)**.

Hosting costs nothing at this scale — Supabase free tier plus Vercel Hobby.

---

## Documentation

| Document | What's in it |
|---|---|
| **[PRD-v2.md](PRD-v2.md)** | The finalised product requirements and the reasoning behind each decision |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | Stack, data model, settlement maths, security, known gaps |
| **[docs/SETUP.md](docs/SETUP.md)** | Step-by-step Supabase + Vercel deployment |
| **[docs/ANDROID-APP.md](docs/ANDROID-APP.md)** | Packaging it as a real Android app, at zero cost |

---

## The three decisions that shaped everything

**Transaction type is derived, not stored.** A transaction records who paid and who consumed it; "personal / household / partner" falls out of those two facts. The label can never disagree with the data, and settlement becomes one formula instead of three special cases.

**Money never touches a float.** Integer paise, end to end. Ratio splits round to whole rupees at the period level, with the remainder assigned to the larger share, so the parts always sum to the total exactly.

**Closing a month does not clear a debt.** Only an actual payment does. Closing locks the month against edits and snapshots the numbers; the balance keeps rolling until someone sends money.

---

## Scripts

```bash
npm run dev         # local development
npm run build       # production build
npm run test        # settlement engine tests
npm run typecheck   # tsc --noEmit
npm run icons       # regenerate PWA/Android icons from public/icons/icon.svg
npm run db:push     # apply migrations to the linked Supabase project
npm run db:types    # regenerate database types
```

---

## Status

MVP. Manual entry only — automatic import from SMS, email and bank statements was deliberately deferred, but every future source writes through the same transaction model via the `source` and `external_ref` columns.

Not built yet: offline entry queue, web push, partial splits, recurring generation. See the *Known gaps* section of the architecture doc for the honest list.
