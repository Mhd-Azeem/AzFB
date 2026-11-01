# Page connection diagnostics

Successful Facebook OAuth and manageable-Page discovery do not by themselves confirm that a Page token can discover forms or install the leadgen subscription. The previous generic message obscured failures after authorization.

`POST /api/meta/pages/select` now identifies the failure stage: token validation, form discovery, Page subscription, or subscription confirmation. It records the safe diagnostic in the workspace/Page's `last_error` and adds a minimal audit event. A failure does not mark the Page connected.

Graph errors expose only a numeric error/subcode and permission names matched from a fixed allowlist. Raw provider messages, access tokens, request URLs and credentials are never reflected. Meta's named permissions are diagnostic evidence; the operator still needs to verify the applicable permission and grant it in the app's login configuration before reconnecting. Do not widen permissions speculatively.

The regression test simulates a form-discovery permission failure, checks that its stage and permission reach the UI, verifies that provider/token-like text does not leak, and confirms the Page remains disconnected. The full suite now passes 35 tests and the Worker type check. Version `d9d1de7e-191b-4be7-9503-099b98aebde6` was deployed. Actual Page access still requires the user's next authenticated connection attempt.
