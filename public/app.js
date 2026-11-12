(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const safeJson = (value, fallback) => {
    try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
  };
  const state = {
    config: null,
    session: safeJson(localStorage.getItem("shoeline_session"), null),
    profile: null,
    products: [],
    orders: [],
    filter: "All",
    cart: safeJson(localStorage.getItem("shoeline_cart"), []),
    guestWishlist: safeJson(localStorage.getItem("shoeline_wishlist"), []),
    wishlist: new Set(),
    adminTab: "overview",
    adminData: null,
    toastTimer: null
  };

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const money = value => `₱${Math.round(Number(value || 0) / 100).toLocaleString("en-PH")}`;
  const productById = id => state.products.find(product => product.id === id);
  const currentUserId = () => state.session?.user?.id || null;
  const isAdmin = () => state.profile?.role === "admin";

  function showToast(message, isError = false) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function setSession(session) {
    state.session = session;
    if (session) {
      session.expires_at = session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
      localStorage.setItem("shoeline_session", JSON.stringify(session));
    } else {
      localStorage.removeItem("shoeline_session");
    }
  }

  async function loadConfig() {
    const response = await fetch("/api/config", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Supabase configuration is unavailable.");
    if (!data.supabaseUrl || !data.supabaseAnonKey) throw new Error("Supabase configuration is incomplete.");
    state.config = data;
  }

  async function loadProducts() {
    state.products = await dbRequest("products?select=id,sku,slug,name,brand,category,audience,description,price,compare_at,inventory,image_url,icon,color,badge,is_new,is_featured&is_active=eq.true&order=is_featured.desc,created_at.desc");
    renderProducts();
  }

  async function authRequest(path, body, accessToken) {
    const response = await fetch(`${state.config.supabaseUrl}/auth/v1/${path}`, {
      method: "POST",
      headers: {
        apikey: state.config.supabaseAnonKey,
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.message || data.error_description || data.error || "Authentication failed.");
    return data;
  }

  async function refreshSession() {
    if (!state.session?.refresh_token) return false;
    try {
      const session = await authRequest("token?grant_type=refresh_token", { refresh_token: state.session.refresh_token });
      setSession(session);
      return true;
    } catch {
      setSession(null);
      state.profile = null;
      return false;
    }
  }

  async function dbRequest(path, options = {}, canRefresh = true) {
    const headers = {
      apikey: state.config.supabaseAnonKey,
      ...(state.session?.access_token ? { Authorization: `Bearer ${state.session.access_token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.prefer ? { Prefer: options.prefer } : {}),
      ...(options.headers || {})
    };
    const response = await fetch(`${state.config.supabaseUrl}/rest/v1/${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (response.status === 401 && canRefresh && state.session?.refresh_token && await refreshSession()) {
      return dbRequest(path, options, false);
    }
    const text = await response.text();
    const data = text ? safeJson(text, text) : null;
    if (!response.ok) {
      const detail = typeof data === "object" ? data.message || data.details || data.hint || data.error : data;
      throw new Error(detail || `Request failed (${response.status}).`);
    }
    return data;
  }

  async function loadProfile() {
    const id = currentUserId();
    if (!id) {
      state.profile = null;
      return null;
    }
    const rows = await dbRequest(`profiles?select=id,full_name,role&id=eq.${encodeURIComponent(id)}&limit=1`);
    state.profile = rows?.[0] || null;
    if (!state.profile) throw new Error("Your account profile is not ready. Contact the store owner.");
    return state.profile;
  }

  function renderHeader() {
    const accountButton = $("#accountButton");
    accountButton.querySelector(".account-label").textContent = isAdmin() ? "Owner" : state.profile ? "My account" : "Account";
    accountButton.classList.toggle("owner-link", isAdmin());
    const wishlistSize = isAdmin() || currentUserId() ? state.wishlist.size : state.guestWishlist.length;
    $("#wishCount").textContent = String(wishlistSize);
    $("#cartCount").textContent = String(state.cart.reduce((sum, item) => sum + item.quantity, 0));
  }

  function visibleProducts() {
    const query = $("#searchInput").value.trim().toLowerCase();
    return state.products.filter(product => {
      const matchesFilter = state.filter === "All"
        || (state.filter === "New" && product.is_new)
        || (state.filter === "Sale" && product.compare_at > product.price)
        || product.audience?.toLowerCase() === state.filter.toLowerCase();
      const matchesSearch = !query || `${product.name} ${product.brand} ${product.category} ${product.audience}`.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }

  function renderProducts() {
    const products = visibleProducts();
    $("#resultsCount").textContent = `${products.length} ${products.length === 1 ? "pair" : "pairs"}`;
    $("#productGrid").innerHTML = products.length ? products.map(product => `
      <article class="product-card" data-product-card>
        <div class="product-visual" style="--product-color:${escapeHtml(product.color)}">
          <span class="product-brand">${escapeHtml(product.brand)}</span>
          ${product.badge ? `<span class="product-badge">${escapeHtml(product.badge)}</span>` : ""}
          <span class="product-shoe" aria-hidden="true">${escapeHtml(product.icon || "👟")}</span>
          <button class="wish-toggle ${state.wishlist.has(product.id) ? "saved" : ""}" type="button" data-action="toggle-wish" data-id="${escapeHtml(product.id)}" aria-label="${state.wishlist.has(product.id) ? "Remove from" : "Add to"} wishlist">${state.wishlist.has(product.id) ? "♥" : "♡"}</button>
        </div>
        <div class="product-details">
          <p class="product-category">${escapeHtml(product.category)} · ${escapeHtml(product.audience)}</p>
          <h3>${escapeHtml(product.name)}</h3>
          <div class="product-price-row"><div class="price-group"><span class="product-price">${money(product.price)}</span>${product.compare_at > product.price ? `<span class="product-old-price">${money(product.compare_at)}</span>` : ""}</div>
            <button class="add-button" type="button" data-action="add-cart" data-id="${escapeHtml(product.id)}" aria-label="Add ${escapeHtml(product.name)} to bag">+</button>
          </div>
        </div>
      </article>`).join("") : `<div class="empty-state"><h3>No pairs found.</h3><p>Try another search or choose a different filter.</p></div>`;
  }

  function setFilter(filter) {
    state.filter = filter;
    $$(".filter-chip").forEach(button => button.classList.toggle("active", button.dataset.filter === filter));
    renderProducts();
  }

  function openModal(title, content, options = {}) {
    $("#modalTitle").textContent = title;
    $("#modalEyebrow").textContent = options.eyebrow || "SHOELINE / STUDIO";
    $("#modalBody").innerHTML = content;
    $("#modalPanel").classList.toggle("admin-wide", Boolean(options.wide));
    $("#modal").classList.add("open");
    $("#modal").setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    $("#modalPanel").focus();
  }

  function closeModal() {
    $("#modal").classList.remove("open");
    $("#modal").setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  function authForm(mode = "login", message = "") {
    const registering = mode === "register";
    openModal(registering ? "Make yourself at home." : "Good to see you.", `
      ${message ? `<p class="notice">${escapeHtml(message)}</p>` : ""}
      <div class="switch-row"><span>${registering ? "Already part of the club?" : "New around here?"}</span><button class="switch-button" type="button" data-action="auth-mode" data-mode="${registering ? "login" : "register"}">${registering ? "Sign in" : "Create an account"}</button></div>
      <form id="authForm" data-mode="${registering ? "register" : "login"}">
        ${registering ? `<div class="field"><label for="authName">Your name</label><input id="authName" name="name" autocomplete="name" required minlength="2" maxlength="80"></div>` : ""}
        <div class="field"><label for="authEmail">Email address</label><input id="authEmail" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="authPassword">Password</label><input id="authPassword" name="password" type="password" autocomplete="${registering ? "new-password" : "current-password"}" minlength="${registering ? "10" : "1"}" required></div>
        <button class="button button-dark form-submit" type="submit">${registering ? "Create your account" : "Sign in"} <span>↗</span></button>
        <p class="notice">${registering ? "Use at least 10 characters. We’ll send you an email to confirm your account." : "Your account details are protected by Supabase authentication."}</p>
      </form>`, { eyebrow: "YOUR SHOELINE / ACCOUNT" });
  }

  async function signIn(email, password) {
    const session = await authRequest("token?grant_type=password", { email, password });
    setSession(session);
    await loadProfile();
    await loadWishlist();
    renderHeader();
    renderProducts();
  }

  async function signUp(name, email, password) {
    const result = await authRequest("signup", { email, password, data: { full_name: name } });
    if (result.access_token) {
      setSession(result);
      await loadProfile();
      await loadWishlist();
      renderHeader();
      renderProducts();
      return true;
    }
    return false;
  }

  async function signOut() {
    if (state.session?.access_token) {
      try { await authRequest("logout", {}, state.session.access_token); } catch { /* Local sign-out must still complete. */ }
    }
    setSession(null);
    state.profile = null;
    state.wishlist = new Set();
    renderHeader();
    closeModal();
    showToast("You’re signed out. See you soon.");
  }

  async function loadWishlist() {
    if (!currentUserId()) {
      state.wishlist = new Set(state.guestWishlist.filter(id => productById(id)));
      return;
    }
    const rows = await dbRequest(`wishlist_items?select=product_id&user_id=eq.${encodeURIComponent(currentUserId())}`);
    state.wishlist = new Set(rows.map(row => row.product_id));
  }

  async function toggleWishlist(productId) {
    if (!currentUserId()) {
      if (state.guestWishlist.includes(productId)) state.guestWishlist = state.guestWishlist.filter(id => id !== productId);
      else state.guestWishlist.push(productId);
      localStorage.setItem("shoeline_wishlist", JSON.stringify(state.guestWishlist));
      state.wishlist = new Set(state.guestWishlist);
    } else if (state.wishlist.has(productId)) {
      await dbRequest(`wishlist_items?user_id=eq.${encodeURIComponent(currentUserId())}&product_id=eq.${encodeURIComponent(productId)}`, { method: "DELETE" });
      state.wishlist.delete(productId);
    } else {
      await dbRequest("wishlist_items", { method: "POST", body: { user_id: currentUserId(), product_id: productId }, prefer: "return=minimal" });
      state.wishlist.add(productId);
    }
    renderProducts();
    renderHeader();
    showToast(state.wishlist.has(productId) ? "Saved for later." : "Removed from your wishlist.");
  }

  function addToCart(productId) {
    const product = productById(productId);
    if (!product || product.inventory < 1) return showToast("This pair is currently out of stock.", true);
    const item = state.cart.find(entry => entry.product_id === productId);
    if (item) {
      if (item.quantity >= Math.min(product.inventory, 20)) return showToast("That’s the available quantity for this pair.", true);
      item.quantity += 1;
    } else {
      state.cart.push({ product_id: productId, quantity: 1 });
    }
    persistCart();
    showToast("A good choice. Added to your bag.");
  }

  function persistCart() {
    localStorage.setItem("shoeline_cart", JSON.stringify(state.cart));
    renderHeader();
  }

  function cartMarkup() {
    const items = state.cart.map(item => ({ item, product: productById(item.product_id) })).filter(row => row.product);
    const subtotal = items.reduce((sum, row) => sum + row.product.price * row.item.quantity, 0);
    if (!items.length) return `<div class="cart-empty"><span>👟</span><strong>Your bag is taking a breather.</strong><p>Find a pair that feels like you.</p><button class="button button-dark" type="button" data-action="close-modal">Keep looking <span>↗</span></button></div>`;
    return `${items.map(({ item, product }) => `<div class="line-item"><div><strong>${escapeHtml(product.name)}</strong><small>${money(product.price)} · Qty ${item.quantity}</small></div><div><button class="switch-button" type="button" data-action="cart-qty" data-id="${escapeHtml(product.id)}" data-delta="-1">−</button> <button class="switch-button" type="button" data-action="cart-qty" data-id="${escapeHtml(product.id)}" data-delta="1">+</button> <button class="switch-button" type="button" data-action="remove-cart" data-id="${escapeHtml(product.id)}">Remove</button></div></div>`).join("")}
      <div class="cart-footer"><span>Subtotal</span><span>${money(subtotal)}</span></div>
      <p class="notice">${subtotal >= 250000 ? "Complimentary delivery is on us." : `Delivery ₱150 · free over ₱2,500.`} Cash on delivery is available at checkout.</p>
      <button class="button button-dark form-submit" type="button" data-action="checkout">Continue to checkout <span>↗</span></button>`;
  }

  function openCart() {
    openModal("The good stuff.", cartMarkup(), { eyebrow: "YOUR BAG" });
  }

  function changeCart(productId, delta) {
    const item = state.cart.find(entry => entry.product_id === productId);
    const product = productById(productId);
    if (!item || !product) return;
    const quantity = item.quantity + delta;
    if (quantity < 1) state.cart = state.cart.filter(entry => entry !== item);
    else if (quantity > Math.min(product.inventory, 20)) return showToast("That’s the available quantity for this pair.", true);
    else item.quantity = quantity;
    persistCart();
    openCart();
  }

  function checkoutForm() {
    const profileName = state.profile?.full_name || "";
    const email = state.session?.user?.email || "";
    openModal("A few little details.", `
      <form id="checkoutForm">
        <div class="form-grid">
          <div class="field"><label for="shippingName">Full name</label><input id="shippingName" name="recipient_name" value="${escapeHtml(profileName)}" autocomplete="name" required></div>
          <div class="field"><label for="shippingPhone">Phone number</label><input id="shippingPhone" name="phone" type="tel" autocomplete="tel" required></div>
          <div class="field full"><label for="shippingLine1">Street address</label><input id="shippingLine1" name="line1" autocomplete="street-address" required></div>
          <div class="field full"><label for="shippingLine2">Apartment, unit or landmark</label><input id="shippingLine2" name="line2" autocomplete="address-line2"></div>
          <div class="field"><label for="shippingCity">City</label><input id="shippingCity" name="city" autocomplete="address-level2" required></div>
          <div class="field"><label for="shippingRegion">Province / region</label><input id="shippingRegion" name="region" autocomplete="address-level1" required></div>
          <div class="field"><label for="shippingPostal">Postal code</label><input id="shippingPostal" name="postal_code" autocomplete="postal-code" required></div>
          <div class="field"><label for="shippingEmail">Email</label><input id="shippingEmail" value="${escapeHtml(email)}" type="email" readonly></div>
          <div class="field full"><label for="customerNote">Delivery note (optional)</label><textarea id="customerNote" name="customer_note" maxlength="1000" placeholder="Anything our delivery team should know?"></textarea></div>
        </div>
        <label class="save-address"><input name="save_address" type="checkbox"> Save this address to my account</label>
        <p class="notice">Payment: cash on delivery. Orders are securely recorded and inventory is reserved in Supabase when you place them.</p>
        <button class="button button-dark form-submit" type="submit">Place order <span>↗</span></button>
      </form>`, { eyebrow: "DELIVERY / CHECKOUT" });
  }

  async function placeOrder(form) {
    if (!currentUserId()) {
      authForm("login", "Sign in before placing your order.");
      return;
    }
    const formData = new FormData(form);
    const address = Object.fromEntries(formData.entries());
    const customerNote = address.customer_note;
    const shouldSaveAddress = address.save_address === "on";
    delete address.customer_note;
    delete address.save_address;
    address.country = "PH";
    try {
      const orderId = await dbRequest("rpc/create_order", {
        method: "POST",
        body: {
          p_items: state.cart.map(item => ({ product_id: item.product_id, quantity: item.quantity })),
          p_shipping_address: address,
          p_customer_note: customerNote
        }
      });
      state.cart = [];
      persistCart();
      let addressSaved = true;
      if (shouldSaveAddress) {
        try {
          await dbRequest("addresses", {
            method: "POST",
            body: { ...address, user_id: currentUserId(), label: "Home", is_default: true },
            prefer: "return=minimal"
          });
        } catch {
          addressSaved = false;
        }
      }
      let refreshNotice = "";
      try { await loadProducts(); }
      catch { refreshNotice = " Your order is safe, but the live stock display could not refresh."; }
      openModal("You’re all set.", `<div class="cart-empty"><span>✳</span><strong>Your order is on its way to becoming a good day.</strong><p>Order ${escapeHtml(String(orderId).slice(0, 8).toUpperCase())} is confirmed. We’ll collect payment on delivery.${addressSaved ? "" : " Your order is safe, but we couldn’t save this address for next time."}${refreshNotice}</p><button class="button button-dark" type="button" data-action="customer" data-tab="orders">View your order <span>↗</span></button></div>`, { eyebrow: "ORDER PLACED" });
      showToast("Order placed. Thank you for choosing Shoeline.");
    } catch (error) {
      showToast(error.message || "We couldn’t place that order. Check your details and try again.", true);
    }
  }

  async function loadOrders() {
    if (!currentUserId()) return [];
    return dbRequest(`orders?select=id,order_number,status,payment_status,payment_method,total,currency,created_at,order_items(product_name,quantity,unit_price)&user_id=eq.${encodeURIComponent(currentUserId())}&order=created_at.desc`);
  }

  function openCustomer(tab = "overview") {
    if (!state.profile) return authForm();
    const name = escapeHtml(state.profile.full_name || "Shoeline member");
    const email = escapeHtml(state.session?.user?.email || "");
    const tabMarkup = `<div class="modal-tabs">${[
      ["overview", "Overview"], ["orders", "Orders"], ["returns", "Returns"], ["addresses", "Addresses"]
    ].map(([value, label]) => `<button type="button" data-action="customer" data-tab="${value}" class="${tab === value ? "active" : ""}">${label}</button>`).join("")}</div>`;
    openModal(`Hello, ${name.split(" ")[0]}.`, `${tabMarkup}<div id="customerPanel"><p>Loading your account…</p></div>`, { eyebrow: "YOUR SHOELINE / ACCOUNT" });
    renderCustomerTab(tab, email).catch(error => showToast(error.message, true));
  }

  async function renderCustomerTab(tab, email) {
    const panel = $("#customerPanel");
    if (!panel) return;
    if (tab === "overview") {
      const orders = await loadOrders();
      panel.innerHTML = `<p><strong>${escapeHtml(state.profile.full_name)}</strong><br><span class="notice">${email}</span></p><p class="notice">Your orders, saved pairs and delivery details are yours alone. Sign out from this device when you’re done.</p><div class="line-item"><div><strong>Recent orders</strong><small>${orders.length ? `${orders.length} order${orders.length === 1 ? "" : "s"} on your account` : "Your next favorite is just around the corner."}</small></div><button class="switch-button" type="button" data-action="customer" data-tab="orders">View orders →</button></div><div class="line-item"><div><strong>Your wishlist</strong><small>${state.wishlist.size} saved pair${state.wishlist.size === 1 ? "" : "s"}</small></div><button class="switch-button" type="button" data-action="wishlist">Open →</button></div><button class="button button-outline form-submit" type="button" data-action="signout">Sign out</button>`;
    } else if (tab === "orders") {
      const orders = await loadOrders();
      panel.innerHTML = orders.length ? orders.map(order => `<div class="order-card"><div><strong>${escapeHtml(order.order_number)}</strong><small>${new Date(order.created_at).toLocaleDateString("en-PH")} · ${escapeHtml((order.order_items || []).map(item => `${item.product_name} × ${item.quantity}`).join(", "))}</small><small><span class="status-pill">${escapeHtml(order.status)}</span> · ${escapeHtml(order.payment_status)}</small></div><strong>${money(order.total)}</strong></div>`).join("") : `<div class="cart-empty"><span>↗</span><strong>Your story starts with a first step.</strong><p>Orders you place will appear here.</p></div>`;
      panel.innerHTML += `<button class="button button-outline form-submit" type="button" data-action="customer" data-tab="returns">Request a return <span>↗</span></button>`;
    } else if (tab === "returns") {
      const orders = await loadOrders();
      panel.innerHTML = `<p>Something not quite right? Tell us what happened and our team will take it from here.</p>${orders.length ? `<form id="returnForm"><div class="field"><label for="returnOrder">Order</label><select id="returnOrder" name="order_id" required>${orders.map(order => `<option value="${escapeHtml(order.id)}">${escapeHtml(order.order_number)} · ${escapeHtml(order.status)}</option>`).join("")}</select></div><div class="field"><label for="returnReason">Reason</label><select id="returnReason" name="reason"><option>Wrong size</option><option>Changed my mind</option><option>Item issue</option><option>Other</option></select></div><div class="field"><label for="returnDetails">A few details</label><textarea id="returnDetails" name="details" maxlength="1000"></textarea></div><button class="button button-dark form-submit" type="submit">Send return request <span>↗</span></button></form>` : `<p class="notice">You’ll be able to request a return after placing your first order.</p>`}`;
    } else {
      const addresses = await dbRequest(`addresses?select=id,label,recipient_name,line1,city,region,postal_code,is_default&user_id=eq.${encodeURIComponent(currentUserId())}&order=is_default.desc,created_at.desc`);
      panel.innerHTML = addresses.length ? addresses.map(address => `<div class="line-item"><div><strong>${escapeHtml(address.label)} ${address.is_default ? "· Default" : ""}</strong><small>${escapeHtml(address.recipient_name)} · ${escapeHtml(address.line1)}, ${escapeHtml(address.city)}, ${escapeHtml(address.region)} ${escapeHtml(address.postal_code)}</small></div></div>`).join("") : `<p class="notice">Your saved addresses will appear here after your first checkout.</p>`;
    }
  }

  function openWishlist() {
    const ids = currentUserId() ? [...state.wishlist] : state.guestWishlist;
    const products = ids.map(productById).filter(Boolean);
    openModal("Saved for a little later.", products.length ? products.map(product => `<div class="line-item"><div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.brand)} · ${money(product.price)}</small></div><button class="switch-button" type="button" data-action="add-cart" data-id="${escapeHtml(product.id)}">Add to bag</button></div>`).join("") : `<div class="cart-empty"><span>♡</span><strong>Nothing saved just yet.</strong><p>Tap the heart on a pair to keep it close.</p></div>`, { eyebrow: "YOUR WISHLIST" });
  }

  async function submitReturn(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await dbRequest("return_requests", {
        method: "POST",
        body: { ...values, user_id: currentUserId() },
        prefer: "return=minimal"
      });
      openModal("We’ll take it from here.", "<p>Your return request is in. Our team will review it and be in touch.</p>", { eyebrow: "RETURN REQUEST SENT" });
    } catch (error) {
      showToast(error.message || "We couldn’t send that request.", true);
    }
  }

  function openQuote() {
    openModal("Let’s find your team’s fit.", `
      <form id="quoteForm">
        <div class="field"><label for="quoteOrg">Organization</label><input id="quoteOrg" name="organization" required maxlength="150"></div>
        <div class="field"><label for="quoteEmail">Contact email</label><input id="quoteEmail" name="email" type="email" required></div>
        <div class="field"><label for="quoteQuantity">Estimated pairs</label><input id="quoteQuantity" name="quantity" type="number" min="1" max="10000" required></div>
        <div class="field"><label for="quoteNotes">Sizes, brands or anything else?</label><textarea id="quoteNotes" name="notes" maxlength="2000"></textarea></div>
        <button class="button button-dark form-submit" type="submit">Send a note <span>↗</span></button>
      </form>`, { eyebrow: "SHOELINE / FOR TEAMS" });
  }

  async function submitQuote(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    values.quantity = Number(values.quantity);
    values.user_id = currentUserId();
    try {
      await dbRequest("quote_requests", { method: "POST", body: values, prefer: "return=minimal" });
      openModal("Thanks for reaching out.", "<p>Your note is with our team. We’ll be in touch soon.</p>", { eyebrow: "MESSAGE SENT" });
    } catch (error) {
      showToast(error.message || "We couldn’t send your note.", true);
    }
  }

  async function openAdmin(tab = "overview") {
    if (!isAdmin()) {
      showToast("Owner access is available to authorized store admins only.", true);
      return;
    }
    state.adminTab = tab;
    openModal("The store, at a glance.", `<div class="admin-shell"><aside class="admin-sidebar"><p class="admin-brand">SHOELINE / OWNER</p><nav class="admin-nav" aria-label="Owner dashboard">${[
      ["overview", "Overview"], ["orders", "Orders"], ["products", "Products"], ["customers", "Customers"], ["returns", "Returns"], ["quotes", "Team quotes"]
    ].map(([value, label]) => `<button type="button" data-action="admin-tab" data-tab="${value}" class="${state.adminTab === value ? "active" : ""}">${label}</button>`).join("")}</nav></aside><div class="admin-main" id="adminContent"><p>Loading your store…</p></div></div>`, { eyebrow: "PRIVATE / OWNER DASHBOARD", wide: true });
    try {
      await loadAdminData();
      renderAdmin();
    } catch (error) {
      $("#adminContent").innerHTML = `<div class="admin-empty">${escapeHtml(error.message || "Could not load the dashboard.")}</div>`;
    }
  }

  async function loadAdminData() {
    const [products, orders, customers, returns, quotes] = await Promise.all([
      dbRequest("products?select=id,name,sku,inventory,price,compare_at,is_active,category,brand&order=created_at.desc"),
      dbRequest("orders?select=id,order_number,status,payment_status,total,created_at,profiles(full_name),order_items(product_name,quantity)&order=created_at.desc&limit=100"),
      dbRequest("profiles?select=id,full_name,role,created_at&order=created_at.desc&limit=100"),
      dbRequest("return_requests?select=id,reason,details,status,created_at,orders(order_number,profiles(full_name))&order=created_at.desc&limit=100"),
      dbRequest("quote_requests?select=id,organization,email,quantity,status,created_at&order=created_at.desc&limit=100")
    ]);
    state.adminData = { products, orders, customers, returns, quotes };
  }

  function adminTabs() {
    $$(".admin-nav button").forEach(button => button.classList.toggle("active", button.dataset.tab === state.adminTab));
  }

  function renderAdmin() {
    const target = $("#adminContent");
    if (!target || !state.adminData) return;
    const data = state.adminData;
    const pending = data.orders.filter(order => order.status === "pending");
    const metrics = `<div class="admin-metrics"><div class="metric-card"><span>Open orders</span><strong>${pending.length}</strong></div><div class="metric-card"><span>Active pairs</span><strong>${data.products.filter(product => product.is_active).length}</strong></div><div class="metric-card"><span>Customers</span><strong>${data.customers.length}</strong></div><div class="metric-card"><span>Team quotes</span><strong>${data.quotes.filter(quote => quote.status === "new").length}</strong></div></div>`;
    let body = "";
    if (state.adminTab === "overview") {
      body = `<div class="admin-topline"><div><h3>Good morning.</h3><p>Here’s what’s happening at Shoeline today.</p></div><span class="status-pill">Live store</span></div>${metrics}<h4>Orders to look at</h4>${renderOrderTable(pending.slice(0, 6))}`;
    } else if (state.adminTab === "orders") {
      body = `<div class="admin-topline"><div><h3>Orders</h3><p>Review and update fulfillment as it moves.</p></div></div>${renderOrderTable(data.orders)}`;
    } else if (state.adminTab === "products") {
      body = `<div class="admin-topline"><div><h3>Products</h3><p>Catalog, pricing and available stock.</p></div><button class="button button-dark" type="button" data-action="new-product">Add a pair <span>+</span></button></div><div class="table-wrap"><table class="admin-table"><thead><tr><th>Pair</th><th>Price (₱)</th><th>Stock</th><th>Visibility</th><th></th></tr></thead><tbody>${data.products.map(product => `<tr data-product-row="${escapeHtml(product.id)}"><td><strong>${escapeHtml(product.name)}</strong><br><small>${escapeHtml(product.sku)}</small></td><td><input data-product-price value="${(product.price / 100).toFixed(0)}" type="number" min="1" aria-label="Price for ${escapeHtml(product.name)}"></td><td><input data-product-stock value="${product.inventory}" type="number" min="0" aria-label="Stock for ${escapeHtml(product.name)}"></td><td><select data-product-active aria-label="Visibility for ${escapeHtml(product.name)}"><option value="true" ${product.is_active ? "selected" : ""}>Live</option><option value="false" ${!product.is_active ? "selected" : ""}>Hidden</option></select></td><td><button class="switch-button" type="button" data-action="save-product" data-id="${escapeHtml(product.id)}">Save</button></td></tr>`).join("")}</tbody></table></div>`;
    } else if (state.adminTab === "customers") {
      body = `<div class="admin-topline"><div><h3>Customers</h3><p>People who’ve made Shoeline part of their day.</p></div></div><div class="table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Role</th><th>Joined</th></tr></thead><tbody>${data.customers.map(customer => `<tr><td>${escapeHtml(customer.full_name || "Shoeline member")}</td><td>${escapeHtml(customer.role)}</td><td>${new Date(customer.created_at).toLocaleDateString("en-PH")}</td></tr>`).join("") || `<tr><td colspan="3">No customers yet.</td></tr>`}</tbody></table></div>`;
    } else if (state.adminTab === "returns") {
      body = `<div class="admin-topline"><div><h3>Returns</h3><p>Keep the experience easy, even when a pair isn’t quite right.</p></div></div>${data.returns.length ? `<div class="table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Reason</th><th>Status</th></tr></thead><tbody>${data.returns.map(request => `<tr><td>${escapeHtml(request.orders?.order_number || "—")}</td><td>${escapeHtml(request.orders?.profiles?.full_name || "Customer")}</td><td>${escapeHtml(request.reason)}</td><td>${escapeHtml(request.status)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="admin-empty">No return requests yet.</div>`}`;
    } else {
      body = `<div class="admin-topline"><div><h3>Team quotes</h3><p>Bulk requests from schools, clubs and communities.</p></div></div>${data.quotes.length ? `<div class="table-wrap"><table class="admin-table"><thead><tr><th>Organization</th><th>Contact</th><th>Pairs</th><th>Status</th></tr></thead><tbody>${data.quotes.map(quote => `<tr><td>${escapeHtml(quote.organization)}</td><td>${escapeHtml(quote.email)}</td><td>${quote.quantity}</td><td>${escapeHtml(quote.status)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="admin-empty">No team requests yet.</div>`}`;
    }
    target.innerHTML = `${state.adminTab === "overview" ? "" : metrics}${body}`;
    adminTabs();
  }

  function renderOrderTable(orders) {
    if (!orders.length) return `<div class="admin-empty">No orders are waiting right now.</div>`;
    const statuses = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];
    return `<div class="table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>${orders.map(order => `<tr><td><strong>${escapeHtml(order.order_number)}</strong><br><small>${new Date(order.created_at).toLocaleDateString("en-PH")}</small></td><td>${escapeHtml(order.profiles?.full_name || "Customer")}</td><td>${(order.order_items || []).reduce((sum, item) => sum + item.quantity, 0)}</td><td>${money(order.total)}</td><td><select data-order-status="${escapeHtml(order.id)}" aria-label="Order status for ${escapeHtml(order.order_number)}">${statuses.map(status => `<option value="${status}" ${status === order.status ? "selected" : ""}>${status}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`;
  }

  function newProductForm() {
    openModal("Add a new favorite.", `
      <form id="productForm">
        <div class="form-grid">
          <div class="field"><label for="productName">Product name</label><input id="productName" name="name" required maxlength="100"></div>
          <div class="field"><label for="productBrand">Brand</label><input id="productBrand" name="brand" required maxlength="60"></div>
          <div class="field"><label for="productSku">SKU</label><input id="productSku" name="sku" required maxlength="40"></div>
          <div class="field"><label for="productAudience">Audience</label><select id="productAudience" name="audience"><option>Unisex</option><option>Men</option><option>Women</option><option>Kids</option></select></div>
          <div class="field"><label for="productCategory">Category</label><input id="productCategory" name="category" required maxlength="50" placeholder="Lifestyle"></div>
          <div class="field"><label for="productPrice">Price (₱)</label><input id="productPrice" name="price" type="number" min="1" required></div>
          <div class="field"><label for="productStock">Starting stock</label><input id="productStock" name="inventory" type="number" min="0" value="0" required></div>
          <div class="field"><label for="productColor">Card color</label><input id="productColor" name="color" type="color" value="#d8e6a8"></div>
        </div>
        <button class="button button-dark form-submit" type="submit">Add to the catalog <span>↗</span></button>
      </form>`, { eyebrow: "OWNER / PRODUCT CATALOG" });
  }

  async function saveProduct(productId) {
    const row = $(`[data-product-row="${CSS.escape(productId)}"]`);
    const price = Number($("[data-product-price]", row).value);
    const inventory = Number($("[data-product-stock]", row).value);
    const isActive = $("[data-product-active]", row).value === "true";
    if (!Number.isFinite(price) || price < 1 || !Number.isInteger(inventory) || inventory < 0) {
      showToast("Enter a valid price and stock quantity.", true);
      return;
    }
    await dbRequest(`products?id=eq.${encodeURIComponent(productId)}`, {
      method: "PATCH",
      body: { price: Math.round(price * 100), inventory, is_active: isActive },
      prefer: "return=minimal"
    });
    await loadAdminData();
    await loadProducts();
    renderAdmin();
    await dbRequest("admin_activity_logs", {
      method: "POST",
      body: { admin_id: currentUserId(), action: "updated product", entity_type: "product", entity_id: productId },
      prefer: "return=minimal"
    });
    showToast("Catalog updated.");
  }

  async function updateOrder(orderId, status) {
    await dbRequest(`orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      body: { status },
      prefer: "return=minimal"
    });
    await dbRequest("admin_activity_logs", {
      method: "POST",
      body: { admin_id: currentUserId(), action: `changed order status to ${status}`, entity_type: "order", entity_id: orderId },
      prefer: "return=minimal"
    });
    await loadAdminData();
    renderAdmin();
    showToast("Order status updated.");
  }

  async function createProduct(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const price = Number(values.price);
    const inventory = Number(values.inventory);
    if (!Number.isFinite(price) || price < 1 || !Number.isInteger(inventory) || inventory < 0) throw new Error("Enter a valid price and stock quantity.");
    const slug = `${values.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
    await dbRequest("products", {
      method: "POST",
      body: {
        sku: values.sku.trim(),
        slug,
        name: values.name.trim(),
        brand: values.brand.trim(),
        category: values.category.trim(),
        audience: values.audience,
        price: Math.round(price * 100),
        inventory,
        color: values.color,
        icon: "👟",
        badge: "JUST IN",
        is_new: true,
        is_active: true
      },
      prefer: "return=minimal"
    });
    await loadAdminData();
    await loadProducts();
    renderAdmin();
    showToast("Your new pair is live.");
  }

  function registerHandlers() {
    document.addEventListener("click", async event => {
      const button = event.target.closest("[data-action]");
      if (button) {
        const { action, id, tab, mode, delta } = button.dataset;
        try {
          if (action === "close-modal") closeModal();
          else if (action === "account") isAdmin() ? await openAdmin() : state.profile ? openCustomer() : authForm();
          else if (action === "auth-mode") authForm(mode);
          else if (action === "signout") await signOut();
          else if (action === "cart") openCart();
          else if (action === "checkout") {
            if (!state.cart.length) return showToast("Your bag is empty.");
            if (!currentUserId()) return authForm("login", "Sign in to continue to checkout.");
            checkoutForm();
          }
          else if (action === "add-cart") addToCart(id);
          else if (action === "remove-cart") {
            state.cart = state.cart.filter(item => item.product_id !== id);
            persistCart();
            openCart();
          }
          else if (action === "cart-qty") changeCart(id, Number(delta));
          else if (action === "wishlist") openWishlist();
          else if (action === "toggle-wish") await toggleWishlist(id);
          else if (action === "quote") openQuote();
          else if (action === "customer") openCustomer(tab);
          else if (action === "admin-tab") {
            state.adminTab = tab;
            renderAdmin();
          }
          else if (action === "new-product") newProductForm();
          else if (action === "save-product") await saveProduct(id);
        } catch (error) {
          showToast(error.message || "That didn’t work. Please try again.", true);
        }
      }

      const filterButton = event.target.closest("[data-filter]");
      if (filterButton) setFilter(filterButton.dataset.filter);

      if (event.target.closest("#menuButton")) {
        const nav = $("#siteNav");
        const expanded = nav.classList.toggle("open");
        $("#menuButton").setAttribute("aria-expanded", String(expanded));
      }
    });

    document.addEventListener("submit", async event => {
      const form = event.target;
      if (!form.matches("form")) return;
      event.preventDefault();
      try {
        if (form.id === "searchForm") {
          renderProducts();
          $("#shop").scrollIntoView({ behavior: "smooth" });
        } else if (form.id === "authForm") {
          const data = new FormData(form);
          if (form.dataset.mode === "register") {
            const confirmed = await signUp(data.get("name").trim(), data.get("email").trim(), data.get("password"));
            if (!confirmed) authForm("login", "Check your inbox to confirm your email, then sign in.");
            else {
              closeModal();
              openCustomer("overview");
              showToast("Welcome to the Shoeline club.");
            }
          } else {
            await signIn(data.get("email").trim(), data.get("password"));
            closeModal();
            if (isAdmin()) await openAdmin();
            else openCustomer("overview");
            showToast("Welcome back.");
          }
        } else if (form.id === "checkoutForm") {
          await placeOrder(form);
        } else if (form.id === "returnForm") {
          await submitReturn(form);
        } else if (form.id === "quoteForm") {
          await submitQuote(form);
        } else if (form.id === "productForm") {
          await createProduct(form);
        }
      } catch (error) {
        showToast(error.message || "We couldn’t complete that request.", true);
      }
    });

    document.addEventListener("change", async event => {
      const select = event.target.closest("[data-order-status]");
      if (!select) return;
      try { await updateOrder(select.dataset.orderStatus, select.value); }
      catch (error) { showToast(error.message || "Could not update the order.", true); }
    });

    $("#productGrid").addEventListener("pointermove", event => {
      const card = event.target.closest("[data-product-card]");
      if (!card || event.pointerType !== "mouse") return;
      const bounds = card.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      card.style.setProperty("--tilt-x", `${(0.5 - y) * 3}deg`);
      card.style.setProperty("--tilt-y", `${(x - 0.5) * 3}deg`);
    });
    $("#productGrid").addEventListener("pointerleave", event => {
      const card = event.target.closest("[data-product-card]");
      if (card) {
        card.style.removeProperty("--tilt-x");
        card.style.removeProperty("--tilt-y");
      }
    }, true);

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeModal();
    });
  }

  async function initialize() {
    registerHandlers();
    try {
      await loadConfig();
      if (state.session?.expires_at && state.session.expires_at < Math.floor(Date.now() / 1000) + 60) await refreshSession();
      if (currentUserId()) {
        try { await loadProfile(); await loadWishlist(); }
        catch {
          setSession(null);
          state.profile = null;
          state.wishlist = new Set();
        }
      } else {
        await loadWishlist();
      }
      await loadProducts();
      state.cart = state.cart.filter(item => productById(item.product_id));
      await loadWishlist();
      persistCart();
      renderHeader();
      renderProducts();
    } catch (error) {
      $("#resultsCount").textContent = "Collection unavailable";
      $("#productGrid").innerHTML = `<div class="empty-state"><h3>We’re making a little room.</h3><p>${escapeHtml(error.message || "The collection is temporarily unavailable.")}</p></div>`;
      showToast(error.message || "Could not connect to Shoeline.", true);
    }
  }

  initialize();
})();
