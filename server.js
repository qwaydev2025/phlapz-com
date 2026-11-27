require('dotenv').config();

const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const multer = require('multer');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET must be configured with at least 32 characters in production.');
}
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const scrypt = promisify(crypto.scrypt);
app.set('trust proxy', 1);
const bundledDataPath = path.join(__dirname, 'data');
const dataPath = process.env.DATA_DIR || bundledDataPath;
const productsPath = path.join(dataPath, 'products.json');
const usersPath = path.join(dataPath, 'users.json');
const ordersPath = path.join(dataPath, 'orders.json');
const paymentSettingsPath = path.join(dataPath, 'payment-settings.json');
const businessSettingsPath = path.join(dataPath, 'business-settings.json');
const sessionPath = path.join(dataPath, 'sessions');
const uploadsPath = path.join(dataPath, 'uploads');
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const adminEmail = process.env.ADMIN_EMAIL || '';
const foodCategories = new Set([
  'Signature Sandwiches',
  'Loaded Sandwiches',
  'Jamaican Patties',
  'Combos',
  'Drinks'
]);
const foodOrderingEnabled = process.env.FOOD_ORDERING_ENABLED === 'true';
const ceoRequestWindows = new Map();
const passwordResetRequests = new Map();
const loginFailures = new Map();
let serializedStoreQueue = Promise.resolve();
let dummyPasswordHash;
const requestRateLimits = new Map();
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

fs.mkdirSync(dataPath, { recursive: true, mode: 0o700 });
for (const fileName of ['products.json', 'orders.json']) {
  const targetPath = path.join(dataPath, fileName);
  const sourcePath = path.join(bundledDataPath, fileName);

  if (fs.existsSync(targetPath)) {
    continue;
  }

  if (
    path.resolve(sourcePath) !== path.resolve(targetPath) &&
    fs.existsSync(sourcePath)
  ) {
    fs.copyFileSync(sourcePath, targetPath);
  } else {
    fs.writeFileSync(targetPath, '[]', { mode: 0o600 });
  }
}
function ensureSnowblowerDraft() {
  const products = readJson(productsPath);
  if (products.some((product) => /snow\s*blower/i.test(String(product.name || '')))) {
    return;
  }

  products.push({
    id: 'snowblower-draft-001',
    name: 'Snowblower - listing details pending',
    category: 'Snowblowers',
    price: null,
    stock: null,
    featured: false,
    published: false,
    description: 'Unpublished draft. Confirm the brand, model, condition, specifications, selling price, available quantity, and product photos before publishing.',
    image: ''
  });
  writeJson(productsPath, products);
}
ensureSnowblowerDraft();
fs.mkdirSync(uploadsPath, { recursive: true, mode: 0o700 });
fs.mkdirSync(sessionPath, { recursive: true, mode: 0o700 });
const sessionStore = new FileStore({
  path: sessionPath,
  ttl: 60 * 60 * 8,
  reapInterval: 60 * 60,
  retries: 0,
  secret: sessionSecret
});
sessionStore.on('error', (error) => {
  console.error('[Sessions] Persistent session store error:', error.message);
});
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsPath,
    filename: (req, file, callback) => {
      const extensions = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif'
      };
      callback(null, `product-${crypto.randomUUID()}${extensions[file.mimetype] || ''}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    callback(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype));
  }
});

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  if (isProduction) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store');
  }
  next();
});
app.use('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '100kb' }));
app.use(express.json({ limit: '20kb' }));
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.path === '/stripe/webhook') {
    return next();
  }

  const origin = req.get('origin');
  const fetchSite = req.get('sec-fetch-site');
  if ((origin && origin !== getConfiguredOrigin()) || fetchSite === 'cross-site') {
    return res.status(403).json({ error: 'Request origin is not allowed.' });
  }
  next();
});
app.use('/api', rateLimit({ windowMs: 60_000, max: 300, keyPrefix: 'api' }));
app.use('/api/login', rateLimit({ windowMs: 15 * 60_000, max: 30, keyPrefix: 'login' }));
app.use('/api/signup', rateLimit({ windowMs: 15 * 60_000, max: 10, keyPrefix: 'signup' }));
app.use('/api/password-reset', rateLimit({ windowMs: 15 * 60_000, max: 10, keyPrefix: 'reset' }));
app.use('/api/create-checkout-session', rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'checkout' }));
app.use('/api/admin/ceo', rateLimit({ windowMs: 10 * 60_000, max: 10, keyPrefix: 'ceo' }));
app.use('/uploads', express.static(uploadsPath));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  name: 'phlapz.sid',
  store: sessionStore,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  proxy: isProduction,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8,
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction
  }
}));

app.use((req, res, next) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return next();
  }

  try {
    const currentUser = readJson(usersPath).find((user) => String(user.id) === String(sessionUser.id));
    const currentAuthVersion = Number(currentUser?.authVersion || 0);
    if (!currentUser || currentUser.approved !== true || Number(req.session.authVersion || 0) !== currentAuthVersion) {
      req.session.user = null;
      delete req.session.authVersion;
      return req.session.save((error) => {
        if (error) return next(error);
        next();
      });
    }

    req.session.user = serializeUser(currentUser);
    next();
  } catch (error) {
    next(error);
  }
});

app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    || ['/login', '/signup', '/password-reset/complete', '/create-checkout-session', '/stripe/webhook', '/admin/ceo'].includes(req.path)) {
    return next();
  }

  runSerializedStoreWork(() => new Promise((resolve) => {
    const release = () => resolve();
    res.once('finish', release);
    res.once('close', release);
    next();
  })).catch(next);
});

function ensureOrdersFile() {
  if (!fs.existsSync(ordersPath)) {
    writeJson(ordersPath, []);
  }
}

function getPaymentSettings() {
  if (!fs.existsSync(paymentSettingsPath)) {
    writeJson(paymentSettingsPath, { manualMethods: [], taxRates: [] });
  }
  const settings = readJson(paymentSettingsPath);
  return {
    manualMethods: Array.isArray(settings.manualMethods) ? settings.manualMethods : [],
    taxRates: Array.isArray(settings.taxRates) ? settings.taxRates : []
  };
}

function getBusinessSettings() {
  const settings = fs.existsSync(businessSettingsPath) ? readJson(businessSettingsPath) : {};
  return {
    acceptingOrders: settings.acceptingOrders === true,
    temporarilyClosed: settings.temporarilyClosed === true,
    pickupEnabled: settings.pickupEnabled !== false,
    deliveryEnabled: false,
    timezone: 'America/Toronto',
    minimumLeadMinutes: Number.isInteger(settings.minimumLeadMinutes)
      ? Math.min(1440, Math.max(0, settings.minimumLeadMinutes)) : 30,
    hours: settings.hours && typeof settings.hours === 'object' && !Array.isArray(settings.hours)
      ? settings.hours : {}
  };
}

function isFoodOrderingAvailable(settings = getBusinessSettings()) {
  return foodOrderingEnabled && settings.acceptingOrders && !settings.temporarilyClosed
    && settings.pickupEnabled && Object.keys(settings.hours).some((day) => {
      const interval = settings.hours[day];
      return interval && /^([01]\d|2[0-3]):[0-5]\d$/.test(interval.open)
        && /^([01]\d|2[0-3]):[0-5]\d$/.test(interval.close)
        && interval.open < interval.close;
    });
}

function isValidPickupSlot(value, settings) {
  const pickupDate = new Date(value);
  if (!Number.isFinite(pickupDate.getTime())
    || pickupDate.getTime() < Date.now() + settings.minimumLeadMinutes * 60_000) {
    return false;
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(pickupDate);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const schedule = settings.hours[values.weekday.toLowerCase()];
  if (!schedule || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.open)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.close)) return false;
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  const [openHour, openMinute] = schedule.open.split(':').map(Number);
  const [closeHour, closeMinute] = schedule.close.split(':').map(Number);
  return minutes >= openHour * 60 + openMinute && minutes < closeHour * 60 + closeMinute;
}

function normalizeOrder(order) {
  if (!order.orderStatus) {
    if (order.status === 'fulfilled') {
      order.orderStatus = 'CONFIRMED';
      order.fulfillmentStatus = 'COMPLETED';
    } else if (order.status === 'paid' || order.status === 'paid_inventory_attention') {
      order.orderStatus = 'PENDING_CONFIRMATION';
      order.fulfillmentStatus = 'NOT_STARTED';
    } else if (order.status === 'payment_failed') {
      order.orderStatus = 'PENDING_CONFIRMATION';
      order.fulfillmentStatus = 'NOT_STARTED';
    } else {
      order.orderStatus = 'PENDING_CONFIRMATION';
      order.fulfillmentStatus = 'NOT_STARTED';
    }
  }
  if (!order.paymentStatus) {
    order.paymentStatus = order.status === 'paid' || order.status === 'fulfilled'
      || order.status === 'paid_inventory_attention' ? 'PAID'
      : order.status === 'payment_failed' ? 'FAILED'
        : 'PENDING';
  }
  order.status = order.orderStatus;
  return order;
}

function addOrderHistory(order, action, actor, details = '') {
  if (!Array.isArray(order.history)) order.history = [];
  order.history.push({
    at: new Date().toISOString(),
    action,
    actor,
    details: String(details).slice(0, 2000)
  });
  order.updatedAt = new Date().toISOString();
}

function serializeCustomerOrder(order) {
  return {
    id: order.id,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    subtotal: order.subtotal,
    shipping: order.shipping,
    tax: order.tax,
    taxJurisdiction: order.taxJurisdiction,
    amount: order.amount,
    paymentMethodName: order.paymentMethodName,
    paymentInstructions: order.paymentInstructions,
    fulfillmentMethod: order.fulfillmentMethod || 'delivery',
    pickupTime: order.pickupTime || '',
    createdAt: order.createdAt
  };
}

function hasPendingOrderEmails(order) {
  return Object.values(order.emailNotifications || {}).some((notification) =>
    Object.values(notification).some((entry) => entry.status === 'failed'));
}

function getOrderTotals(items, province, settings, country = 'CA') {
  const subtotalCents = items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);
  const jurisdiction = `${String(country || '').trim().toUpperCase()}-${String(province || '').trim().toUpperCase()}`;
  const taxRate = settings.taxRates.find((entry) => entry.jurisdiction === jurisdiction);
  if (!taxRate) {
    return { error: `No tax rate is configured for ${jurisdiction}. Please contact the store before placing this order.` };
  }
  const taxCents = Math.round(subtotalCents * Number(taxRate.rate));
  return {
    subtotal: subtotalCents / 100,
    shipping: 0,
    tax: taxCents / 100,
    taxJurisdiction: jurisdiction,
    taxRate: Number(taxRate.rate),
    amount: (subtotalCents + taxCents) / 100
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const backupPath = `${filePath}.bak`;
    if (!fs.existsSync(backupPath)) throw error;
    console.error(`[Storage] Recovering ${path.basename(filePath)} from its last backup:`, error.message);
    const backup = fs.readFileSync(backupPath, 'utf8');
    const data = JSON.parse(backup);
    const recoveryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.recover`;
    fs.writeFileSync(recoveryPath, backup, { mode: 0o600 });
    fs.renameSync(recoveryPath, filePath);
    return data;
  }
}

