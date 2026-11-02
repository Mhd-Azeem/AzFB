# Verification — full-stack implementation

This record supersedes the earlier fictional-frontend verification. An initial hosted deployment and remote migrations are now verified; see [deployment status](docs/DEPLOYMENT-STATUS.md). No live Meta account or genuine lead delivery is claimed.

## Local automated checks

- Vitest: 38 tests passed at the final checkpoint, covering the four existing demo tests plus password/hash and authenticated encryption behavior, exact-byte signatures, validation/CSV guards, one-time provisioning, cookie/CSRF/origin behavior, expiry/rotation/logout/password revocation, login lockouts, workspace isolation, roles, OAuth state/permission checks, encrypted credential non-disclosure, Page subscription confirmation, webhook inbox/replay, distinct submission identity, custom answers, retry/permanent-failure behavior, history cursors, incremental reconciliation, leases, deletion suppression and foreign keys.
- TypeScript: Worker check passed. Frontend production build passed after the clean lockfile install. The Wrangler non-deploying bundle check also passed; the dry-run itself did not upload. The later initial production deployment is recorded separately.
- Wrangler local D1: all five versioned migrations applied successfully in the actual local runtime, in addition to SQLite fixture tests.
- Local Worker API smoke: 18 checks passed, including authenticated live read APIs, actual D1 queries, CSV response, task creation/completion, CSRF rejection and session revocation. Only a generated local test account and explicitly labeled local verification task were created; no mock leads were seeded into live mode.
- Dependency security audit after upgrading the inherited Vitest dependency reported zero advisories at installation time. Final npm ci succeeded and reported zero advisories.

## Browser checks

Local production assets were served by Wrangler, with an actual D1 session and generated local test credentials. Login succeeded. Dashboard rendered real zero totals and zero conversion instead of the 24 fictional records. Settings correctly displayed no Meta connection, disabled Connect/Sync while unconfigured, and showed D1/Cron delivery health. A follow-up was created and completed through the browser, then its completion was verified after reload. At 390 × 844, navigation and Settings worked with no page overflow (375px document width). The session-renewal race found during browser QA was corrected with a 30-second grace window and family-wide logout; regression tests pass.

## Not externally verified

- Authenticated production HTTPS sessions, Cloudflare runtime quotas/load, backup/restore and optional Queue transport. The initial hosted URL and remote migrations are now verified.
- Meta app configuration, app review/advanced access/business eligibility, real OAuth grant, selected Page's actual lead access, live webhook delivery, genuine lead retrieval and multi-device use after deployment.
- Some full Meta documentation pages were rate limited. Meta-owned SDK source confirmed the Lead schema and v26.0 availability; Meta-owned setup source confirmed app/Page leadgen subscriptions, lead retrieval endpoints and cursor/time-filter conventions. Final app-specific permissions and review requirements must still be checked in the owner's dashboard.

Mocks prove handling of expected responses, not that your external accounts are configured or approved. See docs/DEPLOYMENT.md for the exact production setup and genuine-lead acceptance test.


The Meta OAuth runtime compatibility correction, five additional regression tests, and native redirect probe are documented in [OAUTH-FIX.md](docs/OAUTH-FIX.md). Version 40616338-ba17-444f-a8de-6167b9787d48 deployed successfully; a fresh user authorization is still required to verify the live Meta round trip.

Page-connection stage/permission diagnostics and their token-redaction regression test are described in [PAGE-CONNECTION-DIAGNOSTICS.md](docs/PAGE-CONNECTION-DIAGNOSTICS.md). The selected Page's actual external failure must be established from a fresh authenticated attempt; no successful Page subscription is claimed.

- WhatsApp contact workflow: international-number validation, authenticated workspace ownership, New-to-Contacted persistence, later-stage preservation, and timestamped attempts verified with mocked records. Actual WhatsApp navigation/message delivery has not been tested with a real lead.
