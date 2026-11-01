# AZ Leads CRM

A responsive React + TypeScript frontend for Facebook Instant Form leads. The repository was empty when implementation began; Vite supplies the development and production build pipeline.

## Run locally

Requires Node.js 22.12+ (or 20.19+) and npm.

```sh
npm ci
npm run dev
npm run test
npm run build
npm run preview
```

The production static files are written to `dist/`. Host those files on any static host. No deployment is provisioned by this repository. Root-path hosting is the default; configure Vite's `base` before deploying under a subdirectory such as GitHub Pages.

## Implemented

- Dark navy/blue responsive dashboard, sidebar, mobile navigation and keyboard focus styles.
- Overview KPIs, daily activity chart and clickable status pipeline, all calculated from the same 24 fictional leads.
- Leads table with combined text, status, form and inclusive UTC date filters, pagination and empty states.
- Accessible native lead detail dialog with contact information, campaign, custom form answers, editable status and notes.
- Form summaries, form-filtered lead navigation, form conversion analytics and honest connection settings.
- CSV export of the current filtered dataset, with quote escaping and spreadsheet formula mitigation.
- Browser-local persistence for demo status and notes, storage failure feedback, and demo reset.

## Demo limitations

All people, contact details, forms and metrics are fictional. Demo submissions span 25 October–1 November 2026. There is no backend, authentication, actual Facebook connection, live syncing or secure shared database. Notes and statuses are stored in localStorage on this browser only. Do not enter real personal or sensitive information. The connect control is deliberately disabled until backend integration exists. Reset restores the initial statuses and removes demo notes. CSV export includes notes but does not flatten arbitrary custom form answers.

Fonts use Google Fonts with local sans-serif fallbacks; no other external resources are needed by the runtime. Icons are bundled from lucide-react.

## Integration boundary

`src/data.ts` owns the typed lead model, fictional seed, pure filtering and export functions. `src/main.tsx` initializes the demo state and contains the views. Replace `readLeads()` and local state persistence with an authenticated API client when adding the backend. Keep the mock/connection labels until real connection state is returned by the server. Custom answers are represented as question/answer pairs rather than a fixed form schema.

Suggested backend responsibilities: administrator authentication and authorization; server-side Meta Page authorization and token storage; webhook verification and signature validation; lead retrieval and deduplication; durable lead/form storage; retry processing; authenticated list/detail/status/notes endpoints; and actual connection/last-sync status. Never place Meta access tokens or app secrets in Vite environment variables or browser storage. Meta configuration and permission requirements must be verified against current official documentation during backend implementation.

## Verification

`npm test` covers combined filters, date bounds, campaign search, CSV scoping, escaping and formula handling. `npm run build` type-checks the frontend before creating production assets. Browser QA should cover desktop/mobile layout, keyboard dialog dismissal and focus return, navigation, filters, pagination, status/notes persistence and export.
