# Vault — Family Cash Flow Manager
## System Constitution & Engineering Guidelines

This document governs the architecture, data integrity rules, security principles, and coding standards for the Vault codebase. All contributors, pair-programming sessions, and AI agents must strictly uphold these rules.

---

### 1. Fundamental Financial Invariants (Non-Negotiable)

1. **Integer Paise Representation (Zero Float Tolerance)**:
   - Money is **ALWAYS** stored and calculated as an integer representing paise (1 INR = 100 paise; e.g., ₹250.50 is stored as `25050`).
   - Floating-point numbers are strictly forbidden for currency amounts in databases, calculations, and APIs.
   - Conversions to rupee strings (e.g. "₹250.50") happen strictly at the presentation layer using formatted helpers.

2. **Immutable Ledger (No Direct Balance Editing)**:
   - Bucket balances are never mutated manually or directly updated via arbitrary `PATCH` requests.
   - Balances change exclusively via recorded transactions.

3. **No Hard Deletes (Append-Only Accounting)**:
   - Financial entries are never deleted from the database.
   - Erroneous entries are **voided** by creating an opposite reversing transaction linked to the original entry (`status: "voided"`, `reversalOf: originalId`).

4. **ACID Transactions via MongoDB Sessions**:
   - Every multi-step financial operation (transfers, split income, debt settlements, void reversals) must execute inside a MongoDB transaction session (`session.withTransaction`).
   - If any step fails, the entire operation is rolled back.

5. **Bucket Constraints & Negative Balance Protections**:
   - `cash` and `bank` buckets can **never** go below 0 paise.
   - In transfers, `fromBucketId` and `toBucketId` must be distinct.
   - Archived buckets (`isArchived: true`) cannot participate in any new transactions.

6. **Transfers Excluded from Income/Expense Reports**:
   - Transfers represent internal movements between household buckets. They must be explicitly excluded from income and expense aggregates to prevent inflated cash-flow metrics.

7. **Creator-Only Mutation Privileges**:
   - Only the user who created a transaction can void or edit its metadata (such as note/purpose).
   - The partner has read-only access to shared transactions.

---

### 2. Backend-Enforced Privacy & Masking

Privacy is enforced at the **query and service layer**, never solely hidden in the frontend UI.

Each bucket belongs to one of three privacy levels:
- **`shared`**: Partner has full visibility over the bucket, its balance, and all associated transactions.
- **`balance_only`**: Partner can see the bucket and its current balance, but **zero** transactions, categories, notes, comments, or notifications.
- **`private`**: Completely invisible to the partner. Excluded from partner queries and reports.

**Masking Invariant for Transfers**:
When a transfer involves a `shared` bucket and a `private`/`balance_only` bucket, the partner must only see that money entered or left the shared bucket—the hidden bucket's name, type, and details must be masked as `"Protected Bucket"` / `"External"`.

---

### 3. Architecture & Code Structure

The repository is structured as an npm workspaces monorepo:
```
vault/
├── client/          # Next.js (App Router, Tailwind CSS, TanStack Query, React Hook Form)
├── server/          # Node.js, Express, Mongoose, TypeScript
├── shared/          # Single source of truth: Zod schemas & inferred TypeScript types
├── AGENTS.md        # Project constitution (this file)
└── package.json     # Workspaces configuration
```

#### Server Layering:
Strict separation of concerns must be maintained:
`routes -> controllers -> services -> models`
- **Routes**: Define HTTP endpoints, attach auth middleware, and mount controllers.
- **Controllers**: Parse requests, execute Zod validation, pass validated data to services, and send HTTP responses.
- **Services**: Contain pure business logic, database transaction sessions, financial calculations, and privacy masking.
- **Models**: Mongoose schemas enforcing schema-level constraints and indexes.

#### Client Principles (Next.js App Router):
- **Server Components by Default**: Pages and layout fetch data on the server when possible.
- **Use `"use client"` sparingly**: Only for interactive components (forms, modals, interactive charts, state hooks).
- **Forms**: React Hook Form paired with `@hookform/resolvers/zod` using schemas from `@vault/shared`.

---

### 4. TypeScript & Validation Standards

- **Strict TypeScript**: `noImplicitAny: true`, `strictNullChecks: true`.
- **Zero `any` Policy**: Never use `any`. Use `unknown` with type guards or strict generic constraints where dynamic typing is required.
- **Single Source of Truth**:
  - Define data schemas once using **Zod** in `@vault/shared`.
  - Infer TypeScript types using `z.infer<typeof Schema>`.
  - Share these schemas seamlessly across both `server/` (runtime API validation) and `client/` (form validation & query typings).

---

### 5. Development & Testing Discipline

- Work in small, verifiable steps.
- For each new feature or milestone provide:
  1. Typed, clean, readable code with exact file paths.
  2. Postman / curl reproduction steps for manual testing.
  3. Automated Jest tests verifying money logic and privacy masking.
  4. Concise Git commit message and verification checklist.
