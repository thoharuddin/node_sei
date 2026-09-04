# Stock Opname System

A production-shaped **physical inventory audit (stock opname)** system: products and locations,
an immutable stock movement ledger with a current-stock cache, audit programs and assignments,
multiple staff counting sessions per assignment, manager comparison and review, and
approval-driven stock adjustments — all with database-level integrity, transactions,
role-based access control and an audit trail.

The design (ERD, schema, state machines, stock flow, API, authorization matrix, transaction
boundaries) is documented in **[docs/01-DESIGN.md](docs/01-DESIGN.md)** and was written before
the implementation.

---

## 1. Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js 20+ / Express 4 (CommonJS, modular controller → service → repository) |
| Database | PostgreSQL 14 (hand-written SQL migrations: CHECK constraints, partial unique indexes, generated column, integrity triggers, a consistency view) |
| ORM | Prisma 6 (`prisma migrate deploy` over the SQL migrations) |
| API | REST, JSON, `{ data, meta }` / `{ error: { code, message } }` |
| Auth | JWT (`jsonwebtoken`) + bcrypt password hashing (`bcryptjs`) |
| Validation | zod (body / query / params, whitelisted and coerced) |
| Async work | BullMQ + Redis (asynchronous stock reconciliation worker, Phase 7) |
| Tests | Jest + supertest against a dedicated test database (96 tests) |
| Frontend | Next.js 14 (App Router) + Tailwind CSS |

---

## 2. Repository layout

```
.
├── docs/01-DESIGN.md          # ERD, schema, state machines, API, authz matrix, transactions
├── backend/
│   ├── prisma/
│   │   ├── migrations/        # hand-written SQL schema (source of truth)
│   │   ├── schema.prisma      # mirrors the database for Prisma Client
│   │   └── seed.js            # 20 products, 5 locations, 4 users, opening stock
│   ├── src/
│   │   ├── app.js  server.js  worker.js
│   │   ├── config/            # env loading (.env / .env.test)
│   │   ├── database/          # Prisma client + transaction helper
│   │   ├── middleware/        # auth (JWT + role gates), zod validation, error mapping
│   │   ├── modules/
│   │   │   ├── auth/  users/  products/  locations/  stock/
│   │   │   └── audit/         # programs · assignments · sessions · items · adjustments
│   │   ├── queue/             # BullMQ queue + reconciliation worker
│   │   ├── routes/            # route table
│   │   ├── services/          # audit scope resolver (product/location → items)
│   │   └── utils/             # errors, serializers, pagination
│   └── tests/                 # jest + supertest suites
└── frontend/
    ├── app/                   # login, dashboard, products, audit-*, master-data
    ├── components/            # nav + shared UI (table, modal, badge, confirm dialog)
    └── lib/                   # REST client, auth context, formatters
```

---

## 3. Prerequisites

* **Node.js** ≥ 20 (developed on 22)
* **PostgreSQL** ≥ 12 (developed on the local PostgreSQL 14 at `/Library/PostgreSQL/14`)
* **Redis** (only for `STOCK_POSTING_MODE=async`; `brew services start redis`)

Everything runs locally — no Docker.

---

## 4. Setup

### 4.1 Databases

```bash
/Library/PostgreSQL/14/bin/psql -U postgres -c "CREATE DATABASE stock_opname_sei;" -c "CREATE DATABASE stock_opname_sei_test;"
```

> A database named `stock_opname` may already exist on this machine from unrelated work; this
> project deliberately uses `stock_opname_sei` and `stock_opname_sei_test`.

### 4.2 Backend

```bash
cd backend
npm install
cp .env.example .env      # adjust DATABASE_URL / JWT_SECRET if needed
npm run migrate           # prisma migrate deploy — applies the SQL schema
npm run seed              # 20 products, 5 locations, 4 users, opening stock
npm run dev               # http://localhost:4000
```

`.env` knobs:

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | API port (default 4000) |
| `CORS_ORIGIN` | allowed browser origin(s), default `http://localhost:3000` |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | token signing |
| `BCRYPT_ROUNDS` | password hashing cost |
| `STOCK_POSTING_MODE` | `sync` = stock posted inside the approval transaction · `async` = posted by the worker |
| `REDIS_URL`, `QUEUE_PREFIX` | BullMQ connection |

### 4.3 Reconciliation worker (only for `STOCK_POSTING_MODE=async`)

```bash
cd backend
npm run worker
```

With `async`, `POST /audit-sessions/:id/approve` returns immediately (~30 ms) and the bulk
`stock_quant` / `stock_balance` writes are done by this worker. If Redis is unreachable the
approval falls back to posting inline, so correctness never depends on the queue.

