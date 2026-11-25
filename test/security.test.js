const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { after, before, test } = require('node:test');
const Stripe = require('stripe');

const projectRoot = path.join(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phlapz-security-test-'));
const usersFile = path.join(dataDir, 'users.json');
const productsFile = path.join(dataDir, 'products.json');
const ordersFile = path.join(dataDir, 'orders.json');
const legacyPassword = crypto.randomBytes(24).toString('base64url');
const legacyMemberPassword = crypto.randomBytes(24).toString('base64url');
const resetPassword = crypto.randomBytes(24).toString('base64url');
const sessionSecret = crypto.randomBytes(32).toString('hex');
const stripeSecret = 'sk_test_' + crypto.randomBytes(24).toString('hex');
const webhookSecret = 'whsec_' + crypto.randomBytes(24).toString('hex');
const stripe = new Stripe(stripeSecret);
let port;
let child;
let childOutput = '';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      listener.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function startServer() {
  childOutput = '';
  child = spawn(process.execPath, [path.join(projectRoot, 'server.js')], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATA_DIR: dataDir,
      APP_URL: `http://127.0.0.1:${port}`,
      SITE_ORIGIN: `http://127.0.0.1:${port}`,
      SESSION_SECRET: sessionSecret,
      PHLAPZ_OWNER_USER_ID: 'owner',
      STRIPE_SECRET_KEY: stripeSecret,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      FOOD_ORDERING_ENABLED: 'false',
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      XAI_API_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before becoming ready:\n${childOutput}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Server did not become ready:\n${childOutput}`);
}

function stopServer() {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
  });
}

async function postJson(route, data, cookie) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(data)
  });
  return { response, data: await response.json() };
}

function sessionCookie(response) {
  return response.headers.get('set-cookie')?.split(';')[0];
}

before(async () => {
  port = await getFreePort();
  fs.writeFileSync(usersFile, JSON.stringify([
    {
      id: 'owner',
      name: 'Test Owner',
      email: 'owner@example.test',
      password: legacyPassword,
      role: 'admin',
      approved: true
    },
    {
      id: 'member',
      name: 'Test Member',
      email: 'member@example.test',
      password: legacyMemberPassword,
      role: 'member',
      approved: true
    }
  ], null, 2));
  fs.writeFileSync(productsFile, JSON.stringify([
    {
      id: 'published-test-item',
      name: 'Published test item',
      category: 'Test',
      price: 10,
      stock: 3,
      published: true,
      image: ''
    },
    {
      id: 'published-food-item',
      name: 'Test sandwich',
      category: 'Signature Sandwiches',
      price: 8,
      stock: 3,
      published: true,
      customizations: [{ id: 'food-extra-cheese', name: 'Extra cheese', price: 1.5 }],
      image: ''
    },
    {
      id: 'snowblower-draft-001',
      name: 'Snowblower - listing details pending',
      category: 'Snowblowers',
      price: null,
      stock: null,
      published: false,
      image: ''
    }
  ], null, 2));
  fs.writeFileSync(ordersFile, '[]');
  await startServer();
});

after(async () => {
  await stopServer();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('hashes legacy credentials, persists sessions, restricts CEO access, resets passwords, and deduplicates Stripe events', async () => {
  let users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  assert.equal(users.length, 2);
  assert.equal(users.filter((user) => Object.hasOwn(user, 'password')).length, 0);
  assert.match(users[0].passwordHash, /^scrypt\$16384\$8\$1\$/);
  const userBackup = JSON.parse(fs.readFileSync(`${usersFile}.bak`, 'utf8'));
  assert.equal(userBackup.some((user) => Object.hasOwn(user, 'password')), false);
  assert.equal(userBackup.some((user) => Object.hasOwn(user, 'resetTokenHash')), false);

  let login = await postJson('/api/login', { email: 'owner@example.test', password: legacyPassword });
  assert.equal(login.response.status, 200);
  const ownerCookie = sessionCookie(login.response);
  assert.ok(ownerCookie);
  assert.match(login.response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/i);
  const pickupSettingsResponse = await fetch(`http://127.0.0.1:${port}/api/admin/business-settings`, {
    headers: { Cookie: ownerCookie }
  });
  assert.equal(pickupSettingsResponse.status, 200);
  const savedPickupSettings = await fetch(`http://127.0.0.1:${port}/api/admin/business-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: JSON.stringify({
      acceptingOrders: true,
      temporarilyClosed: false,
      pickupEnabled: true,
      minimumLeadMinutes: 30,
      hours: { monday: { open: '09:00', close: '17:00' } }
    })
  });
  assert.equal(savedPickupSettings.status, 200);
  assert.equal((await savedPickupSettings.json()).orderingEnabled, false);
  const invalidPickupHours = await fetch(`http://127.0.0.1:${port}/api/admin/business-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: JSON.stringify({
      acceptingOrders: true,
      temporarilyClosed: false,
      pickupEnabled: true,
      minimumLeadMinutes: 30,
      hours: { monday: { open: '17:00', close: '09:00' } }
    })
  });
  assert.equal(invalidPickupHours.status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/ceo/access`, {
    headers: { Cookie: ownerCookie }
  })).status, 200);

  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/ceo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: JSON.stringify({ command: 'Read store records' })
  })).status, 403);

  const memberLogin = await postJson('/api/login', { email: 'member@example.test', password: legacyMemberPassword });
  assert.equal(memberLogin.response.status, 200);
  const memberCookie = sessionCookie(memberLogin.response);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/ceo/access`, {
    headers: { Cookie: memberCookie }
  })).status, 403);
  const draftCheckout = await postJson('/api/create-checkout-session', {
    items: [{ id: 'snowblower-draft-001', quantity: 1 }]
  }, memberCookie);
  assert.equal(draftCheckout.response.status, 400);
  assert.equal((await postJson('/api/create-checkout-session', {
    idempotencyKey: crypto.randomUUID(),
    items: [{ id: 'published-test-item', quantity: 1 }]
  })).response.status, 401);

  const anonymousProducts = await fetch(`http://127.0.0.1:${port}/api/products`);
  assert.equal(anonymousProducts.status, 401);
  const publicMenu = await fetch(`http://127.0.0.1:${port}/api/menu`);
  assert.equal(publicMenu.status, 200);
  assert.deepEqual((await publicMenu.json()).map((product) => product.id), ['published-food-item']);
  const storefrontStatus = await fetch(`http://127.0.0.1:${port}/api/storefront-status`).then((response) => response.json());
  assert.equal(storefrontStatus.websiteAvailable, true);
  assert.equal(storefrontStatus.orderingEnabled, false);
  assert.equal(storefrontStatus.deliveryEnabled, false);
  assert.equal(storefrontStatus.channels.find((channel) => channel.id === 'doordash').status, 'not_connected');
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/business-settings`)).status, 403);
  const productResponse = await fetch(`http://127.0.0.1:${port}/api/products`, {
    headers: { Cookie: memberCookie }
  });
  assert.equal(productResponse.status, 200);
  const visibleProducts = await productResponse.json();
  assert.equal(visibleProducts.some((product) => product.id === 'snowblower-draft-001'), false);
  assert.match(productResponse.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(productResponse.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/orders`)).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/uploads`, { method: 'POST' })).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/logout`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', Cookie: memberCookie }
  })).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/me`, {
    headers: { Cookie: memberCookie }
  }).then((response) => response.json())).user.id, 'member');

  const badReset = await postJson('/api/password-reset/complete', {
    token: crypto.randomBytes(32).toString('hex'),
    password: resetPassword
  });
  assert.equal(badReset.response.status, 400);
  const resetRequest = await postJson('/api/password-reset/request', { email: 'unknown@example.test' });
  assert.equal(resetRequest.response.status, 200);
  assert.match(resetRequest.data.message, /If an account matches/);

  const signupPassword = crypto.randomBytes(24).toString('base64url');
  const signup = await postJson('/api/signup', {
    name: 'New Test Account',
    email: 'new-member@example.test',
    password: signupPassword
  });
  assert.equal(signup.response.status, 201);
  users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  const newMember = users.find((user) => user.email === 'new-member@example.test');
  assert.match(newMember.passwordHash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(Object.hasOwn(newMember, 'password'), false);
  const raceSignupPassword = crypto.randomBytes(24).toString('base64url');
  const duplicateSignups = await Promise.all([1, 2].map(() => postJson('/api/signup', {
    name: 'Concurrent Account',
    email: 'concurrent@example.test',
    password: raceSignupPassword
  })));
  assert.deepEqual(duplicateSignups.map((result) => result.response.status).sort(), [201, 409]);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/users/owner`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: JSON.stringify({ role: 'member' })
  })).status, 409);

  const resetToken = crypto.randomBytes(32).toString('hex');
  users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  users[0].resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  users[0].resetExpiresAt = Date.now() + 60_000;
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

  const concurrentResets = await Promise.all([1, 2].map(() => postJson('/api/password-reset/complete', {
    token: resetToken,
    password: resetPassword
  })));
  assert.deepEqual(concurrentResets.map((result) => result.response.status).sort(), [200, 400]);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/me`, {
    headers: { Cookie: ownerCookie }
  }).then((response) => response.json())).user, null);

  login = await postJson('/api/login', { email: 'owner@example.test', password: resetPassword });
  assert.equal(login.response.status, 200);
  let persistedCookie = sessionCookie(login.response);
  await stopServer();
  await startServer();
  const persistedSession = await fetch(`http://127.0.0.1:${port}/api/me`, {
    headers: { Cookie: persistedCookie }
  }).then((response) => response.json());
  assert.equal(persistedSession.user.id, 'owner');

  const paymentSettingsResponse = await fetch(`http://127.0.0.1:${port}/api/admin/payment-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: persistedCookie },
    body: JSON.stringify({
      manualMethods: [{ name: 'Bank transfer', instructions: 'Transfer to the configured business account.' }],
      taxRates: [{ jurisdiction: 'CA-ON', rate: 0.13 }]
    })
  });
  assert.equal(paymentSettingsResponse.status, 200);
  const paymentSettings = await paymentSettingsResponse.json();
  const manualMethod = paymentSettings.manualMethods[0];
  const guestFoodOrder = await postJson('/api/create-checkout-session', {
    paymentMethod: manualMethod.id,
    idempotencyKey: crypto.randomUUID(),
    items: [{ id: 'published-food-item', quantity: 1, customizationIds: ['food-extra-cheese'] }],
    contact: {
      name: 'Guest Customer',
      email: 'guest@example.test',
      pickupTime: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    }
  });
  assert.equal(guestFoodOrder.response.status, 503);
  const forgedFoodCustomization = await postJson('/api/create-checkout-session', {
    paymentMethod: manualMethod.id,
    idempotencyKey: crypto.randomUUID(),
    items: [{ id: 'published-food-item', quantity: 1, customizationIds: ['forged-option'] }],
    contact: {
      name: 'Guest Customer',
      email: 'guest@example.test',
      pickupTime: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    }
  });
  assert.equal(forgedFoodCustomization.response.status, 400);
  const paymentOptions = await fetch(`http://127.0.0.1:${port}/api/payment-options`, {
    headers: { Cookie: memberCookie }
  });
  assert.equal(paymentOptions.status, 200);
  assert.equal((await paymentOptions.json()).manualMethods[0].id, manualMethod.id);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/payment-settings`)).status, 403);

  const manualOrderPayload = {
    paymentMethod: manualMethod.id,
    idempotencyKey: crypto.randomUUID(),
    items: [{ id: 'published-test-item', quantity: 1, price: 0, name: 'Client supplied fake price' }],
    paymentStatus: 'PAID',
    orderStatus: 'CONFIRMED',
    contact: {
      phone: '555-0100',
      street: '10 Main Street',
      city: 'Toronto',
      province: 'ON',
      postalCode: 'M5V 1A1',
      country: 'CA'
    }
  };
  const manualOrderResponse = await postJson('/api/create-checkout-session', manualOrderPayload, memberCookie);
  assert.equal(manualOrderResponse.response.status, 201, manualOrderResponse.data.error);
  assert.equal(manualOrderResponse.data.manual, true);
  assert.match(manualOrderResponse.data.instructions, /business account/);
  assert.equal(manualOrderResponse.data.order.orderStatus, 'PENDING_CONFIRMATION');
  assert.equal(manualOrderResponse.data.order.paymentStatus, 'AWAITING_PAYMENT');
  assert.equal(manualOrderResponse.data.order.fulfillmentStatus, 'NOT_STARTED');
  assert.equal(manualOrderResponse.data.order.subtotal, 10);
  assert.equal(manualOrderResponse.data.order.tax, 1.3);
  assert.equal(manualOrderResponse.data.order.amount, 11.3);
  assert.equal(manualOrderResponse.data.emailPending, true);
  const manualOrderId = manualOrderResponse.data.order.id;
  const savedManualOrder = JSON.parse(fs.readFileSync(ordersFile, 'utf8')).find((order) => order.id === manualOrderId);
  assert.equal(savedManualOrder.emailNotifications.received.owner.status, 'failed');
  assert.equal(savedManualOrder.emailNotifications.received.customer.status, 'failed');
  assert.equal(JSON.parse(fs.readFileSync(productsFile, 'utf8')).find((product) => product.id === 'published-test-item').stock, 2);
  const duplicateManualOrder = await postJson('/api/create-checkout-session', manualOrderPayload, memberCookie);
  assert.equal(duplicateManualOrder.response.status, 201);
  assert.equal(duplicateManualOrder.data.order.id, manualOrderId);
  assert.equal(JSON.parse(fs.readFileSync(productsFile, 'utf8')).find((product) => product.id === 'published-test-item').stock, 2);
  const missingTaxOrder = await postJson('/api/create-checkout-session', {
    ...manualOrderPayload,
    idempotencyKey: crypto.randomUUID(),
    contact: { ...manualOrderPayload.contact, province: 'QC' }
  }, memberCookie);
  assert.equal(missingTaxOrder.response.status, 409);
  const unauthenticatedRefund = await fetch(`http://127.0.0.1:${port}/api/admin/orders/${manualOrderId}/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(unauthenticatedRefund.status, 403);

  const prematureConfirmation = await fetch(`http://127.0.0.1:${port}/api/admin/orders/${manualOrderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: persistedCookie },
    body: JSON.stringify({ action: 'confirm' })
  });
  assert.equal(prematureConfirmation.status, 409);
  const unpaidConfirmation = await fetch(`http://127.0.0.1:${port}/api/admin/orders/${manualOrderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: persistedCookie },
    body: JSON.stringify({ action: 'confirm_unpaid' })
  });
  assert.equal(unpaidConfirmation.status, 200);
  const paymentReceived = await fetch(`http://127.0.0.1:${port}/api/admin/orders/${manualOrderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: persistedCookie },
    body: JSON.stringify({ action: 'mark_payment_received', reference: 'Owner bank reconciliation' })
  });
  assert.equal(paymentReceived.status, 200);
  const paidManualOrder = await paymentReceived.json();
  assert.equal(paidManualOrder.paymentStatus, 'PAID');
  assert.equal(paidManualOrder.orderStatus, 'CONFIRMED');
  const unpaidFulfillment = await fetch(`http://127.0.0.1:${port}/api/admin/orders/${manualOrderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: persistedCookie },
    body: JSON.stringify({ action: 'fulfillment', fulfillmentStatus: 'PROCESSING' })
  });
  assert.equal(unpaidFulfillment.status, 200);
  const cancelledManualOrder = await fetch(`http://127.0.0.1:${port}/api/admin/orders/${manualOrderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: persistedCookie },
    body: JSON.stringify({ action: 'cancel' })
  });
  assert.equal(cancelledManualOrder.status, 200);
  assert.equal((await cancelledManualOrder.json()).orderStatus, 'CANCELLED');
  assert.equal(JSON.parse(fs.readFileSync(productsFile, 'utf8')).find((product) => product.id === 'published-test-item').stock, 3);
  const manualRefund = await fetch(`http://127.0.0.1:${port}/api/admin/orders/${manualOrderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: persistedCookie },
    body: JSON.stringify({ action: 'mark_manual_refunded', reference: 'Transfer returned' })
  });
  assert.equal(manualRefund.status, 200);
  assert.equal((await manualRefund.json()).paymentStatus, 'REFUNDED');

  const checkoutSessionId = 'cs_test_' + crypto.randomBytes(12).toString('hex');
  const event = {
    id: 'evt_test_' + crypto.randomBytes(12).toString('hex'),
    object: 'event',
    api_version: '2025-03-31.basil',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: checkoutSessionId,
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        currency: 'cad',
        amount_total: 1000,
        payment_intent: 'pi_test_' + crypto.randomBytes(12).toString('hex'),
        customer_details: { name: '=HYPERLINK("https://evil.example","click")', email: 'buyer@example.test' },
        metadata: {
          userId: 'member',
          userEmail: 'member@example.test',
          items: JSON.stringify([{ id: 'published-test-item', name: 'Published test item', price: 10, quantity: 1 }])
        }
      }
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'checkout.session.completed'
  };
  const rawEvent = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload: rawEvent, secret: webhookSecret });
  const invalidSignature = await fetch(`http://127.0.0.1:${port}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': 'invalid' },
    body: rawEvent
  });
  assert.equal(invalidSignature.status, 400);
  const duplicateDeliveries = await Promise.all([1, 2].map(() => fetch(`http://127.0.0.1:${port}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
      body: rawEvent
    })));
  assert.deepEqual(duplicateDeliveries.map((response) => response.status), [200, 200]);

  const concurrentDeliveries = await Promise.all([1, 2].map(async () => {
    const concurrentEvent = {
      ...event,
      id: 'evt_test_' + crypto.randomBytes(12).toString('hex'),
      data: {
        object: {
          ...event.data.object,
          id: 'cs_test_' + crypto.randomBytes(12).toString('hex'),
          payment_intent: 'pi_test_' + crypto.randomBytes(12).toString('hex')
        }
      }
    };
    const payload = JSON.stringify(concurrentEvent);
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    return fetch(`http://127.0.0.1:${port}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': header },
      body: payload
    });
  }));
  assert.deepEqual(concurrentDeliveries.map((response) => response.status), [200, 200]);

  const products = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
  const orderedProduct = products.find((product) => product.id === 'published-test-item');
  assert.equal(orderedProduct.stock, 0);
  assert.equal(orderedProduct.stockAdjustmentEvents.length, 4);
  assert.equal(JSON.parse(fs.readFileSync(ordersFile, 'utf8')).length, 4);
  const paidOrder = JSON.parse(fs.readFileSync(ordersFile, 'utf8')).find((order) => order.paymentStatus === 'PAID'
    && order.paymentMethod === 'stripe');
  assert.equal(paidOrder.orderStatus, 'PENDING_CONFIRMATION');
  const confirmStripeOrder = await fetch(`http://127.0.0.1:${port}/api/admin/orders/${paidOrder.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: persistedCookie },
    body: JSON.stringify({ action: 'confirm' })
  });
  assert.equal(confirmStripeOrder.status, 200);
  const fulfillStripeOrder = await fetch(`http://127.0.0.1:${port}/api/admin/orders/${paidOrder.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: persistedCookie },
    body: JSON.stringify({ action: 'fulfillment', fulfillmentStatus: 'PROCESSING' })
  });
  assert.equal(fulfillStripeOrder.status, 200);
  const rejectPaidStripeOrder = await fetch(`http://127.0.0.1:${port}/api/admin/orders/${paidOrder.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: persistedCookie },
    body: JSON.stringify({ action: 'reject' })
  });
  assert.equal(rejectPaidStripeOrder.status, 200);
  const refundId = 're_test_' + crypto.randomBytes(12).toString('hex');
  const refundEvents = ['refund.created', 'refund.updated'].map((type, index) => ({
    ...event,
    id: 'evt_test_' + crypto.randomBytes(12).toString('hex'),
    type,
    data: {
      object: {
        id: refundId,
        object: 'refund',
        payment_intent: paidOrder.stripePaymentIntent,
        status: index === 0 ? 'pending' : 'succeeded',
        amount: 1000,
        currency: 'cad'
      }
    }
  }));
  for (const [index, refundEvent] of refundEvents.entries()) {
    const payload = JSON.stringify(refundEvent);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const response = await fetch(`http://127.0.0.1:${port}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
      body: payload
    });
    assert.equal(response.status, 200);
    const updatedOrder = JSON.parse(fs.readFileSync(ordersFile, 'utf8')).find((order) => order.id === paidOrder.id);
    assert.equal(updatedOrder.paymentStatus, index === 0 ? 'REFUND_PENDING' : 'REFUNDED');
  }
  const succeededRefund = refundEvents[1];
  const succeededRefundPayload = JSON.stringify(succeededRefund);
  const succeededRefundSignature = stripe.webhooks.generateTestHeaderString({
    payload: succeededRefundPayload,
    secret: webhookSecret
  });
  const duplicateRefundEvent = await fetch(`http://127.0.0.1:${port}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': succeededRefundSignature },
    body: succeededRefundPayload
  });
  assert.equal(duplicateRefundEvent.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(ordersFile, 'utf8')).find((order) => order.id === paidOrder.id).paymentStatus, 'REFUNDED');
  const csvExport = await fetch(`http://127.0.0.1:${port}/api/admin/export/orders`, {
    headers: { Cookie: persistedCookie }
  });
  assert.equal(csvExport.status, 200);
  assert.match(await csvExport.text(), /"'=HYPERLINK/);

  const failedCheckoutId = 'cs_test_' + crypto.randomBytes(12).toString('hex');
  const failedOrderId = 'order-test-reservation';
  const failedOrder = {
    id: failedOrderId,
    stripeSessionId: failedCheckoutId,
    userId: 'member',
    amount: 10,
    status: 'checkout_pending',
    inventoryReserved: true,
    items: [{ id: 'published-test-item', quantity: 1 }]
  };
  const currentOrders = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
  currentOrders.unshift(failedOrder);
  fs.writeFileSync(ordersFile, JSON.stringify(currentOrders, null, 2));
  const currentProducts = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
  const reservedProduct = currentProducts.find((product) => product.id === 'published-test-item');
  reservedProduct.stockAdjustmentEvents.push(failedOrderId);
  fs.writeFileSync(productsFile, JSON.stringify(currentProducts, null, 2));
  const expirationEvent = {
    ...event,
    id: 'evt_test_' + crypto.randomBytes(12).toString('hex'),
    type: 'checkout.session.expired',
    data: {
      object: {
        ...event.data.object,
        id: failedCheckoutId,
        amount_total: 1000,
        metadata: { orderId: failedOrderId, userId: 'member', userEmail: 'member@example.test' }
      }
    }
  };
  const expirationPayload = JSON.stringify(expirationEvent);
  const expirationSignature = stripe.webhooks.generateTestHeaderString({ payload: expirationPayload, secret: webhookSecret });
  const expiredResponse = await fetch(`http://127.0.0.1:${port}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': expirationSignature },
    body: expirationPayload
  });
  assert.equal(expiredResponse.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(ordersFile, 'utf8')).find((order) => order.id === failedOrderId).paymentStatus, 'FAILED');
  assert.equal(JSON.parse(fs.readFileSync(productsFile, 'utf8')).find((product) => product.id === 'published-test-item').stock, 2);
  const duplicateExpiration = await fetch(`http://127.0.0.1:${port}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': expirationSignature },
    body: expirationPayload
  });
  assert.equal(duplicateExpiration.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(productsFile, 'utf8')).find((product) => product.id === 'published-test-item').stock, 2);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/orders/${failedOrderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: persistedCookie },
    body: JSON.stringify({ status: 'fulfilled' })
  })).status, 409);

  const uploadForm = new FormData();
  uploadForm.append('image', new Blob(['not an image']), 'fake.png');
  const invalidUpload = await fetch(`http://127.0.0.1:${port}/api/admin/uploads`, {
    method: 'POST',
    headers: { Cookie: persistedCookie },
    body: uploadForm
  });
  assert.equal(invalidUpload.status, 400);

  const newProduct = await fetch(`http://127.0.0.1:${port}/api/admin/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: persistedCookie },
    body: JSON.stringify({
      name: 'Validated test product',
      category: 'Test',
      price: 4.5,
      stock: 2,
      description: 'A test item',
      image: '',
      published: true
    })
  });
  assert.equal(newProduct.status, 201);
  const createdProduct = await newProduct.json();
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/products/${createdProduct.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: persistedCookie },
    body: JSON.stringify({
      name: 'Updated test product',
      category: 'Test',
      price: 5,
      stock: 2,
      description: 'Updated',
      image: '',
      published: true
    })
  })).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/products/${createdProduct.id}`, {
    method: 'DELETE',
    headers: { Cookie: persistedCookie }
  })).status, 200);

  const publishSnowblowerWithoutPhoto = await fetch(`http://127.0.0.1:${port}/api/admin/products/snowblower-draft-001`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: persistedCookie },
    body: JSON.stringify({
      name: 'Snowblower',
      category: 'Snowblowers',
      description: 'Details pending',
      price: 100,
      stock: 1,
      image: '',
      published: true
    })
  });
  assert.equal(publishSnowblowerWithoutPhoto.status, 400);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const failedLogin = await postJson('/api/login', {
      email: 'unknown@example.test',
      password: crypto.randomBytes(24).toString('base64url')
    });
    assert.equal(failedLogin.response.status, 401);
  }
  const rateLimitedLogin = await postJson('/api/login', {
    email: 'unknown@example.test',
    password: crypto.randomBytes(24).toString('base64url')
  });
  assert.equal(rateLimitedLogin.response.status, 429);

  fs.writeFileSync(productsFile, '{corrupt');
  const recoveredProducts = await fetch(`http://127.0.0.1:${port}/api/products`, {
    headers: { Cookie: memberCookie }
  });
  assert.equal(recoveredProducts.status, 200);
  assert.equal(Array.isArray(await recoveredProducts.json()), true);
});

