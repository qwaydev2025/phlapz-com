# PHLAPZ.COM technical audit

Audit date: 2026-11-08

## Scope and limits

This audit is based on the checked-out source, configuration, local data-file structure, and the publicly accessible storefront. The live site shows a private member sign-in page. No production credentials, private admin session, or production database were available, so paid transactions, production integrations, and authenticated live workflows were not exercised. No deployment or production data changes were made.

## Technology and architecture

- **Runtime and backend:** JavaScript on Node.js 20+, with Express 4 in a single `server.js` application.
- **Frontend:** Server-served HTML, CSS, and vanilla JavaScript. `public/app.js` switches between storefront, checkout, and admin sections; it is not a multi-page framework or a client-side router.
- **Persistence:** JSON files for products, users, and orders, with atomic file replacement for writes. Sessions use `express-session` and `session-file-store`. There is no relational or managed database, schema, or migration system.
- **Integrations:** Stripe Checkout and signature-verified webhooks; SMTP through Nodemailer for order and password-reset email; xAI's Responses API for the owner-only research panel. The OpenAI package is declared as a dependency but is not part of the observed request flow.
- **Hosting:** Render Blueprint configuration with a persistent disk at `/var/data`, used for the JSON store, sessions, and uploads.
- **Build and tests:** `npm start` starts the app; `npm test` uses Node's built-in test runner. There is no separate frontend build, lint, or type-check script.

## Existing features and routes

The storefront supports member signup/sign-in, password reset, product browsing and category filtering, cart editing, and Stripe-hosted checkout. Admin features include product CRUD and image uploads, member role/approval edits, order status updates and CSV export, summary/health views, email-configuration diagnostics, and an owner-only AI research panel.

The server exposes health and session endpoints; signup, login, logout, and password-reset endpoints; product listing and checkout creation; the Stripe webhook; admin user, product, order, summary, health, export, upload, email-diagnostic, and AI endpoints. Unknown paths are served the same `index.html`.

The project has no separate profile page, standalone dashboard route, search API, or relational database. Search and filtering shown in the admin UI operate on the fetched in-memory lists.

## Findings

### Addressed in the first and second implementation passes

1. **Stored XSS in admin-rendered data.** User-controlled member names and other dynamic record values were interpolated into HTML. The member list and related cart, order, summary, product-action, and health rendering paths now HTML-escape dynamic text and attribute values.
2. **Credential material tracked in the repository.** The local user store contained password hashes and was tracked by Git. It is now ignored and removed from the current Git index while the local file is preserved. This does not remove copies from earlier commits or remote clones; assess access and history remediation separately.
3. **Fresh-install bootstrap depended on a tracked user file.** Fresh production data disks now require `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` and create the initial admin using the existing scrypt password-hashing scheme. Existing user stores are not overwritten. Render and local environment examples and deployment instructions were updated.
4. **Small-screen navigation and accessibility gaps.** Added a keyboard-operable mobile menu, skip link, visible focus styles, reduced-motion support, page description/canonical URL, and a consistent footer. Removed dead “Documentation” and `#` links and the misleading fixed “Member savings” line.
5. **Unauthenticated catalog access and route guards.** Catalog requests now require an approved member. Admin API routes share an admin authorization guard; self-demotion and removal/disablement of the last approved admin are rejected.
6. **HTTP and request hardening.** Added restrictive security headers, production HSTS, API no-store caching, same-origin checks on unsafe browser methods, API/auth/checkout rate limits, payload validation, and generic server errors. JSON writes use fsync plus atomic replacement and protected last-known-good backups; user backups strip plaintext passwords and reset tokens. Mutating API operations are serialized within one process.
7. **Hybrid payment and owner-controlled order lifecycle.** Stripe and configurable manual methods create server-priced orders in `PENDING_CONFIRMATION`. Order, payment, and fulfillment statuses are stored separately. Signed/idempotent Stripe webhooks mark payment only; an owner must confirm/reject. Manual payments remain awaiting payment until owner verification. Unpaid fulfillment is blocked, and an unpaid approval is a separate explicit owner action.
8. **Payment, inventory, and email reliability.** Orders are idempotent by customer checkout request ID, reserve inventory, release reservations on cancellation/rejection and failed/expired Stripe sessions, and retain payment/refund references and history. Stripe refunds require owner action and show `REFUNDED` only after Stripe reports success. Email delivery outcomes are persisted per event/recipient and can be retried from the dashboard. CSV includes order, payment, and fulfillment statuses.
9. **Uploads, exports, and admin validation.** Uploads use random names, 5 MB cap, declared MIME filtering plus image-signature checks, restrictive permissions, and `nosniff`. CSV fields are quoted and formula prefixes neutralized. Admin product/user mutations validate field types and ranges; branded order notification HTML is escaped.
10. **Location tax and checkout records.** Server totals use configured country-region rates; address/contact and price snapshots are stored with each order. Shipping is not charged and is arranged after review.
11. **Operations and recovery.** Added owner payment settings, manual-order instructions, an order lifecycle dashboard, email retry controls, and a PostgreSQL target schema update. No production data was migrated.

