# Couple Finance Manager — PRD v2

**Status:** Requirements finalized. Architecture, schema, and UX flows to follow.
**Last updated:** 3 August 2026

---

## 1. Product Definition

A shared expense tracker for couples, built around one thing existing apps do badly: **automatic, fair settlement between two people who both earn and both pay.**

This is deliberately **not** a personal finance manager. There is no income tracking, no net worth, no budgeting, no savings goals. Those require bank aggregation to be useful, which is explicitly out of scope. The product is: fast manual expense entry + correct settlement + clear reporting.

**Platform:** Mobile-first responsive web app (PWA), installable to home screen. Works on desktop, optimized for phone.

**Locale:** India. Currency INR. Timezone Asia/Kolkata.

---

## 2. Core Data Philosophy

The v1 rule *"every transaction belongs to exactly one owner"* is replaced with a two-field model:

- **Payer** — whose money left the account
- **Beneficiary** — who consumed it (a specific person, or the household)

Transaction type is **derived**, not stored:

| Payer | Beneficiary | Derived type |
|---|---|---|
| A | A | Personal |
| A | Household | Household |
| A | B | Partner expense |

**Why this matters:** settlement becomes a single formula instead of three special cases, the model generalizes to 3+ members without a rewrite, and partial splits become a natural extension rather than a schema migration.

Users never see the words "payer" or "beneficiary." The UI presents the three familiar type labels.

### Non-negotiable schema decisions

- Amounts stored as **integer paise**, never floats.
- A `transaction_splits` table exists from day one, even though the MVP UI only ever writes one row per transaction. This is the single most expensive thing to retrofit later.
- All deletes are **soft deletes**.
- Every create/edit/delete writes an **audit log** entry.
- Contribution configuration is **effective-dated**, never overwritten in place.

---

## 3. Users, Household, Auth

- **Auth:** Email + password, and Google Login.
- **Household** is the primary collaborative entity. All data belongs to a household, not to a user.
- One user creates a household, then invites the second by email. On acceptance, both see identical data.
- Architecture supports N members; MVP UI assumes 2 and may hardcode two-person layouts.

### Sync model

**Not** real-time collaborative editing. Two people almost never edit the same transaction at once, and the infrastructure cost is unjustified.

Instead:
- Pull-to-refresh + refresh on app foreground
- **Push notification when your partner adds a transaction** (`"Ankit added ₹4,500 · Rent"`)
- Last-write-wins on conflict, with the audit log preserving what was overwritten

### Lifecycle edge cases

- Invitation expires after 14 days if unaccepted; creator can resend.
- A member can leave a household. Their transactions remain (data integrity), attributed to their name.
- **CSV export available at all times, by either member, for all household data.** This is both a feature and the honest answer to "what happens to this if the relationship ends."

---

## 4. Privacy Model

**Both members see everything by default.** Personal transactions are fully visible to the partner; they are simply excluded from settlement calculations.

Rationale: partial visibility ("you can see the amount but not what it was") creates a worse dynamic than transparency. A shared finance app that hides things from one partner is solving the wrong problem.

There is no private-transaction flag in the MVP.

---

## 5. Transaction Model

### Fields

| Field | Required | Notes |
|---|---|---|
| Amount | Yes | Integer paise |
| Date | Yes | Defaults to today |
| Payer | Yes | Defaults to current user |
| Beneficiary | Yes | Person or Household — drives derived type |
| Reimbursable | Conditional | Only for partner expenses. See §5.2 |
| Category | No | Never blocking |
| Merchant | No | Autocomplete from history |
| Payment method | No | See §5.3 |
| Notes | No | |
| Attachment | Future | Schema field reserved, not built |
| Created by / Created at | Auto | |
| Last modified by / at | Auto | |
| Deleted at | Auto | Soft delete |

### 5.1 Transaction types

**Personal** — excluded from settlement. Visible to both partners in reports.

**Household** — participates in settlement. Rent, groceries, utilities, dining together, furniture.

**Partner expense** — one partner pays, the other consumes.

### 5.2 Partner expense: gift vs. reimbursable

Every partner expense requires an explicit choice. This is presented as **two type chips at the same level of the entry UI**, not as a follow-up question — so it costs zero extra taps:

- **`For Ankit · gift`** → counts as the buyer's personal spending. No settlement effect.
- **`For Ankit · owes me`** → beneficiary owes the payer the full amount. Full settlement effect.

