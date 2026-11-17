# Vault — Collaborative Family Cash Flow Manager

A high-precision, collaborative fintech web application built specifically for couples and families. Vault replaces spreadsheets with a digital envelope system (Financial Buckets), automated payment schedulers (Plans & Commitments), smart category breakdowns, and cryptographic partner collaboration with backend-enforced privacy levels.

<!-- Screenshots: Add screenshots to docs/ (e.g., docs/dashboard.png) -->

<!-- Demo login: replace with your credentials -->

---

## Features

- **Financial Buckets (Digital Envelopes):**
  - First-class support for diverse household accounts: **Cash**, **Bank Accounts**, **Kuri (Chit Funds)**, **Gold Schemes**, **Loan Taken (EMIs/Liabilities)**, and **Loan Given (Assets/Receivables)**.
  - Starting balance configuration and negative balance protection for cash/bank accounts.
- **Transactions & Cash Flow Tracking:**
  - Record **Incomes**, **Expenses**, and **Transfers**.
  - Internal transfers between buckets are strictly excluded from income/expense reports to prevent artificial cash-flow inflation.
  - Support for split transfers, income allocation, and transaction reconciliation.
- **Plans & Commitments (Smart Recurring Scheduler):**
  - Track fixed-term commitments (EMIs, monthly Kuri chits, jewellery gold schemes) with automated due dates and installment tracking.
  - **Balance-Aware Shortfall Alerts:** Proactively alerts the household if the source bank account balance cannot cover upcoming payments.
  - One-click actions for installment payments, chit payouts, and gold redemptions.
  - Full plan editing (title, source account, due day, alert lead time, and notes).
- **Household Collaboration & Privacy:**
  - Single-use invite links (7-day validity) for seamless partner onboarding.
  - Granular privacy tiers per bucket (`shared`, `balance_only`, and `private`).
- **Responsive UI & Themes:**
  - Full support for Light and Dark modes with Tailwind CSS variables.
  - Keyboard- and trackpad-safe inputs with wheel-scroll protection and viewport-adaptive modals.

---

## Tech Stack

- **Monorepo Architecture:** npm workspaces (`client/`, `server/`, `shared/`).
- **Frontend (`@vault/client`):** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, TanStack Query v5, React Hook Form, `@hookform/resolvers/zod`, Lucide React, Recharts.
- **Backend (`@vault/server`):** Node.js (v20+), Express 4, TypeScript, Mongoose 9, MongoDB Driver 7.
- **Shared (`@vault/shared`):** Zod schema validation & inferred TypeScript types shared between client and server.
- **Testing:** Jest, Supertest, `mongodb-memory-server` (`MongoMemoryReplSet` for real in-memory ACID transaction testing).
- **Security:** HTTP-only SameSite cookies, JWT, Bcrypt.js (salt rounds: 12), Helmet, Express Rate Limit.

---

## Key Engineering Decisions

1. **Integer Paise Representation (Zero Float Tolerance):**
   - Currency is calculated and stored strictly as integers representing paise (1 INR = 100 paise; ₹250.50 is stored as `25050`).
   - Completely eliminates floating-point arithmetic rounding errors. Formatting to rupees occurs strictly at the presentation layer.
2. **Immutable Append-Only Ledger:**
   - Account balances are never directly modified via arbitrary updates. Balances update exclusively through verified transaction records.
   - Financial entries are never hard-deleted; mistaken transactions are voided by creating linked reversing entries (`status: "voided"`, `reversalOf: originalId`).
3. **Multi-Document ACID Transactions:**
   - Multi-step operations (transfers, split allocations, plan executions, void reversals) execute inside MongoDB transaction sessions (`session.withTransaction`). Any failure triggers a clean, atomic rollback.
4. **Backend-Enforced Privacy & Masking:**
   - Enforced at the MongoDB query and service layer—never solely hidden on the client.
   - Buckets support three visibility levels:
     - `shared`: Both partners have full access to balance and transactions.
     - `balance_only`: Partner sees current balance only; transactions and notes are hidden.
     - `private`: Entirely invisible to the partner; excluded from queries and masked in transfer histories.
5. **Transfers Excluded from Income/Expense Aggregates:**
   - Moving funds between household pockets (e.g., Bank to Kuri or Bank to EMI) represents internal cash movement, not external income or expense.
6. **Creator-Only Mutation Privileges:**
   - Only the creator of a transaction or plan can edit metadata or execute voiding.
7. **Single Source of Truth Validation:**
   - Zod schemas in `@vault/shared` validate API payloads at runtime on the server and validate form inputs on the client.

---

## Repository Structure

```
vault/
├── client/          # Next.js App Router frontend (@vault/client)
├── server/          # Express.js REST API server (@vault/server)
├── shared/          # Shared Zod schemas & TypeScript types (@vault/shared)
├── docs/            # Screenshots and project documentation assets
├── package.json     # Root npm workspaces configuration
└── AGENTS.md        # System constitution & engineering guidelines
```

---

## Running Locally

### Prerequisites

- **Node.js:** v20.x or higher
- **npm:** v10.x or higher
- **MongoDB:** MongoDB Atlas cluster or a local MongoDB replica set (required for multi-document ACID transactions).

### 1. Clone & Install Dependencies

From the repository root:

```bash
git clone https://github.com/SHAHANAVC/vault.git
cd vault
npm install
```

### 2. Environment Variables

Create `.env` in `server/` and `.env.local` in `client/` using the provided templates:

#### Server Configuration (`server/.env`)

```env
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:3000
MONGO_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/vault?retryWrites=true&w=majority
JWT_SECRET=replace_with_a_secure_random_secret_at_least_32_characters_long
JWT_EXPIRES_IN=7d
```

#### Client Configuration (`client/.env.local`)

```env
SERVER_URL=http://localhost:5000
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

### 3. Run Development Servers

Start both the backend server and frontend client concurrently:

```bash
npm run dev
```

Or run individual services:

```bash
# Start backend server only (port 5000)
npm run dev -w @vault/server

# Start frontend client only (port 3000)
npm run dev -w @vault/client
```

- **Client:** [http://localhost:3000](http://localhost:3000)
- **Server:** [http://localhost:5000](http://localhost:5000)
- **Health Check:** [http://localhost:5000/health](http://localhost:5000/health)

---

## Build, Test & Lint Scripts

Run scripts across all workspaces from the repository root:

```bash
# Typecheck all workspaces
npm run typecheck

# Build shared package, server, and client
npm run build

# Run automated tests (runs Jest with in-memory replica set for server)
npm test

# Run tests specifically for the server
npm run test -w @vault/server

# Code formatting and linting
npm run lint
npm run format:check
```

---

## License

Private / Proprietary. Built for family cash flow management.