function writeJson(filePath, data) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const backupPath = `${filePath}.bak`;
  let backupTemporaryPath;
  try {
    const fileDescriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fileDescriptor, JSON.stringify(data, null, 2));
      fs.fsyncSync(fileDescriptor);
    } finally {
      fs.closeSync(fileDescriptor);
    }
    if (fs.existsSync(filePath)) {
      let backupData = fs.readFileSync(filePath, 'utf8');
      if (filePath === usersPath) {
        const previousUsers = JSON.parse(backupData);
        for (const user of previousUsers) {
          delete user.password;
          delete user.resetTokenHash;
          delete user.resetExpiresAt;
        }
        backupData = JSON.stringify(previousUsers, null, 2);
      }
      backupTemporaryPath = `${backupPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      const backupDescriptor = fs.openSync(backupTemporaryPath, 'wx', 0o600);
      try {
        fs.writeFileSync(backupDescriptor, backupData);
        fs.fsyncSync(backupDescriptor);
      } finally {
        fs.closeSync(backupDescriptor);
      }
      fs.renameSync(backupTemporaryPath, backupPath);
    }
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    if (backupTemporaryPath && fs.existsSync(backupTemporaryPath)) fs.unlinkSync(backupTemporaryPath);
    throw error;
  }
}

function runSerializedStoreWork(work) {
  const result = serializedStoreQueue.then(work, work);
  serializedStoreQueue = result.then(() => undefined, () => undefined);
  return result;
}

function getConfiguredOrigin() {
  try {
    return new URL(process.env.SITE_ORIGIN || process.env.APP_URL || `http://localhost:${PORT}`).origin;
  } catch {
    return '';
  }
}

function rateLimit({ windowMs, max, keyPrefix }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${req.ip || 'unknown'}`;
    const previous = requestRateLimits.get(key);
    const timestamps = (previous?.timestamps || []).filter((timestamp) => now - timestamp < windowMs);
    if (timestamps.length >= max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((timestamps[0] + windowMs - now) / 1000))));
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }

    if (!requestRateLimits.has(key) && requestRateLimits.size >= 10_000) {
      for (const [storedKey, storedEntry] of requestRateLimits) {
        if (!storedEntry.timestamps.some((timestamp) => now - timestamp < storedEntry.windowMs)) {
          requestRateLimits.delete(storedKey);
        }
      }
      if (requestRateLimits.size >= 10_000) {
        return res.status(503).json({ error: 'Request capacity is temporarily limited. Try again later.' });
      }
    }
    timestamps.push(now);
    requestRateLimits.set(key, { timestamps, windowMs });
    next();
  };
}

function requireAdmin(req, res, next) {
  if (req.session?.user?.role !== 'admin' || req.session.user.approved !== true) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

function requireMember(req, res, next) {
  if (!req.session?.user?.id || req.session.user.approved !== true) {
    return res.status(401).json({ error: 'Approved member access is required.' });
  }
  next();
}

function escapeCsvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function isValidImageFile(filePath, mimeType) {
  const data = fs.readFileSync(filePath);
  if (mimeType === 'image/jpeg') return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mimeType === 'image/png') return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/gif') return data.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/) !== null;
  if (mimeType === 'image/webp') return data.subarray(0, 4).toString('ascii') === 'RIFF'
    && data.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

app.use('/api/admin', (req, res, next) => {
  if (req.path === '/check') return next();
  return requireAdmin(req, res, next);
});

async function initializeUsersFile() {
  if (fs.existsSync(usersPath)) {
    fs.chmodSync(usersPath, 0o600);
    return;
  }

  const email = process.env.INITIAL_ADMIN_EMAIL?.trim();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  const name = process.env.INITIAL_ADMIN_NAME?.trim() || 'Store Administrator';
  if (Boolean(email) !== Boolean(password)) {
    throw new Error('INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must be configured together.');
  }
  if (isProduction && !email) {
    throw new Error('Configure INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD to bootstrap the first admin account.');
  }

  const users = [];
  if (email) {
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || typeof password !== 'string' || password.length < 12 || password.length > 1024
      || name.length < 1 || name.length > 100) {
      throw new Error('Initial admin email, name, or password does not meet the required format.');
    }

    users.push({
      id: `user-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      name,
      email,
      passwordHash: await hashPassword(password),
      role: 'admin',
      approved: true,
      authVersion: 0
    });
  }

  writeJson(usersPath, users);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, encodedHash) {
  const [algorithm, cost, blockSize, parallelization, saltHex, hashHex] = String(encodedHash || '').split('$');
  if (algorithm !== 'scrypt' || cost !== '16384' || blockSize !== '8' || parallelization !== '1'
    || !/^[a-f0-9]{32}$/i.test(saltHex || '') || !/^[a-f0-9]{128}$/i.test(hashHex || '')) {
    return false;
  }

  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}

async function migratePlaintextPasswords() {
  const users = readJson(usersPath);
  let changed = false;
  for (const user of users) {
    if (typeof user.password === 'string') {
      user.passwordHash = await hashPassword(user.password);
      delete user.password;
      changed = true;
    }
    if (!Number.isInteger(user.authVersion)) {
      user.authVersion = Number(user.authVersion || 0);
      changed = true;
    }
  }
  if (changed) {
    writeJson(usersPath, users);
  }
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

function enqueueStripeWebhook(work) {
  return runSerializedStoreWork(work);
}

function getUserByEmail(email) {
  const users = readJson(usersPath);
  return users.find((user) => user.email.toLowerCase() === email.toLowerCase());
}

function serializeUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, approved: user.approved };
}

function requirePHLAPZOwner(req, res, next) {
  const ownerId = process.env.PHLAPZ_OWNER_USER_ID;
  const signedInId = req.session?.user?.id;

  if (!ownerId) {
    return res.status(503).json({ error: 'AI CEO owner access is not configured.' });
  }

  if (!signedInId || String(signedInId) !== String(ownerId)) {
    return res.status(403).json({ error: 'Verified PHLAPZ owner access required.' });
  }

  const currentUser = readJson(usersPath).find((user) => String(user.id) === String(ownerId));
  if (!currentUser || currentUser.role !== 'admin' || currentUser.approved !== true) {
    return res.status(403).json({ error: 'Verified PHLAPZ owner access required.' });
  }

  next();
}

const CEO_RULES = `
You are the PHLAPZ research and planning assistant.
The human owner has final authority. Your operating mode is research only.
You may propose research, comparisons, business plans, marketing ideas, task assignments, and financial analysis methods.
You must not claim to execute actions or invent business data. Do not request or imply access to accounts, personal records, payments, inventory, or private credentials.
Clearly label recommendations as proposed, not executed. No tools or business systems are available to you.
`;

function formatCurrency(value) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value || 0));
}

function escapeEmailHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function isValidProductImage(image) {
  if (image === '') return true;
  if (typeof image !== 'string') return false;
  if (/^\/uploads\/[a-z0-9._-]+$/i.test(image)) return true;
  try {
    const url = new URL(image);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function parseProductFoodDetails(body, currentProduct) {
  const normalizeList = (value, limit, fieldName) => {
    if (value === undefined) return { value: [] };
    if (!Array.isArray(value) || value.length > limit
      || value.some((entry) => typeof entry !== 'string' || entry.trim().length > 120)) {
      return { error: `${fieldName} must be a list of up to ${limit} entries, each 120 characters or fewer.` };
    }
    return { value: value.map((entry) => entry.trim()).filter(Boolean) };
  };
  const ingredients = normalizeList(body?.ingredients, 50, 'Ingredients');
  const allergens = normalizeList(body?.allergens, 30, 'Allergens');
  const customizations = body?.customizations === undefined ? [] : body.customizations;
  const customizationNames = Array.isArray(customizations)
    ? customizations.map((option) => String(option?.name || '').trim().toLowerCase()) : [];
  const customizationIds = Array.isArray(customizations)
    ? customizations.map((option) => option?.id).filter((id) => typeof id === 'string') : [];
  const preparationMinutes = body?.preparationMinutes === undefined || body.preparationMinutes === null
    || body.preparationMinutes === '' ? 0 : Number(body.preparationMinutes);
  if (!Array.isArray(customizations) || customizations.length > 30
    || new Set(customizationNames).size !== customizationNames.length
    || new Set(customizationIds).size !== customizationIds.length
    || customizations.some((option) => typeof option?.name !== 'string'
      || !option.name.trim() || option.name.trim().length > 80
      || !Number.isFinite(Number(option.price)) || Number(option.price) < 0 || Number(option.price) > 1000
      || Math.abs(Number(option.price) * 100 - Math.round(Number(option.price) * 100)) > 1e-8)
    || ingredients.error || allergens.error || !Number.isInteger(preparationMinutes)
    || preparationMinutes < 0 || preparationMinutes > 1440) {
    return {
      error: ingredients.error || allergens.error
        || 'Customizations need a name and a valid price; preparation time must be from 0 to 1,440 minutes.'
    };
  }
  return {
    ingredients: ingredients.value,
    allergens: allergens.value,
    preparationMinutes,
    customizations: customizations.map((option) => ({
      id: typeof option.id === 'string' && /^[a-z0-9_-]{1,80}$/i.test(option.id)
        ? option.id
        : currentProduct?.customizations?.find((existing) => existing.name === option.name.trim())?.id
          || `custom-${crypto.randomUUID()}`,
      name: option.name.trim(),
      price: Math.round(Number(option.price) * 100) / 100
    }))
  };
}

function getStripeCheckoutParameters(order) {
  const lineItems = order.items.map((item) => ({
    price_data: {
      currency: 'cad',
      product_data: {
        name: item.name,
        description: item.description
      },
      unit_amount: Math.round(item.price * 100)
    },
    quantity: item.quantity
  }));
  if (Number(order.tax || 0) > 0) {
    lineItems.push({
      price_data: {
        currency: 'cad',
        product_data: { name: `Tax (${order.taxJurisdiction})` },
        unit_amount: Math.round(Number(order.tax) * 100)
      },
      quantity: 1
    });
  }
  return {
    mode: 'payment',
    expires_at: order.checkoutExpiresAt,
    line_items: lineItems,
    success_url: `${process.env.APP_URL || 'http://localhost:3000'}/?checkout=success`,
    cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/?checkout=cancelled`,
    customer_email: order.customerEmail,
    metadata: {
      orderId: order.id,
      ...(order.userId ? { userId: order.userId } : {}),
      userEmail: order.customerEmail
    }
  };
}

function getStripeCheckoutForOrder(order) {
  return stripe.checkout.sessions.create(getStripeCheckoutParameters(order), { idempotencyKey: order.id });
}

function findOrderForCheckout(orders, checkoutSession) {
  const orderId = checkoutSession.metadata?.orderId;
  return orders.find((entry) => (orderId && entry.id === orderId) || entry.stripeSessionId === checkoutSession.id);
}

function applyInventoryReservation(products, order) {
  const quantities = new Map();
  for (const item of order.items) {
    if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) {
      throw new Error('Checkout contains an invalid product or quantity.');
    }
    quantities.set(item.id, (quantities.get(item.id) || 0) + Number(item.quantity));
  }

  for (const [productId, quantity] of quantities) {
    const product = products.find((entry) => entry.id === productId);
    if (!product) throw new Error('Checkout contains an invalid product or quantity.');
    const reservedEvents = Array.isArray(product.stockAdjustmentEvents) ? product.stockAdjustmentEvents : [];
    if (!reservedEvents.includes(order.id) && Number(product.stock || 0) < quantity) {
      throw new Error(`${product.name} no longer has enough stock.`);
    }
  }

  for (const [productId, quantity] of quantities) {
    const product = products.find((entry) => entry.id === productId);
    const reservedEvents = Array.isArray(product.stockAdjustmentEvents) ? product.stockAdjustmentEvents : [];
    if (!reservedEvents.includes(order.id)) {
      product.stock = Number(product.stock || 0) - quantity;
      product.stockAdjustmentEvents = [...reservedEvents, order.id];
    }
  }
}

function releaseInventoryReservation(products, order) {
  const quantities = new Map();
  for (const item of order.items || []) {
    quantities.set(item.id, (quantities.get(item.id) || 0) + Number(item.quantity || 0));
  }
  for (const [productId, quantity] of quantities) {
    const product = products.find((entry) => entry.id === productId);
    if (!product) continue;

    const reservedEvents = Array.isArray(product.stockAdjustmentEvents) ? product.stockAdjustmentEvents : [];
    const releasedEvents = Array.isArray(product.stockReleaseEvents) ? product.stockReleaseEvents : [];
    if (reservedEvents.includes(order.id) && !releasedEvents.includes(order.id)) {
      product.stock = Number(product.stock || 0) + quantity;
      product.stockReleaseEvents = [...releasedEvents, order.id];
    }
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

async function sendOrderNotification(orders, order, eventKey) {
  const messages = {
    received: 'We received your order. The store owner will review it before confirming.',
    stripe_paid: 'Your Stripe payment was verified. The order is still awaiting the store owner’s review.',
    stripe_paid_closed: 'A Stripe payment was received after this order was closed. The store owner will review the payment and refund if appropriate.',
    confirmed: 'Your order has been approved by the store owner.',
    rejected: 'The store owner has rejected your order. Contact support if you have questions.',
    payment_received: 'The store owner verified your manual payment.',
    shipped: 'Your order has been marked as shipped.',
    completed: 'Your order is complete. Thank you for shopping with PHLAPZ.',
    refund_pending: 'Your refund was requested and is being processed by Stripe.',
    refund: 'Your refund has been confirmed as processed.'
  };
  const message = messages[eventKey];
  if (!message) return false;
  if (!order.emailNotifications || typeof order.emailNotifications !== 'object') order.emailNotifications = {};
  if (!order.emailNotifications[eventKey]) order.emailNotifications[eventKey] = {};
  const delivery = order.emailNotifications[eventKey];
  const recipients = [
    ...(['received', 'stripe_paid', 'stripe_paid_closed'].includes(eventKey) ? [{ key: 'owner', email: adminEmail }] : []),
    { key: 'customer', email: order.customerEmail }
  ];
  const items = (order.items || []).map((item) => `${item.name} x${item.quantity} @ ${formatCurrency(item.price)}`).join('\n');
  const address = order.address
    ? [order.address.street, order.address.city, order.address.province, order.address.postalCode, order.address.country].filter(Boolean).join(', ')
    : 'Not provided';
  const summary = [
    message,
    '',
    `Order: ${order.id}`,
    `Customer: ${order.customerName} <${order.customerEmail}>`,
    `Phone: ${order.phone || 'Not provided'}`,
    `Address: ${address}`,
    `Items:\n${items}`,
    `Subtotal: ${formatCurrency(order.subtotal)}`,
    `Shipping: ${formatCurrency(order.shipping)}`,
    `Tax: ${formatCurrency(order.tax)} (${order.taxJurisdiction || 'not configured'})`,
    `Total: ${formatCurrency(order.amount)}`,
    `Payment method: ${order.paymentMethodName || order.paymentMethod}`,
    `Payment status: ${order.paymentStatus}`,
    `Order status: ${order.orderStatus}`,
    `Fulfillment status: ${order.fulfillmentStatus}`,
    ...(order.fulfillmentMethod === 'pickup' ? [`Pickup requested: ${order.pickupTime || 'Not specified'}`] : []),
    ...(order.customerNotes ? [`Customer notes: ${order.customerNotes}`] : []),
    `Date: ${order.createdAt}`,
    ...(order.paymentMethod === 'stripe' ? [`Stripe reference: ${order.stripeSessionId || order.stripePaymentIntent || 'pending'}`] : []),
    ...(order.paymentInstructions ? [`Payment instructions:\n${order.paymentInstructions}`] : [])
  ].join('\n');
  const safeSummary = escapeEmailHtml(summary).replace(/\n/g, '<br>');
  const subject = `PHLAPZ order ${order.id} — ${eventKey.replaceAll('_', ' ')}`;
  let allSent = true;
  for (const recipient of recipients) {
    if (delivery[recipient.key]?.status === 'sent') continue;
    if (!mailTransport || !recipient.email) {
      delivery[recipient.key] = {
        status: 'failed',
        error: !mailTransport ? 'Email transport is not configured.'
          : recipient.key === 'owner' ? 'ADMIN_EMAIL is not configured.' : 'Customer email is missing.'
      };
      allSent = false;
      continue;
    }
    try {
      await mailTransport.sendMail({
        from: process.env.SMTP_USER,
        to: recipient.email,
        subject,
        text: summary,
        html: `<div style="font-family:Arial,sans-serif;color:#202124"><h2>PHLAPZ order update</h2><p>${safeSummary}</p><p>Thank you,<br>PHLAPZ</p></div>`
      });
      delivery[recipient.key] = { status: 'sent', sentAt: new Date().toISOString() };
    } catch (error) {
      delivery[recipient.key] = { status: 'failed', error: String(error.message || 'Email delivery failed.').slice(0, 300) };
      allSent = false;
      console.error('[Order email] Delivery failed:', { orderId: order.id, recipient: recipient.key, message: error.message });
    }
  }
  addOrderHistory(order, 'email_notification', 'system', `${eventKey}: ${allSent ? 'sent' : 'delivery pending'}`);
  writeJson(ordersPath, orders);
  return allSent;
}

app.get('/api/me', (req, res) => {
  if (!req.session.user) {
    return res.status(200).json({ user: null });
  }
  res.json({ user: req.session.user });
});

app.post('/api/signup', async (req, res, next) => {
  const { name, email, password } = req.body || {};
  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  const normalizedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedName || normalizedName.length > 100 || normalizedEmail.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Enter a valid name and email address.' });
  }
  if (password.length < 12 || password.length > 1024) {
    return res.status(400).json({ error: 'Password must be between 12 and 1024 characters.' });
  }

  try {
    const newUser = await runSerializedStoreWork(async () => {
      const users = readJson(usersPath);
      if (users.some((user) => user.email.toLowerCase() === normalizedEmail)) return null;

      const user = {
        id: `user-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        name: normalizedName,
        email: normalizedEmail,
        passwordHash: await hashPassword(password),
        role: 'member',
        approved: true,
        authVersion: 0
      };
      users.push(user);
      writeJson(usersPath, users);
      return user;
    });
    if (!newUser) {
      return res.status(409).json({ error: 'This email is already registered.' });
    }

    await regenerateSession(req);
    req.session.user = serializeUser(newUser);
    req.session.authVersion = newUser.authVersion;
    await saveSession(req);
    res.status(201).json({ user: req.session.user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/login', async (req, res, next) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  if (typeof email !== 'string' || typeof password !== 'string' || password.length > 1024) {
    return res.status(400).json({ error: 'Email or password is invalid.' });
  }
  if (email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Email or password is invalid.' });
  }

  const loginKey = String(req.ip || 'unknown');
  const now = Date.now();
  const recentFailures = (loginFailures.get(loginKey) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);
  if (recentFailures.length >= 10) {
    res.set('Retry-After', String(Math.ceil((recentFailures[0] + 15 * 60 * 1000 - now) / 1000)));
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
  }

  try {
    const user = getUserByEmail(email.trim());
    const passwordMatches = await verifyPassword(password, user?.passwordHash || dummyPasswordHash);
    if (!user || !passwordMatches) {
      recentFailures.push(now);
      if (!loginFailures.has(loginKey) && loginFailures.size >= 5000) {
        loginFailures.delete(loginFailures.keys().next().value);
      }
      loginFailures.set(loginKey, recentFailures);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (user.approved !== true) {
      return res.status(403).json({ error: 'Your account is not currently approved.' });
    }

    loginFailures.delete(loginKey);
    await regenerateSession(req);
    req.session.user = serializeUser(user);
    req.session.authVersion = Number(user.authVersion || 0);
    await saveSession(req);
    res.json({ user: req.session.user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: 'Unable to log out securely.' });
    res.clearCookie('phlapz.sid');
    res.json({ ok: true });
  });
});

