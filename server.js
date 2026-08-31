require('dotenv').config();

const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const productsPath = path.join(__dirname, 'data', 'products.json');
const usersPath = path.join(__dirname, 'data', 'users.json');
const ordersPath = path.join(__dirname, 'data', 'orders.json');
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const adminEmail = process.env.ADMIN_EMAIL || '';
const mailTransport = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    })
  : null;

app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'private-store-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

function ensureOrdersFile() {
  if (!fs.existsSync(ordersPath)) {
    fs.writeFileSync(ordersPath, JSON.stringify([], null, 2));
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getUserByEmail(email) {
  const users = readJson(usersPath);
  return users.find((user) => user.email.toLowerCase() === email.toLowerCase());
}

function serializeUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, approved: user.approved };
}

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

async function sendAdminOrderAlert(order) {
  if (!mailTransport || !adminEmail) return;

  const itemSummary = order.items.map((item) => `${item.name} x${item.quantity} @ ${formatCurrency(item.price)}`).join('\n');
  const emailText = [
    'New successful purchase received.',
    '',
    `Customer: ${order.customerName}`,
    `Email: ${order.customerEmail}`,
    `Amount: ${formatCurrency(order.amount)}`,
    `Payment: Verified via Stripe`,
    `Items:\n${itemSummary}`,
    '',
    'This customer has completed a paid purchase and can be notified to pick up or ship.'
  ].join('\n');

  await mailTransport.sendMail({
    from: process.env.SMTP_USER,
    to: adminEmail,
    subject: `Paid order: ${order.customerName} - ${formatCurrency(order.amount)}`,
    text: emailText,
    html: `<h2>New successful purchase</h2><p><strong>Customer:</strong> ${order.customerName}</p><p><strong>Email:</strong> ${order.customerEmail}</p><p><strong>Amount:</strong> ${formatCurrency(order.amount)}</p><p><strong>Payment:</strong> Verified via Stripe</p><p><strong>Items:</strong></p><ul>${order.items.map((item) => `<li>${item.name} x${item.quantity} @ ${formatCurrency(item.price)}</li>`).join('')}</ul>`
  });
}

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ user: req.session.user });
});

app.post('/api/signup', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }

  const users = readJson(usersPath);
  if (users.some((user) => user.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'This email is already registered.' });
  }

  const newUser = {
    id: `user-${Date.now()}`,
    name,
    email,
    password,
    role: 'member',
    approved: true
  };
  users.push(newUser);
  writeJson(usersPath, users);

  req.session.user = serializeUser(newUser);
  res.status(201).json({ user: req.session.user });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = getUserByEmail(email);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  req.session.user = serializeUser(user);
  res.json({ user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/users', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const users = readJson(usersPath)
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      approved: user.approved
    }));

  res.json(users);
});

app.put('/api/admin/users/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { role, approved } = req.body || {};
  const users = readJson(usersPath);
  const user = users.find((item) => item.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (role) user.role = role;
  if (approved !== undefined) user.approved = approved;

  writeJson(usersPath, users);
  res.json({ ok: true, user });
});

app.delete('/api/admin/users/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const users = readJson(usersPath);
  const filtered = users.filter((user) => user.id !== req.params.id);
  writeJson(usersPath, filtered);
  res.json({ ok: true });
});

app.get('/api/admin/check', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  res.json({ ok: true, user: req.session.user });
});

app.get('/api/admin/summary', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const users = readJson(usersPath);
  const products = readJson(productsPath);
  const orders = fs.existsSync(ordersPath) ? readJson(ordersPath) : [];
  const revenue = orders.reduce((sum, order) => sum + Number(order.amount || 0), 0);
  const lowStockProducts = products.filter((p) => Number(p.stock || 0) <= 5);

  res.json({
    users: users.length,
    products: products.length,
    orders: orders.length,
    revenue,
    lowStockCount: lowStockProducts.length,
    recentMembers: users.slice(0, 5).map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    })),
    recentOrders: orders.slice(0, 5).map((order) => ({
      id: order.id,
      customerName: order.customerName,
      amount: order.amount,
      status: order.status
    }))
  });
});

app.get('/api/admin/orders', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const orders = fs.existsSync(ordersPath) ? readJson(ordersPath) : [];
  res.json(orders);
});

app.get('/api/admin/export/orders', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const orders = fs.existsSync(ordersPath) ? readJson(ordersPath) : [];
  const csvHeader = ['Order ID', 'Customer', 'Email', 'Amount', 'Status', 'Date', 'Items'].join(',');
  const csvRows = orders.map((order) => {
    const itemStr = (order.items || []).map((item) => `${item.name}x${item.quantity}`).join('; ');
    const date = new Date(order.createdAt || Date.now()).toLocaleDateString();
    return [order.id, `"${order.customerName}"`, order.customerEmail, order.amount, order.status || 'paid', date, `"${itemStr}"`].join(',');
  });

  const csv = [csvHeader, ...csvRows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="orders-export.csv"');
  res.send(csv);
});

