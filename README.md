# Phlapz.com

1001737608 Ontario Inc. operating as Phlapz.com.

## Deploy to Render

1. Push this repository to GitHub.
2. In Render, select **New** then **Blueprint**, connect the GitHub repository, and approve `render.yaml`.
3. Set `APP_URL` to the assigned Render URL, such as `https://phlapz-storefront.onrender.com`.
4. Add the Stripe and email values listed in `.env.example` in the Render environment settings.
5. In Stripe, configure the webhook endpoint as `https://your-render-url/api/stripe/webhook` and copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
6. To enable the owner-only AI CEO research panel, set `XAI_API_KEY`, `PHLAPZ_OWNER_USER_ID`, and `SITE_ORIGIN` in the Render environment settings. Set `SITE_ORIGIN` to the exact public origin (scheme and hostname, without a path), and set the owner ID to the verified admin account's internal ID. `XAI_MODEL` defaults to `grok-4.7`.

The Render disk at `/var/data` keeps orders, users, inventory changes, and product uploads between deploys. Products and orders are initialized from the tracked files in `data/`; user records are not tracked or copied from the repository. When provisioning a new empty data disk, set `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` in Render's environment settings. The app creates that first admin with a salted password hash and removes the bootstrap credentials from use; existing user records on a persistent disk are left unchanged. Choose a unique password of at least 12 characters and clear the bootstrap variables after the first successful startup.

## Local development

Copy `.env.example` to `.env`, fill in required values, then run:

```sh
npm install
npm start
```

## PHLAPZ food storefront

The public menu is separate from the existing member-only retail catalog. Food products use the menu categories in the admin product editor; retail products and customer records are retained and are not exposed through the public food menu. Product descriptions, ingredients, allergens, stock, price, preparation time, and images are managed by an administrator. Do not enter unverified prices or allergen information.

Food ordering is disabled by default. Keep `FOOD_ORDERING_ENABLED=false` until the kitchen is legally and operationally ready, payment and tax settings have been verified, and pickup hours and order handling have been confirmed. When enabled, checkout remains subject to explicit owner review; the pickup time is a customer request, not a confirmed preparation promise. `STORE_TAX_JURISDICTION` selects the configured tax jurisdiction for pickup orders (default `CA-ON`); the matching rate must be configured in the admin settings.

The website's availability is independent of kitchen operations. Admins configure Toronto pickup hours, temporary closure, order acceptance, and minimum pickup notice in **Settings**; requested times outside those hours are rejected server-side. Pickup is the only represented food fulfillment method; delivery remains unavailable. Uber Eats, DoorDash, and SkipTheDishes are shown as future, unconnected channels. No marketplace orders or menu data are synchronized by this application.

If the local `data/users.json` file does not exist, the server creates an empty user store unless `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` are configured. The existing ignored local file is preserved.

## Security notes

- On startup, legacy plaintext user passwords are converted to salted `scrypt` hashes without changing account IDs or passwords. New signups and password resets also store only hashes.
- Password reset links are one-time tokens, expire after 30 minutes, and are emailed only when SMTP is configured. Configure SMTP before offering account recovery. A successful reset invalidates existing user sessions.
- Sign-in failures are rate-limited by client IP to reduce password-guessing attempts; this is an in-process limit and should be supplemented by edge-level protection if traffic scales.
- Sessions are stored on disk under `DATA_DIR/sessions` so they survive app restarts on Render's persistent disk. Use a private, random `SESSION_SECRET` of at least 32 characters in production; Render generates one for a Blueprint deployment.
- Orders keep order approval, payment, and fulfillment in separate fields. Every new order starts `PENDING_CONFIRMATION`; Stripe webhooks can set payment to `PAID`, but only an authenticated owner can confirm or reject it. Manual payment methods and instructions are configured in the admin **Settings** panel. Manual payments remain `AWAITING_PAYMENT` until the owner verifies them. Unpaid orders cannot be fulfilled; the owner must explicitly choose the unpaid-confirmation exception to approve one.
- Checkout totals are calculated from server-side catalog prices and customization prices. Retail checkout uses the customer's Canadian address; food pickup uses `STORE_TAX_JURISDICTION`. The owner configures exact jurisdiction rates (for example `CA-ON | 0.13`, fractional form) in **Settings**; checkout refuses jurisdictions without an explicit configured rate. Food orders are pickup-only. Configure accurate rates before accepting orders; this implementation is not tax advice or a tax-service integration.
- Signed Stripe Checkout and refund webhooks are verified and deduplicated. Stripe-paid rejected orders can be refunded through the owner dashboard; a refund is shown as complete only after Stripe confirms success. Manual refunds are performed outside the site and must be explicitly confirmed by the owner in the dashboard.
- Atomic file replacements and per-product event markers prevent a retried event from decrementing stock twice after a process restart. Email delivery outcomes are saved per order and failed messages can be retried from the dashboard. This JSON-file approach assumes a single app instance; use a transactional database before scaling horizontally.
- Keep `.env` out of Git and store production secrets in Render's Environment settings. Rotate any credentials that may have been exposed.
- User records, including password hashes, are intentionally excluded from Git. Removing the file from the current Git index does not erase it from prior commits; if repository history was shared, restrict access and assess password resets/history cleanup separately.
- The Git history includes commits containing `data/users.json` password hashes. Treat those hashes as exposed: rotate passwords for accounts represented in that history, and assess repository access/history replacement separately. The history check did not find committed `.env`, `.env.local`, or `.env.production` files; this is not proof that no secret was ever shared elsewhere.
- HTTP APIs use security headers, same-origin checks for browser mutations, authenticated member catalog access, and per-process rate limits. These in-process limits and JSON-store serialization protect only a single running instance; use a shared rate limiter and transactional database before scaling horizontally.
- JSON writes retain a mode-restricted last-known-good backup and restore malformed files from that backup. User backups omit plaintext passwords and reset tokens. Protect the persistent disk and any backups as sensitive customer data.
- Stripe Checkout and manual orders reserve stock, and cancelled/rejected orders release reservations. Stripe payment failures/expiry release stock; webhook payment success does not approve the order. The owner dashboard records approval, manual payment verification, fulfillment progress, notes, refund outcomes, and email delivery history separately.

The catalog includes an unpublished snowblower draft with no price, stock, or photo. It is hidden from shoppers and rejected by checkout until an admin adds verified details, a photo, a price, and a quantity. Purchase cost is not stored in the public product listing.

The AI CEO panel is research-only: it sends the submitted command to xAI and has no tools or access to store records. It is a single assistant, not an operational 21-agent system. It is available only to the configured owner account while that account remains an approved admin. The endpoint checks the browser origin, logs request timestamps without logging command contents, and limits requests to 10 per 10 minutes per owner per server process. Configure any additional spending limits in the xAI account.