Rationale for requiring the choice: defaulting either way produces a wrong answer often enough to erode trust in the settlement number. An app that silently bills your partner for their birthday present is worse than one that asks.

### 5.3 Payment methods and joint accounts

Payment method is a free-form user-managed list (e.g. "HDFC Debit", "Amex", "GPay–SBI").

A payment method can be flagged **Joint**. Transactions paid from a joint method are treated as **already split according to the active contribution ratio** and produce no settlement delta. This prevents the common failure where rent paid from a joint account looks like one person carried it.

### 5.4 Cash

ATM withdrawals are **not** expenses and should not be entered. Only the spending from that cash is logged. This is documented in onboarding; no special handling is built.

---

## 6. Non-Expense Records

These are separate record types, excluded from all spending totals, and were missing from v1. Without them, reports are wrong within the first week.

### Settlement transfer
When one partner actually sends money to square up. Affects the balance, never appears in "spending."

Fields: from, to, amount, date, note, optional link to a closed period.

### Refund / reversal
Returned items, cancelled bookings, cashback. Linked to the original transaction where possible; standalone otherwise. Reduces the relevant spending totals and adjusts settlement symmetrically with the original.

---

## 7. Settlement System

The most important subsystem. It answers exactly one question: **who owes whom, and how much, right now.**

### 7.1 Contribution models

- **Equal** — 50:50
- **Ratio** — e.g. 60:40
- **Fixed** — e.g. A contributes ₹30,000, B contributes ₹20,000

### 7.2 Income is not stored

The ratio is entered **directly** (60:40), not derived from stored salaries.

Rationale: salaries are used only to produce one percentage, they change with appraisals, and storing them drags in a whole income module plus a privacy question neither partner asked for. The onboarding flow may offer a calculator that suggests a ratio from two salary figures, but only the resulting ratio is persisted.

### 7.3 Effective dating

Contribution config is versioned with `effective_from`. Changes take effect from the **start of the next period**, never mid-period.

Rationale: a single month split across two ratios is confusing to explain in the UI and produces settlement numbers neither partner can verify by hand. Deferring to the next period costs nothing in accuracy and a great deal in clarity.

Historical periods always compute using the config version active during that period.

### 7.4 Balance behaviour: rolling, with optional close

The running balance **carries forward indefinitely** until money actually changes hands. There is no automatic monthly reset.

Either partner may **close a period**, which:
- Snapshots the computed balance and the config version used
- Locks all transactions dated within that period against edit or delete
- Optionally records the settlement transfer that squared it

**Back-dated entries into a closed period** are permitted but do not mutate history. They generate an **adjustment** in the current open period, clearly labeled with its original date. Reopening a closed period is possible but requires confirmation and is logged.

### 7.5 Calculation

For an open balance across all unsettled periods:

```
For each period P with active config C:
  household_total(P)   = Σ household transactions in P
  expected_share(X, P) = household_total(P) × C.share(X)     [ratio/equal]
                       = C.fixed_amount(X)                    [fixed]
  actual_paid(X, P)    = Σ household transactions in P where payer = X
                         (joint-method transactions contribute
                          each partner's ratio share to that partner)

  household_delta(X)   = actual_paid(X, P) − expected_share(X, P)

partner_delta(X) = Σ reimbursable partner expenses X paid for the other
                 − Σ reimbursable partner expenses the other paid for X

balance(X) = Σ_P household_delta(X, P) + partner_delta(X)
           − Σ settlement transfers X received
           + Σ settlement transfers X sent
           ± refund adjustments
```

Positive balance = owed money. The displayed result is always a single sentence: *"Ankit owes you ₹3,240."*

### 7.6 Rounding

Ratio splits are rounded to the nearest **whole rupee**. Any remainder is assigned to the higher-contributing partner. Rounding is applied at the period level, not per transaction, to prevent accumulated drift.

### 7.7 Fixed-contribution semantics

The fixed model must behave differently from the ratio model, or it has no reason to exist. Splitting the overspend by the same proportions as the commitments produces mathematically identical results to a ratio split, so:

- **Household spends more than the committed total** — each partner covers their commitment in full, and the excess above it is split **equally** on top. In plain language: *"we each put in our number, and whatever it runs over we split down the middle."*
- **Household spends less than the committed total** — commitments scale down proportionally. There is no shared pot in this product for a surplus to sit in, so expecting one partner to "owe" money that went nowhere would be wrong.

