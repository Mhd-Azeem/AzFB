# Current deployment — 1 November 2026

The application is deployed at **https://az-leads.azeem-maestro.workers.dev** on the Cloudflare account selected by the owner during setup.

- Production D1 database: `az-leads`; its actual UUID is configured in the production `DB` binding.
- All five remote migrations applied successfully. The development binding remains local-only; the mistakenly added remote development binding was removed.
- Production application origin and CORS allowlist both use the deployed HTTPS origin.
- Production build and deployment succeeded. Version: `cf70eb98-b7f8-4a0d-a8aa-05632be1b754`.
- The hosted page returned HTTP 200. Static-page security headers are supplied through `public/_headers`; API headers remain in Worker middleware.
- The authenticated API intentionally returns `503 server_not_configured` while server secrets remain missing. No customer data is exposed.
- No production Owner account, Meta credentials, Page authorization, Queue binding or genuine lead delivery has been configured or verified yet. `META_GRAPH_VERSION` remains unset pending Meta setup.

This record supersedes earlier statements that no deployment/remote migrations existed. The earlier local/API/CI test results remain applicable, but they do not establish live Meta integration.

Next: configure production `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY` and a temporary `BOOTSTRAP_SECRET`, provision the Owner using the secure instructions in [DEPLOYMENT.md](DEPLOYMENT.md), then remove the bootstrap secret. After that, configure the actual Meta app credentials/version, authorization, Page/form selection and a genuine test lead.