test('public food products expose validated ingredients and priced customization choices', async () => {
  await stopServer();
  await startServer();
  const login = await postJson('/api/login', {
    email: 'owner@example.test',
    password: resetPassword
  });
  assert.equal(login.response.status, 200);
  const cookie = sessionCookie(login.response);
  const productPayload = {
    name: 'Admin managed sandwich',
    category: 'Signature Sandwiches',
    price: 12.5,
    stock: 4,
    description: 'A configurable menu item.',
    ingredients: ['Egg', 'Sausage'],
    allergens: ['Egg', 'Wheat'],
    preparationMinutes: 12,
    customizations: [{ name: 'Add cheese', price: 1.5 }],
    published: true
  };
  const create = await fetch(`http://127.0.0.1:${port}/api/admin/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(productPayload)
  });
  assert.equal(create.status, 201);
  const createdProduct = await create.json();
  assert.deepEqual(createdProduct.ingredients, ['Egg', 'Sausage']);
  assert.equal(createdProduct.customizations[0].price, 1.5);

  const publicMenu = await fetch(`http://127.0.0.1:${port}/api/menu`).then((response) => response.json());
  const publicProduct = publicMenu.find((product) => product.id === createdProduct.id);
  assert.equal(publicProduct.preparationMinutes, 12);
  assert.equal(publicProduct.customizations[0].id, createdProduct.customizations[0].id);
  assert.equal(Object.hasOwn(publicProduct, 'stockAdjustmentEvents'), false);

  const invalidUpdate = await fetch(`http://127.0.0.1:${port}/api/admin/products/${createdProduct.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ ...productPayload, customizations: [{ name: 'Add cheese', price: 1.237 }] })
  });
  assert.equal(invalidUpdate.status, 400);
});

test('guest pickup checkout uses server customization prices, validates hours, and reserves stock once', async () => {
  const checkoutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phlapz-food-checkout-test-'));
  const checkoutPort = await getFreePort();
  let checkoutChild;
  let output = '';

  try {
    fs.writeFileSync(path.join(checkoutDir, 'products.json'), JSON.stringify([{
      id: 'guest-sandwich',
      name: 'Guest sandwich',
      category: 'Signature Sandwiches',
      price: 10,
      stock: 3,
      published: true,
      customizations: [{ id: 'add-cheese', name: 'Add cheese', price: 1.5 }]
    }]));
    fs.writeFileSync(path.join(checkoutDir, 'orders.json'), '[]');
    fs.writeFileSync(path.join(checkoutDir, 'payment-settings.json'), JSON.stringify({
      manualMethods: [{ id: 'pay-at-pickup', name: 'Pay at pickup', instructions: 'Pay when you collect.' }],
      taxRates: [{ jurisdiction: 'CA-ON', rate: 0.13 }]
    }));
    fs.writeFileSync(path.join(checkoutDir, 'business-settings.json'), JSON.stringify({
      acceptingOrders: true,
      temporarilyClosed: false,
      pickupEnabled: true,
      deliveryEnabled: false,
      timezone: 'America/Toronto',
      minimumLeadMinutes: 5,
      hours: {
        monday: { open: '00:00', close: '23:59' },
        tuesday: { open: '00:00', close: '23:59' },
        wednesday: { open: '00:00', close: '23:59' },
        thursday: { open: '00:00', close: '23:59' },
        friday: { open: '00:00', close: '23:59' },
        saturday: { open: '00:00', close: '23:59' },
        sunday: { open: '00:00', close: '23:59' }
      }
    }));

    checkoutChild = spawn(process.execPath, [path.join(projectRoot, 'server.js')], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(checkoutPort),
        DATA_DIR: checkoutDir,
        APP_URL: `http://127.0.0.1:${checkoutPort}`,
        SITE_ORIGIN: `http://127.0.0.1:${checkoutPort}`,
        SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
        FOOD_ORDERING_ENABLED: 'true',
        STRIPE_SECRET_KEY: '',
        SMTP_HOST: '',
        SMTP_USER: '',
        SMTP_PASS: ''
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    checkoutChild.stdout.on('data', (chunk) => { output += chunk.toString(); });
    checkoutChild.stderr.on('data', (chunk) => { output += chunk.toString(); });

    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (checkoutChild.exitCode !== null) throw new Error(`Food checkout server exited:\n${output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${checkoutPort}/api/health`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.equal(ready, true, `Food checkout server did not start:\n${output}`);

    const request = {
      paymentMethod: 'pay-at-pickup',
      idempotencyKey: crypto.randomUUID(),
      items: [{
        id: 'guest-sandwich',
        quantity: 2,
        customizationIds: ['add-cheese'],
        price: 0,
        name: 'Client supplied fake price'
      }],
      contact: {
        name: 'Pickup Guest',
        email: 'pickup@example.test',
        pickupTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        notes: 'Ring the bell'
      }
    };
    const createOrder = async (payload) => {
      const response = await fetch(`http://127.0.0.1:${checkoutPort}/api/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return { response, data: await response.json() };
    };
    const created = await createOrder(request);
    assert.equal(created.response.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.order.subtotal, 23);
    assert.equal(created.data.order.tax, 2.99);
    assert.equal(created.data.order.amount, 25.99);
    assert.equal(created.data.order.fulfillmentMethod, 'pickup');
    assert.equal(created.data.order.orderStatus, 'PENDING_CONFIRMATION');
    const persistedOrder = JSON.parse(fs.readFileSync(path.join(checkoutDir, 'orders.json'), 'utf8'))[0];
    assert.equal(persistedOrder.salesChannel, 'website');
    assert.equal(persistedOrder.items[0].price, 11.5);
    assert.equal(persistedOrder.items[0].customizations[0].name, 'Add cheese');
    assert.equal(JSON.parse(fs.readFileSync(path.join(checkoutDir, 'products.json'), 'utf8'))[0].stock, 1);

    const duplicate = await createOrder(request);
    assert.equal(duplicate.response.status, 201);
    assert.equal(duplicate.data.order.id, created.data.order.id);
    assert.equal(JSON.parse(fs.readFileSync(path.join(checkoutDir, 'products.json'), 'utf8'))[0].stock, 1);

    const pickupParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      weekday: 'long',
      hour: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(request.contact.pickupTime)).map((part) => [part.type, part.value]));
    const closedWindowHour = Number(pickupParts.hour) === 12 ? '13' : '12';
    const restrictedHours = Object.fromEntries(
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        .map((day) => [day, { open: `${closedWindowHour}:00`, close: `${closedWindowHour}:01` }])
    );
    fs.writeFileSync(path.join(checkoutDir, 'business-settings.json'), JSON.stringify({
      acceptingOrders: true,
      temporarilyClosed: false,
      pickupEnabled: true,
      timezone: 'America/Toronto',
      minimumLeadMinutes: 5,
      hours: restrictedHours
    }));
    const outsideHours = await createOrder({ ...request, idempotencyKey: crypto.randomUUID() });
    assert.equal(outsideHours.response.status, 400);
  } finally {
    if (checkoutChild && checkoutChild.exitCode === null) {
      await new Promise((resolve) => {
        checkoutChild.once('exit', resolve);
        checkoutChild.kill();
      });
    }
    fs.rmSync(checkoutDir, { recursive: true, force: true });
  }
});

test('bootstraps an admin with a password hash when the user store is missing', async () => {
  const bootstrapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phlapz-bootstrap-test-'));
  const bootstrapPort = await getFreePort();
  const bootstrapPassword = crypto.randomBytes(24).toString('base64url');
  const bootstrapSecret = crypto.randomBytes(32).toString('hex');
  const bootstrapChild = spawn(process.execPath, [path.join(projectRoot, 'server.js')], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(bootstrapPort),
      DATA_DIR: bootstrapDir,
      APP_URL: `http://127.0.0.1:${bootstrapPort}`,
      SESSION_SECRET: bootstrapSecret,
      INITIAL_ADMIN_EMAIL: 'bootstrap@example.test',
      INITIAL_ADMIN_PASSWORD: bootstrapPassword
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  bootstrapChild.stdout.on('data', (chunk) => { output += chunk.toString(); });
  bootstrapChild.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (bootstrapChild.exitCode !== null) {
        throw new Error(`Bootstrap server exited before becoming ready:\n${output}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${bootstrapPort}/api/health`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.equal(ready, true, `Bootstrap server did not become ready:\n${output}`);

    const users = JSON.parse(fs.readFileSync(path.join(bootstrapDir, 'users.json'), 'utf8'));
    assert.equal(users.length, 1);
    assert.equal(users[0].email, 'bootstrap@example.test');
    assert.match(users[0].passwordHash, /^scrypt\$16384\$8\$1\$/);
    assert.equal(Object.hasOwn(users[0], 'password'), false);

    const login = await fetch(`http://127.0.0.1:${bootstrapPort}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bootstrap@example.test', password: bootstrapPassword })
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.role, 'admin');
  } finally {
    if (bootstrapChild.exitCode === null) {
      await new Promise((resolve) => {
        bootstrapChild.once('exit', resolve);
        bootstrapChild.kill();
      });
    }
    fs.rmSync(bootstrapDir, { recursive: true, force: true });
  }
});
