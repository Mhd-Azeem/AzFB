# Meta OAuth transport correction — 1 November 2026

The `meta_oauth_network` failure during Facebook authorization was caused by the application's use of `redirect: "error"` in server-side fetch calls. Cloudflare Workers does not implement that Fetch mode and throws before sending the request. The generic error handler incorrectly described this as a temporary Meta failure and claimed a retry was scheduled.

Both OAuth exchanges and authenticated Graph requests now use Workers-supported `manual` mode. Any 3xx response is explicitly rejected before reading/following its Location; credentials are not forwarded to another endpoint. Network, unreadable-response and rejected-token errors have safe actionable messages. OAuth failures direct the user to start a fresh authorization rather than claiming background login retries exist.

Validation: 34 automated tests pass, including five regression tests for both exchanges, Graph mode, redirect refusal, sanitized errors and fresh-code guidance. Worker type checking and the frontend production build pass. A separate local Wrangler/native-runtime probe confirmed that `error` mode is rejected while `manual` mode constructs successfully. The probe uses no credentials or customer data and is not exposed in the production application.

After deployment, return to CRM Settings and start Connect Facebook again. The failed callback already consumed its one-use state; refreshing that callback cannot safely replay authorization. Actual Page access and a genuine lead remain subject to the user's new authorization and the final round-trip acceptance test.

Reference: [Cloudflare Request redirect modes](https://developers.cloudflare.com/workers/runtime-apis/request/).