app.get('/api/admin/health', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const users = readJson(usersPath);
  const products = readJson(productsPath);
  const orders = fs.existsSync(ordersPath) ? readJson(ordersPath) : [];

  const lowStockProducts = products.filter((p) => Number(p.stock || 0) <= 5);
  const paidOrders = orders.filter((o) => o.status === 'paid').length;
  const unfulfilledOrders = orders.filter((o) => o.status !== 'fulfilled' && o.status !== 'cancelled').length;
  const todaysOrders = orders.filter((o) => {
    const orderDate = new Date(o.createdAt || Date.now());
    const today = new Date();
    return orderDate.toDateString() === today.toDateString();
  }).length;

  res.json({
    storeHealth: 'running',
    totalMembers: users.length,
    totalProducts: products.length,
    totalOrders: orders.length,
    todaysOrders,
    paidOrders,
    unfulfilledOrders,
    lowStockProducts: lowStockProducts.map((p) => ({ id: p.id, name: p.name, stock: p.stock })),
    lastOrderTime: orders.length > 0 ? orders[0].createdAt : null,
    avgOrderValue: orders.length > 0 ? (orders.reduce((sum, o) => sum + Number(o.amount || 0), 0) / orders.length).toFixed(2) : 0
  });
});

app.get('/api/products', (req, res) => {
  const products = readJson(productsPath);
  res.json(products);
});

app.post('/api/create-checkout-session', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Please sign in before checking out.' });
  }

  if (!stripe) {
    return res.status(400).json({ error: 'Stripe is not configured yet. Add STRIPE_SECRET_KEY to .env.' });
  }

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) {
    return res.status(400).json({ error: 'Your cart is empty.' });
  }

  try {
    const normalizedItems = items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description || 'Member purchase',
      price: Number(item.price || 0),
      quantity: Number(item.quantity || 1)
    }));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: normalizedItems.map((item) => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.name,
            description: item.description || 'Member purchase'
          },
          unit_amount: Math.round(Number(item.price) * 100)
        },
        quantity: Number(item.quantity || 1)
      })),
      success_url: `${process.env.APP_URL || 'http://localhost:3000'}/?checkout=success`,
      cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/?checkout=cancelled`,
      customer_email: req.session.user.email,
      metadata: {
        userId: req.session.user.id,
        userEmail: req.session.user.email,
        items: JSON.stringify(normalizedItems),
        totalAmount: String(normalizedItems.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0))
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Stripe checkout failed.' });
  }
});

app.post('/api/stripe/webhook', async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(400).json({ error: 'Stripe webhook is not configured.' });
  }

  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerName = session.customer_details?.name || session.metadata?.userEmail || 'Customer';
    const customerEmail = session.customer_details?.email || session.metadata?.userEmail || 'unknown@email.com';
    const items = session.metadata?.items ? JSON.parse(session.metadata.items) : [];
    const order = {
      id: `order-${Date.now()}`,
      customerName,
      customerEmail,
      amount: Number(session.amount_total ? session.amount_total / 100 : Number(session.metadata?.totalAmount || 0)),
      status: 'paid',
      createdAt: new Date().toISOString(),
      items
    };

    ensureOrdersFile();
    const orders = readJson(ordersPath);
    orders.unshift(order);
    writeJson(ordersPath, orders);

    await sendAdminOrderAlert(order);
  }

  res.json({ received: true });
});

app.post('/api/admin/products', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { name, category, price, stock, description, image } = req.body || {};
  if (!name || !category || price === undefined || stock === undefined) {
    return res.status(400).json({ error: 'Name, category, price, and stock are required.' });
  }

  const products = readJson(productsPath);
  const product = {
    id: `p-${Date.now()}`,
    name,
    category,
    price: Number(price),
    stock: Number(stock),
    featured: false,
    description: description || '',
    image: image || ''
  };

  products.unshift(product);
  writeJson(productsPath, products);
  res.status(201).json(product);
});

app.put('/api/admin/products/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { name, category, price, stock, description, image } = req.body || {};
  if (!name || !category || price === undefined || stock === undefined) {
    return res.status(400).json({ error: 'Name, category, price, and stock are required.' });
  }

  const products = readJson(productsPath);
  const product = products.find((item) => item.id === req.params.id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  product.name = name;
  product.category = category;
  product.price = Number(price);
  product.stock = Number(stock);
  product.description = description || '';
  product.image = image || '';

  writeJson(productsPath, products);
  res.json(product);
});

app.patch('/api/admin/orders/:id/status', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { status } = req.body || {};
  const validStatuses = ['paid', 'pending', 'fulfilled', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'A valid status is required.' });
  }

  const orders = fs.existsSync(ordersPath) ? readJson(ordersPath) : [];
  const order = orders.find((item) => item.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found.' });
  }

  order.status = status;
  writeJson(ordersPath, orders);
  res.json(order);
});

app.delete('/api/admin/products/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const products = readJson(productsPath);
  const filtered = products.filter((product) => product.id !== req.params.id);
  writeJson(productsPath, filtered);
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Private storefront running at http://localhost:${PORT}`);
});