app.post('/api/password-reset/request', (req, res) => {
  const genericResponse = { message: 'If an account matches that email, password reset instructions will be sent.' };
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const now = Date.now();
  const requester = String(req.ip || 'unknown');
  const recentRequests = (passwordResetRequests.get(requester) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);
  if (recentRequests.length >= 5) {
    return res.json(genericResponse);
  }
  recentRequests.push(now);
  if (!passwordResetRequests.has(requester) && passwordResetRequests.size >= 5000) {
    for (const [storedRequester, timestamps] of passwordResetRequests) {
      if (!timestamps.some((timestamp) => now - timestamp < 15 * 60 * 1000)) {
        passwordResetRequests.delete(storedRequester);
      }
    }
    if (passwordResetRequests.size >= 5000) return res.json(genericResponse);
  }
  passwordResetRequests.set(requester, recentRequests);

  if (!email || email.length > 254 || !mailTransport) {
    if (!mailTransport) console.error('[Password Reset] Email transport is not configured.');
    return res.json(genericResponse);
  }

  const users = readJson(usersPath);
  const user = users.find((entry) => entry.email.toLowerCase() === email);
  if (!user) {
    return res.json(genericResponse);
  }

  const token = crypto.randomBytes(32).toString('hex');
  user.resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
  user.resetExpiresAt = now + 30 * 60 * 1000;
  writeJson(usersPath, users);

  let appOrigin;
  try {
    appOrigin = new URL(process.env.APP_URL || 'http://localhost:3000').origin;
  } catch (error) {
    console.error('[Password Reset] APP_URL is invalid:', error.message);
    return res.json(genericResponse);
  }

  mailTransport.sendMail({
    from: process.env.SMTP_USER,
    to: user.email,
    subject: 'Reset your PHLAPZ.com password',
    text: `Use this one-time link within 30 minutes to reset your password: ${appOrigin}/#reset=${token}\n\nIf you did not request this, you can ignore this email.`
  }).then(() => {
    console.info('[Password Reset] Instructions sent.');
  }).catch((error) => {
    console.error('[Password Reset] Email delivery failed:', error.message);
  });

  res.json(genericResponse);
});

app.post('/api/password-reset/complete', async (req, res, next) => {
  const { token, password } = req.body || {};
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)
    || typeof password !== 'string' || password.length < 12 || password.length > 1024) {
    return res.status(400).json({ error: 'The reset link is invalid or expired, or the password is too short.' });
  }

  try {
    const updated = await runSerializedStoreWork(async () => {
      const tokenHash = crypto.createHash('sha256').update(token).digest();
      const users = readJson(usersPath);
      const user = users.find((entry) => {
        if (!entry.resetTokenHash || !/^[a-f0-9]{64}$/i.test(entry.resetTokenHash)) return false;
        const storedHash = Buffer.from(entry.resetTokenHash, 'hex');
        return storedHash.length === tokenHash.length && crypto.timingSafeEqual(storedHash, tokenHash);
      });
      if (!user || Number(user.resetExpiresAt) < Date.now()) return false;

      user.passwordHash = await hashPassword(password);
      delete user.password;
      delete user.resetTokenHash;
      delete user.resetExpiresAt;
      user.authVersion = Number(user.authVersion || 0) + 1;
      writeJson(usersPath, users);
      return true;
    });
    if (!updated) {
      return res.status(400).json({ error: 'The reset link is invalid or expired.' });
    }
    res.json({ message: 'Password updated. Please sign in with your new password.' });
  } catch (error) {
    next(error);
  }
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
  const { role, approved } = req.body || {};
  if ((role !== undefined && !['admin', 'member'].includes(role))
    || (approved !== undefined && typeof approved !== 'boolean')
    || (role === undefined && approved === undefined)) {
    return res.status(400).json({ error: 'Provide a valid role or approval status.' });
  }

  const users = readJson(usersPath);
  const user = users.find((item) => item.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const wouldDemoteAdmin = user.role === 'admin' && role === 'member';
  const wouldUnapproveAdmin = user.role === 'admin' && approved === false;
  if ((wouldDemoteAdmin || wouldUnapproveAdmin)
    && users.filter((item) => item.role === 'admin' && item.approved === true).length <= 1) {
    return res.status(409).json({ error: 'The last approved administrator cannot be removed or disabled.' });
  }

  if (String(user.id) === String(req.session.user.id)
    && (role === 'member' || approved === false)) {
    return res.status(409).json({ error: 'You cannot remove your own administrator access.' });
  }

  if (role !== undefined) user.role = role;
  if (approved !== undefined) user.approved = approved;
  user.authVersion = Number(user.authVersion || 0) + 1;

  writeJson(usersPath, users);
  res.json({ ok: true, user: serializeUser(user) });
});

app.delete('/api/admin/users/:id', (req, res) => {
  const users = readJson(usersPath);
  const user = users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (String(user.id) === String(req.session.user.id)) {
    return res.status(409).json({ error: 'You cannot remove your own account while signed in.' });
  }
  if (user.role === 'admin' && user.approved === true
    && users.filter((item) => item.role === 'admin' && item.approved === true).length <= 1) {
    return res.status(409).json({ error: 'The last approved administrator cannot be removed.' });
  }

  const filtered = users.filter((user) => user.id !== req.params.id);
  writeJson(usersPath, filtered);
  res.json({ ok: true });
});

app.get('/api/admin/check', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin' || req.session.user.approved !== true) {
    return res.status(200).json({ ok: false, user: null, error: 'Admin access required.' });
  }

  res.json({ ok: true, user: req.session.user });
});

app.get('/api/admin/ceo/access', requirePHLAPZOwner, (req, res) => {
  res.json({ owner: true });
});

app.post('/api/admin/ceo', requirePHLAPZOwner, async (req, res) => {
  const configuredOrigin = process.env.SITE_ORIGIN || process.env.APP_URL;
  let expectedOrigin;
  try {
    expectedOrigin = configuredOrigin ? new URL(configuredOrigin).origin : '';
  } catch {
    expectedOrigin = '';
  }

  if (!expectedOrigin) {
    return res.status(503).json({ error: 'AI CEO site origin is not configured.' });
  }
  if (!req.get('origin') || req.get('origin') !== expectedOrigin) {
    return res.sendStatus(403);
  }

  const command = req.body?.command;
  if (typeof command !== 'string' || !command.trim() || command.length > 2000) {
    return res.status(400).json({ error: 'Enter a command under 2000 characters.' });
  }
  if (!process.env.XAI_API_KEY) {
    return res.status(503).json({ error: 'AI CEO is not configured.' });
  }

  const now = Date.now();
  const userId = String(req.session.user.id);
  const recentRequests = (ceoRequestWindows.get(userId) || []).filter((timestamp) => now - timestamp < 10 * 60 * 1000);
  if (recentRequests.length >= 10) {
    const retryAfter = Math.ceil((recentRequests[0] + 10 * 60 * 1000 - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'AI CEO request limit reached. Try again later.' });
  }
  recentRequests.push(now);
  ceoRequestWindows.set(userId, recentRequests);
  console.info('[AI CEO] Request started', { ownerId: userId, at: new Date(now).toISOString() });

  try {
    const apiResponse = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.XAI_MODEL || 'grok-4.7',
        store: false,
        input: [
          { role: 'system', content: CEO_RULES },
          { role: 'user', content: command.trim() }
        ]
      }),
      signal: AbortSignal.timeout(120000)
    });

    if (!apiResponse.ok) {
      throw new Error(`xAI returned status ${apiResponse.status}`);
    }

    const data = await apiResponse.json();
    const answer = (data.output || [])
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content || [])
      .filter((item) => item.type === 'output_text')
      .map((item) => item.text)
      .join('\n')
      .trim();

    if (!answer) {
      return res.status(502).json({ error: 'AI CEO returned no completed text.' });
    }

    console.info('[AI CEO] Request completed', { ownerId: userId, at: new Date().toISOString() });
    res.json({ agent: 'PHLAPZ AI CEO', mode: 'research', executedActions: 0, answer });
  } catch (error) {
    console.error('[AI CEO] Request failed:', error.message);
    res.status(502).json({ error: 'AI CEO service is temporarily unavailable.' });
  }
});

app.get('/api/admin/summary', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const users = readJson(usersPath);
  const products = readJson(productsPath);
  const orders = fs.existsSync(ordersPath) ? readJson(ordersPath) : [];
  orders.forEach(normalizeOrder);
  const revenue = orders.reduce((sum, order) => sum
    + (order.paymentStatus === 'PAID' || order.paymentStatus === 'REFUND_PENDING' ? Number(order.amount || 0) : 0), 0);
  const lowStockProducts = products.filter((p) => p.published !== false && Number(p.stock || 0) <= 5);

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
      status: order.orderStatus,
      paymentStatus: order.paymentStatus
    }))
  });
});

app.post('/api/admin/uploads', (req, res, next) => {
  next();
}, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Choose a JPG, PNG, WEBP, or GIF image up to 5 MB.' });
  }
  try {
    if (!isValidImageFile(req.file.path, req.file.mimetype)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'The uploaded file does not match a supported image format.' });
    }
    fs.chmodSync(req.file.path, 0o600);
  } catch (error) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(500).json({ error: 'The uploaded image could not be validated.' });
  }

  res.status(201).json({ imageUrl: `/uploads/${req.file.filename}` });
});

app.get('/api/admin/payment-settings', (req, res) => {
  res.json(getPaymentSettings());
});

