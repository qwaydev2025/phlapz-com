const state = {
  user: null,
  ceoAvailable: false,
  products: [],
  storefrontStatus: { orderingEnabled: false },
  passwordResetToken: null,
  users: [],
  orders: [],
  cart: [],
  paymentOptions: { stripe: false, manualMethods: [] },
  checkoutRequestId: sessionStorage.getItem('phlapz.checkoutRequestId') || '',
  mode: 'login',
  filter: 'All',
  adminProductSearch: '',
  adminProductCategory: 'All',
  memberSearch: '',
  orderSearch: '',
  orderStatus: 'All',
  editingProductId: null
};
const foodCategories = new Set([
  'Signature Sandwiches',
  'Loaded Sandwiches',
  'Jamaican Patties',
  'Combos',
  'Drinks'
]);

const authSection = document.querySelector('#authSection');
const homeSection = document.querySelector('#homeSection');
const storeSection = document.querySelector('#storeSection');
const checkoutSection = document.querySelector('#checkoutSection');
const adminSection = document.querySelector('#adminSection');
const authForm = document.querySelector('#authForm');
const authSubmit = document.querySelector('#authSubmit');
const authMessage = document.querySelector('#authMessage');
const nameField = document.querySelector('#nameField');
const logoutButton = document.querySelector('#logoutButton');
const mobileNavToggle = document.querySelector('#mobileNavToggle');
const mainNav = document.querySelector('#mainNav');
const appNotice = document.querySelector('#appNotice');
const memberName = document.querySelector('#memberName');
const productGrid = document.querySelector('#productGrid');
const featuredProductGrid = document.querySelector('#featuredProductGrid');
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
const passwordResetRequestForm = document.querySelector('#passwordResetRequestForm');
const passwordResetCompleteForm = document.querySelector('#passwordResetCompleteForm');
const passwordResetMessage = document.querySelector('#passwordResetMessage');

let noticeTimer;
let cartPersistenceWarningShown = false;

try {
  const savedCart = JSON.parse(localStorage.getItem('phlapz.cart') || '[]');
  if (Array.isArray(savedCart)) {
    state.cart = savedCart.filter((item) => item && typeof item.id === 'string'
      && typeof item.name === 'string' && Number.isFinite(Number(item.price))
      && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 100);
  }
} catch (error) {
  console.warn('[Cart] Saved cart could not be restored:', error.message);
}

function persistCart() {
  try {
    localStorage.setItem('phlapz.cart', JSON.stringify(state.cart));
  } catch (error) {
    console.warn('[Cart] Cart persistence failed:', error.message);
    if (!cartPersistenceWarningShown) {
      cartPersistenceWarningShown = true;
      showNotice('Your browser could not save the cart between visits.', true);
    }
  }
}

function showNotice(message, isError = false) {
  window.clearTimeout(noticeTimer);
  appNotice.textContent = message;
  appNotice.classList.toggle('error', isError);
  appNotice.classList.remove('hidden');
  noticeTimer = window.setTimeout(() => appNotice.classList.add('hidden'), 5000);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
  const showName = mode === 'signup';
  nameField.parentElement.classList.toggle('hidden', !showName);
  authSubmit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  document.querySelector('#passwordField').minLength = showName ? 12 : 0;
}

function updateCartTotal() {
  persistCart();
  const total = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemCount = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  cartCount.textContent = itemCount;
  subtotalValue.textContent = formatCurrency(total);
  const finalTotal = document.querySelector('#subtotalValueFinal');
  if (finalTotal) {
    finalTotal.textContent = 'Calculated by region';
  }
  const taxValue = document.querySelector('#taxValue');
  if (taxValue) taxValue.textContent = 'Calculated by region';
  const shippingValue = document.querySelector('#shippingValue');
  if (shippingValue) shippingValue.textContent = 'Arranged after review';
  document.querySelector('#orderResult')?.classList.add('hidden');
}

