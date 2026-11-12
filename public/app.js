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
    reviews: [],
    orders: [],
    filter: "All",
    cart: safeJson(localStorage.getItem("shoeline_cart"), []),
    guestWishlist: safeJson(localStorage.getItem("shoeline_wishlist"), []),
    wishlist: new Set(),
    adminTab: "overview",
    adminData: null,
    adminRefreshTimer: null,
    adminRefreshInFlight: false,
    adminLiveActive: false,
    realtimeSocket: null,
    realtimeHeartbeat: null,
    realtimeReconnectTimer: null,
    realtimeReconnectAttempts: 0,
    realtimeRef: 0,
    productPreviewUrl: null,
    navigationPreviewTimer: null,
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

  function showNavigationPreview(message) {
    const preview = $("#navigationPreview");
    $("#navigationPreviewText").textContent = message;
    preview.setAttribute("aria-hidden", "false");
    preview.classList.add("visible");
    clearTimeout(state.navigationPreviewTimer);
    state.navigationPreviewTimer = setTimeout(hideNavigationPreview, 520);
  }

  function hideNavigationPreview() {
    const preview = $("#navigationPreview");
    preview.classList.remove("visible");
    preview.setAttribute("aria-hidden", "true");
  }

  function loadingMarkup(message) {
    return `<div class="loading-card" role="status"><span class="loader" aria-hidden="true"></span><span>${escapeHtml(message)}</span></div>`;
  }

  async function toggleBackgroundMusic() {
    const audio = $("#backgroundMusic");
    const button = $("#musicToggle");
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        showToast("Background music could not be played. Please try again.", true);
      }
      return;
    }
    audio.pause();
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", "Play background music");
    $(".music-label", button).textContent = "Play music";
    button.classList.remove("playing");
  }

  function tryAutoplayBackgroundMusic() {
    const audio = $("#backgroundMusic");
    audio.volume = 0.35;
    audio.play().catch(error => {
      if (error.name !== "NotAllowedError" && !audio.error) {
        showToast("Background music could not be played.", true);
      }
    });
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
    const [products, reviews] = await Promise.all([
      dbRequest("products?select=id,sku,slug,name,brand,category,audience,description,price,compare_at,inventory,image_url,icon,color,badge,is_new,is_featured&is_active=eq.true&order=is_featured.desc,created_at.desc"),
      dbRequest("product_reviews?select=product_id,rating&is_approved=eq.true&order=created_at.desc&limit=500")
    ]);
    state.products = products;
    state.reviews = reviews;
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
      syncRealtimeAccessToken();
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
    accountButton.querySelector(".account-label").textContent = isAdmin() ? "Profile" : state.profile ? "My account" : "Account";
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

  function productImageUrl(product) {
    if (!product.image_url) return null;
    try {
      const url = new URL(product.image_url, location.origin);
      return url.protocol === "https:" || url.origin === location.origin ? url.href : null;
    } catch {
      return null;
    }
  }

  function productRating(productId) {
    const ratings = state.reviews.filter(review => review.product_id === productId);
    if (!ratings.length) return null;
    const average = ratings.reduce((sum, review) => sum + Number(review.rating), 0) / ratings.length;
    return { average, count: ratings.length, stars: "★".repeat(Math.round(average)) + "☆".repeat(5 - Math.round(average)) };
  }

  function renderProducts() {
    const products = visibleProducts();
    const grid = $("#productGrid");
    $("#resultsCount").textContent = `${products.length} ${products.length === 1 ? "pair" : "pairs"}`;
    grid.setAttribute("aria-labelledby", `filter-${state.filter.toLowerCase()}`);
    grid.innerHTML = products.length ? products.map(product => `
      <article class="product-card" data-product-card>
        <div class="product-visual" style="--product-color:${escapeHtml(product.color)}">
          <span class="product-brand">${escapeHtml(product.brand)}</span>
          ${product.badge ? `<span class="product-badge">${escapeHtml(product.badge)}</span>` : ""}
          ${productImageUrl(product)
            ? `<img class="product-photo" src="${escapeHtml(productImageUrl(product))}" alt="${escapeHtml(product.name)} sneakers" loading="lazy">`
            : `<svg class="product-shoe" viewBox="0 0 760 460" aria-hidden="true" focusable="false"><use href="#sneaker-artwork"></use></svg>`}
          <button class="wish-toggle ${state.wishlist.has(product.id) ? "saved" : ""}" type="button" data-action="toggle-wish" data-id="${escapeHtml(product.id)}" aria-label="${state.wishlist.has(product.id) ? "Remove from" : "Add to"} wishlist">${state.wishlist.has(product.id) ? "♥" : "♡"}</button>
        </div>
        <div class="product-details">
          <p class="product-category">${escapeHtml(product.category)} · ${escapeHtml(product.audience)}</p>
          <h3>${escapeHtml(product.name)}</h3>
          ${productRating(product.id)
            ? `<div class="product-rating"><span class="product-stars" aria-label="Rated ${productRating(product.id).average.toFixed(1)} out of 5">${productRating(product.id).stars}</span><button type="button" data-action="product-reviews" data-id="${escapeHtml(product.id)}">${productRating(product.id).average.toFixed(1)} · ${productRating(product.id).count} review${productRating(product.id).count === 1 ? "" : "s"}</button></div>`
            : `<div class="product-rating"><span class="product-stars" aria-hidden="true">☆☆☆☆☆</span><button type="button" data-action="product-reviews" data-id="${escapeHtml(product.id)}">Be the first to review</button></div>`}
          <div class="product-price-row"><div class="price-group"><span class="product-price">${money(product.price)}</span>${product.compare_at > product.price ? `<span class="product-old-price">${money(product.compare_at)}</span>` : ""}</div>
            <button class="add-button" type="button" data-action="add-cart" data-id="${escapeHtml(product.id)}" aria-label="Add ${escapeHtml(product.name)} to bag">+</button>
          </div>
        </div>
      </article>`).join("") : `<div class="empty-state"><h3>No pairs found.</h3><p>Try another search or choose a different filter.</p></div>`;
    grid.setAttribute("aria-busy", "false");
  }

  function setFilter(filter) {
    state.filter = filter;
    $$(".filter-chip").forEach(button => {
      const selected = button.dataset.filter === filter;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    const grid = $("#productGrid");
    grid.setAttribute("aria-busy", "true");
    grid.classList.add("is-transitioning");
    requestAnimationFrame(() => {
      renderProducts();
      requestAnimationFrame(() => grid.classList.remove("is-transitioning"));
    });
  }

  function initializeMotion() {
    const targets = $$("[data-reveal]");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      targets.forEach(target => target.classList.add("is-visible"));
      return;
    }
    document.body.classList.add("motion-ready");
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -24px 0px" });
    targets.forEach(target => observer.observe(target));
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
    stopAdminLiveUpdates();
    if (state.productPreviewUrl) {
      URL.revokeObjectURL(state.productPreviewUrl);
      state.productPreviewUrl = null;
    }
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
        <p class="notice">${registering ? "Use at least 10 characters. If email confirmation is off for the store, you’ll be signed in immediately; otherwise, confirm your email first." : "Your account details are protected by Supabase authentication."}</p>
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

  async function openProductReviews(productId) {
    const product = productById(productId);
    if (!product) return;
    openModal(`${product.name} reviews`, `<div class="review-loading"><span class="loader"></span><p>Loading customer reviews…</p></div>`, { eyebrow: "SHOELINE / CUSTOMER NOTES" });
    try {
      const reviews = await dbRequest(`product_reviews?select=id,rating,title,body,created_at&product_id=eq.${encodeURIComponent(productId)}&is_approved=eq.true&order=created_at.desc&limit=100`);
      let reviewForm = `<p class="notice">Sign in to review this pair after it has been delivered.</p><button class="button button-outline form-submit" type="button" data-action="account">Sign in to write a review <span>↗</span></button>`;
      if (currentUserId()) {
        const [eligibleOrders, existingReviews] = await Promise.all([
          dbRequest(`orders?select=id,order_number,order_items!inner(product_id)&user_id=eq.${encodeURIComponent(currentUserId())}&status=eq.delivered&order_items.product_id=eq.${encodeURIComponent(productId)}`),
          dbRequest(`product_reviews?select=id&product_id=eq.${encodeURIComponent(productId)}&user_id=eq.${encodeURIComponent(currentUserId())}&limit=1`)
        ]);
        if (existingReviews.length) {
          reviewForm = `<p class="notice">You’ve already reviewed this pair. Thanks for sharing your experience.</p>`;
        } else if (eligibleOrders.length) {
          reviewForm = `<form id="reviewForm" data-product-id="${escapeHtml(productId)}">
            <div class="field"><label for="reviewOrder">Delivered order</label><select id="reviewOrder" name="order_id" required>${eligibleOrders.map(order => `<option value="${escapeHtml(order.id)}">${escapeHtml(order.order_number)}</option>`).join("")}</select></div>
            <div class="field"><label for="reviewRating">Your rating</label><select id="reviewRating" name="rating" required><option value="5">★★★★★ · Loved it</option><option value="4">★★★★☆ · Really good</option><option value="3">★★★☆☆ · It’s good</option><option value="2">★★☆☆☆ · Not for me</option><option value="1">★☆☆☆☆ · Disappointed</option></select></div>
            <div class="field"><label for="reviewTitle">Headline (optional)</label><input id="reviewTitle" name="title" maxlength="100"></div>
            <div class="field"><label for="reviewBody">Your review</label><textarea id="reviewBody" name="body" maxlength="1500" required minlength="10"></textarea></div>
            <button class="button button-dark form-submit" type="submit">Submit review <span>↗</span></button>
            <p class="notice">Reviews are checked before they appear publicly.</p>
          </form>`;
        } else {
          reviewForm = `<p class="notice">Reviews are available after your order for this pair has been delivered.</p>`;
        }
      }
      const reviewList = reviews.length ? reviews.map(review => `<article class="review-item"><div class="review-item-heading"><span class="product-stars" aria-label="${review.rating} out of 5">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span><time>${new Date(review.created_at).toLocaleDateString("en-PH")}</time></div>${review.title ? `<h3>${escapeHtml(review.title)}</h3>` : ""}<p>${escapeHtml(review.body)}</p><small>Verified Shoeline customer</small></article>`).join("") : `<div class="admin-empty">No approved reviews yet. Your experience can be the first.</div>`;
      $("#modalBody").innerHTML = `<div class="review-list">${reviewList}</div><div class="review-compose"><h3>Share your experience</h3>${reviewForm}</div>`;
    } catch (error) {
      $("#modalBody").innerHTML = `<div class="admin-empty">${escapeHtml(error.message || "Reviews are temporarily unavailable.")}</div>`;
      showToast(error.message || "Could not load reviews.", true);
    }
  }

  async function submitReview(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const productId = form.dataset.productId;
    const rating = Number(values.rating);
    if (!currentUserId() || !productById(productId)) throw new Error("Sign in to review this product.");
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Choose a rating from 1 to 5.");
    await dbRequest("product_reviews", {
      method: "POST",
      body: {
        product_id: productId,
        user_id: currentUserId(),
        order_id: values.order_id,
        rating,
        title: String(values.title || "").trim(),
        body: String(values.body || "").trim(),
        is_approved: false
      },
      prefer: "return=minimal"
    });
    await loadProducts();
    openModal("Thanks for sharing.", "<p>Your review has been sent to the store owner for approval.</p>", { eyebrow: "REVIEW SUBMITTED" });
  }

  function openCustomer(tab = "overview") {
    if (!state.profile) return authForm();
    if (tab === "owner" && isAdmin()) return openAdmin();
    const name = escapeHtml(state.profile.full_name || "Shoeline member");
    const email = escapeHtml(state.session?.user?.email || "");
    const tabs = [["overview", "Overview"], ["orders", "Orders"], ["returns", "Returns"], ["addresses", "Addresses"]];
    if (isAdmin()) tabs.push(["owner", "Owner dashboard"]);
    const tabMarkup = `<div class="modal-tabs">${tabs.map(([value, label]) => `<button type="button" data-action="customer" data-tab="${value}" class="${tab === value ? "active" : ""}">${label}</button>`).join("")}</div>`;
    openModal(`Hello, ${name.split(" ")[0]}.`, `${tabMarkup}<div id="customerPanel"><p>Loading your account…</p></div>`, { eyebrow: "YOUR SHOELINE / ACCOUNT" });
    renderCustomerTab(tab, email).catch(error => {
      const panel = $("#customerPanel");
      if (panel) panel.innerHTML = `<div class="empty-state"><p>${escapeHtml(error.message || "Could not load your account.")}</p></div>`;
      showToast(error.message || "Could not load your account.", true);
    });
  }

  async function renderCustomerTab(tab, email) {
    const panel = $("#customerPanel");
    if (!panel) return;
    panel.innerHTML = loadingMarkup(`Loading your ${tab}…`);
    if (tab === "overview") {
      const orders = await loadOrders();
      panel.innerHTML = `<p><strong>${escapeHtml(state.profile.full_name)}</strong><br><span class="notice">${email}</span></p><p class="notice">Your orders, saved pairs and delivery details are yours alone. Sign out from this device when you’re done.</p>${isAdmin() ? `<div class="owner-profile-card"><div><strong>Store owner</strong><small>Manage orders, products, stock and reviews.</small></div><button class="button button-dark" type="button" data-action="customer" data-tab="owner">Open dashboard <span>↗</span></button></div>` : ""}<div class="line-item"><div><strong>Recent orders</strong><small>${orders.length ? `${orders.length} order${orders.length === 1 ? "" : "s"} on your account` : "Your next favorite is just around the corner."}</small></div><button class="switch-button" type="button" data-action="customer" data-tab="orders">View orders →</button></div><div class="line-item"><div><strong>Your wishlist</strong><small>${state.wishlist.size} saved pair${state.wishlist.size === 1 ? "" : "s"}</small></div><button class="switch-button" type="button" data-action="wishlist">Open →</button></div><button class="button button-outline form-submit" type="button" data-action="signout">Sign out</button>`;
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
    stopAdminLiveUpdates();
    state.adminTab = tab;
    openModal("The store, at a glance.", `<div class="admin-shell"><aside class="admin-sidebar"><p class="admin-brand"><img src="/images/shoeline-logo.png" alt=""> SHOELINE / OWNER</p><nav class="admin-nav" aria-label="Owner dashboard">${[
      ["overview", "Overview"], ["orders", "Orders"], ["products", "Products & stock"], ["customers", "Customers"], ["reviews", "Reviews"], ["returns", "Returns"], ["quotes", "Team quotes"], ["access", "Team access"]
    ].map(([value, label]) => `<button type="button" data-action="admin-tab" data-tab="${value}" class="${state.adminTab === value ? "active" : ""}">${label}</button>`).join("")}</nav></aside><main class="admin-main"><div class="admin-live-status" id="adminLiveStatus" role="status">Connecting to live order updates…</div><div id="adminContent"><p>Loading your store…</p></div></main></div>`, { eyebrow: "PRIVATE / OWNER DASHBOARD", wide: true });
    try {
      await loadAdminData();
      renderAdmin();
      startAdminLiveUpdates();
    } catch (error) {
      $("#adminContent").innerHTML = `<div class="admin-empty">${escapeHtml(error.message || "Could not load the dashboard.")}</div>`;
    }
  }

  async function loadAdminData() {
    const [products, orders, customers, returns, quotes, reviews] = await Promise.all([
      dbRequest("products?select=id,name,sku,inventory,price,compare_at,is_active,category,brand,image_url&order=created_at.desc"),
      dbRequest("orders?select=id,order_number,status,payment_status,payment_method,total,created_at,shipping_address,customer_note,profiles(full_name),order_items(product_name,quantity,unit_price)&order=created_at.desc&limit=100"),
      dbRequest("profiles?select=id,full_name,role,created_at&order=created_at.desc&limit=100"),
      dbRequest("return_requests?select=id,reason,details,status,created_at,orders(order_number,profiles(full_name))&order=created_at.desc&limit=100"),
      dbRequest("quote_requests?select=id,organization,email,quantity,status,created_at&order=created_at.desc&limit=100"),
      dbRequest("product_reviews?select=id,product_id,rating,title,body,is_approved,created_at,profiles(full_name),products(name)&order=created_at.desc&limit=200")
    ]);
    state.adminData = { products, orders, customers, returns, quotes, reviews };
  }

  function adminTabs() {
    $$(".admin-nav button").forEach(button => button.classList.toggle("active", button.dataset.tab === state.adminTab));
  }

  function renderAdmin() {
    const target = $("#adminContent");
    if (!target || !state.adminData) return;
    const data = state.adminData;
    const pending = data.orders.filter(order => order.status === "pending");
    const metrics = `<div class="admin-metrics"><div class="metric-card"><span>Pending orders</span><strong>${pending.length}</strong></div><div class="metric-card"><span>Active pairs</span><strong>${data.products.filter(product => product.is_active).length}</strong></div><div class="metric-card"><span>Customers</span><strong>${data.customers.length}</strong></div><div class="metric-card"><span>Review queue</span><strong>${data.reviews.filter(review => !review.is_approved).length}</strong></div><div class="metric-card"><span>Team quotes</span><strong>${data.quotes.filter(quote => quote.status === "new").length}</strong></div></div>`;
    let body = "";
    if (state.adminTab === "overview") {
      body = `<div class="admin-topline"><div><h3>Good morning.</h3><p>Here’s what’s happening at Shoeline today.</p></div><span class="status-pill">Live store</span></div>${metrics}<h4>Orders to look at</h4>${renderOrderTable(pending.slice(0, 6))}`;
    } else if (state.adminTab === "orders") {
      body = `<div class="admin-topline"><div><h3>Orders</h3><p>Review and update fulfillment as it moves.</p></div></div>${renderOrderTable(data.orders)}`;
    } else if (state.adminTab === "products") {
      body = `<div class="admin-topline"><div><h3>Products & stock</h3><p>Catalog details, pricing, images and available inventory.</p></div><button class="button button-dark" type="button" data-action="new-product">Add a pair <span>+</span></button></div><div class="table-wrap"><table class="admin-table"><thead><tr><th>Pair</th><th>Price (₱)</th><th>Stock</th><th>Visibility</th><th></th></tr></thead><tbody>${data.products.map(product => `<tr data-product-row="${escapeHtml(product.id)}"><td><strong>${escapeHtml(product.name)}</strong><br><small>${escapeHtml(product.sku)}${product.image_url ? " · image ready" : " · no image"}</small></td><td><input data-product-price value="${(product.price / 100).toFixed(0)}" type="number" min="1" aria-label="Price for ${escapeHtml(product.name)}"></td><td><input data-product-stock value="${product.inventory}" type="number" min="0" aria-label="Stock for ${escapeHtml(product.name)}"></td><td><select data-product-active aria-label="Visibility for ${escapeHtml(product.name)}"><option value="true" ${product.is_active ? "selected" : ""}>Live</option><option value="false" ${!product.is_active ? "selected" : ""}>Hidden</option></select></td><td><button class="switch-button" type="button" data-action="save-product" data-id="${escapeHtml(product.id)}">Save</button></td></tr>`).join("")}</tbody></table></div>`;
    } else if (state.adminTab === "customers") {
      body = `<div class="admin-topline"><div><h3>Customers</h3><p>People who’ve made Shoeline part of their day.</p></div></div><div class="table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Role</th><th>Joined</th></tr></thead><tbody>${data.customers.map(customer => `<tr><td>${escapeHtml(customer.full_name || "Shoeline member")}</td><td>${escapeHtml(customer.role)}</td><td>${new Date(customer.created_at).toLocaleDateString("en-PH")}</td></tr>`).join("") || `<tr><td colspan="3">No customers yet.</td></tr>`}</tbody></table></div>`;
    } else if (state.adminTab === "returns") {
      body = `<div class="admin-topline"><div><h3>Returns</h3><p>Keep the experience easy, even when a pair isn’t quite right.</p></div></div>${data.returns.length ? `<div class="table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Reason</th><th>Status</th></tr></thead><tbody>${data.returns.map(request => `<tr><td>${escapeHtml(request.orders?.order_number || "—")}</td><td>${escapeHtml(request.orders?.profiles?.full_name || "Customer")}</td><td>${escapeHtml(request.reason)}</td><td>${escapeHtml(request.status)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="admin-empty">No return requests yet.</div>`}`;
    } else if (state.adminTab === "reviews") {
      body = `<div class="admin-topline"><div><h3>Product reviews</h3><p>Approve verified-purchase reviews before they appear in the storefront.</p></div></div>${data.reviews.length ? `<div class="table-wrap"><table class="admin-table"><thead><tr><th>Product / reviewer</th><th>Rating</th><th>Review</th><th>Status</th><th></th></tr></thead><tbody>${data.reviews.map(review => `<tr><td><strong>${escapeHtml(review.products?.name || "Product")}</strong><br><small>${escapeHtml(review.profiles?.full_name || "Shoeline customer")} · ${new Date(review.created_at).toLocaleDateString("en-PH")}</small></td><td><span class="product-stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span></td><td><strong>${escapeHtml(review.title || "Customer review")}</strong><br><small>${escapeHtml(review.body)}</small></td><td>${review.is_approved ? "Published" : "Needs review"}</td><td>${review.is_approved ? `<button class="switch-button" type="button" data-action="moderate-review" data-id="${escapeHtml(review.id)}" data-approved="false">Hide</button>` : `<button class="switch-button" type="button" data-action="moderate-review" data-id="${escapeHtml(review.id)}" data-approved="true">Approve</button>`} <button class="switch-button danger-link" type="button" data-action="delete-review" data-id="${escapeHtml(review.id)}">Delete</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="admin-empty">No product reviews yet.</div>`}`;
    } else if (state.adminTab === "access") {
      body = `<div class="admin-topline"><div><h3>Team access</h3><p>Grant owner access only to an existing verified account.</p></div></div><form id="adminAccessForm"><div class="field"><label for="adminAccessEmail">Account email</label><input id="adminAccessEmail" name="email" type="email" autocomplete="email" required></div><button class="button button-dark" type="submit">Grant owner access <span>↗</span></button></form><p class="notice">The account must already exist and have a confirmed email. Changes are recorded in the owner activity log.</p>`;
    } else {
      body = `<div class="admin-topline"><div><h3>Team quotes</h3><p>Bulk requests from schools, clubs and communities.</p></div></div>${data.quotes.length ? `<div class="table-wrap"><table class="admin-table"><thead><tr><th>Organization</th><th>Contact</th><th>Pairs</th><th>Status</th></tr></thead><tbody>${data.quotes.map(quote => `<tr><td>${escapeHtml(quote.organization)}</td><td>${escapeHtml(quote.email)}</td><td>${quote.quantity}</td><td>${escapeHtml(quote.status)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="admin-empty">No team requests yet.</div>`}`;
    }
    target.innerHTML = `${state.adminTab === "overview" ? "" : metrics}${body}`;
    adminTabs();
  }

  function renderOrderTable(orders) {
    if (!orders.length) return `<div class="admin-empty">No orders are waiting right now.</div>`;
    const statuses = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "refunded"];
    return `<div class="table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Customer / delivery</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${orders.map(order => {
      const address = order.shipping_address || {};
      const items = (order.order_items || []).map(item => `${item.product_name} × ${item.quantity}`).join(", ");
      const deletable = order.status === "delivered" || order.status === "cancelled";
      return `<tr><td><strong>${escapeHtml(order.order_number)}</strong><br><small>${new Date(order.created_at).toLocaleDateString("en-PH")}</small></td><td>${escapeHtml(order.profiles?.full_name || "Customer")}<br><small>${escapeHtml(address.phone || "")} · ${escapeHtml([address.city, address.region].filter(Boolean).join(", "))}</small></td><td><small>${escapeHtml(items || "No item details")}</small></td><td>${money(order.total)}</td><td><select data-order-status="${escapeHtml(order.id)}" aria-label="Order status for ${escapeHtml(order.order_number)}">${statuses.map(status => `<option value="${status}" ${status === order.status ? "selected" : ""}>${status}</option>`).join("")}</select></td><td>${deletable ? `<button class="switch-button danger-link" type="button" data-action="delete-order" data-id="${escapeHtml(order.id)}" data-order-number="${escapeHtml(order.order_number)}">Delete</button>` : "—"}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function setAdminLiveStatus(message, isError = false) {
    const status = $("#adminLiveStatus");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  async function refreshAdminOrders() {
    if (!state.adminData || state.adminRefreshInFlight || document.visibilityState !== "visible") return;
    state.adminRefreshInFlight = true;
    try {
      state.adminData.orders = await dbRequest("orders?select=id,order_number,status,payment_status,payment_method,total,created_at,shipping_address,customer_note,profiles(full_name),order_items(product_name,quantity,unit_price)&order=created_at.desc&limit=100");
      if (!state.realtimeSocket || state.realtimeSocket.readyState !== WebSocket.OPEN) {
        setAdminLiveStatus(`Auto-refresh active · updated ${new Date().toLocaleTimeString("en-PH")}`);
      }
      if (state.adminTab === "overview" || state.adminTab === "orders") renderAdmin();
    } catch (error) {
      setAdminLiveStatus(`Order refresh failed: ${error.message}`, true);
      throw error;
    } finally {
      state.adminRefreshInFlight = false;
    }
  }

  function connectAdminRealtime() {
    if (!state.adminLiveActive || !state.session?.access_token || !("WebSocket" in window)) {
      setAdminLiveStatus("Auto-refresh active · live stream unavailable");
      return;
    }
    let socket;
    try {
      const endpoint = new URL("/realtime/v1/websocket", state.config.supabaseUrl);
      endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
      endpoint.searchParams.set("apikey", state.config.supabaseAnonKey);
      endpoint.searchParams.set("vsn", "1.0.0");
      socket = new WebSocket(endpoint);
    } catch (error) {
      const delay = scheduleAdminRealtimeReconnect();
      setAdminLiveStatus(`Live order stream unavailable: ${error.message}. Retrying in ${Math.round(delay / 1000)}s; auto-refresh remains active.`, true);
      return;
    }
    state.realtimeSocket = socket;

    socket.addEventListener("open", () => {
      if (!state.adminLiveActive || socket !== state.realtimeSocket) return;
      state.realtimeRef = 1;
      socket.send(JSON.stringify({
        topic: "realtime:public:orders",
        event: "phx_join",
        payload: {
          config: {
            broadcast: { ack: false, self: false },
            presence: { enabled: false, key: "" },
            postgres_changes: [{ event: "*", schema: "public", table: "orders" }],
            private: false
          },
          access_token: state.session.access_token
        },
        ref: "1",
        join_ref: "1"
      }));
      state.realtimeHeartbeat = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        state.realtimeRef += 1;
        socket.send(JSON.stringify({
          topic: "phoenix",
          event: "heartbeat",
          payload: {},
          ref: String(state.realtimeRef),
          join_ref: null
        }));
      }, 25000);
    });

    socket.addEventListener("message", event => {
      if (socket !== state.realtimeSocket) return;
      const message = safeJson(event.data, null);
      if (!message || typeof message !== "object") {
        setAdminLiveStatus("Live order stream sent an unreadable message; auto-refresh remains active.", true);
        return;
      }
      if (message.event === "phx_reply" && message.ref === "1") {
        if (message.payload?.status === "ok") {
          state.realtimeReconnectAttempts = 0;
          setAdminLiveStatus("Live order updates connected.");
        } else {
          setAdminLiveStatus("Live order subscription was rejected; auto-refresh remains active.", true);
          socket.close(4001, "Order subscription rejected");
        }
      } else if (message.event === "postgres_changes") {
        refreshAdminOrders().catch(() => {});
      } else if (message.event === "phx_error" || message.event === "phx_close") {
        setAdminLiveStatus("Live order stream disconnected; auto-refresh remains active.", true);
        socket.close(4002, "Order subscription disconnected");
      }
    });

    socket.addEventListener("error", () => {
      if (socket !== state.realtimeSocket) return;
      setAdminLiveStatus("Live order stream unavailable; auto-refresh remains active.", true);
    });
    socket.addEventListener("close", () => {
      if (socket !== state.realtimeSocket) return;
      if (state.realtimeHeartbeat) clearInterval(state.realtimeHeartbeat);
      state.realtimeHeartbeat = null;
      state.realtimeSocket = null;
      if (!state.adminLiveActive) return;
      const delay = scheduleAdminRealtimeReconnect();
      setAdminLiveStatus(`Reconnecting to live orders in ${Math.round(delay / 1000)}s; auto-refresh remains active.`);
    });
  }

  function scheduleAdminRealtimeReconnect() {
    if (!state.adminLiveActive) return 0;
    if (state.realtimeReconnectTimer) clearTimeout(state.realtimeReconnectTimer);
    const delay = Math.min(5000 * (2 ** state.realtimeReconnectAttempts), 60000);
    state.realtimeReconnectAttempts = Math.min(state.realtimeReconnectAttempts + 1, 4);
    state.realtimeReconnectTimer = setTimeout(() => {
      state.realtimeReconnectTimer = null;
      connectAdminRealtime();
    }, delay);
    return delay;
  }

  function startAdminLiveUpdates() {
    stopAdminLiveUpdates();
    state.adminLiveActive = true;
    state.adminRefreshTimer = setInterval(() => {
      refreshAdminOrders().catch(() => {});
    }, 12000);
    connectAdminRealtime();
  }

  function syncRealtimeAccessToken() {
    const socket = state.realtimeSocket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    state.realtimeRef += 1;
    socket.send(JSON.stringify({
      topic: "realtime:public:orders",
      event: "access_token",
      payload: { access_token: state.session.access_token },
      ref: String(state.realtimeRef),
      join_ref: "1"
    }));
  }

  function stopAdminLiveUpdates() {
    state.adminLiveActive = false;
    if (state.adminRefreshTimer) clearInterval(state.adminRefreshTimer);
    if (state.realtimeHeartbeat) clearInterval(state.realtimeHeartbeat);
    if (state.realtimeReconnectTimer) clearTimeout(state.realtimeReconnectTimer);
    state.adminRefreshTimer = null;
    state.realtimeHeartbeat = null;
    state.realtimeReconnectTimer = null;
    state.realtimeReconnectAttempts = 0;
    if (state.realtimeSocket) {
      const socket = state.realtimeSocket;
      state.realtimeSocket = null;
      socket.close(1000, "Owner dashboard closed");
    }
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
          <div class="field"><label for="productCompareAt">Compare-at price (₱)</label><input id="productCompareAt" name="compare_at" type="number" min="0" value="0"></div>
          <div class="field"><label for="productStock">Starting stock</label><input id="productStock" name="inventory" type="number" min="0" value="0" required></div>
          <div class="field"><label for="productColor">Card color</label><input id="productColor" name="color" type="color" value="#e7e9f4"></div>
          <div class="field full"><label for="productDescription">Product description</label><textarea id="productDescription" name="description" maxlength="1000" required></textarea></div>
          <div class="field full"><label for="productImage">HD product photo</label><input id="productImage" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required><p class="notice">JPEG, PNG, WebP or AVIF · up to 8 MB. Use photos you own or are licensed to use.</p><img id="productImagePreview" class="product-image-preview" alt="Selected product photo preview" hidden></div>
        </div>
        <button class="button button-dark form-submit" type="submit">Add to the catalog <span>↗</span></button>
      </form>`, { eyebrow: "OWNER / PRODUCT CATALOG" });
  }

  async function uploadProductImage(file) {
    const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
    if (!extensions[file.type]) throw new Error("Choose a JPEG, PNG, WebP or AVIF image.");
    if (file.size < 1 || file.size > 8 * 1024 * 1024) throw new Error("Product images must be smaller than 8 MB.");
    if (!state.session?.access_token) throw new Error("Sign in with an owner account to upload product photos.");

    const path = `${Date.now()}-${crypto.randomUUID()}.${extensions[file.type]}`;
    const response = await fetch(`${state.config.supabaseUrl}/storage/v1/object/shoeline-product-images/${path}`, {
      method: "POST",
      headers: {
        apikey: state.config.supabaseAnonKey,
        Authorization: `Bearer ${state.session.access_token}`,
        "Content-Type": file.type,
        "x-upsert": "false"
      },
      body: file
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "The product image could not be uploaded.");
    return {
      path,
      url: `${state.config.supabaseUrl}/storage/v1/object/public/shoeline-product-images/${encodeURIComponent(path)}`
    };
  }

  async function removeProductImage(path) {
    const response = await fetch(`${state.config.supabaseUrl}/storage/v1/object/shoeline-product-images`, {
      method: "DELETE",
      headers: {
        apikey: state.config.supabaseAnonKey,
        Authorization: `Bearer ${state.session.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prefixes: [path] })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "The unused product image could not be removed.");
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
    await dbRequest("rpc/admin_update_order_status", {
      method: "POST",
      body: { p_order_id: orderId, p_status: status }
    });
    await loadAdminData();
    renderAdmin();
    showToast("Order status updated.");
  }

  async function deleteOrder(orderId, orderNumber) {
    const order = state.adminData?.orders.find(item => item.id === orderId);
    if (!order || !["delivered", "cancelled"].includes(order.status)) {
      throw new Error("Only delivered or cancelled orders can be deleted.");
    }
    if (!window.confirm(`Permanently delete ${orderNumber || order.order_number}? This cannot be undone.`)) return;
    await dbRequest("rpc/admin_delete_order", {
      method: "POST",
      body: { p_order_id: orderId }
    });
    await loadAdminData();
    renderAdmin();
    showToast("Order deleted.");
  }

  async function moderateReview(reviewId, isApproved) {
    await dbRequest(`product_reviews?id=eq.${encodeURIComponent(reviewId)}`, {
      method: "PATCH",
      body: { is_approved: isApproved },
      prefer: "return=minimal"
    });
    await Promise.all([loadAdminData(), loadProducts()]);
    renderAdmin();
    showToast(isApproved ? "Review published." : "Review hidden.");
  }

  async function deleteReview(reviewId) {
    if (!window.confirm("Permanently delete this review?")) return;
    await dbRequest(`product_reviews?id=eq.${encodeURIComponent(reviewId)}`, { method: "DELETE" });
    await Promise.all([loadAdminData(), loadProducts()]);
    renderAdmin();
    showToast("Review deleted.");
  }

  async function grantAdminAccess(email) {
    await dbRequest("rpc/admin_grant_user_admin", {
      method: "POST",
      body: { p_email: email.trim() }
    });
    await loadAdminData();
    renderAdmin();
    showToast("Owner access granted to the verified account.");
  }

  async function createProduct(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const price = Number(values.price);
    const compareAt = Number(values.compare_at || 0);
    const inventory = Number(values.inventory);
    const file = form.elements.image.files[0];
    if (!Number.isFinite(price) || price < 1 || !Number.isFinite(compareAt) || compareAt < 0 || !Number.isInteger(inventory) || inventory < 0) throw new Error("Enter a valid price and stock quantity.");
    if (!file) throw new Error("Choose a product image before adding this pair.");
    const slug = `${values.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
    const image = await uploadProductImage(file);
    try {
      const created = await dbRequest("products?select=id", {
        method: "POST",
        body: {
          sku: values.sku.trim(),
          slug,
          name: values.name.trim(),
          brand: values.brand.trim(),
          category: values.category.trim(),
          audience: values.audience,
          description: values.description.trim(),
          price: Math.round(price * 100),
          compare_at: Math.round(compareAt * 100),
          inventory,
          image_url: image.url,
          color: values.color,
          icon: "👟",
          badge: "JUST IN",
          is_new: true,
          is_active: true
        },
        prefer: "return=representation"
      });
      if (!created?.[0]?.id) throw new Error("The product was not returned after saving.");
    } catch (error) {
      try {
        await removeProductImage(image.path);
      } catch (cleanupError) {
        throw new Error(`${error.message} The uploaded photo also could not be cleaned up: ${cleanupError.message}`);
      }
      throw error;
    }

    await loadProducts();
    closeModal();
    await openAdmin("products");
    showToast("Your new pair is live.");
  }

  function registerHandlers() {
    document.addEventListener("click", event => {
      const target = event.target.closest(".site-nav a, #filters [role='tab'], .modal-tabs [data-action='customer'], .admin-nav [data-action='admin-tab']");
      if (!target) return;
      const label = target.textContent.trim().replace(/\s+/g, " ");
      showNavigationPreview(`Loading ${label}…`);
    }, true);

    $("#backgroundMusic").addEventListener("play", () => {
      const button = $("#musicToggle");
      button.setAttribute("aria-pressed", "true");
      button.setAttribute("aria-label", "Pause background music");
      $(".music-label", button).textContent = "Pause music";
      button.classList.add("playing");
    });

    $("#backgroundMusic").addEventListener("pause", () => {
      const button = $("#musicToggle");
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", "Play background music");
      $(".music-label", button).textContent = "Play music";
      button.classList.remove("playing");
    });

    $("#backgroundMusic").addEventListener("error", () => {
      showToast("The background music file could not be loaded.", true);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.adminLiveActive) {
        refreshAdminOrders().catch(() => {});
      }
    });

    document.addEventListener("click", async event => {
      const button = event.target.closest("[data-action]");
      if (button) {
        const { action, id, tab, mode, delta } = button.dataset;
        try {
          if (action === "close-modal") closeModal();
          else if (action === "account") state.profile ? openCustomer() : authForm();
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
          else if (action === "music-toggle") await toggleBackgroundMusic();
          else if (action === "toggle-wish") await toggleWishlist(id);
          else if (action === "product-reviews") await openProductReviews(id);
          else if (action === "quote") openQuote();
          else if (action === "customer") openCustomer(tab);
          else if (action === "admin-tab") {
            state.adminTab = tab;
            renderAdmin();
          }
          else if (action === "new-product") newProductForm();
          else if (action === "save-product") await saveProduct(id);
          else if (action === "delete-order") await deleteOrder(id, button.dataset.orderNumber);
          else if (action === "moderate-review") await moderateReview(id, button.dataset.approved === "true");
          else if (action === "delete-review") await deleteReview(id);
        } catch (error) {
          showToast(error.message || "That didn’t work. Please try again.", true);
        }
      }

      const filterButton = event.target.closest("[data-filter]");
      if (filterButton) setFilter(filterButton.dataset.filter);

    });

    document.addEventListener("submit", async event => {
      const form = event.target;
      if (!form.matches("form")) return;
      event.preventDefault();
      try {
        if (form.id === "searchForm") {
          renderProducts();
          $("#shop").scrollIntoView({ behavior: "smooth" });
        } else if (form.id === "storeSearchForm") {
          const query = $("#storeSearchInput").value.trim();
          const encodedQuery = encodeURIComponent(query);
          $("#storeMap").src = `https://www.google.com/maps?q=${encodedQuery}&output=embed`;
          $("#storeDirections").href = `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`;
          showNavigationPreview("Finding that place on the map…");
        } else if (form.id === "authForm") {
          const data = new FormData(form);
          if (form.dataset.mode === "register") {
            const confirmed = await signUp(data.get("name").trim(), data.get("email").trim(), data.get("password"));
            if (!confirmed) authForm("login", "Email confirmation is enabled for this store. Confirm your email, then sign in.");
            else {
              closeModal();
              openCustomer("overview");
              showToast("Welcome to the Shoeline club.");
            }
          } else {
            await signIn(data.get("email").trim(), data.get("password"));
            closeModal();
            openCustomer("overview");
            showToast("Welcome back.");
          }
        } else if (form.id === "checkoutForm") {
          await placeOrder(form);
        } else if (form.id === "returnForm") {
          await submitReturn(form);
        } else if (form.id === "quoteForm") {
          await submitQuote(form);
        } else if (form.id === "reviewForm") {
          await submitReview(form);
        } else if (form.id === "adminAccessForm") {
          const email = new FormData(form).get("email");
          await grantAdminAccess(email);
        } else if (form.id === "productForm") {
          await createProduct(form);
        }
      } catch (error) {
        showToast(error.message || "We couldn’t complete that request.", true);
      }
    });

    document.addEventListener("change", async event => {
      const select = event.target.closest("[data-order-status]");
      if (select) {
        try { await updateOrder(select.dataset.orderStatus, select.value); }
        catch (error) { showToast(error.message || "Could not update the order.", true); }
        return;
      }
      if (event.target.id === "productImage" && event.target.files?.[0]) {
        if (state.productPreviewUrl) URL.revokeObjectURL(state.productPreviewUrl);
        state.productPreviewUrl = URL.createObjectURL(event.target.files[0]);
        const preview = $("#productImagePreview");
        preview.src = state.productPreviewUrl;
        preview.hidden = false;
      }
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

    const heroArt = $(".hero-art");
    if (heroArt && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      heroArt.addEventListener("pointermove", event => {
        const bounds = heroArt.getBoundingClientRect();
        heroArt.style.setProperty("--pointer-x", `${((event.clientX - bounds.left) / bounds.width - 0.5) * 18}px`);
        heroArt.style.setProperty("--pointer-y", `${((event.clientY - bounds.top) / bounds.height - 0.5) * 14}px`);
      });
      heroArt.addEventListener("pointerleave", () => {
        heroArt.style.removeProperty("--pointer-x");
        heroArt.style.removeProperty("--pointer-y");
      });
    }

    document.addEventListener("keydown", event => {
      const currentTab = event.target.closest?.('#filters [role="tab"]');
      if (currentTab && ["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
        const tabs = $$('#filters [role="tab"]');
        const currentIndex = tabs.indexOf(currentTab);
        const nextIndex = event.key === "Home" ? 0
          : event.key === "End" ? tabs.length - 1
            : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        tabs[nextIndex].focus();
        setFilter(tabs[nextIndex].dataset.filter);
      }
      if (event.key === "Escape") closeModal();
    });
  }

  async function initialize() {
    registerHandlers();
    tryAutoplayBackgroundMusic();
    initializeMotion();
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
      $("#productGrid").setAttribute("aria-busy", "false");
      showToast(error.message || "Could not connect to Shoeline.", true);
    }
  }

  initialize();
})();
