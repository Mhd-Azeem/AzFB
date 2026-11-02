# Deployment and the first genuine lead

The initial deployment and remote migrations are now verified; see [current deployment status](DEPLOYMENT-STATUS.md). For the current account, skip database creation, migrations and first deployment below and continue with server secrets and Owner provisioning. Meta authorization and real lead delivery remain unverified. All commands below are for the owner to run after reviewing configuration. Never paste secrets into chat, commit them, or use `VITE_` variables for credentials.

## 1. Local development

Use Node.js 24 (the tests use Node's built-in SQLite). From the repository:

```sh
npm ci
cp .dev.vars.example .dev.vars
```

On PowerShell, use `Copy-Item .dev.vars.example .dev.vars`. Fill `.dev.vars` with independently generated secrets: `SESSION_SECRET` and `BOOTSTRAP_SECRET` should each have at least 32 random bytes of entropy; `TOKEN_ENCRYPTION_KEY` must be exactly 32 random bytes encoded as base64. The file is ignored by Git. Leave Meta fields blank until you have your actual app settings. Generate secrets with your password manager or locally:

```sh
node --input-type=module -e "import {randomBytes} from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
node --input-type=module -e "import {randomBytes} from 'node:crypto'; console.log(randomBytes(32).toString('base64'))"
```

Run the hex command separately for each hex secret. Keep the password pepper/session secret backed up securely: `SESSION_SECRET` is also the password-hashing pepper, so changing it invalidates existing password verifiers as well as sessions. Rotating it requires an account recovery/reprovisioning plan. Rotating the AES key requires re-encrypting existing tokens with their workspace/Page associated data or disconnecting and reconnecting Meta; never simply overwrite it and lose token access.

```sh
npm run db:local
npm test
npm run worker:check
npm run build
npm run worker:dev
```

Open `http://localhost:8787`. This serves the production frontend and API together. `npm run dev` is optional frontend hot reload at `http://127.0.0.1:5173`, proxying `/api` to the local Worker. Keep the same browser hostname throughout a session. Cookies are intentionally non-Secure only with `ENVIRONMENT=local`; never deploy a public environment using that setting.

For a disposable local verification database, `node scripts/smoke-local.mjs` provisions a generated test-only account and checks the API. It refuses to use an external origin. Credentials are kept in ignored `work/local-qa.json`, never printed. Do not use this QA account or secrets for production. The script assumes either an empty database or its own prior QA account.

Local Cron does not run automatically. With Wrangler running, invoke it explicitly:

```sh
curl "http://localhost:8787/cdn-cgi/local/scheduled"
```

## 2. Cloudflare database and initial deployment

```sh
npx wrangler login
npx wrangler whoami
npx wrangler d1 create az-leads
```

Put the **actual returned database UUID** into `env.production.d1_databases[0].database_id` in `wrangler.jsonc`. The empty production ID is intentional; no account ID or database ID is invented. Do not replace the local-only binding with a real database.

```sh
npx wrangler d1 migrations apply az-leads --remote --env production
npm run build
npx wrangler deploy --env production
```

The first deployment prints your actual HTTPS URL. It deliberately fails closed for API access until its origin and secrets are configured. In `env.production.vars`, set:

```json
{
  "ENVIRONMENT": "production",
  "APP_ORIGIN": "YOUR_ACTUAL_HTTPS_ORIGIN_WITHOUT_TRAILING_SLASH",
  "ALLOWED_ORIGINS": "YOUR_ACTUAL_HTTPS_ORIGIN_WITHOUT_TRAILING_SLASH",
  "META_GRAPH_VERSION": "v26.0"
}
```

The origin strings above are placeholders to replace, not deployable URLs. Prefer a single same-origin Worker deployment. No wildcard CORS, alternate frontend API origin or third-party cookie setup is necessary. If you add a custom domain later, change these values and the Meta redirect/callback settings together.

`v26.0` is present in Meta's official SDK as checked on 1 November 2026; confirm it is enabled/supported for **your app** in the Meta dashboard before selecting it. There is no silent API-version fallback. App-specific policy and permission approval still must be checked.

Configure secrets interactively, using the actual values from your own accounts:

```sh
npx wrangler secret put SESSION_SECRET --env production
npx wrangler secret put TOKEN_ENCRYPTION_KEY --env production
npx wrangler secret put BOOTSTRAP_SECRET --env production
npx wrangler secret put META_APP_ID --env production
npx wrangler secret put META_APP_SECRET --env production
npx wrangler secret put META_WEBHOOK_VERIFY_TOKEN --env production
```

If your Facebook Login for Business setup requires a configuration ID, also set `META_LOGIN_CONFIG_ID` with `wrangler secret put META_LOGIN_CONFIG_ID --env production`. The Connect URL includes this ID when supplied. Its configured permissions must grant the permissions checked by the backend.

```sh
npm run deploy
```

No credentials are needed in GitHub Actions for checks. Production deployment is an explicit owner action; CI does not deploy automatically.

## 3. Provision the initial Owner once

The endpoint `POST /api/auth/bootstrap` requires an allowed `Origin`, JSON, and `X-Bootstrap-Secret`. It atomically creates the singleton provisioning record, workspace, Owner and audit entry. Concurrent attempts cannot provision a second workspace. There is no default password.

Use a secure local client. The request body is:

```json
{
  "email": "YOUR_OWNER_EMAIL",
  "name": "YOUR_NAME",
  "workspaceName": "YOUR_WORKSPACE",
  "password": "YOUR_UNIQUE_12_TO_128_CHARACTER_PASSWORD"
}
```

Send it to your actual origin plus `/api/auth/bootstrap`, with `Origin` equal to `APP_ORIGIN`, `Content-Type: application/json` and the configured `X-Bootstrap-Secret`. To avoid putting secrets/passwords in shell history, use PowerShell secure prompts and process-memory values (this script prints neither the password nor the secret):

```powershell
$crmOrigin = Read-Host 'Actual HTTPS CRM origin (no trailing slash)'
$crmEmail = Read-Host 'Owner email'
$crmName = Read-Host 'Owner name'
$crmWorkspace = Read-Host 'Workspace name'
$crmSecret = Read-Host 'Bootstrap secret' -AsSecureString
$crmPassword = Read-Host 'Unique owner password' -AsSecureString
$crmSecretText = [System.Net.NetworkCredential]::new('', $crmSecret).Password
$crmPasswordText = [System.Net.NetworkCredential]::new('', $crmPassword).Password
$crmBody = @{email=$crmEmail; name=$crmName; workspaceName=$crmWorkspace; password=$crmPasswordText} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$crmOrigin/api/auth/bootstrap" -ContentType 'application/json' -Headers @{Origin=$crmOrigin; 'X-Bootstrap-Secret'=$crmSecretText} -Body $crmBody
Remove-Variable crmSecretText,crmPasswordText,crmBody,crmSecret,crmPassword
```

After successful provisioning:

```sh
npx wrangler secret delete BOOTSTRAP_SECRET --env production
```

Sign in at the CRM URL. Add Admin/Agent members in Settings. Use unique initial passwords, transfer them securely, and have each person change theirs. There is no email delivery or automatic password-reset service. Owner recovery is a deliberate administrative maintenance operation against the verified account/database, not an unauthenticated recovery endpoint.

## 4. Optional Queues — recommended for timely ingestion

The local fallback works with D1, immediate webhook waitUntil processing and five-minute Cron reconciliation, without Queues. Incoming signed events are durably stored before acknowledgement; bounded immediate processing retrieves a lead in the background. Cron recovers pending/leased work and missed lead notifications independently of browser sessions. Production binds the free az-leads-ingestion Queue with single-message, single-concurrency consumption. History discovers up to 25 IDs and schedules one lead per message; the no-Queue fallback requests two records per page. Bounded work limits invocation cost; large backlogs require further ticks or optional Queues. Hourly subscription checks verify app/Page webhook configuration. See [AUTOMATIC-SYNC-AUDIT.md](AUTOMATIC-SYNC-AUDIT.md) for exact limits, diagnostics and test steps.

Create queues if they are available for your account:

```sh
npx wrangler queues create az-leads-ingest
npx wrangler queues create az-leads-transport-dlq
```

Add this inside `env.production` in `wrangler.jsonc`, alongside the existing fields:

```json
"queues": {
  "producers": [{"binding":"INGEST_QUEUE","queue":"az-leads-ingest"}],
  "consumers": [{
    "queue":"az-leads-ingest",
    "max_batch_size":1,
    "max_batch_timeout":5,
    "max_retries":3,
    "dead_letter_queue":"az-leads-transport-dlq"
  }]
}
```

Redeploy with `npm run deploy`. A single-message consumer keeps each invocation bounded. Queue messages contain only job/inbox IDs; credentials and lead answers stay server-side. D1 remains the durable source of truth if publishing fails, the transport retries expire, or Queue messages are duplicated. History continuation and transient retries are republished with delays; Cron repairs pending/stale leases. D1 jobs stop after eight consecutive failed attempts per page or immediately on permanent errors. Fix permissions first, then use Settings → Replay. Transport DLQ contents can be inspected with Cloudflare tooling; D1 pending jobs remain schedulable even if a transport message is dead-lettered.

Current Cloudflare documentation includes Queues on the Free plan with usage/retention limits. Free does not mean unlimited: monitor Workers invocations, D1 reads/writes/storage, Queue operations and CPU time. The CRM does not promise a zero bill at arbitrary volume. Five-minute visible-tab polling is used for notifications/dashboard/health; hidden tabs do not poll.

## 5. Exact Meta setup and first lead

These actions require the Page owner/app administrator. Meta dashboard labels and eligibility can vary with app type; verify the required permissions and review status in your own app. Core Lead Ads retrieval endpoints and SDK fields were checked against Meta-owned source; some full developers.facebook.com documentation pages returned HTTP 429 during implementation, so App Review eligibility and the app's final configuration are not externally verified.

1. In Meta for Developers, create or open the business app that you own and that supports Facebook Page Lead Ads, Facebook Login (or Login for Business) and Page Webhooks. Associate the required business portfolio and complete any verification shown by Meta.
2. In App Settings → Basic, configure your real domain, privacy policy URL, contact details, and data deletion instructions/callback as required by Meta. This repository implements authenticated CRM deletion and provides an operations guide; it does not fabricate a public privacy policy or implement Meta's signed-request data-deletion callback. Supply a real policy and deletion-instructions URL before requesting review.
3. Configure the Login product's **Valid OAuth Redirect URI** to the exact `APP_ORIGIN` plus `/api/meta/callback`. For Login for Business configurations, grant the requested permissions and set the resulting `META_LOGIN_CONFIG_ID` if required by your chosen login setup. Use server-side authorization code flow; no tokens are passed into the frontend.
4. Request/grant `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_ads`, and `leads_retrieval`. These are checked after token exchange and again for the selected Page. If Meta's current app/use-case setup requires additional access or Advanced Access/App Review, obtain it before using accounts outside eligible app roles. Development mode/app roles are not a bypass for Page/lead access restrictions. Do not assume app ownership alone grants lead retrieval.
5. In the Page's business settings / Leads Access Manager, ensure your person and CRM/app have lead access to the intended Page and that your Page/business tasks permit management. If the business has customized lead access, explicitly assign it. Inaccessible Pages/forms or revoked permissions are displayed as errors rather than treated as connected.
6. In the app's Webhooks product, select object **Page**, set Callback URL to `APP_ORIGIN` plus `/api/webhooks/meta`, and enter the **same** verify token configured in `META_WEBHOOK_VERIFY_TOKEN`. Complete verification and subscribe the app's Page webhook configuration to **leadgen**. This app-level subscription is separate from the Page-level subscription.
7. Sign in to AZ Leads → Settings → Connect Facebook. Authorize the intended Pages and permissions. The backend validates state, app ID, expiration and granted permissions, exchanges tokens server-side, and stores them encrypted.
8. Choose **Connect this Page**. The server reads its forms, calls `POST /PAGE_ID/subscribed_apps` with `subscribed_fields=leadgen`, then reads `/PAGE_ID/subscribed_apps` to confirm your app and field. A connection is not marked connected without that confirmation.
9. Open **Instant forms**, select the intended forms, and use **Sync Now** in Settings. Follow job progress. Manual sync reads all currently accessible pages of leads. Scheduled reconciliation uses a saved successful checkpoint with a 48-hour overlap. Neither mode can restore leads that Meta has expired, removed or denied; Meta's availability window must be checked for your account.
10. Open Meta's [Lead Ads Testing Tool](https://developers.facebook.com/tools/lead-ads-testing/), select the same Page and selected form, create a test lead, and inspect its delivery/troubleshooting status. If a previous test lead blocks creating another, remove that test lead through Meta's tool before creating a new one. Do not delete genuine customer leads to run this test.
11. Confirm a signed delivery was saved, the workspace job reached `complete`, and the same Meta lead ID appears exactly once with its real answers. Retry the test webhook to verify no duplicate. Then verify status/notes/task changes persist after signing in on a second device. A Meta dashboard sample event with dummy IDs can verify delivery but cannot prove Graph retrieval of a genuine lead.

Do not label the production integration verified until these steps succeed with your real app/Page and the deployed HTTPS Worker. Test cross-device access, session expiry, disconnect/reconnect, permission revocation and backup/restore procedures before operational use.

## References checked

- [Meta-owned lead retrieval setup and subscription workflow](https://github.com/facebookincubator/catalogue-of-api-solutions/blob/main/solutions/leads/leads-retrieval-set-up-checker.md)
- [Meta's official SDK Graph API version](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py)
- [Meta's official Lead field schema](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/lead.py)
- [Meta lead retrieval documentation](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/) — full access was rate limited during implementation
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
