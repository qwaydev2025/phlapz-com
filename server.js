require('dotenv').config();

const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');

const app = express();
const PORT = process.env.PORT || 3000;
const productsPath = path.join(__dirname, 'data', 'products.json');
const usersPath = path.join(__dirname, 'data', 'users.json');
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'private-store-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

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
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: items.map((item) => ({
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
        userEmail: req.session.user.email
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Stripe checkout failed.' });
  }
});

app.post('/api/admin/products', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { name, category, price, stock, description } = req.body || {};
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
    description: description || ''
  };

  products.unshift(product);
  writeJson(productsPath, products);
  res.status(201).json(product);
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
