const state = {
  user: null,
  products: [],
  users: [],
  cart: [],
  mode: 'login',
  filter: 'All'
};

const authSection = document.querySelector('#authSection');
const storeSection = document.querySelector('#storeSection');
const adminSection = document.querySelector('#adminSection');
const authForm = document.querySelector('#authForm');
const authSubmit = document.querySelector('#authSubmit');
const authMessage = document.querySelector('#authMessage');
const nameField = document.querySelector('#nameField');
const logoutButton = document.querySelector('#logoutButton');
const memberName = document.querySelector('#memberName');
const productGrid = document.querySelector('#productGrid');
const cartItems = document.querySelector('#cartItems');
const cartCount = document.querySelector('#cartCount');
const subtotalValue = document.querySelector('#subtotalValue');
const categoryFilter = document.querySelector('#categoryFilter');
const productForm = document.querySelector('#productForm');
const adminProductList = document.querySelector('#adminProductList');
const adminUsersList = document.querySelector('#adminUsersList');
const adminLink = document.querySelector('#adminLink');
const cartButton = document.querySelector('#cartButton');

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
  const showName = mode === 'signup';
  nameField.parentElement.classList.toggle('hidden', !showName);
  authSubmit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
}

function updateCartTotal() {
  const total = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  cartCount.textContent = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  subtotalValue.textContent = `$${total.toFixed(2)}`;
}

function renderCart() {
  if (!state.cart.length) {
    cartItems.innerHTML = '<p class="product-description">Your cart is empty.</p>';
    updateCartTotal();
    return;
  }

  cartItems.innerHTML = state.cart.map((item) => `
    <div class="cart-item">
      <div>
        <strong>${item.name}</strong>
        <div class="product-description">Qty: ${item.quantity}</div>
      </div>
      <strong>$${(item.price * item.quantity).toFixed(2)}</strong>
    </div>
  `).join('');
  updateCartTotal();
}

function renderProducts() {
  const filtered = state.products.filter((product) => {
    if (state.filter === 'All') return true;
    return product.category === state.filter;
  });

  if (!filtered.length) {
    productGrid.innerHTML = '<div class="product-description">No products in this category yet.</div>';
    return;
  }

  productGrid.innerHTML = filtered.map((product) => {
    const imageMarkup = product.image
      ? `<img class="product-thumb" src="${product.image}" alt="${product.name}" />`
      : `<div class="product-image">${product.name.charAt(0)}</div>`;

    return `
      <article class="product-card">
        ${imageMarkup}
        <div class="product-content">
          <div class="product-meta">
            <span>${product.category}</span>
            <span class="product-price">$${Number(product.price).toFixed(2)}</span>
          </div>
          <h4>${product.name}</h4>
          <div class="product-description">${product.description || 'Premium product for approved members.'}</div>
          <button data-product-id="${product.id}" class="add-to-cart">Add to cart</button>
        </div>
      </article>
    `;
  }).join('');

  document.querySelectorAll('.add-to-cart').forEach((button) => {
    button.addEventListener('click', () => {
      const product = state.products.find((item) => item.id === button.dataset.productId);
      if (!product) return;
      const existing = state.cart.find((item) => item.id === product.id);
      if (existing) {
        existing.quantity += 1;
      } else {
        state.cart.push({ ...product, quantity: 1 });
      }
      renderCart();
    });
  });
}

function renderAdminProducts() {
  if (!state.user || state.user.role !== 'admin') {
    adminProductList.innerHTML = '';
    return;
  }

  adminProductList.innerHTML = state.products.map((product) => `
    <div class="admin-product-row">
      <div>
        <strong>${product.name}</strong>
        <div class="product-description">$${Number(product.price).toFixed(2)} · ${product.category}</div>
      </div>
      <button data-delete-id="${product.id}">Delete</button>
    </div>
  `).join('');

  document.querySelectorAll('[data-delete-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.deleteId;
      const response = await fetch(`/api/admin/products/${id}`, { method: 'DELETE' });
      if (response.ok) {
        await fetchProducts();
      }
    });
  });
}

function renderAdminUsers() {
  if (!state.user || state.user.role !== 'admin') {
    adminUsersList.innerHTML = '';
    return;
  }

  if (!state.users.length) {
    adminUsersList.innerHTML = '<p class="product-description">No members yet.</p>';
    return;
  }

  adminUsersList.innerHTML = state.users.map((member) => `
    <div class="admin-product-row">
      <div>
        <strong>${member.name}</strong>
        <div class="product-description">${member.email}</div>
      </div>
      <span class="pill">${member.role}</span>
    </div>
  `).join('');
}