### Remaining technical and product risks

- **File-backed storage remains single-instance only.** Synchronous JSON reads/writes block the event loop; there are no database transactions or cross-instance locks. The new serialization queue only coordinates one Node.js process. Do not scale to multiple instances until PostgreSQL (or equivalent transactional storage) and shared sessions/rate limiting are deployed.
- **Member approval policy remains permissive.** New signups are immediately approved, preserving existing behavior. Change this only after the business approves an invitation/manual-approval flow.
- **Abuse controls are process-local.** Login, reset, and owner-AI throttles use in-memory maps, so they reset on restart and do not aggregate across instances.
- **Upload inspection checks signatures, not complete image decoding/transcoding.** Consider re-encoding uploads in an isolated image-processing service before production scale. Product images are intentionally served publicly.
- **Operational recovery is not a transaction across files.** Backups are per-file, not a coordinated snapshot of users/products/orders. Restore/reconciliation procedures and scheduled offsite backups must be verified before scaling or production migration.
- **Payment/tax settings need owner configuration before checkout.** Manual methods default to none, and orders are blocked for any country-region without an explicitly configured rate. Configure and verify the legally applicable rates before enabling customer checkout. Shipping remains uncharged and must be arranged after review.
- **Manual payment and fulfillment operations need owner procedures.** Manual payment verification, manual refunds, and shipping updates are explicit owner actions; this pass does not integrate a bank, carrier, address validation, or tax calculation service.
- **HTTP hardening is improved but not exhaustive.** CSP permits inline styles to support existing dashboard markup. Review the policy, production origin/proxy settings, shared rate limiting, and structured operational logging in staging.
- **Error visibility and UI states are inconsistent.** Several admin actions fail silently when a request returns a non-success status; fetch failures can produce empty lists that look like valid empty results. Add consistent pending/error/retry states.
- **SEO and performance are limited by the private single-page experience.** Page metadata is generic, there are no observed sitemap/robots files or product-specific indexable pages, and the showcase PNG/external font loading should be measured and optimized. No Core Web Vitals measurements were performed.
- **Automated coverage is useful but not exhaustive.** Integration tests cover password migration/reset, concurrent signup and reset attempts, persistent sessions, owner/member authorization, admin bootstrap, Stripe webhook signatures/idempotency, manual and Stripe order states, duplicate submission, tax computation/guarding, inventory transitions, CSV formula escaping, upload signature rejection, product CRUD, JSON backup recovery, and login throttling. They do not verify SMTP delivery or a live Stripe payment/refund.

## Recommended implementation roadmap

1. **Configure business operations:** set exact tax rates and manual payment instructions in the owner dashboard; verify applicable regions and customer notifications in staging.
2. **Move critical state to transactional storage:** choose a managed database, define additive migrations, preserve and reconcile existing production JSON data, and make inventory reservation/decrement atomic. Use a shared session store if scaling beyond one instance.
3. **Harden APIs and operations:** consistent validation/error responses, structured logs, readiness checks, and explicit UI loading/error states.
4. **Complete frontend redesign:** establish reusable responsive components/tokens, review every storefront/admin viewport, optimize real images and font loading, and test keyboard/screen-reader behavior.
5. **Improve SEO and performance:** assess public versus members-only indexing requirements, add sitemap/robots and appropriate metadata, measure Core Web Vitals, and optimize image formats/caching.
6. **Complete quality assurance and deployment checks:** automate critical browser workflows, verify staging email and Stripe integrations, and document a tested backup/rollback process before any production change.

## Second-pass validation and deployment status

Backend integration and syntax validation are reported with the implementation summary in the change handoff. Manual browser checks from the preceding pass covered mobile navigation, member signup, storefront rendering, cart/checkout interaction, and horizontal overflow; this hybrid checkout UI requires a new browser pass. Live Stripe payments/refunds and SMTP delivery were not attempted. No production deployment, DNS change, production data migration, destructive data operation, or Git-history rewrite was performed.
