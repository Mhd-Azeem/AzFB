# AZ Leads CRM

React 19 + TypeScript + Vite frontend, Hono/Cloudflare Worker API, D1 database, and optional Cloudflare Queues. The navy/blue dashboard now defaults to authenticated database-backed mode. The fictional frontend is isolated at `/?mode=demo`; live mode never falls back to it.

**Status:** implemented and tested; the initial deployment is available at [az-leads.azeem-maestro.workers.dev](https://az-leads.azeem-maestro.workers.dev). Remote migrations are applied. Login remains locked until server secrets and the Owner account are provisioned; Meta authorization and real lead delivery are unverified. See [current deployment status](docs/DEPLOYMENT-STATUS.md).

## Features

- One-time Owner provisioning; password login, HttpOnly server sessions, CSRF, rotation, lockouts, role authorization and audit events.
- Workspace-owned leads, all custom answers, separate submission identity, possible repeat-contact hints, notes, activities, assignments, follow-ups, contact-app links and persistent stages.
- Search by person/contact/campaign/form/Page, date/stage/form/Page/agent filters, server pagination/sorting, bounded matching CSV export, actual database analytics and five-minute in-app notifications.
- Server Meta OAuth/state/permission/expiration checks, encrypted Page/user tokens, Page selection and confirmed leadgen subscription, real form discovery/selection, disconnect/reconnect and actionable diagnostics.
- Raw-body signed webhook verification and durable inbox acknowledgement; separately retrieved full lead records; idempotent imports, cursor pagination, exponential retry, dead-letter/replay, lease recovery and incremental reconciliation.
- Connection/job health, Sync Now, team access, account password changes and workspace retention. No automated outbound messaging or paid notification provider.

## Start

Use Node.js 24 and npm. Copy `.dev.vars.example` to ignored `.dev.vars` and fill the required local server secrets as described in the deployment guide.

```sh
npm ci
npm run db:local
npm test
npm run worker:check
npm run build
npm run worker:dev
```

Open `http://localhost:8787`. Provision the Owner once using `/api/auth/bootstrap`; no default login exists. The optional `npm run dev` frontend at `http://127.0.0.1:5173` proxies API requests to the running Worker. Built assets are in `dist/`; deploy the frontend and Worker together for secure same-origin cookies. Static-only hosting supports the isolated demo but cannot run the CRM backend.

## Repository map

| Path                                           | Responsibility                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/main.tsx`, `src/api.ts`                   | Authenticated entry, session lifecycle, in-memory CSRF/API client                                |
| `src/pages/`, `src/components/`, `src/hooks/`  | Reusable CRM views, accessible detail dialog, states and fetching                                |
| `src/demo/DemoApp.tsx`, `src/data.ts`          | Explicit fictional demo and its browser-only data; never a live source                           |
| `shared/contracts.ts`                          | Shared roles, stages and API data types                                                          |
| `worker/auth.ts`, `crypto.ts`                  | Provisioning, passwords, cookies/sessions, HMAC and authenticated token encryption               |
| `worker/crm.ts`, `filters.ts`                  | Workspace APIs, validation, SQL filters, analytics and export                                    |
| `worker/meta.ts`, `meta-client.ts`             | OAuth, Page/form management, token checks, official Graph requests                               |
| `worker/webhooks.ts`, `inbox.ts`, `jobs.ts`    | Signed durable ingestion, retries, pagination, reconciliation and retention                      |
| `migrations/0001_core.sql`                     | Users, sessions, workspaces, Meta connections, Pages/forms, leads/answers/notes/activities/tasks |
| `migrations/0002_ingestion.sql`                | Webhook events, sync jobs, suppression tombstones, notification read markers                     |
| `migrations/0003_reconciliation.sql`           | Incremental checkpoints and operational indexes                                                  |
| `migrations/0004_webhook_inbox.sql`            | Durable, bounded-dispatch signed webhook inbox                                                   |
| `migrations/0005_session_rotation.sql`         | Session families and OAuth state continuity through safe rotation                                |
| `wrangler.jsonc`, `.dev.vars.example`          | Local/production bindings and safe secret examples                                               |
| `worker/security.test.ts`, `worker/test-db.ts` | Mocked Meta + actual SQLite schema/API/security tests                                            |
| `scripts/smoke-local.mjs`                      | Disposable local-only Worker/D1 API verification                                                 |

## Guides

- [Audit of the original repository](docs/AUDIT.md)
- [Deployment, Cloudflare commands and exact Meta setup](docs/DEPLOYMENT.md)
- [Endpoint catalog and filtering semantics](docs/API.md)
- [Security controls, recovery and privacy operations](docs/SECURITY.md)
- [Verification results and limitations](VERIFICATION.md)

No app IDs, database UUIDs, production origins or secrets are fabricated. The production database binding and origin now use values verified during setup. D1+Cron mode needs no Queue binding but is intentionally low-throughput; Queues is recommended for timely delivery and history imports. Availability windows, App Review and free-tier quotas are provider constraints, not promises made by this application.
