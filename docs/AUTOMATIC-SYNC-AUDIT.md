# Automatic lead synchronization audit and fix

## Observed production evidence before changes (2026-11-02 UTC)

A read-only diagnostic retrieved only counts, timestamps and internal safe error codes, not customer answers, contact details or token values. It showed:

- 15 persisted leads at audit time. This is a later snapshot than the user's original 10-versus-6 report and cannot reconstruct what the browser or database contained at that earlier instant.
- No webhook inbox rows and no workspace webhook events. The authorized Page had subscribed=1 in local state but last_webhook_at was NULL. A saved subscription flag alone is not proof that Meta's app-level Page webhook is active or delivering. The exact external reason for absent delivery is not established by the database snapshot.
- One history job stopped after one attempt with error_code=invalid_field_data. Its generic UI message misleadingly suggested Page access. This parser error is not evidence of an expired token, permission denial, or budget-based throttling.
- A successful retrieval at 13:20 UTC but an older completed reconciliation checkpoint at 09:00 UTC; the failed job was updated at 13:30 UTC.
- The deployed configuration had no Queue binding and a ten-minute Cron trigger. notifyInbox and signalJobs previously did nothing without a Queue; only Cron did the work, at one job per tick. History pages contained five leads, so larger imports could require many ticks.
- Maintenance only scheduled reconciliation after six hours and did not automatically rearm dead jobs. One rejected submission could stop a whole form's import.
- The Leads page had no polling; dashboard charts/counts polled only every five minutes. Thus a browser refresh could reveal records already stored by delayed ingestion, while a manual Sync request could retrieve missing records. The observed Refresh action alone does not distinguish those two cases.

There is no evidence linking the advertising budget change to the failure. No claim is made that the exact rejected field has been identified: the original failed Graph response was not logged, and no customer values were inspected. Code review identified rejection of question keys longer than 200 characters and non-string/null values as plausible triggers of invalid_field_data.

## Implementation

### Signed webhook path

Exact raw bytes still undergo HMAC-SHA256 verification before parsing. Invalid signatures are rejected. A valid notification is durably inserted before HTTP acknowledgement. Through waitUntil, the no-Queue deployment now immediately dispatches one bounded inbox slice and retrieves a queued lead using its server-held encrypted Page token. The acknowledgement does not wait for Meta to return the lead. Queue delivery remains supported; send failure falls back to a bounded local attempt. Work not completed within the runtime lifetime remains recoverable through D1 leases and Cron. Notifications are not treated as full customer records.

### Scheduled offline recovery

Production and local configuration now use */5 * * * * for recovery, independent of browser sessions, plus 7 * * * * for subscription audits. Five-minute recovery schedules selected/authorized forms using existing 48-hour checkpoint overlap and cursor pagination. It processes bounded jobs with a ten-lead history page, reusing form metadata to reduce D1 calls. Up to four forms are scheduled and two jobs processed per recovery invocation; an inbox dispatch consumes that invocation's immediate processing budget. Large backlogs or many forms require additional runs; a five-minute schedule is not a universal five-minute completion guarantee. Optional Queues increase throughput without changing durable job ownership.

The workspace heartbeat records scheduler start, completion and safe failure diagnostics. Interrupted inbox/job leases can be reclaimed. Exponential retry with jitter and Retry-After remains; exhausted temporary history errors are eligible for retry after a 30-minute cooldown. Permission failures remain visible and require reconnection/replay. Migration 0007 restarts only history jobs stopped by the previous invalid_field_data parser, clearing their cursor to safely restart with database deduplication.

### Answer parsing and isolated failures

The importer accepts long custom question keys up to 4,096 characters and normalizes primitive/object/null answers to displayable strings under the existing total-answer size limit. It does not guess a rigid custom-question schema. Unsupported individual submissions get a separate failed lead job with an error code, while other records on the history page and later pages continue importing. Nothing is silently merged. Existing uniqueness by workspace/Page/Meta lead ID, per-answer uniqueness and transactional insertion continue to prevent duplicate submissions. Agent status, assignment, notes and tasks are not overwritten on re-import.

### Real subscription diagnostics

Hourly audits and POST /api/meta/verify-webhooks inspect the actual app's Page subscription, expected HTTPS callback, active flag and leadgen field with an app token held only on the backend. App-level configuration mismatches are reported rather than overwriting unrelated app settings. For an authorized Page, the checker reads subscribed_apps, adds leadgen if absent (preserving its other subscribed fields), and confirms the result. Page/account credentials are not returned or logged.

### Open-dashboard refresh

Lead records and database-derived dashboard statistics refresh every 30 seconds while visible. Returning to the tab or regaining connectivity triggers an immediate refresh. Hidden tabs do not poll. Polling does not initiate Meta imports; background server work continues when every CRM tab is closed. Stale aborted requests cannot overwrite a newly selected account's response. A failed refresh retains the last loaded lead list and shows an error/retry action.

GET /api/sync-status and Settings expose last successful retrieval, signed webhook receipt, background completion, pending/failed work, app callback diagnostics, Page subscription-check timestamps and replay controls. Configuration confirmation is deliberately distinct from successful test-lead delivery.

## Validation

50 Vitest tests pass, including raw-byte signatures/challenge, early acknowledgement with a deliberately blocked Meta response, immediate no-Queue retrieval, duplicate webhook replay, closed-browser scheduled recovery of a ten-lead dataset, manual sync idempotency, custom-answer normalization, malformed-record isolation, history cursors, 429/Retry-After, cooldown recovery versus permission failures, app/Page subscription verification and repair, workspace isolation and visible/hidden/online frontend polling. Worker TypeScript checks and frontend production build pass. Migration 0007 applied successfully to the local D1 runtime.

Actual signed Meta delivery cannot be certified by mocks. After deployment, inspect the live heartbeat and subscription checker, then submit a new test lead with Meta's Lead Ads Testing Tool. Confirm a new signed receipt and processed job; verify the open Leads page updates without Refresh. With the browser closed, submit another lead, then inspect the database later. To validate fallback, use a test Page/form with controlled webhook suppression and confirm recovery on subsequent five-minute ticks. Do not disable production lead delivery simply to test recovery.

## Deployment

No new paid service or Queue is required. Apply 0007 remotely and deploy the matching Worker/assets:

```powershell
npx.cmd wrangler d1 migrations apply az-leads --remote --env production
npx.cmd wrangler deploy --env production
```

If app diagnostics report missing Page/leadgen subscription: Meta Developers > AZ Leads CRM > the lead use case's Webhooks configuration > Page object; verify https://az-leads.azeem-maestro.workers.dev/api/webhooks/meta with the existing backend verification token and subscribe to leadgen. Keep the OAuth callback unchanged. Use Verify webhook configuration in CRM Settings; reconnect the selected account only if diagnostics identify a permission/token issue. App publishing/access requirements remain Meta-controlled.

Runtime references: https://developers.cloudflare.com/workers/runtime-apis/context/ (waitUntil lifecycle), https://developers.cloudflare.com/workers/configuration/cron-triggers/ (scheduled background invocation), and Meta's maintained setup checker https://github.com/facebookincubator/catalogue-of-api-solutions/blob/main/solutions/leads/leads-retrieval-set-up-checker.md (app subscription, Page subscribed_apps and form/lead retrieval).
