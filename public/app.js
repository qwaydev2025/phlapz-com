const state = {
  user: null,
  products: [],
  users: [],
  orders: [],
  cart: [],
  mode: 'login',
  filter: 'All',
  adminProductSearch: '',
  adminProductCategory: 'All',
  memberSearch: '',
  orderSearch: '',
  orderStatus: 'All',
  editingProductId: null
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
const adminOrdersList = document.querySelector('#adminOrdersList');
const adminLink = document.querySelector('#adminLink');
const cartButton = document.querySelector('#cartButton');
const adminGreetingName = document.querySelector('#adminGreetingName');
const refreshAdminData = document.querySelector('#refreshAdminData');
const adminTabs = document.querySelectorAll('.admin-tab');
const adminPanels = document.querySelectorAll('.admin-panel');
const statUsers = document.querySelector('#statUsers');
const statProducts = document.querySelector('#statProducts');
const statOrders = document.querySelector('#statOrders');
const statRevenue = document.querySelector('#statRevenue');
const statLowStock = document.querySelector('#statLowStock');
const recentMembersList = document.querySelector('#recentMembersList');
const recentOrdersList = document.querySelector('#recentOrdersList');
const adminProductSearch = document.querySelector('#adminProductSearch');
const adminProductCategoryFilter = document.querySelector('#adminProductCategoryFilter');
const memberSearch = document.querySelector('#memberSearch');
const orderSearch = document.querySelector('#orderSearch');
const orderStatusFilter = document.querySelector('#orderStatusFilter');
const productSaveButton = document.querySelector('#productSaveButton');
const cancelProductEditButton = document.querySelector('#cancelProductEdit');
const exportOrdersButton = document.querySelector('#exportOrdersButton');
const storeHealthWidget = document.querySelector('#storeHealthWidget');

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
      <div class="cart-item-actions">
        <div class="quantity-controls">
          <button class="mini-button" data-action="decrease" data-product-id="${item.id}">−</button>
          <span>${item.quantity}</span>
          <button class="mini-button" data-action="increase" data-product-id="${item.id}">+</button>
        </div>
        <button class="text-button" data-action="remove" data-product-id="${item.id}">Remove</button>
        <strong>$${(item.price * item.quantity).toFixed(2)}</strong>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('[data-product-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const productId = button.dataset.productId;
      const action = button.dataset.action;
      const item = state.cart.find((cartItem) => cartItem.id === productId);
      if (!item) return;

      if (action === 'increase') {
        item.quantity += 1;
      }

      if (action === 'decrease') {
        item.quantity -= 1;
        if (item.quantity <= 0) {
          state.cart = state.cart.filter((cartItem) => cartItem.id !== productId);
        }
      }

      if (action === 'remove') {
        state.cart = state.cart.filter((cartItem) => cartItem.id !== productId);
      }

      renderCart();
    });
  });

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

function resetProductForm() {
  state.editingProductId = null;
  productForm.reset();
  productSaveButton.textContent = 'Save product';
  cancelProductEditButton.classList.add('hidden');
}

function populateProductForm(product) {
  state.editingProductId = product.id;
  document.querySelector('#productName').value = product.name || '';
  document.querySelector('#productCategory').value = product.category || 'Food';
  document.querySelector('#productPrice').value = product.price ?? 0;
  document.querySelector('#productStock').value = product.stock ?? 0;
  document.querySelector('#productImage').value = product.image || '';
  document.querySelector('#productDescription').value = product.description || '';
  productSaveButton.textContent = 'Update product';
  cancelProductEditButton.classList.remove('hidden');
}

