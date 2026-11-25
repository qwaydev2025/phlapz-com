# PostgreSQL migration plan

The application still uses local JSON files. `migrations/001_initial_schema.sql` describes an additive PostgreSQL target; it is documentation/planning input and is **not run by the application**. No production data was copied, modified, or deleted.

## Target data model

- `users`: case-insensitive unique email, password hash, role/approval, auth version, one-time reset hash.
- `products`: product details and available stock in integer cents and units.
- `orders` and `order_items`: immutable contact/price snapshots; distinct order, payment, and fulfillment statuses; unique Stripe and checkout request identifiers; refund, notification, and audit history.
- `inventory_reservations`: unique order/product reservations with nullable expiry for manual-payment orders, commit, and release state.
- `store_payment_settings`: owner-configured manual payment instructions and jurisdiction tax rates.
- `stripe_events`: Stripe event IDs for durable idempotency.
- `sessions`: session payload and expiry for a shared session store.

## Safe cutover sequence

1. Provision PostgreSQL and apply the schema in a non-production environment. Keep the existing file store authoritative.
2. Export a timestamped, access-controlled backup of the persistent disk. Validate JSON shape, unique user emails/product IDs, order-to-product references, and stock values without changing source files.
3. Run a dry-run importer that reports row counts and conflicts. Map existing product/order monetary values to integer cents using decimal arithmetic; preserve legacy IDs and order snapshots. Migrate legacy `paid` orders to `PENDING_CONFIRMATION` plus `PAID`, and legacy `fulfilled` orders to `CONFIRMED`, `PAID`, and `COMPLETED` fulfillment. Never import the tracked baseline as production truth.
4. Import into empty target tables inside one database transaction. Compare record counts, inventory totals, order totals, and password-hash bytes. Verify sign-in and Stripe webhook replay using a staging copy.
5. Add database-backed repository methods and tests behind a feature flag. Use row locks or conditional stock updates for reservations; commit order/items/reservations together.
6. During cutover, pause checkout, take a final backup, import the delta, run reconciliation, switch the application connection, and validate health, login, product availability, and webhook idempotency.
7. Retain the source backup read-only through the rollback window. Roll back by switching the application to the preserved JSON copy only after reconciling any payments created after cutover.

Do not dual-write payment/inventory state to independent stores without a reconciliation ledger. Do not apply this migration to production without explicit approval, backup verification, and a tested maintenance plan.