---

## 8. Period Definition

The settlement period is a **month with a configurable start day** (default: 1st).

Rationale: many Indian households budget salary-date to salary-date. A household earning on the 28th thinks in 28th–27th months, and forcing calendar months makes every number feel slightly wrong.

---

## 9. Categories

Optional, always. Never blocks saving a transaction.

Defaults: Groceries, Rent, Fuel, Dining, Utilities, Shopping, Travel, Healthcare, Entertainment, Subscription, Education.

Users can create custom categories. Categories apply to all transaction types. Category is **inferred from merchant history** when a known merchant is entered, and pre-filled — the user can ignore or change it.

---

## 10. Entry Experience

Target: **under 10 seconds, under 4 taps, for a typical transaction.**

Flow:
1. Tap **+** → numeric keypad opens immediately, cursor in amount
2. Type amount
3. Tap a type chip: `Personal` · `Household` · `For Ankit · gift` · `For Ankit · owes me`
4. Save

Everything else is optional and reachable without leaving the screen:
- **Date** defaults to today; yesterday is one tap
- **Payer** defaults to the current user
- **Merchant** autocompletes from history; recent merchants appear as chips
- **Category** pre-filled from merchant history when known
- **Payment method** defaults to last used

**Quick-add chips** on the home screen for the user's 3–4 most frequent transaction shapes (e.g. "Groceries · Household · GPay"), reducing common entries to amount + one tap.

---

## 11. Dashboard

Current period, at a glance:

- **Settlement headline** — one sentence, largest element on screen: *"Ankit owes you ₹3,240"*
- Household spending / Your personal / Their personal / Total
- Contribution progress — actual vs. expected, per person, as a bar
- Recent transactions (both partners, with attribution)
- Monthly spending trend
- Top categories

---

## 12. Reports

Filter by: period, person, transaction type, category, payment method, merchant.

Views: Household only · Personal (per person) · Partner · Combined.

Every report is exportable to CSV.

---

## 13. Search

Full-text and structured search across: merchant, notes, category, amount (and amount ranges), date (and date ranges), person, payment method.

---

## 14. Editing and Deletion

- Every transaction editable, including by the partner who did not create it. Couples share money; permission walls create friction and solve nothing.
- Every edit and delete writes to the **audit log**, showing who changed what and when.
- Deletion requires confirmation and is a soft delete.
- Transactions in a **closed period are locked** until the period is reopened.

The audit log is a relationship feature, not an engineering one. It resolves "I definitely entered that" without either partner having to be right from memory.

---

## 15. Engagement

The primary failure mode of a two-person expense app is **one partner quitting**, at which point the other partner's numbers are not merely incomplete but actively wrong. This is treated as a product requirement, not a growth concern.

MVP:
- Push notification on partner activity
- Weekly summary notification, including relative logging activity
- The app must remain useful to a single user whose partner has disengaged — personal tracking and reports work standalone, and settlement degrades gracefully rather than showing a confidently wrong number

---

## 16. Explicitly Out of Scope for MVP

Designed for in the schema, built later:

- Automatic import (SMS, notifications, email parsing, statements, UPI/bank APIs) — all future sources create transactions through the same model with a `source` field
- Recurring expenses — schema supports a recurrence template; MVP has no generator
- Attachments / receipt images
- Budgets, savings goals, net worth
- Multi-currency
- More than two household members
- Partial and multi-way transaction splits — **table exists, UI does not**

---

## 17. Language Guidelines

The app must never surface accounting terminology. Enforced substitutions:

| Never say | Say |
|---|---|
| Reconciliation | Who owes whom |
| Debit / Credit | Paid / Received |
| Ledger, Journal | History |
| Liability, Receivable | You're owed / You owe |
| Reimbursement | They owe you |
| Contribution variance | You've paid ₹X more than your share |

---

## Open Items for Architecture Phase

1. Database and hosting choice (Postgres + row-level security is the assumed default)
2. Auth provider selection
3. Push notification delivery on iOS PWA — known platform limitation, needs a fallback plan
4. Offline entry and sync queue — likely required given the mobile entry goal
5. Recurring-expense schema shape, even though unbuilt