function renderAdminProducts() {
  if (!state.user || state.user.role !== 'admin') {
    adminProductList.innerHTML = '';
    return;
  }

  const filteredProducts = state.products.filter((product) => {
    const searchText = state.adminProductSearch.toLowerCase();
    const matchesSearch = !searchText || product.name.toLowerCase().includes(searchText) || product.description?.toLowerCase().includes(searchText) || product.category.toLowerCase().includes(searchText);
    const matchesCategory = state.adminProductCategory === 'All' || product.category === state.adminProductCategory;
    return matchesSearch && matchesCategory;
  });

  if (!filteredProducts.length) {
    adminProductList.innerHTML = '<p class="product-description">No products match your filters.</p>';
    return;
  }

  adminProductList.innerHTML = filteredProducts.map((product) => `
    <div class="admin-product-row">
      <div>
        <strong>${product.name}</strong>
        <div class="product-description">$${Number(product.price).toFixed(2)} · ${product.category}</div>
      </div>
      <div class="row-actions">
        <button data-edit-id="${product.id}">Edit</button>
        <button class="danger-button" data-delete-id="${product.id}">Delete</button>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('[data-edit-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const product = state.products.find((item) => item.id === button.dataset.editId);
      if (product) {
        populateProductForm(product);
        window.scrollTo({ top: document.querySelector('#productForm').offsetTop - 20, behavior: 'smooth' });
      }
    });
  });

  document.querySelectorAll('[data-delete-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.deleteId;
      const response = await fetch(`/api/admin/products/${id}`, { method: 'DELETE' });
      if (response.ok) {
        if (state.editingProductId === id) {
          resetProductForm();
        }
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

  const filteredUsers = state.users.filter((member) => {
    const searchText = state.memberSearch.toLowerCase();
    return !searchText || member.name.toLowerCase().includes(searchText) || member.email.toLowerCase().includes(searchText) || member.role.toLowerCase().includes(searchText);
  });

  if (!filteredUsers.length) {
    adminUsersList.innerHTML = '<p class="product-description">No members match your search.</p>';
    return;
  }

  adminUsersList.innerHTML = filteredUsers.map((member) => `
    <div class="admin-product-row">
      <div>
        <strong>${member.name}</strong>
        <div class="product-description">${member.email}</div>
      </div>
      <div class="row-actions">
        <select class="member-role-select" data-member-id="${member.id}">
          <option value="member" ${member.role === 'member' ? 'selected' : ''}>Member</option>
          <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
        <button class="danger-button" data-delete-member-id="${member.id}">Remove</button>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.member-role-select').forEach((select) => {
    select.addEventListener('change', async (event) => {
      const id = event.target.dataset.memberId;
      const role = event.target.value;
      const response = await fetch(`/api/admin/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });

      if (response.ok) {
        await fetchUsers();
        await fetchAdminSummary();
      }
    });
  });

  document.querySelectorAll('[data-delete-member-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.deleteMemberId;
      if (confirm('Are you sure you want to remove this member? This cannot be undone.')) {
        const response = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
        if (response.ok) {
          await fetchUsers();
          await fetchAdminSummary();
        }
      }
    });
  });
}

function renderAdminOrders() {
  if (!state.user || state.user.role !== 'admin') {
    adminOrdersList.innerHTML = '';
    return;
  }

  const filteredOrders = state.orders.filter((order) => {
    const searchText = state.orderSearch.toLowerCase();
    const matchesSearch = !searchText || order.customerName.toLowerCase().includes(searchText) || (order.customerEmail || '').toLowerCase().includes(searchText) || String(order.amount).includes(searchText);
    const matchesStatus = state.orderStatus === 'All' || (order.status || '').toLowerCase() === state.orderStatus.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  if (!filteredOrders.length) {
    adminOrdersList.innerHTML = '<p class="product-description">No orders match your filters.</p>';
    return;
  }

  adminOrdersList.innerHTML = filteredOrders.map((order) => `
    <div class="admin-product-row order-row">
      <div>
        <strong>${order.customerName || 'Customer'}</strong>
        <div class="product-description">${order.customerEmail || 'No email'} · ${new Date(order.createdAt || Date.now()).toLocaleDateString()}</div>
      </div>
      <div class="order-meta">
        <select class="order-status-select" data-order-status-id="${order.id}">
          <option value="paid" ${order.status === 'paid' ? 'selected' : ''}>Paid</option>
          <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="fulfilled" ${order.status === 'fulfilled' ? 'selected' : ''}>Fulfilled</option>
          <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
        </select>
        <strong>$${Number(order.amount || 0).toFixed(2)}</strong>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.order-status-select').forEach((select) => {
    select.addEventListener('change', async (event) => {
      const id = event.target.dataset.orderStatusId;
      const status = event.target.value;
      const response = await fetch(`/api/admin/orders/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });

      if (response.ok) {
        await fetchOrders();
        await fetchAdminSummary();
      }
    });
  });
}

function setAdminView(view) {
  adminTabs.forEach((button) => {
    button.classList.toggle('active', button.dataset.adminView === view);
  });

  adminPanels.forEach((panel) => {
    const isActive = panel.id === (
      view === 'overview' ? 'adminOverviewPanel' :
      view === 'products' ? 'adminProductsPanel' :
      view === 'members' ? 'adminMembersPanel' :
      view === 'orders' ? 'adminOrdersPanel' :
      'adminSettingsPanel'
    );
    panel.classList.toggle('hidden', !isActive);
    panel.classList.toggle('active', isActive);
  });

  if (view === 'settings') {
    fetchStoreHealth();
  }
}

async function fetchAdminSummary() {
  if (!state.user || state.user.role !== 'admin') return;

  const response = await fetch('/api/admin/summary');
  if (!response.ok) return;

  const summary = await response.json();
  statUsers.textContent = String(summary.users || 0);
  statProducts.textContent = String(summary.products || 0);
  statOrders.textContent = String(summary.orders || 0);
  statRevenue.textContent = `$${Number(summary.revenue || 0).toFixed(2)}`;
  statLowStock.textContent = String(summary.lowStockCount || 0);

  recentMembersList.innerHTML = (summary.recentMembers || []).map((member) => `
    <div class="compact-row">
      <div>
        <strong>${member.name}</strong>
        <span>${member.email}</span>
      </div>
      <span class="pill">${member.role}</span>
    </div>
  `).join('') || '<p class="product-description">No recent members.</p>';

  recentOrdersList.innerHTML = (summary.recentOrders || []).map((order) => `
    <div class="compact-row">
      <div>
        <strong>${order.customerName}</strong>
        <span>${order.status}</span>
      </div>
      <strong>$${Number(order.amount || 0).toFixed(2)}</strong>
    </div>
  `).join('') || '<p class="product-description">No recent orders.</p>';
}

async function fetchStoreHealth() {
  if (!state.user || state.user.role !== 'admin') return;

  const response = await fetch('/api/admin/health');
  if (!response.ok) return;

  const health = await response.json();
  const statusColor = health.storeHealth === 'running' ? '#3d9d5c' : '#d32f2f';
  
  let widget = `
    <div class="health-indicators">
      <div class="health-indicator" style="border-color: ${statusColor}">
        <span style="color: ${statusColor}">●</span>
        <strong>Store is ${health.storeHealth}</strong>
      </div>
      <div class="metric-row">
        <span>Today's orders:</span>
        <strong>${health.todaysOrders}</strong>
      </div>
      <div class="metric-row">
        <span>Unfulfilled orders:</span>
        <strong style="color: ${health.unfulfilledOrders > 0 ? '#ff7d5b' : '#3d9d5c'}">${health.unfulfilledOrders}</strong>
      </div>
      <div class="metric-row">
        <span>Average order value:</span>
        <strong>$${Number(health.avgOrderValue || 0).toFixed(2)}</strong>
      </div>
    </div>
  `;

  if (health.lowStockProducts && health.lowStockProducts.length > 0) {
    widget += `<div class="alert-box"><strong>Low stock alert:</strong> ${health.lowStockProducts.map((p) => `${p.name} (${p.stock})`).join(', ')}</div>`;
  }

  storeHealthWidget.innerHTML = widget;
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

async function fetchOrders() {
  if (!state.user || state.user.role !== 'admin') {
    state.orders = [];
    renderAdminOrders();
    return;
  }

  const response = await fetch('/api/admin/orders');
  if (!response.ok) {
    state.orders = [];
    renderAdminOrders();
    return;
  }

  state.orders = await response.json();
  renderAdminOrders();
}

function showStore() {
  authSection.classList.add('hidden');
  storeSection.classList.remove('hidden');
  const isAdmin = !!(state.user && state.user.role === 'admin');
  adminLink.classList.toggle('hidden', !isAdmin);
  if (isAdmin) {
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
  adminLink.classList.add('hidden');
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
    adminGreetingName.textContent = state.user.name || 'Admin';
    showStore();
    await fetchProducts();
    if (state.user.role === 'admin') {
      await fetchUsers();
      await fetchOrders();
      await fetchAdminSummary();
    }
  } else {
    showAuth();
  }
}

async function ensureAdminAccess() {
  if (!state.user || state.user.role !== 'admin') {
    showAuth();
    return;
  }

  const response = await fetch('/api/admin/check');
  if (!response.ok) {
    state.user = null;
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

  const endpoint = state.editingProductId ? `/api/admin/products/${state.editingProductId}` : '/api/admin/products';
  const method = state.editingProductId ? 'PUT' : 'POST';

  const response = await fetch(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (response.ok) {
    resetProductForm();
    await fetchProducts();
  }
}

document.querySelectorAll('.tab-button').forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});

authForm.addEventListener('submit', submitAuth);
productForm.addEventListener('submit', submitProduct);
cancelProductEditButton.addEventListener('click', resetProductForm);
adminTabs.forEach((button) => {
  button.addEventListener('click', () => setAdminView(button.dataset.adminView));
});
adminProductSearch.addEventListener('input', (event) => {
  state.adminProductSearch = event.target.value;
  renderAdminProducts();
});
adminProductCategoryFilter.addEventListener('change', (event) => {
  state.adminProductCategory = event.target.value;
  renderAdminProducts();
});
memberSearch.addEventListener('input', (event) => {
  state.memberSearch = event.target.value;
  renderAdminUsers();
});
orderSearch.addEventListener('input', (event) => {
  state.orderSearch = event.target.value;
  renderAdminOrders();
});
orderStatusFilter.addEventListener('change', (event) => {
  state.orderStatus = event.target.value;
  renderAdminOrders();
});
refreshAdminData.addEventListener('click', async () => {
  if (state.user && state.user.role === 'admin') {
    await fetchUsers();
    await fetchOrders();
    await fetchAdminSummary();
  }
});

exportOrdersButton.addEventListener('click', () => {
  if (state.user && state.user.role === 'admin') {
    window.location.href = '/api/admin/export/orders';
  }
});
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
adminLink.addEventListener('click', async (event) => {
  event.preventDefault();
  if (!state.user || state.user.role !== 'admin') {
    showAuth();
    return;
  }

  const response = await fetch('/api/admin/check');
  if (!response.ok) {
    state.user = null;
    showAuth();
    return;
  }

  adminSection.classList.toggle('hidden');
});

setMode('login');
renderCart();
loadSession();
ensureAdminAccess();
