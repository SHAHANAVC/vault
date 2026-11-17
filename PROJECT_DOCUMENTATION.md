# VAULT — Family Finance & Cash Flow Management Platform
## Comprehensive Technical Documentation & Project Report

---

## 1. Executive Summary

### 1.1 Project Title
**Vault — Collaborative Family Cash Flow Management Platform**

### 1.2 Problem Statement
Traditional personal finance tools are designed either for single individuals (ignoring married life and shared responsibilities) or for corporate accounting (overly complex with double-entry ledgers). Families in regions like India commonly manage multi-pocket finances comprising:
- Physical cash in hand and wallet
- Bank savings and checking accounts
- Rotating community savings (Kuri / Chit funds)
- Fixed liabilities and loans (Laptop EMI, vehicle loans, personal debt)
- Jewellery gold savings schemes
- Dedicated future/medical emergency reserves

Conventional applications fail to represent these diverse instruments, lack partner privacy tiers, suffer from floating-point rounding errors, and do not provide collaborative family visibility.

### 1.3 Solution
**Vault** is a modern, high-precision, collaborative fintech web platform built specifically for couples and families. It replaces manual spreadsheets with a digital envelope system (Financial Buckets), automated payment schedulers (Plans & Commitments), real-time category breakdowns, and cryptographic partner collaboration with backend-enforced privacy levels.

---

## 2. Technology Stack & Tools

### 2.1 Frontend (Client Application)
- **Framework:** Next.js (App Router, Server Components & Client Hooks)
- **Language:** TypeScript 5.6 (Strict typing with zero `any` policy)
- **Styling & Design System:** Tailwind CSS with CSS Variables for seamless Light & Dark mode support
- **State & Server Cache Management:** TanStack Query (React Query) with automatic cache invalidation
- **Form Handling & Validation:** React Hook Form integrated with `@hookform/resolvers/zod`
- **Iconography:** Lucide React

### 2.2 Backend (Server Application)
- **Runtime Environment:** Node.js (v20+)
- **Framework:** Express.js (Modular route-controller-service-model layering)
- **Language:** TypeScript
- **Database ODM:** Mongoose (v8+) & Native MongoDB Driver
- **Authentication & Security:**
  - JSON Web Tokens (`jsonwebtoken`)
  - HTTP-Only, Secure, SameSite Cookies
  - Password Hashing with Bcrypt.js (Salt factor 12)
  - Helmet for security headers and rate limiting (`express-rate-limit`)

### 2.3 Shared Workspace (`@vault/shared`)
- **Package Architecture:** npm workspaces monorepo (`client/`, `server/`, `shared/`)
- **Validation Engine:** Zod
- **Type Inference:** Automatic single-source-of-truth TypeScript types inferred via `z.infer<typeof Schema>` across both frontend forms and backend REST controllers.

### 2.4 Database & Cloud Infrastructure
- **Database:** MongoDB Atlas (Cloud NoSQL Multi-region Cluster) with replica-set support for ACID transactions
- **Frontend Hosting:** Vercel (Edge network, automated CI/CD directly from GitHub `main` branch)
- **Backend Hosting:** Render (Cloud Web Service)
- **DevOps & Availability:** Cron-Job.org (Automated 10-minute HTTP keep-alive ping preventing cold starts)
- **Version Control:** Git & GitHub (`SHAHANAVC/vault`)
- **Automated Testing:** Jest, Supertest, MongoMemoryReplSet (for in-memory ACID testing)

---

## 3. Fundamental Financial & Architectural Invariants

1. **Integer Paise Precision (Zero Float Tolerance):**
   - Floating-point arithmetic in software leads to inaccuracies (e.g. `0.1 + 0.2 = 0.30000000000000004`).
   - In Vault, all monetary amounts are calculated and stored strictly as integers representing **paise** (1 INR = 100 paise; e.g. ₹250.50 is stored as `25050`).
   - Conversion to formatted rupee strings (e.g., `₹250.50`) occurs purely at the presentation layer.

2. **Immutable Append-Only Ledger:**
   - Account balances cannot be modified directly via arbitrary `PATCH` requests.
   - Balances change exclusively through verified, recorded transactions.
   - Erroneous entries are never hard-deleted; they are voided by creating linked opposite reversal entries (`status: "voided"`, `reversalOf: originalId`).

3. **Multi-Document ACID Transactions:**
   - Financial operations that span multiple entities (e.g., transferring ₹5,000 from Bank to Kuri) execute inside MongoDB transactions (`session.withTransaction`).
   - If any step fails, all balance changes are automatically rolled back.

4. **Negative Balance Protections:**
   - `cash` and `bank` buckets can never be driven below 0 paise.
   - Internal transfers require distinct source and destination accounts.

5. **Exclusion of Internal Transfers from Cash Flow Metrics:**
   - Moving money from a bank account to a savings bucket or EMI is an internal transfer, not a household expense.
   - Transfers are strictly excluded from income and expense aggregates to prevent artificially inflated cash-flow figures.