app.put('/api/admin/payment-settings', (req, res) => {
  const manualMethods = req.body?.manualMethods;
  const taxRates = req.body?.taxRates;
  if (!Array.isArray(manualMethods) || manualMethods.length > 10
    || !Array.isArray(taxRates) || taxRates.length > 100) {
    return res.status(400).json({ error: 'Payment methods and tax rates must be valid lists.' });
  }
  const currentSettings = getPaymentSettings();
  const normalizedMethods = [];
  for (const method of manualMethods) {
    const name = typeof method?.name === 'string' ? method.name.trim() : '';
    const instructions = typeof method?.instructions === 'string' ? method.instructions.trim() : '';
    if (!name || name.length > 80 || !instructions || instructions.length > 2000) {
      return res.status(400).json({ error: 'Each manual payment method needs a name and instructions (up to 2,000 characters).' });
    }
    const existing = currentSettings.manualMethods.find((entry) => entry.id === method.id);
    normalizedMethods.push({
      id: existing?.id || `manual-${crypto.randomUUID()}`,
      name,
      instructions,
      active: method.active !== false
    });
  }
  const normalizedTaxRates = [];
  for (const entry of taxRates) {
    const jurisdiction = typeof entry?.jurisdiction === 'string' ? entry.jurisdiction.trim().toUpperCase() : '';
    const rate = Number(entry?.rate);
    if (!/^[A-Z]{2}-[A-Z0-9]{2,3}$/.test(jurisdiction) || !Number.isFinite(rate) || rate < 0 || rate > 0.5
      || normalizedTaxRates.some((taxRate) => taxRate.jurisdiction === jurisdiction)) {
      return res.status(400).json({ error: 'Tax jurisdictions must be unique country-region codes with rates from 0% to 50%.' });
    }
    normalizedTaxRates.push({ jurisdiction, rate });
  }
  writeJson(paymentSettingsPath, { manualMethods: normalizedMethods, taxRates: normalizedTaxRates });
  res.json({ manualMethods: normalizedMethods, taxRates: normalizedTaxRates });
});

app.get('/api/admin/orders', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const orders = fs.existsSync(ordersPath) ? readJson(ordersPath) : [];
  orders.forEach(normalizeOrder);
  res.json(orders);
});

app.patch('/api/admin/orders/:id', async (req, res) => {
  const { action } = req.body || {};
  const orders = fs.existsSync(ordersPath) ? readJson(ordersPath) : [];
  const order = orders.find((entry) => entry.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  normalizeOrder(order);
  const actor = req.session.user.id;

  if (action === 'confirm' || action === 'confirm_unpaid') {
    if (order.orderStatus !== 'PENDING_CONFIRMATION') {
      return res.status(409).json({ error: 'Only pending orders can be confirmed.' });
    }
    if (order.paymentStatus !== 'PAID' && action !== 'confirm_unpaid') {
      return res.status(409).json({ error: 'Payment must be verified before confirmation. Use the explicit unpaid confirmation action only if you approve this exception.' });
    }
    order.orderStatus = 'CONFIRMED';
    order.status = order.orderStatus;
    addOrderHistory(order, 'order_confirmed', actor, action === 'confirm_unpaid' ? 'Owner explicitly approved before payment.' : '');
    writeJson(ordersPath, orders);
    await sendOrderNotification(orders, order, 'confirmed');
    return res.json(order);
  }

  if (action === 'reject' || action === 'cancel') {
    const destination = action === 'reject' ? 'REJECTED' : 'CANCELLED';
    if (['REJECTED', 'CANCELLED'].includes(order.orderStatus)
      || ['SHIPPED', 'COMPLETED'].includes(order.fulfillmentStatus)) {
      return res.status(409).json({ error: 'This order is already in a terminal state.' });
    }
    if (order.paymentMethod === 'stripe' && order.paymentStatus === 'PENDING' && order.stripeSessionId && stripe) {
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
        if (session.payment_status === 'paid' || session.status === 'complete') {
          return res.status(409).json({ error: 'Stripe reports this checkout as complete. Wait for the signed webhook to update payment status, then reject and refund as needed.' });
        }
        if (session.status === 'open') await stripe.checkout.sessions.expire(order.stripeSessionId);
      } catch (error) {
        console.error('[Order] Unable to expire Stripe checkout:', error.message);
        return res.status(502).json({ error: 'The Stripe checkout could not be safely closed. The order was not changed.' });
      }
    }
    if (order.inventoryReserved) {
      const products = readJson(productsPath);
      releaseInventoryReservation(products, order);
      writeJson(productsPath, products);
      order.inventoryReserved = false;
    }
    order.orderStatus = destination;
    order.status = destination;
    order.fulfillmentStatus = 'CANCELLED';
    addOrderHistory(order, action === 'reject' ? 'order_rejected' : 'order_cancelled', actor);
    writeJson(ordersPath, orders);
    if (action === 'reject') await sendOrderNotification(orders, order, 'rejected');
    return res.json(order);
  }

  if (action === 'mark_payment_received') {
    if (order.paymentMethod !== 'manual' || !['AWAITING_PAYMENT', 'PENDING', 'FAILED'].includes(order.paymentStatus)) {
      return res.status(409).json({ error: 'Only a manual order awaiting verification can be marked as received.' });
    }
    if (!['PENDING_CONFIRMATION', 'CONFIRMED'].includes(order.orderStatus)) {
      return res.status(409).json({ error: 'Payment cannot be verified for a rejected or cancelled order.' });
    }
    order.paymentStatus = 'PAID';
    order.paymentReceivedAt = new Date().toISOString();
    order.paymentReceivedBy = actor;
    addOrderHistory(order, 'manual_payment_verified', actor, String(req.body?.reference || '').slice(0, 200));
    writeJson(ordersPath, orders);
    await sendOrderNotification(orders, order, 'payment_received');
    return res.json(order);
  }

  if (action === 'mark_manual_refunded') {
    if (order.paymentMethod !== 'manual' || order.paymentStatus !== 'PAID'
      || !['REJECTED', 'CANCELLED'].includes(order.orderStatus)) {
      return res.status(409).json({ error: 'Only a rejected or cancelled paid manual order can be marked refunded.' });
    }
    order.paymentStatus = 'REFUNDED';
    order.refundStatus = 'confirmed_by_owner';
    addOrderHistory(order, 'manual_refund_confirmed', actor, String(req.body?.reference || '').slice(0, 200));
    writeJson(ordersPath, orders);
    await sendOrderNotification(orders, order, 'refund');
    return res.json(order);
  }

  if (action === 'fulfillment') {
    const fulfillmentStatus = req.body?.fulfillmentStatus;
    const allowed = {
      NOT_STARTED: ['PROCESSING'],
      PROCESSING: ['SHIPPED', 'COMPLETED'],
      SHIPPED: ['COMPLETED']
    };
    if (order.paymentStatus !== 'PAID') {
      return res.status(409).json({ error: 'An unpaid order cannot be fulfilled.' });
    }
    if (order.orderStatus !== 'CONFIRMED'
      || !allowed[order.fulfillmentStatus]?.includes(fulfillmentStatus)) {
      return res.status(409).json({ error: 'That fulfillment status transition is not allowed.' });
    }
    order.fulfillmentStatus = fulfillmentStatus;
    addOrderHistory(order, `fulfillment_${fulfillmentStatus.toLowerCase()}`, actor);
    writeJson(ordersPath, orders);
    if (fulfillmentStatus === 'SHIPPED' || fulfillmentStatus === 'COMPLETED') {
      await sendOrderNotification(orders, order, fulfillmentStatus.toLowerCase());
    }
    return res.json(order);
  }

  if (action === 'note') {
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note || note.length > 2000) return res.status(400).json({ error: 'Notes must contain 1 to 2,000 characters.' });
    if (!Array.isArray(order.internalNotes)) order.internalNotes = [];
    order.internalNotes.push({ at: new Date().toISOString(), actor, note });
    addOrderHistory(order, 'internal_note_added', actor, note);
    writeJson(ordersPath, orders);
    return res.json(order);
  }

  if (action === 'resend_email') {
    for (const eventKey of Object.keys(order.emailNotifications || {})) {
      const eventDelivery = order.emailNotifications[eventKey];
      if (Object.values(eventDelivery).some((entry) => entry.status === 'failed')) {
        await sendOrderNotification(orders, order, eventKey);
      }
    }
    return res.json(order);
  }

  return res.status(400).json({ error: 'Unsupported order action.' });
});

app.post('/api/admin/orders/:id/refund', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe refunds are not configured.' });
  const orders = fs.existsSync(ordersPath) ? readJson(ordersPath) : [];
  const order = orders.find((entry) => entry.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  normalizeOrder(order);
  if (order.paymentMethod !== 'stripe' || order.paymentStatus !== 'PAID' || !order.stripeSessionId) {
    return res.status(409).json({ error: 'Only a verified, non-refunded Stripe payment can be refunded.' });
  }
  if (!['REJECTED', 'CANCELLED'].includes(order.orderStatus) && req.body?.confirm !== true) {
    return res.status(409).json({ error: 'Reject or cancel the order before issuing its refund.' });
  }
  order.paymentStatus = 'REFUND_PENDING';
  order.refundAttempts = Number(order.refundAttempts || 0) + 1;
  addOrderHistory(order, 'refund_requested', req.session.user.id);
  writeJson(ordersPath, orders);

  try {
    let paymentIntent = order.stripePaymentIntent;
    if (!paymentIntent) {
      const checkoutSession = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
      paymentIntent = typeof checkoutSession.payment_intent === 'string'
        ? checkoutSession.payment_intent : checkoutSession.payment_intent?.id;
    }
    if (!paymentIntent) throw new Error('Stripe payment intent is not available for this order.');
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntent },
      { idempotencyKey: `${order.id}-full-refund` }
    );
    order.refundId = refund.id;
    order.refundStatus = refund.status;
    order.paymentStatus = refund.status === 'succeeded' ? 'REFUNDED'
      : refund.status === 'pending' ? 'REFUND_PENDING' : 'PAID';
    addOrderHistory(order, 'refund_result', 'stripe', `${refund.id}: ${refund.status}`);
    writeJson(ordersPath, orders);
    if (refund.status === 'succeeded') await sendOrderNotification(orders, order, 'refund');
    else if (refund.status === 'pending') await sendOrderNotification(orders, order, 'refund_pending');
    return res.json(order);
  } catch (error) {
    order.paymentStatus = 'PAID';
    order.refundStatus = 'failed';
    order.refundError = String(error.message || 'Refund failed.').slice(0, 300);
    addOrderHistory(order, 'refund_failed', 'stripe', order.refundError);
    writeJson(ordersPath, orders);
    console.error('[Refund] Stripe refund failed:', { orderId: order.id, message: error.message });
    return res.status(502).json({ error: 'Stripe did not confirm the refund. The order remains paid; review Stripe before retrying.' });
  }
});