function resetCheckoutRequestId() {
  state.checkoutRequestId = '';
  sessionStorage.removeItem('phlapz.checkoutRequestId');
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
        <strong>${escapeHtml(item.name)}</strong>
        <div class="product-description">Qty: ${item.quantity}</div>
        ${(item.selectedCustomizations || []).length
          ? `<div class="product-description">Add-ons: ${escapeHtml(item.selectedCustomizations.map((option) => option.name).join(', '))}</div>` : ''}
      </div>
      <div class="cart-item-actions">
        <div class="quantity-controls">
          <button class="mini-button" data-action="decrease" data-cart-key="${escapeHtml(item.cartKey || item.id)}" aria-label="Decrease quantity">−</button>
          <span>${item.quantity}</span>
          <button class="mini-button" data-action="increase" data-cart-key="${escapeHtml(item.cartKey || item.id)}" aria-label="Increase quantity">+</button>
        </div>
        <button class="text-button" data-action="remove" data-cart-key="${escapeHtml(item.cartKey || item.id)}">Remove</button>
        <strong>${formatCurrency(item.price * item.quantity)}</strong>
      </div>
    </div>
  `).join('');

  cartItems.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      const cartKey = button.dataset.cartKey;
      const item = state.cart.find((cartItem) => (cartItem.cartKey || cartItem.id) === cartKey);
      if (!item) return;

      if (action === 'increase') {
        const product = state.products.find((productItem) => productItem.id === item.id);
        const availableStock = Number(product?.stock || 0);
        const totalQuantity = state.cart.filter((cartItem) => cartItem.id === item.id)
          .reduce((sum, cartItem) => sum + cartItem.quantity, 0);
        if (totalQuantity >= availableStock) {
          showNotice(`${item.name} only has ${availableStock} left in stock.`, true);
          return;
        }
        item.quantity += 1;
      }

      if (action === 'decrease') {
        item.quantity -= 1;
        if (item.quantity <= 0) {
          state.cart = state.cart.filter((cartItem) => (cartItem.cartKey || cartItem.id) !== cartKey);
        }
      }

      if (action === 'remove') {
        state.cart = state.cart.filter((cartItem) => (cartItem.cartKey || cartItem.id) !== cartKey);
      }

      resetCheckoutRequestId();
      renderCart();
    });
  });

  updateCartTotal();
}

function renderProducts() {
  const search = document.querySelector('#menuSearch').value.trim().toLowerCase();
  const publishedProducts = state.products.filter((product) => product.published !== false && foodCategories.has(product.category));
  const filteredBySearch = publishedProducts.filter((product) =>
    !search || `${product.name} ${product.description || ''} ${product.category}`.toLowerCase().includes(search));
  const featuredProducts = filteredBySearch.filter((product) => product.featured);
  featuredProductGrid.innerHTML = featuredProducts.length
    ? renderProductCards(featuredProducts)
    : '';
  const filtered = filteredBySearch.filter((product) => {
    if (state.filter === 'All') return true;
    return product.category === state.filter;
  }).sort((first, second) => Number(second.featured) - Number(first.featured));

  if (!filtered.length) {
    productGrid.innerHTML = publishedProducts.length
      ? `<div class="menu-empty-state"><span class="menu-empty-icon" aria-hidden="true">⌕</span><div><h4>No menu items found</h4><p>Try another search or choose a different category.</p></div></div>`
      : `<div class="menu-empty-state"><span class="menu-empty-icon" aria-hidden="true">✦</span><div><h4>Good things are cooking.</h4><p>We’re getting the PHLAPZ kitchen menu ready. Check back soon for what’s fresh.</p></div></div>`;
    return;
  }

  productGrid.innerHTML = renderProductCards(filtered);

  document.querySelectorAll('#productGrid .add-to-cart, #featuredProductGrid .add-to-cart').forEach((button) => {
    button.addEventListener('click', () => {
      const product = state.products.find((item) => item.id === button.dataset.productId);
      if (!product) return;

      const selectedOptions = Array.from(button.closest('.product-card').querySelectorAll('[data-customization-product]'))
        .filter((input) => input.checked)
        .map((input) => product.customizations.find((option) => option.id === input.dataset.customizationId))
        .filter(Boolean);
      const optionIds = selectedOptions.map((option) => option.id).sort();
      const cartKey = `${product.id}::${optionIds.join(',')}`;
      const existing = state.cart.find((item) => (item.cartKey || item.id) === cartKey);
      const currentQty = state.cart.filter((item) => item.id === product.id)
        .reduce((sum, item) => sum + item.quantity, 0);
      const availableStock = Number(product.stock || 0);

      if (currentQty + 1 > availableStock) {
        showNotice(`${product.name} only has ${availableStock} left in stock.`, true);
        return;
      }

      if (existing) {
        existing.quantity += 1;
      } else {
        const customizationTotal = selectedOptions.reduce((sum, option) => sum + Number(option.price), 0);
        state.cart.push({
          ...product,
          price: Number(product.price) + customizationTotal,
          quantity: 1,
          cartKey,
          selectedCustomizations: selectedOptions
        });
      }
      resetCheckoutRequestId();
      renderCart();
    });
  });
}

function renderProductCards(products) {
  return products.map((product) => {
    const image = typeof product.image === 'string' && (
      /^https:\/\//i.test(product.image) || /^\/uploads\/[a-z0-9._-]+$/i.test(product.image)
    ) ? product.image : '';
    const imageMarkup = image
      ? `<img class="product-thumb" src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy" />`
      : `<div class="product-image"><span>PHLAPZ</span></div>`;
    const stock = Number(product.stock || 0);
    const stockLabel = stock <= 5
      ? `<span class="stock-pill low">${stock === 0 ? 'Out of stock' : `Only ${stock} left`}</span>`
      : `<span class="stock-pill">${stock} in stock</span>`;
    const featuredLabel = product.featured
      ? '<span class="featured-badge">Featured</span>'
      : '';

    return `
      <article class="product-card${product.featured ? ' product-card-featured' : ''}">
        ${imageMarkup}
        <div class="product-content">
          <div class="product-meta">
            <span>${escapeHtml(product.category)}</span>
            <span class="product-price">${formatCurrency(product.price)}</span>
          </div>
          ${featuredLabel}
          <h4>${escapeHtml(product.name)}</h4>
          <div class="product-description">${escapeHtml(product.description || '')}</div>
          ${Array.isArray(product.ingredients) && product.ingredients.length
            ? `<p class="food-details"><strong>Ingredients:</strong> ${escapeHtml(product.ingredients.join(', '))}</p>` : ''}
          ${Array.isArray(product.allergens) && product.allergens.length
            ? `<p class="food-details"><strong>Allergens:</strong> ${escapeHtml(product.allergens.join(', '))}</p>` : ''}
          ${Number(product.preparationMinutes) > 0
            ? `<p class="food-details">About ${Number(product.preparationMinutes)} min preparation</p>` : ''}
          ${Array.isArray(product.customizations) && product.customizations.length
            ? `<fieldset class="food-customizations"><legend>Add-ons</legend>${product.customizations.map((option) => `
                <label><input type="checkbox" data-customization-product="${escapeHtml(product.id)}" data-customization-id="${escapeHtml(option.id)}" />
                  ${escapeHtml(option.name)}${Number(option.price) > 0 ? ` (+${formatCurrency(option.price)})` : ''}</label>`).join('')}</fieldset>` : ''}
          <div class="stock-row">${stockLabel}</div>
          <button data-product-id="${escapeHtml(product.id)}" class="add-to-cart"${stock <= 0 || !state.storefrontStatus.orderingEnabled ? ' disabled' : ''}>${stock <= 0 ? 'Sold out' : state.storefrontStatus.orderingEnabled ? 'Add to cart' : 'Ordering soon'}</button>
        </div>
      </article>
    `;
  }).join('');
}

function syncProductPublishFields() {
  const published = document.querySelector('#productPublished').checked;
  document.querySelector('#productPrice').required = published;
  document.querySelector('#productStock').required = published;
}

function resetProductForm() {
  state.editingProductId = null;
  productForm.reset();
  document.querySelector('#productPublished').checked = true;
  syncProductPublishFields();
  productSaveButton.textContent = 'Save product';
  cancelProductEditButton.classList.add('hidden');
}