6. **Backend-Enforced Privacy & Masking:**
   - Buckets support three visibility levels: `shared`, `balance_only`, and `private`.
   - Private buckets are excluded or masked at the MongoDB query and service layer, ensuring confidential financial data never leaves the server.

---

## 4. Key Functional Modules

```
                    ┌─────────────────────────┐
                    │      Vault Platform     │
                    └────────────┬────────────┘
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│   Auth & Pairs   │   │ Financial Buckets│   │   Transactions   │
│ • Secure JWT     │   │ • Cash & Bank    │   │ • + Income       │
│ • Partner Invite │   │ • Kuri & Gold    │   │ • - Expense      │
│ • 3-Tier Privacy │   │ • Loan EMI       │   │ • ⇄ Transfer     │
└──────────────────┘   └──────────────────┘   └──────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │   Plans & Commitments   │
                    │ • Due Date Reminders    │
                    │ • Shortfall Alerts      │
                    │ • One-Click Payments    │
                    │ • Full Plan Editing     │
                    └─────────────────────────┘
```

### 4.1 Authentication & Household Onboarding
- **Password Visibility:** Toggle button with eye icon for show/hide state.
- **Explicit Credential Feedback:** Distinct error messages for non-existent emails (`Email does not exist`) vs incorrect passwords (`Incorrect password`).
- **Partner Pairing:** Single-use invitation links (valid for 7 days) allowing the spouse to join the household with atomic verification (maximum 2 partners per household).

### 4.2 Financial Buckets (Digital Envelopes)
- Supports 6 distinct account classifications:
  1. **Cash:** Physical cash and wallet money.
  2. **Bank Account:** Savings and current accounts.
  3. **Kuri (Chit Fund):** Rotating accumulated monthly savings.
  4. **Gold Scheme:** Jewellery gold savings accumulation.
  5. **Loan Taken (Liability/Debt):** Outstanding loans and EMIs (reduces to ₹0 as payments occur).
  6. **Loan Given (Asset/Receivable):** Money lent to others.
- **Initial Opening Balance:** Input field allowing users to establish existing balances or debts upon creation.
- **Adaptive Modal UX:** Fixed header and footer with internal scrollbar, ensuring buttons and titles never get cut off on small laptop screens.
- **Wheel Scroll Protection:** Number inputs disable spin-arrows and ignore accidental mouse-wheel scroll events.

### 4.3 Transactions Engine
- **Income Logging (`+ Income`):** Records inflows (Salary, Business, Kuri Payout / Auction).
- **Expense Tracking (`- Expense`):** Granular tracking with smart categories (`Groceries`, `Food & Dining`, `Rent`, `Utilities`, `Transportation`, `Shopping`, `Healthcare`, `Kuri / Chitty`, `EMI / Loan`, `Gold Scheme`, `Entertainment`, `Miscellaneous`).
- **Internal Transfers (`⇄ Transfer`):** Moves funds seamlessly between accounts (e.g., Bank → Cash, Bank → Kuri, Bank → Laptop EMI).
- **Date Filtering:** Embedded inline calendar picker with a one-click `Today` toggle for instant daily accounting.

### 4.4 Plans & Commitments (Smart Recurring Scheduler)
- Manages fixed-term commitments (EMIs, Kuri chits, Gold schemes).
- **Automated Scheduling:** Automatically calculates due dates, installment progress, and completion percentages.
- **Balance-Aware Shortfall Alerts:** Warns the family if the linked bank account lacks sufficient balance before an upcoming due date.
- **One-Click Execution:** Inline `Pay Installment`, `Record Kuri Payout`, and `Redeem Gold` actions.
- **Plan Modification (`Edit Plan`):** Allows users to edit plan titles, payment source accounts, due days (1–31), alert lead times (1–7 days), and notes.

---

## 5. Deployment & Reliability Setup

- **Frontend:** Deployed to Vercel production at `fam-cashflow-vault.vercel.app`.
- **Backend:** Deployed to Render cloud service at `https://vault-2q1r.onrender.com`.
- **24/7 Keep-Alive Architecture:** Configured an automated cron job on Cron-job.org sending an HTTP `GET /health` request every 10 minutes. This eliminates Render free-tier idle spin-down and guarantees zero cold-start latency for all family members.
- **Git Repository:** Single monorepo maintained on GitHub at `https://github.com/SHAHANAVC/vault.git`.

---

## 6. Summary of Key Achievements
- **Zero Float Calculation Errors:** Strict integer arithmetic in paise.
- **Guaranteed Data Consistency:** ACID transaction rollbacks on failures.
- **Partner Privacy Freedom:** Discretionary shared vs private envelope visibility.
- **Real-World Regional Fit:** Dedicated first-class support for Kuri chits, gold schemes, and loan paydowns.
- **Resilient Cloud Uptime:** Production-ready CI/CD with automated health monitoring.