### 4.4 Frontend

```bash
cd frontend
npm install
cp .env.example .env.local     # NEXT_PUBLIC_API_URL=http://localhost:4000/api
npm run dev                    # http://localhost:3000
```

### 4.5 Seeded accounts

| Username | Password | Role |
|---|---|---|
| `manager` | `manager123` | manager |
| `budi` | `staff123` | staff |
| `andi` | `staff123` | staff |
| `candra` | `staff123` | staff |

Seeded master data: 20 products (`SKU001`…`SKU020`), locations `WH → WH-STOCK → RACK-A/B/C`,
and opening stock spread over the racks (several SKUs deliberately exist in more than one rack).

---

## 5. Tests

```bash
cd backend
npm test
```

96 tests over 9 suites, run against `stock_opname_sei_test` with `STOCK_POSTING_MODE=sync`
(migrations are applied automatically by the Jest global setup):

| Suite | Covers |
|---|---|
| `auth.test.js` | login, JWT contents, hashed passwords, tampered/expired tokens, instant revocation on deactivation |
| `authorization.test.js` | the full role matrix, cross-staff isolation, anonymous access |
| `master-data.test.js` | product quantity aggregation, unique keys, soft vs hard delete, location tree/cycles, user rules |
| `stock.test.js` | ledger + cache in one transaction, transfers, negative guard, append-only enforcement, rollback, 10 concurrent postings |
| `audit-assignment.test.js` | program lifecycle, product/location scope constraints (API + database), scope freeze, dashboard counters |
| `audit-session.test.js` | item generation, snapshot immutability, duplicate/concurrent start, multiple sessions, editing + change trail, submit freeze |
| `audit-approval.test.js` | comparison, approval transaction, zero differences skipped, sibling auto-rejection, idempotent and concurrent approval, injected-failure rollback, traceability |
| `reconciliation-worker.test.js` | async posting, redelivered job no-op, concurrent jobs, failure marking, retry |
| `end-to-end.test.js` | the full scenario of the requirement, through the public API only |

---

## 6. Core model

```
audit_program → audit_assignment → audit_session → audit_session_item
                                          ↓
                                  stock_adjustment → stock_quant → stock_balance
```

* **`stock_quant` is the immutable ledger.** A database trigger rejects `UPDATE`/`DELETE`;
  corrections are new movements. Current stock is conceptually `SUM(quantity)` grouped by
  product and location.
* **`stock_balance` is a cache** with `UNIQUE(product_id, location_id)`. It is only ever
  written by one funnel (`stock.repository.postMovements`) in the same transaction as the
  ledger rows that move it. `GET /api/stock/consistency` proves `balance == ledger` from a SQL
  view.
* **`audit_session_item.system_quantity` is a snapshot** taken when the session starts; later
  movements never change it. `difference` is a `GENERATED ALWAYS AS (counted − system) STORED`
  column, so the arithmetic belongs to the database.
* **Assignments** carry array targets and a CHECK constraint: a `product` assignment has
  product ids only, a `location` assignment has location ids only. A location assignment
  expands over the whole location subtree; a product assignment expands over every location
  holding that product — quantities of different locations are never merged.
* **One approved session per assignment** and **one stock adjustment per session** are
  enforced by a partial unique index and a unique constraint respectively.

### Approval (one transaction)

lock session → verify `submitted` and not already approved → validate items → create the
single `stock_adjustment` → post `stock_quant` rows for non-zero differences → move
`stock_balance` → mark `approved` with `approved_by`/`approved_at` → auto-reject the sibling
sessions → close the assignment → commit. Any failure rolls everything back; a repeat request
is idempotent and posts nothing twice (row lock + `UNIQUE(audit_session_id)` +
`posting_status` guard).

---

## 7. API

Base URL `http://localhost:4000/api`. All endpoints except `POST /auth/login` require
`Authorization: Bearer <jwt>`; roles are enforced in the backend.