app.get('/api/admin/export/orders', (req, res) => {
  const orders = fs.existsSync(ordersPath) ? readJson(ordersPath) : [];
  orders.forEach(normalizeOrder);
  const csvHeader = [
    'Order ID', 'Customer', 'Email', 'Amount', 'Order Status', 'Payment Status',
    'Fulfillment Status', 'Payment Method', 'Date', 'Items'
  ].map(escapeCsvCell).join(',');
  const csvRows = orders.map((order) => {
    const itemStr = (order.items || []).map((item) => `${item.name}x${item.quantity}`).join('; ');
    const date = new Date(order.createdAt || Date.now()).toLocaleDateString();
    return [
      order.id, order.customerName, order.customerEmail, order.amount, order.orderStatus,
      order.paymentStatus, order.fulfillmentStatus, order.paymentMethodName || order.paymentMethod,
      date, itemStr
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  const csv = [csvHeader, ...csvRows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="orders-export.csv"');
  res.send(csv);
});

app.get('/api/admin/debug-email', (req, res) => {
  res.json({
    status: 'debug',
    mailConfigured: !!mailTransport,
    adminEmailConfigured: !!adminEmail,
    smtpHost: process.env.SMTP_HOST ? '✓ Set' : '✗ Missing',
    smtpUser: process.env.SMTP_USER ? '✓ Set' : '✗ Missing',
    smtpPass: process.env.SMTP_PASS ? '✓ Set' : '✗ Missing',
    smtpPort: process.env.SMTP_PORT || '587',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ? '✓ Set' : '✗ Missing',
    message: mailTransport ? 'Email is configured' : 'Email is NOT configured - check your .env or Render environment variables'
  });
});

app.get('/api/admin/health', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const users = readJson(usersPath);
  const products = readJson(productsPath);
  const orders = fs.existsSync(ordersPath) ? readJson(ordersPath) : [];
  orders.forEach(normalizeOrder);

  const lowStockProducts = products.filter((p) => p.published !== false && Number(p.stock || 0) <= 5);
  const paidOrders = orders.filter((o) => o.paymentStatus === 'PAID').length;
  const unfulfilledOrders = orders.filter((o) => o.fulfillmentStatus !== 'COMPLETED'
    && !['CANCELLED', 'REJECTED'].includes(o.orderStatus)).length;
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
  if (!req.session?.user?.id || req.session.user.approved !== true) {
    return res.status(401).json({ error: 'Approved member access is required.' });
  }
  const products = readJson(productsPath);
  const visibleProducts = products.filter((product) => product.published !== false || req.session.user?.role === 'admin');
  res.json(visibleProducts.map(({ stockAdjustmentEvents, stockReleaseEvents, ...product }) => product));
});

app.get('/api/menu', (req, res) => {
  const products = readJson(productsPath)
    .filter((product) => product.published !== false && foodCategories.has(product.category))
    .map(({ stockAdjustmentEvents, stockReleaseEvents, ...product }) => product);
  res.json(products);
});

app.get('/api/storefront-status', (req, res) => {
  const settings = getBusinessSettings();
  res.json({
    websiteAvailable: true,
    orderingEnabled: isFoodOrderingAvailable(settings),
    pickupEnabled: settings.pickupEnabled,
    deliveryEnabled: false,
    temporarilyClosed: settings.temporarilyClosed,
    minimumLeadMinutes: settings.minimumLeadMinutes,
    timezone: settings.timezone,
    hours: settings.hours,
    channels: [
      { id: 'website', name: 'PHLAPZ website', status: 'independent' },
      { id: 'ubereats', name: 'Uber Eats', status: 'not_connected' },
      { id: 'doordash', name: 'DoorDash', status: 'not_connected' },
      { id: 'skipthedishes', name: 'SkipTheDishes', status: 'not_connected' }
    ]
  });
});

app.get('/api/payment-options', (req, res) => {
  const settings = getPaymentSettings();
  res.json({
    stripe: Boolean(stripe),
    orderingEnabled: isFoodOrderingAvailable(),
    manualMethods: settings.manualMethods.filter((method) => method.active !== false)
      .map(({ id, name }) => ({ id, name }))
  });
});

app.get('/api/admin/business-settings', (req, res) => {
  res.json(getBusinessSettings());
});

app.put('/api/admin/business-settings', (req, res) => {
  const body = req.body || {};
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const hours = {};
  if (!body.hours || typeof body.hours !== 'object' || Array.isArray(body.hours)
    || Object.keys(body.hours).some((day) => !dayNames.includes(day))) {
    return res.status(400).json({ error: 'Provide valid weekly pickup hours.' });
  }
  for (const day of dayNames) {
    const interval = body.hours[day];
    if (interval === null || interval === undefined) continue;
    const validTime = (time) => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
    if (!interval || !validTime(interval.open) || !validTime(interval.close)
      || interval.open >= interval.close) {
      return res.status(400).json({ error: `Pickup hours for ${day} must use a valid open and close time on the same day.` });
    }
    hours[day] = { open: interval.open, close: interval.close };
  }
  if (typeof body.acceptingOrders !== 'boolean' || typeof body.temporarilyClosed !== 'boolean'
    || typeof body.pickupEnabled !== 'boolean' || !Number.isInteger(body.minimumLeadMinutes)
    || body.minimumLeadMinutes < 0 || body.minimumLeadMinutes > 1440) {
    return res.status(400).json({ error: 'Order acceptance, pickup availability, closure status, and lead time must be valid.' });
  }
  const settings = {
    acceptingOrders: body.acceptingOrders,
    temporarilyClosed: body.temporarilyClosed,
    pickupEnabled: body.pickupEnabled,
    deliveryEnabled: false,
    timezone: 'America/Toronto',
    minimumLeadMinutes: body.minimumLeadMinutes,
    hours
  };
  writeJson(businessSettingsPath, settings);
  res.json({ ...settings, orderingEnabled: isFoodOrderingAvailable(settings) });
});

app.post('/api/create-checkout-session', async (req, res) => {
  const paymentMethod = req.body?.paymentMethod || 'stripe';
  const idempotencyKey = req.body?.idempotencyKey;
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const sessionUser = req.session?.user?.approved === true ? req.session.user : null;
  if (!items.length || items.length > 50) {
    return res.status(400).json({ error: 'Your cart is empty.' });
  }
  if (typeof idempotencyKey !== 'string'
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(idempotencyKey)) {
    return res.status(400).json({ error: 'A valid checkout request ID is required.' });
  }
  if (paymentMethod === 'stripe' && !stripe) {
    return res.status(400).json({ error: 'Stripe is not configured yet. Choose another available payment method or contact the store.' });
  }
  try {
    const result = await runSerializedStoreWork(async () => {
      const orders = readJson(ordersPath);
      const products = readJson(productsPath);
      const paymentSettings = getPaymentSettings();
      const chosenMethod = paymentMethod === 'stripe'
        ? { id: 'stripe', name: 'Stripe', instructions: '' }
        : paymentSettings.manualMethods.find((method) => method.id === paymentMethod && method.active !== false);
      if (!chosenMethod) return { error: 'That payment method is not available.', status: 400 };

      const requestedQuantities = new Map();
      const requestedLines = [];
      for (const item of items) {
        const quantity = Number(item?.quantity);
        if (typeof item?.id !== 'string' || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
          return { error: 'Each cart item must have a valid product and quantity.', status: 400 };
        }
        const customizationIds = item.customizationIds === undefined ? [] : item.customizationIds;
        if (!Array.isArray(customizationIds) || customizationIds.length > 30
          || customizationIds.some((id) => typeof id !== 'string' || id.length > 80)
          || new Set(customizationIds).size !== customizationIds.length) {
          return { error: 'A cart item has invalid customization choices.', status: 400 };
        }
        const totalQuantity = (requestedQuantities.get(item.id) || 0) + quantity;
        if (totalQuantity > 100) return { error: 'Each product is limited to 100 units per checkout.', status: 400 };
        requestedQuantities.set(item.id, totalQuantity);
        requestedLines.push({ id: item.id, quantity, customizationIds: [...customizationIds].sort() });
      }

      const productMap = new Map(products.map((product) => [product.id, product]));
      const normalizedItems = [];
      let containsOnlyFood = true;
      for (const line of requestedLines) {
        const product = productMap.get(line.id);
        if (!product || product.published === false) {
          return { error: 'A product in your cart is no longer available.', status: 400 };
        }
        if (!foodCategories.has(product.category)) containsOnlyFood = false;
        const customizations = line.customizationIds.map((id) =>
          (product.customizations || []).find((option) => option.id === id));
        if (customizations.some((option) => !option)) {
          return { error: `${product.name} has a customization that is no longer available.`, status: 400 };
        }
        if (product.price === null || !Number.isFinite(Number(product.price)) || Number(product.price) < 0) {
          return { error: `${product.name} has an invalid price and cannot be ordered.`, status: 400 };
        }
        const customizationTotalCents = customizations.reduce((sum, option) =>
          sum + Math.round(Number(option.price) * 100), 0);
        const name = customizations.length
          ? `${product.name} (${customizations.map((option) => option.name).join(', ')})`
          : product.name;

        normalizedItems.push({
          id: product.id,
          name,
          description: product.description || 'Member purchase',
          price: (Math.round(Number(product.price) * 100) + customizationTotalCents) / 100,
          quantity: line.quantity,
          customizations: customizations.map((option) => ({
            id: option.id,
            name: option.name,
            price: Number(option.price)
          }))
        });
      }
      if (!sessionUser && !containsOnlyFood) {
        return { error: 'Please sign in before ordering non-menu products.', status: 401 };
      }
      const businessSettings = containsOnlyFood ? getBusinessSettings() : null;
      if (containsOnlyFood && !isFoodOrderingAvailable(businessSettings)) {
        return { error: 'Online food ordering is not open yet. Please check back soon.', status: 503 };
      }

      const contact = req.body?.contact || {};
      const customerName = String(contact.name || sessionUser?.name || '').trim();
      const customerEmail = String(contact.email || sessionUser?.email || '').trim().toLowerCase();
      if (!customerName || customerName.length > 100
        || customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
        return { error: 'Enter your name and a valid email address.', status: 400 };
      }
      const isFoodOrder = normalizedItems.every((item) => foodCategories.has(productMap.get(item.id)?.category));
      const pickupTime = String(contact.pickupTime || '').trim();
      if (isFoodOrder && (!pickupTime || pickupTime.length > 80
        || !isValidPickupSlot(pickupTime, businessSettings))) {
        return { error: 'Choose a future pickup time within the kitchen’s published hours.', status: 400 };
      }
      const notes = String(contact.notes || '').trim();
      if (notes.length > 1000) {
        return { error: 'Order notes must be 1,000 characters or fewer.', status: 400 };
      }
      const address = {
        street: typeof contact.street === 'string' ? contact.street.trim() : '',
        city: typeof contact.city === 'string' ? contact.city.trim() : '',
        province: typeof contact.province === 'string' ? contact.province.trim().toUpperCase() : '',
        postalCode: typeof contact.postalCode === 'string' ? contact.postalCode.trim().toUpperCase() : '',
        country: typeof contact.country === 'string' ? contact.country.trim().toUpperCase() : ''
      };
      if (!isFoodOrder && (Object.values(address).some((value) => value.length > 120)
        || !address.street || !address.city || !/^[A-Z]{2}$/.test(address.province)
        || !/^[A-Z]{2}$/.test(address.country) || !address.postalCode || address.postalCode.length > 16)) {
        return { error: 'Enter a valid street, city, province or region, postal code, and country.', status: 400 };
      }
      const taxJurisdiction = isFoodOrder
        ? String(process.env.STORE_TAX_JURISDICTION || 'CA-ON').toUpperCase()
        : `${address.country}-${address.province}`;
      const [taxCountry, taxProvince] = taxJurisdiction.split('-');
      const totals = getOrderTotals(normalizedItems, taxProvince, paymentSettings, taxCountry);
      if (totals.error) return { error: totals.error, status: 409 };
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
        paymentMethod,
        items: requestedLines.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        address,
        phone: String(contact.phone || '').trim(),
        customerName,
        customerEmail,
        pickupTime,
        notes
      })).digest('hex');
      const existingOrder = orders.find((order) => order.checkoutRequestId === idempotencyKey
        && (sessionUser ? order.userId === sessionUser.id : !order.userId && order.customerEmail === customerEmail));
      if (existingOrder) {
        normalizeOrder(existingOrder);
        if (existingOrder.requestFingerprint !== fingerprint) {
          return { error: 'This checkout request ID was already used for a different order.', status: 409 };
        }
        if (existingOrder.paymentMethod === 'stripe' && existingOrder.stripeSessionId
          && existingOrder.paymentStatus === 'PENDING') {
          const checkoutSession = await stripe.checkout.sessions.retrieve(existingOrder.stripeSessionId);
          if (checkoutSession.status === 'open' && checkoutSession.url) {
            return { order: serializeCustomerOrder(existingOrder), url: checkoutSession.url };
          }
        }
        return {
          order: serializeCustomerOrder(existingOrder),
          manual: existingOrder.paymentMethod !== 'stripe',
          emailPending: hasPendingOrderEmails(existingOrder)
        };
      }

      for (const [productId, quantity] of requestedQuantities) {
        const product = productMap.get(productId);
        if (Number(product.stock || 0) < quantity) {
          return { error: `${product.name} only has ${Number(product.stock || 0)} left in stock.`, status: 400 };
        }
      }

      if (paymentMethod !== 'stripe' && !chosenMethod.instructions.trim()) {
        return { error: 'The selected manual payment method has no payment instructions yet.', status: 409 };
      }
      const order = {
        id: `order-${crypto.randomUUID()}`,
        checkoutRequestId: idempotencyKey,
        requestFingerprint: fingerprint,
        userId: sessionUser?.id || null,
        customerName,
        customerEmail,
        phone: String(contact.phone || '').trim().slice(0, 40),
        address: isFoodOrder ? null : address,
        fulfillmentMethod: isFoodOrder ? 'pickup' : 'delivery',
        pickupTime: pickupTime.slice(0, 80),
        customerNotes: notes,
        salesChannel: isFoodOrder ? 'website' : 'retail',
        ...totals,
        paymentMethod: paymentMethod === 'stripe' ? 'stripe' : 'manual',
        paymentMethodId: chosenMethod.id,
        paymentMethodName: chosenMethod.name,
        paymentInstructions: chosenMethod.instructions || '',
        orderStatus: 'PENDING_CONFIRMATION',
        paymentStatus: paymentMethod === 'stripe' ? 'PENDING' : 'AWAITING_PAYMENT',
        fulfillmentStatus: 'NOT_STARTED',
        status: 'PENDING_CONFIRMATION',
        createdAt: new Date().toISOString(),
        checkoutExpiresAt: Math.floor(Date.now() / 1000) + 35 * 60,
        inventoryReserved: false,
        items: normalizedItems,
        history: []
      };

      const duplicateActive = orders.find((entry) => entry.userId === order.userId
        && entry.customerEmail === order.customerEmail
        && entry.orderStatus === 'PENDING_CONFIRMATION'
        && entry.paymentStatus === 'PENDING'
        && entry.checkoutRequestId !== idempotencyKey);
      if (duplicateActive && paymentMethod === 'stripe') {
        return { error: 'You already have a Stripe checkout awaiting payment. Complete it or wait for it to expire before starting another.', status: 409 };
      }

      addOrderHistory(order, 'order_received', 'customer');
      orders.unshift(order);
      writeJson(ordersPath, orders);
      try {
        applyInventoryReservation(products, order);
      } catch (error) {
        orders.shift();
        writeJson(ordersPath, orders);
        return { error: error.message, status: 409 };
      }
      writeJson(productsPath, products);
      order.inventoryReserved = true;
      writeJson(ordersPath, orders);

      if (paymentMethod !== 'stripe') {
        await sendOrderNotification(orders, order, 'received');
        return { order: serializeCustomerOrder(order), manual: true, emailPending: hasPendingOrderEmails(order) };
      }

      try {
        const checkoutSession = await getStripeCheckoutForOrder(order);
        order.stripeSessionId = checkoutSession.id;
        addOrderHistory(order, 'stripe_checkout_created', 'system', checkoutSession.id);
        writeJson(ordersPath, orders);
        await sendOrderNotification(orders, order, 'received');
        return { order: serializeCustomerOrder(order), url: checkoutSession.url };
      } catch (error) {
        const definitiveFailure = Number.isInteger(error.statusCode)
          && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429;
        if (definitiveFailure) {
          releaseInventoryReservation(products, order);
          order.inventoryReserved = false;
          order.paymentStatus = 'FAILED';
          order.paymentError = 'Stripe checkout could not be created.';
          addOrderHistory(order, 'stripe_checkout_failed', 'system');
          writeJson(productsPath, products);
        }
        await sendOrderNotification(orders, order, 'received');
        writeJson(ordersPath, orders);
        throw error;
      }
    });

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    if (result.url) return res.status(201).json(result);
    res.status(201).json({
      order: result.order,
      manual: result.manual,
      instructions: result.order.paymentInstructions,
      emailPending: result.emailPending
    });
  } catch (error) {
    console.error('[Checkout] Unable to create checkout:', error.message);
    res.status(502).json({ error: 'Secure checkout is temporarily unavailable. Please try again.' });
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

  const stripeObject = event.data.object;
  const supportedEvents = [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
    'refund.created',
    'refund.updated'
  ];
  if (!supportedEvents.includes(event.type)) return res.json({ received: true });

  try {
    const result = await enqueueStripeWebhook(async () => {
      const orders = readJson(ordersPath);
      if (event.type.startsWith('refund.')) {
        const order = orders.find((entry) => entry.stripePaymentIntent === stripeObject.payment_intent
          || entry.refundId === stripeObject.id);
        if (!order) return { received: true, unmatched: true };
        normalizeOrder(order);
        if (!Array.isArray(order.processedStripeEventIds)) order.processedStripeEventIds = [];
        if (order.processedStripeEventIds.includes(event.id)) return { received: true, duplicate: true };
        order.processedStripeEventIds.push(event.id);
        order.refundId = stripeObject.id;
        order.refundStatus = stripeObject.status;
        order.paymentStatus = stripeObject.status === 'succeeded' ? 'REFUNDED'
          : stripeObject.status === 'pending' ? 'REFUND_PENDING'
            : stripeObject.status === 'failed' || stripeObject.status === 'canceled' ? 'PAID'
              : order.paymentStatus;
        addOrderHistory(order, 'refund_status_updated', 'stripe', `${stripeObject.id}: ${stripeObject.status}`);
        writeJson(ordersPath, orders);
        if (order.paymentStatus === 'REFUNDED') await sendOrderNotification(orders, order, 'refund');
        else if (order.paymentStatus === 'REFUND_PENDING') await sendOrderNotification(orders, order, 'refund_pending');
        return { received: true };
      }

      const checkoutSession = stripeObject;
      let order = findOrderForCheckout(orders, checkoutSession);

      if (event.type === 'checkout.session.completed' && checkoutSession.payment_status !== 'paid') {
        return { ignored: 'payment_not_complete' };
      }

      if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
        if (order && order.paymentStatus !== 'PAID' && order.paymentStatus !== 'REFUNDED') {
          normalizeOrder(order);
          if (order.inventoryReserved) {
            const products = readJson(productsPath);
            releaseInventoryReservation(products, order);
            writeJson(productsPath, products);
            order.inventoryReserved = false;
          }
          order.paymentStatus = 'FAILED';
          order.paymentFailure = event.type === 'checkout.session.expired' ? 'Checkout expired.' : 'Stripe reported payment failure.';
          if (!Array.isArray(order.processedStripeEventIds)) order.processedStripeEventIds = [];
          if (!order.processedStripeEventIds.includes(event.id)) order.processedStripeEventIds.push(event.id);
          addOrderHistory(order, 'stripe_payment_failed', 'stripe', event.type);
          writeJson(ordersPath, orders);
        }
        return { received: true };
      }

      if (checkoutSession.payment_status !== 'paid') {
        return { ignored: 'payment_not_complete' };
      }
      if (checkoutSession.mode !== 'payment' || typeof checkoutSession.id !== 'string') {
        throw new Error('Paid checkout session has invalid payment details.');
      }

      if (!order) {
        const legacyItems = JSON.parse(checkoutSession.metadata?.items || '[]');
        if (!Array.isArray(legacyItems) || !legacyItems.length) {
          throw new Error('Paid checkout session does not match a pending order.');
        }
        order = {
          id: `order-${crypto.randomUUID()}`,
          stripeSessionId: checkoutSession.id,
          stripeEventId: event.id,
          customerName: checkoutSession.customer_details?.name || checkoutSession.metadata?.userEmail || 'Customer',
          customerEmail: checkoutSession.customer_details?.email || checkoutSession.metadata?.userEmail || '',
          amount: Number(checkoutSession.amount_total || 0) / 100,
          paymentMethod: 'stripe',
          paymentMethodName: 'Stripe',
          orderStatus: 'PENDING_CONFIRMATION',
          paymentStatus: 'PENDING',
          fulfillmentStatus: 'NOT_STARTED',
          status: 'PENDING_CONFIRMATION',
          createdAt: new Date().toISOString(),
          inventoryReserved: false,
          history: [],
          items: legacyItems
        };
        orders.unshift(order);
      }
      normalizeOrder(order);

      if (order.stripeSessionId && order.stripeSessionId !== checkoutSession.id) {
        throw new Error('Checkout session does not match the stored order.');
      }
      if (order.userId && checkoutSession.metadata?.userId !== order.userId) {
        throw new Error('Checkout session customer does not match the stored order.');
      }
      if (!Array.isArray(order.processedStripeEventIds)) order.processedStripeEventIds = [];
      if (order.processedStripeEventIds.includes(event.id)) {
        return { received: true, duplicate: true };
      }
      if (order.paymentStatus === 'PAID') {
        order.processedStripeEventIds.push(event.id);
        addOrderHistory(order, 'duplicate_stripe_payment_event', 'stripe', event.id);
        writeJson(ordersPath, orders);
        return { received: true, duplicate: true };
      }

      order.stripeSessionId = checkoutSession.id;
      order.stripePaymentIntent = typeof checkoutSession.payment_intent === 'string'
        ? checkoutSession.payment_intent : checkoutSession.payment_intent?.id || null;
      order.customerName = checkoutSession.customer_details?.name || order.customerName;
      order.customerEmail = checkoutSession.customer_details?.email || order.customerEmail;
      const expectedAmount = Math.round(Number(order.amount) * 100);
      if (checkoutSession.currency !== 'cad' || !Number.isFinite(expectedAmount)
        || expectedAmount !== Number(checkoutSession.amount_total)) {
        throw new Error('Paid checkout amount does not match the stored order.');
      }

      if (['REJECTED', 'CANCELLED'].includes(order.orderStatus)) {
        order.paymentStatus = 'PAID';
        order.processedStripeEventIds.push(event.id);
        addOrderHistory(order, 'late_payment_after_order_closed', 'stripe', checkoutSession.id);
        writeJson(ordersPath, orders);
        await sendOrderNotification(orders, order, 'stripe_paid_closed');
        return { received: true, closedOrderPayment: true };
      }

      const products = readJson(productsPath);
      if (!order.inventoryReserved) {
        try {
          applyInventoryReservation(products, order);
          order.inventoryReserved = true;
        } catch (error) {
          order.paymentStatus = 'PAID';
          order.inventoryError = 'Payment succeeded but inventory is unavailable; manual review is required.';
          order.processedStripeEventIds.push(event.id);
          addOrderHistory(order, 'paid_inventory_attention', 'stripe', error.message);
          writeJson(ordersPath, orders);
          console.error('[Webhook] Paid order needs inventory review:', order.id);
          return { received: true, inventoryAttention: true };
        }
      }

      order.paymentStatus = 'PAID';
      order.processedStripeEventIds.push(event.id);
      addOrderHistory(order, 'stripe_payment_verified', 'stripe', checkoutSession.id);
      writeJson(productsPath, products);
      writeJson(ordersPath, orders);

      await sendOrderNotification(orders, order, 'stripe_paid');

      console.info('[Webhook] Paid checkout processed:', order.id);
      return { received: true };
    });
    res.json(result);
  } catch (error) {
    console.error('[Webhook] Failed to process checkout event:', error.message);
    res.status(500).json({ error: 'Checkout event could not be fully recorded. Stripe may retry this event.' });
  }
});