async function fetchProducts() {
  const response = await fetch('/api/products');
  if (!response.ok) {
    state.products = [];
    renderProducts();
    renderAdminProducts();
    return;
  }

  state.products = await response.json();
  renderProducts();
  renderAdminProducts();
}

async function fetchUsers() {
  if (!state.user || state.user.role !== 'admin') {
    state.users = [];
    renderAdminUsers();
    return;
  }

  const response = await fetch('/api/admin/users');
  if (!response.ok) {
    state.users = [];
    renderAdminUsers();
    return;
  }

  state.users = await response.json();
  renderAdminUsers();
}

function showStore() {
  authSection.classList.add('hidden');
  storeSection.classList.remove('hidden');
  if (state.user && state.user.role === 'admin') {
    adminSection.classList.remove('hidden');
  } else {
    adminSection.classList.add('hidden');
  }
  logoutButton.classList.remove('hidden');
  memberName.textContent = state.user ? state.user.name : 'Member';
  renderAdminUsers();
}

function showAuth() {
  authSection.classList.remove('hidden');
  storeSection.classList.add('hidden');
  adminSection.classList.add('hidden');
  logoutButton.classList.add('hidden');
  state.cart = [];
  renderCart();
}

async function loadSession() {
  const response = await fetch('/api/me');
  if (!response.ok) {
    showAuth();
    return;
  }

  const payload = await response.json();
  state.user = payload.user;
  if (state.user) {
    showStore();
    await fetchProducts();
    await fetchUsers();
  } else {
    showAuth();
  }
}

async function submitAuth(event) {
  event.preventDefault();
  authMessage.textContent = '';
  const formData = new FormData(authForm);
  const payload = {
    name: formData.get('name')?.toString().trim(),
    email: formData.get('email')?.toString().trim(),
    password: formData.get('password')?.toString()
  };

  const endpoint = state.mode === 'signup' ? '/api/signup' : '/api/login';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  if (!response.ok) {
    authMessage.textContent = result.error || 'Request failed.';
    return;
  }

  state.user = result.user;
  authForm.reset();
  showStore();
  await fetchProducts();
  await fetchUsers();
}

async function submitProduct(event) {
  event.preventDefault();
  const formData = new FormData(productForm);
  const payload = {
    name: formData.get('name').toString().trim(),
    price: Number(formData.get('price')),
    stock: Number(formData.get('stock')),
    category: formData.get('category').toString(),
    description: formData.get('description').toString().trim(),
    image: formData.get('image')?.toString().trim() || ''
  };

  const response = await fetch('/api/admin/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (response.ok) {
    productForm.reset();
    await fetchProducts();
  }
}

document.querySelectorAll('.tab-button').forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});

authForm.addEventListener('submit', submitAuth);
productForm.addEventListener('submit', submitProduct);
logoutButton.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  state.user = null;
  state.cart = [];
  state.products = [];
  showAuth();
});
categoryFilter.addEventListener('change', (event) => {
  state.filter = event.target.value;
  renderProducts();
});
cartButton.addEventListener('click', () => {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
});
document.querySelector('#checkoutButton').addEventListener('click', async () => {
  if (!state.user) {
    alert('Please sign in before checking out.');
    return;
  }

  if (!state.cart.length) {
    alert('Add at least one product before checkout.');
    return;
  }

  const checkoutButton = document.querySelector('#checkoutButton');
  checkoutButton.disabled = true;
  checkoutButton.textContent = 'Processing...';

  try {
    const response = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: state.cart })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Checkout failed.');
    }

    if (result.url) {
      window.location.href = result.url;
      return;
    }

    throw new Error('No checkout URL returned.');
  } catch (error) {
    alert(error.message || 'Unable to complete checkout.');
  } finally {
    checkoutButton.disabled = false;
    checkoutButton.textContent = 'Complete purchase';
  }
});
adminLink.addEventListener('click', (event) => {
  event.preventDefault();
  if (state.user && state.user.role === 'admin') {
    adminSection.classList.toggle('hidden');
  }
});

setMode('login');
renderCart();
loadSession();