function populateProductForm(product) {
  state.editingProductId = product.id;
  document.querySelector('#productName').value = product.name || '';
  document.querySelector('#productCategory').value = product.category || 'Electric Bikes';
  document.querySelector('#productPrice').value = product.price ?? '';
  document.querySelector('#productStock').value = product.stock ?? '';
  document.querySelector('#productPublished').checked = product.published !== false;
  syncProductPublishFields();
  document.querySelector('#productImage').value = product.image || '';
  document.querySelector('#productDescription').value = product.description || '';
  document.querySelector('#productIngredients').value = Array.isArray(product.ingredients) ? product.ingredients.join('\n') : '';
  document.querySelector('#productAllergens').value = Array.isArray(product.allergens) ? product.allergens.join('\n') : '';
  document.querySelector('#productPreparationMinutes').value = product.preparationMinutes || '';
  document.querySelector('#productCustomizations').value = Array.isArray(product.customizations)
    ? product.customizations.map((option) => `${option.name} | ${Number(option.price).toFixed(2)}`).join('\n') : '';
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
    const matchesSearch = !searchText || String(product.name).toLowerCase().includes(searchText) || product.description?.toLowerCase().includes(searchText) || String(product.category).toLowerCase().includes(searchText);
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
        <strong>${escapeHtml(product.name)}</strong>
        <div class="product-description">${product.published === false ? 'Unpublished draft · details required' : formatCurrency(product.price)} · ${escapeHtml(product.category)}</div>
      </div>
      <div class="row-actions">
        <button data-edit-id="${escapeHtml(product.id)}">Edit</button>
        <button class="danger-button" data-delete-id="${escapeHtml(product.id)}">Delete</button>
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
    return !searchText || String(member.name || '').toLowerCase().includes(searchText)
      || String(member.email || '').toLowerCase().includes(searchText)
      || String(member.role || '').toLowerCase().includes(searchText);
  });

  if (!filteredUsers.length) {
    adminUsersList.innerHTML = '<p class="product-description">No members match your search.</p>';
    return;
  }

  adminUsersList.innerHTML = filteredUsers.map((member) => `
    <div class="admin-product-row">
      <div>
        <strong>${escapeHtml(member.name)}</strong>
        <div class="product-description">${escapeHtml(member.email)}</div>
      </div>
      <div class="row-actions">
        <select class="member-role-select" data-member-id="${escapeHtml(member.id)}">
          <option value="member" ${member.role === 'member' ? 'selected' : ''}>Member</option>
          <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
        <button class="danger-button" data-delete-member-id="${escapeHtml(member.id)}">Remove</button>
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
      } else {
        const result = await response.json();
        showNotice(result.error || 'Unable to update member access.', true);
        await fetchUsers();
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
        } else {
          const result = await response.json();
          showNotice(result.error || 'Unable to remove the member.', true);
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
    const matchesSearch = !searchText || String(order.customerName || '').toLowerCase().includes(searchText)
      || String(order.customerEmail || '').toLowerCase().includes(searchText)
      || String(order.id || '').toLowerCase().includes(searchText) || String(order.amount).includes(searchText);
    const matchesStatus = state.orderStatus === 'All'
      || (state.orderStatus.startsWith('payment:')
        ? String(order.paymentStatus || '').toUpperCase() === state.orderStatus.slice(8)
        : String(order.orderStatus || order.status || '').toUpperCase() === state.orderStatus
          || String(order.fulfillmentStatus || '').toUpperCase() === state.orderStatus);
    return matchesSearch && matchesStatus;
  });

  if (!filteredOrders.length) {
    adminOrdersList.innerHTML = '<p class="product-description">No orders match your filters.</p>';
    return;
  }

  adminOrdersList.innerHTML = filteredOrders.map((order) => {
    const status = String(order.orderStatus || order.status || 'PENDING_CONFIRMATION').toUpperCase();
    const paymentStatus = String(order.paymentStatus || 'PENDING').toUpperCase();
    const fulfillmentStatus = String(order.fulfillmentStatus || 'NOT_STARTED').toUpperCase();
    const items = (order.items || []).map((item) =>
      `<li>${escapeHtml(item.name)} × ${Number(item.quantity)} — ${formatCurrency(item.price)}</li>`).join('');
    const itemSummary = (order.items || []).map((item) =>
      `${escapeHtml(item.name)} × ${Number(item.quantity)}`).join(', ');
    const address = order.address
      ? [order.address.street, order.address.city, order.address.province, order.address.postalCode, order.address.country].filter(Boolean).join(', ')
      : 'Not provided';
    const history = (order.history || []).map((entry) =>
      `<li><strong>${escapeHtml(entry.action)}</strong> · ${escapeHtml(entry.at)} · ${escapeHtml(entry.actor)}${entry.details ? ` — ${escapeHtml(entry.details)}` : ''}</li>`).join('');
    const notes = (order.internalNotes || []).map((entry) =>
      `<li>${escapeHtml(entry.at)} · ${escapeHtml(entry.actor)}: ${escapeHtml(entry.note)}</li>`).join('');
    const notifications = Object.entries(order.emailNotifications || {}).map(([event, delivery]) => {
      const stateText = Object.entries(delivery).map(([recipient, result]) => `${recipient}: ${result.status}`).join(', ');
      return `<li>${escapeHtml(event)} — ${escapeHtml(stateText)}</li>`;
    }).join('');
    const paymentRef = order.stripeSessionId || order.stripePaymentIntent || '';
    const canReject = !['REJECTED', 'CANCELLED'].includes(status)
      && !['SHIPPED', 'COMPLETED'].includes(fulfillmentStatus);
    const paid = paymentStatus === 'PAID';
    return `
      <article class="admin-order-card">
        <div class="admin-order-heading">
          <div>
            <strong>${escapeHtml(order.customerName || 'Customer')}</strong>
            <div class="product-description">${escapeHtml(order.customerEmail || 'No email')} · ${escapeHtml(order.createdAt || '')}</div>
            <div class="product-description">Order ${escapeHtml(order.id)}</div>
          </div>
          <div class="admin-order-statuses">
            <span class="pill">${escapeHtml(status)}</span>
            <span class="pill">${escapeHtml(paymentStatus)}</span>
            <span class="pill">${escapeHtml(fulfillmentStatus)}</span>
            <strong>${formatCurrency(order.amount)}</strong>
          </div>
        </div>
        <div class="product-description">Channel: ${escapeHtml(order.salesChannel || 'website')} · ${escapeHtml(order.paymentMethodName || order.paymentMethod || 'Unknown payment')} · ${itemSummary}</div>
        <details class="admin-order-details">
          <summary>Order details, history, and notes</summary>
          <p><strong>Phone:</strong> ${escapeHtml(order.phone || 'Not provided')}</p>
          <p><strong>Fulfillment:</strong> ${escapeHtml(order.fulfillmentMethod || 'delivery')}${order.pickupTime ? ` · Requested pickup ${escapeHtml(order.pickupTime)}` : ''}</p>
          <p><strong>Address:</strong> ${escapeHtml(address)}</p>
          ${order.customerNotes ? `<p><strong>Customer notes:</strong> ${escapeHtml(order.customerNotes)}</p>` : ''}
          <ul>${items}</ul>
          <p>Subtotal ${formatCurrency(order.subtotal)} · Shipping ${formatCurrency(order.shipping)} · Tax ${formatCurrency(order.tax)} (${escapeHtml(order.taxJurisdiction || 'unconfigured')}) · Total ${formatCurrency(order.amount)}</p>
          ${order.paymentInstructions ? `<p><strong>Payment instructions:</strong> ${escapeHtml(order.paymentInstructions)}</p>` : ''}
          ${paymentRef ? `<p><strong>Stripe reference:</strong> ${escapeHtml(paymentRef)}</p>` : ''}
          ${order.refundId ? `<p><strong>Refund:</strong> ${escapeHtml(order.refundId)} · ${escapeHtml(order.refundStatus || '')}</p>` : ''}
          ${order.refundError ? `<p class="form-error">${escapeHtml(order.refundError)}</p>` : ''}
          ${notes ? `<h5>Internal notes</h5><ul>${notes}</ul>` : '<p>No internal notes.</p>'}
          ${history ? `<h5>Order history</h5><ul>${history}</ul>` : ''}
          ${notifications ? `<h5>Email delivery</h5><ul>${notifications}</ul>` : ''}
        </details>
        <div class="admin-order-actions">
          ${status === 'PENDING_CONFIRMATION' ? `<button class="primary-button" data-order-action="confirm" data-order-id="${escapeHtml(order.id)}" ${paid ? '' : 'disabled'}>Confirm paid order</button>` : ''}
          ${status === 'PENDING_CONFIRMATION' && !paid ? `<button class="secondary-button" data-order-action="confirm_unpaid" data-order-id="${escapeHtml(order.id)}">Confirm unpaid exception</button>` : ''}
          ${canReject ? `<button class="secondary-button" data-order-action="reject" data-order-id="${escapeHtml(order.id)}">Reject</button><button class="secondary-button" data-order-action="cancel" data-order-id="${escapeHtml(order.id)}">Cancel</button>` : ''}
          ${order.paymentMethod === 'manual' && ['AWAITING_PAYMENT', 'PENDING', 'FAILED'].includes(paymentStatus) && ['PENDING_CONFIRMATION', 'CONFIRMED'].includes(status)
            ? `<button class="secondary-button" data-order-action="mark_payment_received" data-order-id="${escapeHtml(order.id)}">Verify manual payment</button>` : ''}
          ${paid && status === 'CONFIRMED' ? `
            <select data-fulfillment-order-id="${escapeHtml(order.id)}" aria-label="Update fulfillment status">
              <option value="">Update fulfillment</option>
              ${fulfillmentStatus === 'NOT_STARTED' ? '<option value="PROCESSING">Processing</option>' : ''}
              ${fulfillmentStatus === 'PROCESSING' ? '<option value="SHIPPED">Shipped</option><option value="COMPLETED">Completed</option>' : ''}
              ${fulfillmentStatus === 'SHIPPED' ? '<option value="COMPLETED">Completed</option>' : ''}
            </select>` : ''}
          ${['REJECTED', 'CANCELLED'].includes(status) && order.paymentMethod === 'stripe' && paid
            ? `<button class="secondary-button" data-order-action="refund" data-order-id="${escapeHtml(order.id)}">Issue Stripe refund</button>` : ''}
          ${['REJECTED', 'CANCELLED'].includes(status) && order.paymentMethod === 'manual' && paid
            ? `<button class="secondary-button" data-order-action="mark_manual_refunded" data-order-id="${escapeHtml(order.id)}">Confirm manual refund</button>` : ''}
          <button class="secondary-button" data-order-action="resend_email" data-order-id="${escapeHtml(order.id)}">Retry failed emails</button>
        </div>
        <div class="admin-order-note">
          <input type="text" maxlength="2000" placeholder="Add internal note" data-order-note-id="${escapeHtml(order.id)}" />
          <button class="secondary-button" data-order-action="note" data-order-id="${escapeHtml(order.id)}">Add note</button>
        </div>
      </article>`;
  }).join('');

  adminOrdersList.querySelectorAll('[data-order-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.orderId;
      const action = button.dataset.orderAction;
      if (action === 'refund' && !window.confirm('Issue a full refund through Stripe?')) return;
      const payload = { action };
      if (action === 'note') {
        const noteInput = adminOrdersList.querySelector(`[data-order-note-id="${CSS.escape(id)}"]`);
        payload.note = noteInput?.value || '';
      }
      button.disabled = true;
      try {
        if (action === 'refund') {
          const response = await fetch(`/api/admin/orders/${id}/refund`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Refund request failed.');
        } else {
          const response = await fetch(`/api/admin/orders/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Unable to update the order.');
          if (action === 'resend_email') showNotice('Failed customer/owner emails were retried.');
        }
        await fetchOrders();
        await fetchAdminSummary();
      } catch (error) {
        showNotice(error.message || 'Unable to update the order.', true);
        await fetchOrders();
      }
    });
  });
  adminOrdersList.querySelectorAll('[data-fulfillment-order-id]').forEach((select) => {
    select.addEventListener('change', async () => {
      if (!select.value) return;
      const response = await fetch(`/api/admin/orders/${select.dataset.fulfillmentOrderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fulfillment', fulfillmentStatus: select.value })
      });
      const result = await response.json();
      if (!response.ok) showNotice(result.error || 'Unable to update fulfillment.', true);
      await fetchOrders();
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
      view === 'ceo' ? 'adminCeoPanel' :
      'adminSettingsPanel'
    );
    panel.classList.toggle('hidden', !isActive);
    panel.classList.toggle('active', isActive);
  });

  if (view === 'settings') {
    fetchStoreHealth();
    loadPaymentSettings();
    loadBusinessSettings();
  }
}

async function initializeCeoPanel() {
  const tab = document.querySelector('#ceoAdminTab');
  if (!tab || !state.user || state.user.role !== 'admin') return;

  try {
    const response = await fetch('/api/admin/ceo/access');
    state.ceoAvailable = response.ok;
    tab.classList.toggle('hidden', !state.ceoAvailable);
    if (!state.ceoAvailable && document.querySelector('#adminCeoPanel').classList.contains('active')) {
      setAdminView('overview');
    }
  } catch (error) {
    state.ceoAvailable = false;
    tab.classList.add('hidden');
    console.error('[AI CEO] Unable to check owner access:', error.message);
  }
}

async function sendCeoCommand() {
  const commandField = document.querySelector('#ceoCommand');
  const output = document.querySelector('#ceoResponse');
  const button = document.querySelector('#ceoSend');
  const command = commandField.value.trim();

  if (!command || command.length > 2000) {
    output.textContent = 'Enter a command of 1 to 2000 characters.';
    return;
  }

  button.disabled = true;
  output.textContent = 'Contacting AI CEO...';
  try {
    const response = await fetch('/api/admin/ceo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'AI CEO request failed.');
    }
    output.textContent = data.answer;
  } catch (error) {
    output.textContent = error.message || 'AI CEO service is temporarily unavailable.';
  } finally {
    button.disabled = false;
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
  statRevenue.textContent = formatCurrency(summary.revenue);
  statLowStock.textContent = String(summary.lowStockCount || 0);

  recentMembersList.innerHTML = (summary.recentMembers || []).map((member) => `
    <div class="compact-row">
      <div>
        <strong>${escapeHtml(member.name)}</strong>
        <span>${escapeHtml(member.email)}</span>
      </div>
      <span class="pill">${escapeHtml(member.role)}</span>
    </div>
  `).join('') || '<p class="product-description">No recent members.</p>';

  recentOrdersList.innerHTML = (summary.recentOrders || []).map((order) => `
    <div class="compact-row">
      <div>
        <strong>${escapeHtml(order.customerName)}</strong>
        <span>${escapeHtml(order.status)}</span>
      </div>
      <strong>${formatCurrency(order.amount)}</strong>
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
        <strong>${formatCurrency(health.avgOrderValue)}</strong>
      </div>
    </div>
  `;

  if (health.lowStockProducts && health.lowStockProducts.length > 0) {
    widget += `<div class="alert-box"><strong>Low stock alert:</strong> ${health.lowStockProducts.map((p) => `${escapeHtml(p.name)} (${p.stock})`).join(', ')}</div>`;
  }

  storeHealthWidget.innerHTML = widget;
}

async function fetchProducts() {
  const response = await fetch(state.user ? '/api/products' : '/api/menu');
  if (!response.ok) {
    productGrid.innerHTML = '<p class="product-description">Products could not be loaded. Please try again.</p>';
    featuredProductGrid.innerHTML = '';
    showNotice('The product catalog could not be loaded.', true);
    return;
  }

  state.products = await response.json();
  if (!state.user) {
    state.products = state.products.filter((product) => foodCategories.has(product.category));
  }
  renderProducts();
  renderAdminProducts();
}

async function loadStorefrontStatus() {
  const response = await fetch('/api/storefront-status');
  if (!response.ok) {
    showNotice('Store availability could not be loaded.', true);
    return;
  }
  state.storefrontStatus = await response.json();
  document.querySelector('#storefrontAvailability').textContent = state.storefrontStatus.temporarilyClosed
    ? 'Kitchen temporarily closed'
    : state.storefrontStatus.orderingEnabled
      ? 'Pickup scheduling available'
      : 'Website open · Pickup ordering unavailable';
  const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const hoursText = weekdays.map((day) => {
    const interval = state.storefrontStatus.hours?.[day];
    return interval ? `${day[0].toUpperCase()}${day.slice(1)} ${interval.open}–${interval.close}` : '';
  }).filter(Boolean);
  document.querySelector('#kitchenHours').textContent = hoursText.length
    ? `Pickup hours (${state.storefrontStatus.timezone}): ${hoursText.join(' · ')}`
    : 'Kitchen hours have not been published yet.';
  const earliestPickup = new Date(Date.now() + Number(state.storefrontStatus.minimumLeadMinutes || 0) * 60_000);
  const timezoneOffset = earliestPickup.getTimezoneOffset() * 60_000;
  document.querySelector('#checkoutPickupTime').min = new Date(earliestPickup.getTime() - timezoneOffset)
    .toISOString().slice(0, 16);
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

  try {
    const response = await fetch('/api/admin/orders');
    if (!response.ok) {
      console.error('[Orders] Failed to fetch:', response.status);
      state.orders = [];
      renderAdminOrders();
      return;
    }

    state.orders = await response.json();
    console.log('[Orders] Loaded:', state.orders.length, 'orders');
    renderAdminOrders();
  } catch (error) {
    console.error('[Orders] Error:', error.message);
    state.orders = [];
    renderAdminOrders();
  }
}

async function loadPaymentSettings() {
  const response = await fetch('/api/admin/payment-settings');
  if (!response.ok) {
    showNotice('Unable to load payment settings.', true);
    return;
  }
  const settings = await response.json();
  document.querySelector('#manualPaymentMethods').value = (settings.manualMethods || [])
    .map((method) => `${method.name} | ${method.instructions}`).join('\n');
  document.querySelector('#taxRateSettings').value = (settings.taxRates || [])
    .map((entry) => `${entry.jurisdiction} | ${Number(entry.rate)}`).join('\n');
}

async function loadBusinessSettings() {
  const response = await fetch('/api/admin/business-settings');
  if (!response.ok) {
    showNotice('Unable to load pickup settings.', true);
    return;
  }
  const settings = await response.json();
  document.querySelector('#acceptingOrders').checked = settings.acceptingOrders === true;
  document.querySelector('#temporarilyClosed').checked = settings.temporarilyClosed === true;
  document.querySelector('#pickupEnabled').checked = settings.pickupEnabled === true;
  document.querySelector('#minimumLeadMinutes').value = String(settings.minimumLeadMinutes ?? 30);
  document.querySelector('#pickupHours').value = Object.entries(settings.hours || {})
    .map(([day, hours]) => `${day[0].toUpperCase()}${day.slice(1)} | ${hours.open} | ${hours.close}`).join('\n');
}

async function saveBusinessSettings() {
  const hours = {};
  const dayNames = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
  const lines = document.querySelector('#pickupHours').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const [dayText, open, close] = line.split('|').map((part) => part.trim());
    const day = (dayText || '').toLowerCase();
    if (!dayNames.has(day) || !open || !close || hours[day]) {
      showNotice('Enter unique valid days as Monday | 09:00 | 17:00.', true);
      return;
    }
    hours[day] = { open, close };
  }
  const response = await fetch('/api/admin/business-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      acceptingOrders: document.querySelector('#acceptingOrders').checked,
      temporarilyClosed: document.querySelector('#temporarilyClosed').checked,
      pickupEnabled: document.querySelector('#pickupEnabled').checked,
      minimumLeadMinutes: Number(document.querySelector('#minimumLeadMinutes').value),
      hours
    })
  });
  const result = await response.json();
  if (!response.ok) {
    showNotice(result.error || 'Unable to save pickup settings.', true);
    return;
  }
  await loadStorefrontStatus();
  await fetchProducts();
  showNotice('Pickup settings saved.');
}

async function loadPaymentOptions() {
  const methodSelect = document.querySelector('#paymentMethod');
  const preview = document.querySelector('#paymentInstructionsPreview');
  methodSelect.innerHTML = '<option value="">Loading payment methods...</option>';
  try {
    const response = await fetch('/api/payment-options');
    const options = await response.json();
    if (!response.ok) throw new Error(options.error || 'Unable to load payment methods.');
    state.paymentOptions = options;
    state.storefrontStatus.orderingEnabled = options.orderingEnabled === true;
    const methods = [
      ...(options.stripe ? [{ id: 'stripe', name: 'Pay online with Stripe' }] : []),
      ...(options.manualMethods || [])
    ];
    methodSelect.innerHTML = methods.length
      ? methods.map((method) => `<option value="${escapeHtml(method.id)}">${escapeHtml(method.name)}</option>`).join('')
      : '<option value="">No payment methods are currently available</option>';
    document.querySelector('#checkoutButton').disabled = methods.length === 0 || !options.orderingEnabled;
    preview.textContent = !options.orderingEnabled
      ? 'Online food ordering is not open yet. Browse the menu and check back soon.'
      : methods.length
      ? 'Pickup only. Your requested pickup time is confirmed by the kitchen after review.'
      : 'The store has not configured a payment method yet.';
  } catch (error) {
    methodSelect.innerHTML = '<option value="">Payment methods unavailable</option>';
    document.querySelector('#checkoutButton').disabled = true;
    preview.textContent = error.message || 'Payment methods could not be loaded.';
  }
}

async function savePaymentSettings() {
  const parseLines = (value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const manualMethods = parseLines(document.querySelector('#manualPaymentMethods').value).map((line) => {
    const separator = line.indexOf('|');
    return separator < 0 ? { name: '', instructions: '' } : {
      name: line.slice(0, separator).trim(),
      instructions: line.slice(separator + 1).trim()
    };
  });
  const taxRates = parseLines(document.querySelector('#taxRateSettings').value).map((line) => {
    const separator = line.indexOf('|');
    return separator < 0 ? { jurisdiction: '', rate: NaN } : {
      jurisdiction: line.slice(0, separator).trim().toUpperCase(),
      rate: Number(line.slice(separator + 1).trim())
    };
  });
  const response = await fetch('/api/admin/payment-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manualMethods, taxRates })
  });
  const result = await response.json();
  if (!response.ok) {
    showNotice(result.error || 'Unable to save payment settings.', true);
    return;
  }
  showNotice('Payment and tax settings saved.');
}

function showHome() {
  authSection.classList.add('hidden');
  homeSection.classList.remove('hidden');
  storeSection.classList.add('hidden');
  checkoutSection.classList.add('hidden');
  adminSection.classList.add('hidden');
  const isAdmin = !!(state.user && state.user.role === 'admin');
  adminLink.classList.toggle('hidden', !isAdmin);
  logoutButton.classList.remove('hidden');
}

function showStore() {
  authSection.classList.add('hidden');
  homeSection.classList.add('hidden');
  storeSection.classList.remove('hidden');
  checkoutSection.classList.add('hidden');
  const isAdmin = !!(state.user && state.user.role === 'admin');
  adminLink.classList.toggle('hidden', !isAdmin);
  if (isAdmin) {
    adminSection.classList.remove('hidden');
  } else {
    adminSection.classList.add('hidden');
  }
  logoutButton.classList.remove('hidden');
  logoutButton.textContent = state.user ? 'Log out' : 'Sign in';
  memberName.textContent = state.user ? `Welcome, ${state.user.name}` : 'PHLAPZ Kitchen';
  renderAdminUsers();
}

function showCheckout() {
  authSection.classList.add('hidden');
  homeSection.classList.add('hidden');
  storeSection.classList.add('hidden');
  checkoutSection.classList.remove('hidden');
  adminSection.classList.add('hidden');
  adminLink.classList.toggle('hidden', !(state.user && state.user.role === 'admin'));
  logoutButton.classList.remove('hidden');
  renderCart();
  document.querySelector('#checkoutName').value = state.user?.name || '';
  document.querySelector('#checkoutEmail').value = state.user?.email || '';
  loadPaymentOptions();
}

function showAuth() {
  authSection.classList.remove('hidden');
  homeSection.classList.add('hidden');
  storeSection.classList.add('hidden');
  checkoutSection.classList.add('hidden');
  adminSection.classList.add('hidden');
  adminLink.classList.add('hidden');
  logoutButton.classList.remove('hidden');
  logoutButton.textContent = 'Back to menu';
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
    await loadStorefrontStatus();
    await fetchProducts();
    if (state.user.role === 'admin') {
      await fetchUsers();
      await fetchOrders();
      await fetchAdminSummary();
      await initializeCeoPanel();
    }
  } else {
    showStore();
    await loadStorefrontStatus();
    await fetchProducts();
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
  await loadStorefrontStatus();
  await fetchProducts();
  await fetchUsers();
  await initializeCeoPanel();
}

async function requestPasswordReset(event) {
  event.preventDefault();
  passwordResetMessage.textContent = '';
  const button = passwordResetRequestForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const response = await fetch('/api/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.querySelector('#resetEmail').value.trim() })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to request a password reset.');
    passwordResetMessage.textContent = result.message;
  } catch (error) {
    passwordResetMessage.textContent = error.message || 'Unable to request a password reset.';
  } finally {
    button.disabled = false;
  }
}

async function completePasswordReset(event) {
  event.preventDefault();
  passwordResetMessage.textContent = '';
  const password = document.querySelector('#newPasswordField').value;
  const button = passwordResetCompleteForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const response = await fetch('/api/password-reset/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: state.passwordResetToken, password })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to reset the password.');

    state.passwordResetToken = null;
    passwordResetCompleteForm.reset();
    passwordResetCompleteForm.classList.add('hidden');
    document.querySelector('#authForm').classList.remove('hidden');
    document.querySelector('.auth-tabs').classList.remove('hidden');
    document.querySelector('#forgotPasswordButton').classList.remove('hidden');
    setMode('login');
    passwordResetMessage.textContent = result.message;
  } catch (error) {
    passwordResetMessage.textContent = error.message || 'Unable to reset the password.';
  } finally {
    button.disabled = false;
  }
}

function initializePasswordReset() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get('reset');
  if (!token) return false;

  history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  state.passwordResetToken = token;
  showAuth();
  document.querySelector('#authForm').classList.add('hidden');
  document.querySelector('.auth-tabs').classList.add('hidden');
  document.querySelector('#forgotPasswordButton').classList.add('hidden');
  passwordResetCompleteForm.classList.remove('hidden');
  passwordResetMessage.textContent = 'Choose a new password for your account.';
  return true;
}

async function submitProduct(event) {
  event.preventDefault();
  const formData = new FormData(productForm);
  let image = formData.get('image')?.toString().trim() || '';
  const imageFile = formData.get('imageFile');

  if (imageFile instanceof File && imageFile.size > 0) {
    const uploadData = new FormData();
    uploadData.append('image', imageFile);
    const uploadResponse = await fetch('/api/admin/uploads', {
      method: 'POST',
      body: uploadData
    });
    const uploadResult = await uploadResponse.json();
    if (!uploadResponse.ok) {
      showNotice(uploadResult.error || 'Image upload failed.', true);
      return;
    }
    image = uploadResult.imageUrl;
  }

  const customizations = formData.get('customizations').toString().split(/\r?\n/)
    .map((line) => line.trim()).filter(Boolean).map((line) => {
      const separator = line.lastIndexOf('|');
      return separator < 0 ? { name: line, price: NaN } : {
        name: line.slice(0, separator).trim(),
        price: Number(line.slice(separator + 1).trim())
      };
    });
  if (customizations.some((option) => !option.name || !Number.isFinite(option.price))) {
    showNotice('Enter add-ons as a name and price, for example: Add cheese | 1.50.', true);
    return;
  }

  const payload = {
    name: formData.get('name').toString().trim(),
    price: formData.get('price') === '' ? null : Number(formData.get('price')),
    stock: formData.get('stock') === '' ? null : Number(formData.get('stock')),
    category: formData.get('category').toString(),
    description: formData.get('description').toString().trim(),
    ingredients: formData.get('ingredients').toString().split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
    allergens: formData.get('allergens').toString().split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
    preparationMinutes: formData.get('preparationMinutes') === '' ? 0 : Number(formData.get('preparationMinutes')),
    customizations,
    image,
    published: document.querySelector('#productPublished').checked
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
    showNotice('Product saved.');
  } else {
    const result = await response.json();
    showNotice(result.error || 'Unable to save the product.', true);
  }
}

document.querySelectorAll('.tab-button').forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});
document.querySelector('#menuSearch').addEventListener('input', renderProducts);

document.querySelectorAll('[data-cta]').forEach((button) => {
  button.addEventListener('click', () => {
    const mode = button.dataset.mode;
    setMode(mode);
    const authCard = document.querySelector('#authSection .auth-card');
    if (authCard) {
      authCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

authForm.addEventListener('submit', submitAuth);
passwordResetRequestForm.addEventListener('submit', requestPasswordReset);
passwordResetCompleteForm.addEventListener('submit', completePasswordReset);
document.querySelector('#forgotPasswordButton').addEventListener('click', () => {
  document.querySelector('#authForm').classList.add('hidden');
  document.querySelector('.auth-tabs').classList.add('hidden');
  document.querySelector('#forgotPasswordButton').classList.add('hidden');
  passwordResetRequestForm.classList.remove('hidden');
  passwordResetMessage.textContent = '';
  document.querySelector('#resetEmail').value = document.querySelector('#emailField').value;
});
document.querySelector('#backToLoginButton').addEventListener('click', () => {
  passwordResetRequestForm.classList.add('hidden');
  document.querySelector('#authForm').classList.remove('hidden');
  document.querySelector('.auth-tabs').classList.remove('hidden');
  document.querySelector('#forgotPasswordButton').classList.remove('hidden');
  passwordResetMessage.textContent = '';
  setMode('login');
});
productForm.addEventListener('submit', submitProduct);
document.querySelector('#productPublished').addEventListener('change', syncProductPublishFields);
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
document.querySelector('#savePaymentSettings').addEventListener('click', savePaymentSettings);
document.querySelector('#saveBusinessSettings').addEventListener('click', saveBusinessSettings);
[
  '#checkoutName',
  '#checkoutEmail',
  '#checkoutPhone',
  '#checkoutPickupTime',
  '#checkoutNotes',
  '#paymentMethod'
].forEach((selector) => {
  document.querySelector(selector).addEventListener('input', resetCheckoutRequestId);
  document.querySelector(selector).addEventListener('change', resetCheckoutRequestId);
});

exportOrdersButton.addEventListener('click', () => {
  if (state.user && state.user.role === 'admin') {
    window.location.href = '/api/admin/export/orders';
  }
});
document.querySelector('#ceoSend').addEventListener('click', sendCeoCommand);
logoutButton.addEventListener('click', async () => {
  if (!state.user) {
    if (authSection.classList.contains('hidden')) showAuth();
    else showStore();
    return;
  }
  await fetch('/api/logout', { method: 'POST' });
  state.user = null;
  state.products = [];
  await loadStorefrontStatus();
  showStore();
  await fetchProducts();
});
document.querySelector('#homeLink')?.addEventListener('click', (event) => {
  event.preventDefault();
  showStore();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

mobileNavToggle.addEventListener('click', () => {
  const isExpanded = mobileNavToggle.getAttribute('aria-expanded') === 'true';
  mobileNavToggle.setAttribute('aria-expanded', String(!isExpanded));
  mobileNavToggle.setAttribute('aria-label', isExpanded ? 'Open navigation menu' : 'Close navigation menu');
  mainNav.classList.toggle('is-open', !isExpanded);
});

mainNav.addEventListener('click', (event) => {
  if (!event.target.closest('a')) return;
  mobileNavToggle.setAttribute('aria-expanded', 'false');
  mobileNavToggle.setAttribute('aria-label', 'Open navigation menu');
  mainNav.classList.remove('is-open');
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || mobileNavToggle.getAttribute('aria-expanded') !== 'true') return;
  mobileNavToggle.setAttribute('aria-expanded', 'false');
  mobileNavToggle.setAttribute('aria-label', 'Open navigation menu');
  mainNav.classList.remove('is-open');
  mobileNavToggle.focus();
});

window.addEventListener('resize', () => {
  if (window.innerWidth <= 880) return;
  mobileNavToggle.setAttribute('aria-expanded', 'false');
  mobileNavToggle.setAttribute('aria-label', 'Open navigation menu');
  mainNav.classList.remove('is-open');
});

document.querySelector('#shopLink')?.addEventListener('click', (event) => {
  event.preventDefault();
  showStore();
  const target = document.querySelector('#storeSection');
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

document.querySelector('#checkoutLink')?.addEventListener('click', (event) => {
  event.preventDefault();
  if (!state.cart.length) {
    showNotice('Your cart is empty. Add items before checking out.', true);
    showStore();
    return;
  }

  showCheckout();
  const target = document.querySelector('#checkoutSection');
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

document.querySelector('#adminLink')?.addEventListener('click', async (event) => {
  event.preventDefault();

  if (!state.user || state.user.role !== 'admin') {
    showAuth();
    setMode('login');
    return;
  }

  const response = await fetch('/api/admin/check');
  if (!response.ok) {
    state.user = null;
    showAuth();
    return;
  }

  authSection.classList.add('hidden');
  homeSection.classList.add('hidden');
  storeSection.classList.add('hidden');
  adminSection.classList.remove('hidden');
  logoutButton.classList.remove('hidden');
  const target = document.querySelector('#adminSection');
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (state.user) {
    await fetchUsers();
    await fetchOrders();
    await fetchAdminSummary();
    await initializeCeoPanel();
  }
});

document.querySelector('#homeToShopBtn')?.addEventListener('click', () => {
  showStore();
  const target = document.querySelector('#storeSection');
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

categoryFilter.addEventListener('change', (event) => {
  state.filter = event.target.value;
  renderProducts();
});
cartButton.addEventListener('click', () => {
  if (!state.cart.length) {
    showStore();
    return;
  }

  showCheckout();
  const target = document.querySelector('#checkoutSection');
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
document.querySelector('#checkoutButton').addEventListener('click', async () => {
  if (!state.cart.length) {
    showNotice('Add at least one product before checkout.', true);
    return;
  }

  const paymentMethod = document.querySelector('#paymentMethod').value;
  const pickupValue = document.querySelector('#checkoutPickupTime').value;
  const pickupDate = pickupValue ? new Date(pickupValue) : null;
  const contact = {
    name: document.querySelector('#checkoutName').value.trim(),
    email: document.querySelector('#checkoutEmail').value.trim(),
    phone: document.querySelector('#checkoutPhone').value.trim(),
    pickupTime: pickupDate && Number.isFinite(pickupDate.getTime()) ? pickupDate.toISOString() : '',
    notes: document.querySelector('#checkoutNotes').value.trim()
  };
  if (state.user) {
    contact.name = state.user.name;
    contact.email = state.user.email;
  }
  if (!paymentMethod || !contact.name || !contact.email || !contact.pickupTime) {
    showNotice('Enter your name, email, pickup time, and payment method.', true);
    return;
  }
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(state.checkoutRequestId)) {
    state.checkoutRequestId = window.crypto.randomUUID();
    sessionStorage.setItem('phlapz.checkoutRequestId', state.checkoutRequestId);
  }

  const checkoutButton = document.querySelector('#checkoutButton');
  checkoutButton.disabled = true;
  checkoutButton.textContent = 'Processing...';

  try {
    const response = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: state.cart.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          customizationIds: (item.selectedCustomizations || []).map((option) => option.id)
        })),
        paymentMethod,
        idempotencyKey: state.checkoutRequestId,
        contact
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Checkout failed.');
    }

    if (result.url) {
      resetCheckoutRequestId();
      window.location.href = result.url;
      return;
    }

    if (!result.manual || !result.order) throw new Error('The server did not return a confirmed order record.');
    const order = result.order;
    state.cart = [];
    resetCheckoutRequestId();
    renderCart();
    document.querySelector('#subtotalValue').textContent = formatCurrency(order.subtotal);
    document.querySelector('#shippingValue').textContent = formatCurrency(order.shipping);
    document.querySelector('#taxValue').textContent = `${formatCurrency(order.tax)} (${escapeHtml(order.taxJurisdiction)})`;
    document.querySelector('#subtotalValueFinal').textContent = formatCurrency(order.amount);
    const orderResult = document.querySelector('#orderResult');
    orderResult.innerHTML = `
      <strong>Order received — ${escapeHtml(order.id)}</strong>
      <p>Order status: ${escapeHtml(order.orderStatus)} · Payment status: ${escapeHtml(order.paymentStatus)}</p>
      <p>${escapeHtml(result.instructions || 'The owner will contact you with payment instructions.')}</p>
      ${result.emailPending ? '<p>Email could not be delivered yet. The owner can retry it from the dashboard.</p>' : ''}
      <p>Your order is not approved until the owner reviews it.</p>`;
    orderResult.classList.remove('hidden');
    showNotice('Your order was saved and is awaiting owner review.');
  } catch (error) {
    showNotice(error.message || 'Unable to complete checkout.', true);
  } finally {
    checkoutButton.disabled = !state.storefrontStatus.orderingEnabled
      || (state.paymentOptions.stripe === false && !state.paymentOptions.manualMethods?.length);
    checkoutButton.textContent = 'Place order';
  }
});
setMode('login');
syncProductPublishFields();
renderCart();
document.querySelector('#currentYear').textContent = String(new Date().getFullYear());
if (!initializePasswordReset()) {
  loadSession();
}
