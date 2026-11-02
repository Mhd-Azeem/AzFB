# Multiple Facebook logins

Migration `0006_meta_accounts.sql` converts the former workspace-only connection primary key to `(workspace_id, meta_user_id)`. It retains every original encrypted token unchanged, identifies its legacy encryption context, and maps existing Pages to that connection. New user tokens use account-specific authenticated encryption context. Page tokens remain Page/workspace-bound. No original leads, notes, tasks, statuses, or form answers are rewritten.

## Using the CRM

1. Settings > Facebook accounts > Add Facebook account. Sign into the intended Facebook login before authorizing. If Meta reuses the current Facebook session, switch accounts in Facebook first, then return to the CRM and start Add again; do not disconnect the working CRM account just to switch browser login.
2. Authorize the relevant Pages. Choose the new account in Manage account, give it a recognizable name, connect its Pages, refresh forms, select forms and sync.
3. Leads shows All accounts and an account tab for each saved login. Filters, pagination, search and CSV export respect the selected account. Historical leads remain available in that account tab after disconnect.
4. Reconnect selected account uses account-bound OAuth state. Signing into a different user is rejected before either connection is modified. Adding the same user refreshes that connection rather than creating a duplicate.
5. Review connection removal disconnects only the selected account, clears its credentials, deselects its forms and cancels its jobs. Other accounts continue running. Remote Meta revocation is attempted and failures are reported. Account labels and Page ownership remain to retain historical lead grouping.

A Page managed by two connected Facebook users retains its original owner; the second login never overwrites that Page token or creates another copy of its submissions. Reconnect the original login to restore that Page. A shared Page is shown under its owning account. Account labels are editable; no additional Facebook profile permissions are requested just to name a connection.

Webhook routing still uses the Page and workspace. Jobs use that Page's encrypted token, and permission failures mark only its owning account as needing reconnection. All connections belong to the same CRM workspace; Owner/Admin can manage them and workspace Agents can view the workspace's leads. Tabs are organization, not separate user-access boundaries. Use separate workspaces for separate security boundaries.

Home includes a View leads button; at mobile widths it spans the available width with a 44px minimum touch target.

## API additions

- GET /api/meta/accounts: safe account IDs, labels and states; no credentials.
- PATCH /api/meta/accounts/:id: Owner/Admin rename with `{label}`.
- GET /api/meta/connect?accountId=...: reconnect this workspace-owned account (omit for Add).
- GET /api/meta/connection-status: adds accounts and Page account_id; original connection field retained for compatibility.
- POST /api/meta/disconnect: requires `{accountId}`. Omitting the account is rejected; global disconnect is no longer implicit.
- GET /api/leads and /api/leads/export: `accountId` selects the account using a workspace-scoped Page ownership lookup.

## Deployment and verification

Run tests, Worker type checks and frontend build. Apply migrations locally with `npm.cmd run db:local`; apply production migration with `npx.cmd wrangler d1 migrations apply az-leads --remote --env production`, then deploy the matching backend/frontend with `npx.cmd wrangler deploy --env production`. The migration preserves the original connection and maps all existing Pages before the account UI is used. Deploy during a quiet period; the preceding backend cannot complete a fresh OAuth callback after the primary-key migration.

Regression coverage includes upgrading a populated pre-multi-account database and legacy token use, independent OAuth logins, wrong-account reconnect rejection, correct-account reconnect isolation, shared-Page token preservation, account-filtered lists/CSV, account-specific disconnect, historical lead retention, account rename, workspace isolation, credential non-disclosure and foreign-key checks. Second-account real Meta authorization and new lead delivery require testing with that user's authorized Pages after deployment. Meta's current app mode, permission access and dashboard requirements still apply; this code does not grant additional Meta access.