app.post('/api/admin/products', (req, res) => {
  const { name, category, price, stock, description, image } = req.body || {};
  const foodDetails = parseProductFoodDetails(req.body);
  if (foodDetails.error) return res.status(400).json({ error: foodDetails.error });
  if (typeof name !== 'string' || typeof category !== 'string'
    || name.trim().length < 1 || name.trim().length > 120 || category.trim().length < 1 || category.trim().length > 80
    || (description !== undefined && (typeof description !== 'string' || description.length > 4000))
    || (image !== undefined && (typeof image !== 'string' || image.length > 2048))
    || (req.body?.published !== undefined && typeof req.body.published !== 'boolean')) {
    return res.status(400).json({ error: 'Product name, category, description, image, or publish status is invalid.' });
  }
  const published = req.body?.published !== false;
  const isSnowblower = /snow\s*blower/i.test(`${name || ''} ${category || ''}`);
  const parsedPrice = price === '' || price === null || price === undefined ? null : Number(price);
  const parsedStock = stock === '' || stock === null || stock === undefined ? null : Number(stock);
  if ((parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 1_000_000))
    || (parsedPrice !== null && Math.abs(parsedPrice * 100 - Math.round(parsedPrice * 100)) > 1e-8)
    || (parsedStock !== null && (!Number.isInteger(parsedStock) || parsedStock < 0))
    || !isValidProductImage(image || '')
    || (published && (parsedPrice === null || parsedStock === null))
    || (published && isSnowblower && (!String(description || '').trim() || !String(image || '').trim()))) {
    const message = published && isSnowblower
      ? 'Snowblower listings require verified product details, a photo, a valid price, and a whole-number stock quantity before publishing.'
      : 'Published products require a valid price and whole-number stock quantity.';
    return res.status(400).json({ error: message });
  }

  const products = readJson(productsPath);
  const product = {
    id: `p-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    name: String(name).trim(),
    category,
    price: parsedPrice,
    stock: parsedStock,
    featured: false,
    published,
    description: description || '',
    image: image || '',
    ingredients: foodDetails.ingredients,
    allergens: foodDetails.allergens,
    preparationMinutes: foodDetails.preparationMinutes,
    customizations: foodDetails.customizations
  };

  products.unshift(product);
  writeJson(productsPath, products);
  res.status(201).json(product);
});

app.put('/api/admin/products/:id', (req, res) => {
  const { name, category, price, stock, description, image } = req.body || {};
  const products = readJson(productsPath);
  const product = products.find((item) => item.id === req.params.id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found.' });
  }
  const foodDetails = parseProductFoodDetails(req.body, product);
  if (foodDetails.error) return res.status(400).json({ error: foodDetails.error });
  if (typeof name !== 'string' || typeof category !== 'string'
    || name.trim().length < 1 || name.trim().length > 120 || category.trim().length < 1 || category.trim().length > 80
    || (description !== undefined && (typeof description !== 'string' || description.length > 4000))
    || (image !== undefined && (typeof image !== 'string' || image.length > 2048))
    || (req.body?.published !== undefined && typeof req.body.published !== 'boolean')) {
    return res.status(400).json({ error: 'Product name, category, description, image, or publish status is invalid.' });
  }
  const published = req.body?.published !== false;
  const isSnowblower = /snow\s*blower/i.test(`${name || ''} ${category || ''}`);
  const parsedPrice = price === '' || price === null || price === undefined ? null : Number(price);
  const parsedStock = stock === '' || stock === null || stock === undefined ? null : Number(stock);
  if ((parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 1_000_000))
    || (parsedPrice !== null && Math.abs(parsedPrice * 100 - Math.round(parsedPrice * 100)) > 1e-8)
    || (parsedStock !== null && (!Number.isInteger(parsedStock) || parsedStock < 0))
    || !isValidProductImage(image || '')
    || (published && (parsedPrice === null || parsedStock === null))
    || (published && isSnowblower && (!String(description || '').trim() || !String(image || '').trim()))) {
    const message = published && isSnowblower
      ? 'Snowblower listings require verified product details, a photo, a valid price, and a whole-number stock quantity before publishing.'
      : 'Published products require a valid price and whole-number stock quantity.';
    return res.status(400).json({ error: message });
  }

  product.name = String(name).trim();
  product.category = category;
  product.price = parsedPrice;
  product.stock = parsedStock;
  product.description = description || '';
  product.image = image || '';
  product.ingredients = foodDetails.ingredients;
  product.allergens = foodDetails.allergens;
  product.preparationMinutes = foodDetails.preparationMinutes;
  product.customizations = foodDetails.customizations;
  product.published = published;

  writeJson(productsPath, products);
  res.json(product);
});

app.patch('/api/admin/orders/:id/status', (req, res) => {
  const { status } = req.body || {};
  if (status !== 'fulfilled') {
    return res.status(400).json({ error: 'Payment can only be marked received after verified Stripe or owner-confirmed manual payment. Use the fulfillment action to process orders.' });
  }

  const orders = fs.existsSync(ordersPath) ? readJson(ordersPath) : [];
  const order = orders.find((item) => item.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found.' });
  }

  normalizeOrder(order);
  if (order.paymentStatus !== 'PAID' || order.orderStatus !== 'CONFIRMED') {
    return res.status(409).json({ error: 'Only an owner-confirmed, paid order can be completed.' });
  }

  order.fulfillmentStatus = 'COMPLETED';
  addOrderHistory(order, 'fulfillment_completed', req.session.user.id);
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

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.code === 'LIMIT_FILE_SIZE' ? 413
    : Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  console.error('[HTTP] Request failed:', {
    method: req.method,
    path: req.path,
    status,
    message: error.message
  });
  const message = status === 413 ? 'Uploaded file exceeds the 5 MB limit.'
    : status === 400 ? 'Request body is invalid.'
      : status === 500 ? 'An unexpected server error occurred.' : 'Request could not be completed.';
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: message });
  res.status(status).type('text').send(message);
});

async function startServer() {
  await initializeUsersFile();
  await migratePlaintextPasswords();
  getPaymentSettings();
  const orders = fs.existsSync(ordersPath) ? readJson(ordersPath) : [];
  const originalOrders = JSON.stringify(orders);
  orders.forEach(normalizeOrder);
  if (JSON.stringify(orders) !== originalOrders) writeJson(ordersPath, orders);
  dummyPasswordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
  app.listen(PORT, () => {
    console.log(`Private storefront running at http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('[Startup] Storefront initialization failed:', error.message);
  process.exitCode = 1;
});
