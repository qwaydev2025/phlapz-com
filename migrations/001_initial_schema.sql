CREATE TABLE users (
  id text PRIMARY KEY,
  name varchar(100) NOT NULL,
  email varchar(254) NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  approved boolean NOT NULL DEFAULT false,
  auth_version integer NOT NULL DEFAULT 0 CHECK (auth_version >= 0),
  reset_token_hash char(64),
  reset_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_reset_token_hash_format CHECK (
    reset_token_hash IS NULL OR reset_token_hash ~ '^[a-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));
CREATE UNIQUE INDEX users_reset_token_hash_unique ON users (reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;

CREATE TABLE products (
  id text PRIMARY KEY,
  name varchar(120) NOT NULL,
  category varchar(80) NOT NULL,
  description varchar(4000) NOT NULL DEFAULT '',
  price_cents bigint CHECK (price_cents IS NULL OR price_cents >= 0),
  available_stock integer CHECK (available_stock IS NULL OR available_stock >= 0),
  featured boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT true,
  image text NOT NULL DEFAULT '',
  ingredients jsonb NOT NULL DEFAULT '[]'::jsonb,
  allergens jsonb NOT NULL DEFAULT '[]'::jsonb,
  preparation_minutes integer NOT NULL DEFAULT 0 CHECK (preparation_minutes BETWEEN 0 AND 1440),
  customizations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX products_published_category_idx ON products (category, name)
  WHERE published = true;

CREATE TABLE orders (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  checkout_request_id uuid,
  request_fingerprint char(64),
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  customer_name varchar(200) NOT NULL DEFAULT '',
  customer_email varchar(254) NOT NULL DEFAULT '',
  customer_phone varchar(40) NOT NULL DEFAULT '',
  sales_channel text NOT NULL DEFAULT 'website',
  fulfillment_method text NOT NULL DEFAULT 'delivery',
  pickup_time timestamptz,
  customer_notes varchar(1000) NOT NULL DEFAULT '',
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  subtotal_cents bigint NOT NULL CHECK (subtotal_cents >= 0),
  shipping_cents bigint NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  tax_cents bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  tax_jurisdiction varchar(8) NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents = subtotal_cents + shipping_cents + tax_cents),
  currency char(3) NOT NULL DEFAULT 'CAD',
  payment_method text NOT NULL CHECK (payment_method IN ('stripe', 'manual')),
  payment_method_id text,
  payment_method_name varchar(80) NOT NULL,
  payment_instructions text NOT NULL DEFAULT '',
  order_status text NOT NULL CHECK (order_status IN (
    'PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'CANCELLED'
  )),
  payment_status text NOT NULL CHECK (payment_status IN (
    'AWAITING_PAYMENT', 'PENDING', 'PAID', 'FAILED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'
  )),
  fulfillment_status text NOT NULL CHECK (fulfillment_status IN (
    'NOT_STARTED', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED'
  )),
  refund_id text,
  refund_status text,
  email_notifications jsonb NOT NULL DEFAULT '{}'::jsonb,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  internal_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX orders_user_created_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_order_status_created_idx ON orders (order_status, created_at DESC);
CREATE INDEX orders_payment_status_created_idx ON orders (payment_status, created_at DESC);
CREATE INDEX orders_fulfillment_status_created_idx ON orders (fulfillment_status, created_at DESC);
CREATE UNIQUE INDEX orders_checkout_request_unique ON orders (user_id, checkout_request_id)
  WHERE checkout_request_id IS NOT NULL;

CREATE TABLE order_items (
  order_id text NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  line_number integer NOT NULL CHECK (line_number >= 0),
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name varchar(120) NOT NULL,
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  customizations jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (order_id, line_number)
);

CREATE INDEX order_items_product_idx ON order_items (product_id);

CREATE TABLE inventory_reservations (
  order_id text NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL CHECK (status IN ('reserved', 'committed', 'released')),
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, product_id)
);

CREATE INDEX inventory_reservations_expiry_idx ON inventory_reservations (expires_at)
  WHERE status = 'reserved' AND expires_at IS NOT NULL;

CREATE TABLE store_payment_settings (
  singleton_id boolean PRIMARY KEY DEFAULT true CHECK (singleton_id),
  manual_methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  tax_rates jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE store_business_settings (
  singleton_id boolean PRIMARY KEY DEFAULT true CHECK (singleton_id),
  accepting_orders boolean NOT NULL DEFAULT false,
  temporarily_closed boolean NOT NULL DEFAULT false,
  pickup_enabled boolean NOT NULL DEFAULT true,
  delivery_enabled boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'America/Toronto',
  minimum_lead_minutes integer NOT NULL DEFAULT 30 CHECK (minimum_lead_minutes BETWEEN 0 AND 1440),
  weekly_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stripe_events (
  event_id text PRIMARY KEY,
  checkout_session_id text,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  sid text PRIMARY KEY,
  sess jsonb NOT NULL,
  expire timestamptz NOT NULL
);

CREATE INDEX sessions_expire_idx ON sessions (expire);