| Method | Path | Role |
|---|---|---|
| POST | `/auth/login` · GET `/auth/me` | public · any |
| GET POST | `/users` | manager |
| GET PUT DELETE | `/users/:id` | manager (DELETE = deactivate) |
| GET | `/products` · `/products/:id` · `/products/:id/stock` | any |
| POST PUT DELETE | `/products` · `/products/:id` | manager (DELETE = soft) |
| GET | `/locations` (`?tree=1`) · `/locations/:id` | any |
| POST PUT DELETE | `/locations` · `/locations/:id` | manager (DELETE = soft) |
| GET | `/stock` · `/stock/:productId/:locationId` · `/stock/movements` · `/stock/movements/:id` | any |
| GET | `/stock/consistency` | manager |
| POST | `/stock/movements` · `/stock/transfers` | manager |
| GET POST | `/audit-programs` | any (staff: assigned only) · manager |
| GET PUT | `/audit-programs/:id` · GET `/audit-programs/:id/dashboard` | any · manager |
| GET POST | `/audit-programs/:id/assignments` | any · manager |
| GET | `/audit-assignments` · `/audit-assignments/:id` | any (scoped) |
| GET | `/audit-assignments/my` | staff |
| GET | `/audit-assignments/:id/comparison` | manager |
| PUT | `/audit-assignments/:id` | manager |
| POST | `/audit-assignments/:id/start` | staff (must be assigned) |
| GET | `/audit-sessions` · `/audit-sessions/:id` · `/audit-sessions/:id/items` | manager · owning staff |
| PUT POST | `/audit-sessions/:id/items` | owning staff (draft) · manager (before approval) |
| POST | `/audit-sessions/:id/submit` | owning staff |
| POST | `/audit-sessions/:id/approve` · `/reject` · `/reopen` | manager |
| PUT GET | `/audit-session-items/:id` · `/audit-session-items/:id/logs` | as above |
| GET | `/stock-adjustments` · `/stock-adjustments/:id` | manager |
| POST | `/stock-adjustments/:id/retry-posting` | manager |
| GET | `/health` | public |

Quick smoke test:

```bash
curl -s -X POST localhost:4000/api/auth/login -H 'content-type: application/json' -d '{"username":"manager","password":"manager123"}'
```

---

## 8. UI walkthrough

**Manager** — Dashboard (programs with assignments / sessions / submitted / approved /
pending review) → Audit Program → *Assignments* tab (create a product or location assignment
for several staff) → *Sessions* tab → assignment page with the side-by-side comparison:

```
Product   Location   System   Budi (#2)   Andi (#3)
SKU001    RACK-A       100      98 (-2)     100 (0)     differs
SKU002    RACK-A        50      50 ( 0)      49 (-1)    differs
SKU003    RACK-A        20      25 (+5)      24 (+4)    differs

[Approve Budi's session]  [Approve Andi's session]  [Reject all]
```

Approving posts the stock adjustment and auto-rejects the other sessions. Managers can also
edit a submitted session's counts (with a reason) and inspect each item's change history.

**Staff** — My Assignments → **Start Audit** (items generated automatically from the
assignment scope) → counting sheet:

```
Product   System Qty   Counted Qty   Difference
SKU002        18          [ 16 ]        -2
SKU013        80          [ 83 ]        +3

[Save]  [Submit Audit]
```

After submission the session is read-only for staff.

**Products** — the list shows each product's total quantity; clicking it opens the
per-location balances plus the read-only `stock_quant` movement history, where every audit
adjustment links back to its stock adjustment, audit session, program and counting staff.

---

## 9. Git history

The work is committed phase by phase on `main`:

| Commit | Contents |
|---|---|
| `docs: system design` | ERD, schema, relationships, state transitions, stock flow, API, authorization matrix, transaction boundaries |
| `Phase 1` | PostgreSQL schema, constraints, indexes, migrations, seed data |
| `Phase 2` | JWT authentication, password hashing, role-based authorization |
| `Phase 3` | Products, locations and users management |
| `Phase 4` | Stock ledger, balance cache, transactional movement posting |
| `Phase 5` | Audit programs, assignments, sessions, automatic item generation, counting, submit |
| `Phase 6` | Comparison, manager editing, approve, reject, stock adjustment generation |
| `Phase 7` | Non-blocking approval via the BullMQ reconciliation worker with idempotency guard |
| `Phase 8` | Test suite |
| `Frontend` | Next.js UI |

---

## 10. Notes and deliberate decisions

* `audit_assignment` uses **array columns** (`assigned_user_ids`, `product_ids`,
  `location_ids`) as listed in the requirement; because arrays cannot carry foreign keys, a
  constraint trigger validates that every id exists, is active, and (for users) is staff.
* Quantities are `NUMERIC(18,3)` and surrogate keys are `INTEGER`, so JSON payloads carry
  plain numbers.
* The generated `difference` column is intentionally **absent from `schema.prisma`**: Prisma
  sends it on `createMany` and PostgreSQL rejects writes to generated columns. Raw SQL reads
  the real column; the API serializer derives the same value.
* Approval applies the **difference**, not the counted value: if stock moved between the
  snapshot and the approval, the ledger stays coherent and the movement remains explainable.
* Deletion is always a soft delete when history exists; `?hard=1` is refused with `409` for
  products/locations with stock or audit references, and users are never physically deleted.
