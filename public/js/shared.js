// /corner-barr/js/shared.js
//
// Everything on this page that appears on every page of the site:
// the cart, checkout + PayPal, accounts/login, wishlist, order history,
// and the owner's "Manage Shop" admin panel. shop.js and product.js
// both load this first and call initShared() before doing their own
// page-specific rendering.


/* =========================================
   SHARED DOM ELEMENTS
   (populated by cacheSharedDom(), called after the header/modals
   partials have been injected into the page — see partials.js)
========================================= */

let cartButton, cartDrawer, cartOverlay, closeCartButton, cartItemsContainer,
    cartTotal, cartCount;

let checkoutButton, checkoutModal, closeCheckoutButton, checkoutTotal,
    checkoutForm, checkoutError, paypalButtonContainer, checkoutFormFields,
    orderConfirmation, shippingOptionsContainer;

let accountButton, manageShopButton, accountModal, closeAccountButton,
    accountLoggedOut, accountLoggedIn, accountForm, accountEmailInput,
    accountPasswordInput, togglePasswordVisibility, passwordEyeIcon,
    accountError, accountFormTitle, accountSubmitButton, accountToggleText,
    accountToggleMode, accountEmailDisplay, logoutButton, myOrdersList,
    myWishlistList, myPaymentMethodsList, savePaypalButtonContainer;

let savedPaymentMethodsSection, savedPaymentMethodsList, saveWalletOption,
    saveWalletCheckbox;

let adminModal, closeAdminButton, adminError, adminTabListings, adminTabOrders,
    adminTabShipping, adminListingsSection, adminOrdersSection,
    adminShippingSection, adminOrdersList, adminProductList, adminProductForm,
    adminProductId, adminCategory, adminName, adminDescription, adminPrice,
    adminStock, adminDropZone, adminImagePreview, adminDropZoneText, adminImageInput,
    adminExtraPhotosLocked, adminExtraPhotosManager, adminExtraPhotosList,
    adminExtraDropZone, adminExtraImageInput,
    adminCancelEdit, adminSaveButton, adminFormTitle;

let adminShippingMethodsList, adminShippingMethodForm, adminShippingMethodId,
    adminShippingName, adminShippingPrice, adminShippingDaysMin,
    adminShippingDaysMax, adminShippingCancelEdit, adminShippingSaveButton,
    adminCategoryThresholdsList;

let adminTags;

let siteSearchInput, siteSearchClear, siteSearchResults;

let notificationBellButton, notificationBadge, notificationPanel,
    notificationList, markAllNotificationsRead;


// The customer's shopping cart. Populated from localStorage by loadCart()
// during initShared(). Every page that loads shared.js shares this single
// in-memory array.
let cart = [];


function cacheSharedDom() {

    cartButton = document.getElementById("cartButton");
    cartDrawer = document.getElementById("cartDrawer");
    cartOverlay = document.getElementById("cartOverlay");
    closeCartButton = document.getElementById("closeCart");
    cartItemsContainer = document.getElementById("cartItems");
    cartTotal = document.getElementById("cartTotal");
    cartCount = document.getElementById("cartCount");

    checkoutButton = document.getElementById("checkoutButton");
    checkoutModal = document.getElementById("checkoutModal");
    closeCheckoutButton = document.getElementById("closeCheckout");
    checkoutTotal = document.getElementById("checkoutTotal");
    checkoutForm = document.getElementById("checkoutForm");
    checkoutError = document.getElementById("checkoutError");
    paypalButtonContainer = document.getElementById("paypal-button-container");
    checkoutFormFields = document.getElementById("checkoutFormFields");
    orderConfirmation = document.getElementById("orderConfirmation");
    shippingOptionsContainer = document.getElementById("shippingOptions");

    accountButton = document.getElementById("accountButton");
    manageShopButton = document.getElementById("manageShopButton");
    accountModal = document.getElementById("accountModal");
    closeAccountButton = document.getElementById("closeAccount");
    accountLoggedOut = document.getElementById("accountLoggedOut");
    accountLoggedIn = document.getElementById("accountLoggedIn");
    accountForm = document.getElementById("accountForm");
    accountEmailInput = document.getElementById("accountEmail");
    accountPasswordInput = document.getElementById("accountPassword");
    togglePasswordVisibility = document.getElementById("togglePasswordVisibility");
    passwordEyeIcon = document.getElementById("passwordEyeIcon");
    accountError = document.getElementById("accountError");
    accountFormTitle = document.getElementById("accountFormTitle");
    accountSubmitButton = document.getElementById("accountSubmitButton");
    accountToggleText = document.getElementById("accountToggleText");
    accountToggleMode = document.getElementById("accountToggleMode");
    accountEmailDisplay = document.getElementById("accountEmailDisplay");
    logoutButton = document.getElementById("logoutButton");
    myOrdersList = document.getElementById("myOrdersList");
    myWishlistList = document.getElementById("myWishlistList");
    myPaymentMethodsList = document.getElementById("myPaymentMethodsList");
    savePaypalButtonContainer = document.getElementById("savePaypalButtonContainer");

    savedPaymentMethodsSection = document.getElementById("savedPaymentMethodsSection");
    savedPaymentMethodsList = document.getElementById("savedPaymentMethodsList");
    saveWalletOption = document.getElementById("saveWalletOption");
    saveWalletCheckbox = document.getElementById("saveWalletCheckbox");

    adminModal = document.getElementById("adminModal");
    closeAdminButton = document.getElementById("closeAdmin");
    adminError = document.getElementById("adminError");
    adminTabListings = document.getElementById("adminTabListings");
    adminTabOrders = document.getElementById("adminTabOrders");
    adminTabShipping = document.getElementById("adminTabShipping");
    adminListingsSection = document.getElementById("adminListingsSection");
    adminOrdersSection = document.getElementById("adminOrdersSection");
    adminShippingSection = document.getElementById("adminShippingSection");
    adminOrdersList = document.getElementById("adminOrdersList");
    adminProductList = document.getElementById("adminProductList");
    adminProductForm = document.getElementById("adminProductForm");
    adminProductId = document.getElementById("adminProductId");
    adminCategory = document.getElementById("adminCategory");
    adminName = document.getElementById("adminName");
    adminDescription = document.getElementById("adminDescription");
    adminPrice = document.getElementById("adminPrice");
    adminStock = document.getElementById("adminStock");
    adminTags = document.getElementById("adminTags");
    adminDropZone = document.getElementById("adminDropZone");
    adminImagePreview = document.getElementById("adminImagePreview");
    adminDropZoneText = document.getElementById("adminDropZoneText");
    adminImageInput = document.getElementById("adminImageInput");
    adminExtraPhotosLocked = document.getElementById("adminExtraPhotosLocked");
    adminExtraPhotosManager = document.getElementById("adminExtraPhotosManager");
    adminExtraPhotosList = document.getElementById("adminExtraPhotosList");
    adminExtraDropZone = document.getElementById("adminExtraDropZone");
    adminExtraImageInput = document.getElementById("adminExtraImageInput");
    adminCancelEdit = document.getElementById("adminCancelEdit");
    adminSaveButton = document.getElementById("adminSaveButton");
    adminFormTitle = document.getElementById("adminFormTitle");

    adminShippingMethodsList = document.getElementById("adminShippingMethodsList");
    adminShippingMethodForm = document.getElementById("adminShippingMethodForm");
    adminShippingMethodId = document.getElementById("adminShippingMethodId");
    adminShippingName = document.getElementById("adminShippingName");
    adminShippingPrice = document.getElementById("adminShippingPrice");
    adminShippingDaysMin = document.getElementById("adminShippingDaysMin");
    adminShippingDaysMax = document.getElementById("adminShippingDaysMax");
    adminShippingCancelEdit = document.getElementById("adminShippingCancelEdit");
    adminShippingSaveButton = document.getElementById("adminShippingSaveButton");
    adminCategoryThresholdsList = document.getElementById("adminCategoryThresholdsList");

    siteSearchInput = document.getElementById("siteSearchInput");
    siteSearchClear = document.getElementById("siteSearchClear");
    siteSearchResults = document.getElementById("siteSearchResults");

    notificationBellButton = document.getElementById("notificationBellButton");
    notificationBadge = document.getElementById("notificationBadge");
    notificationPanel = document.getElementById("notificationPanel");
    notificationList = document.getElementById("notificationList");
    markAllNotificationsRead = document.getElementById("markAllNotificationsRead");

}


function money(value) {

    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD"
    }).format(value);

}


// Anything at or below this shows "Only N left!" instead of a plain
// "In Stock" — low enough to create real urgency, high enough that it
// isn't screaming about every routine restock level.
const LOW_STOCK_THRESHOLD = 5;

function getStockStatus(stock) {

    const quantity = Number(stock);

    if (!Number.isFinite(quantity) || quantity <= 0) {
        return { label: "Out of Stock", className: "stock-status-out", outOfStock: true, quantity: 0 };
    }

    if (quantity <= LOW_STOCK_THRESHOLD) {
        return {
            label: `Only ${quantity} left!`,
            className: "stock-status-low",
            outOfStock: false,
            quantity
        };
    }

    return { label: "In Stock", className: "stock-status-in", outOfStock: false, quantity };

}


function stockStatusMarkup(stock) {
    const status = getStockStatus(stock);
    return `<span class="stock-status ${status.className}">${escapeHtml(status.label)}</span>`;
}


/* =========================================
   LOCAL STORAGE (cart persistence)
========================================= */

function loadCart() {

    const savedCart = localStorage.getItem("cornerBarrCart");

    if (!savedCart) {
        return;
    }

    try {
        cart = JSON.parse(savedCart);
    } catch (error) {
        console.error("Could not load saved cart.", error);
        cart = [];
    }

}


function saveCart() {
    localStorage.setItem("cornerBarrCart", JSON.stringify(cart));
}


/* =========================================
   CUTTING BOARD PRODUCTS
========================================= */

function addStandardProductToCart(product, category) {

    const item = {

        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,

        productId: product.id,
        category, // "soap" | "holiday"

        name: product.name,
        price: product.price, // used for on-screen display only; server re-verifies
        quantity: 1,

        engraving: "",
        style: "",
        giftMessage: ""

    };

    cart.push(item);

    saveCart();
    renderCart();
    openCart();

}


function renderCart() {

    cartItemsContainer.innerHTML = "";

    if (cart.length === 0) {

        cartItemsContainer.innerHTML = `
            <div class="empty-cart">
                Your cart is empty.
                <br><br>
                Choose something handmade and make it yours.
            </div>
        `;

        cartTotal.textContent = money(0);
        cartCount.textContent = "0";

        checkoutButton.disabled = true;
        checkoutButton.style.opacity = "0.5";

        return;

    }

    checkoutButton.disabled = false;
    checkoutButton.style.opacity = "1";

    let total = 0;
    let quantity = 0;

    cart.forEach(item => {

        total += item.price * item.quantity;
        quantity += item.quantity;

        const element = document.createElement("div");
        element.className = "cart-item";

        const engraving = item.engraving
            ? `Engraving: ${escapeHtml(item.engraving)}`
            : "No engraving";

        const details = [item.style, engraving]
            .filter(Boolean)
            .map(escapeHtml)
            .join("<br>");

        const gift = item.giftMessage ? "<br>Gift message included" : "";

        element.innerHTML = `
            <div class="cart-item-image"></div>

            <div>
                <div class="cart-item-name">${escapeHtml(item.name)}</div>

                <div class="cart-item-details">
                    ${details}
                    ${gift}
                </div>

                <div class="quantity-controls">
                    <button type="button" data-minus="${item.id}">−</button>
                    <span>${item.quantity}</span>
                    <button type="button" data-plus="${item.id}">+</button>
                </div>

                <button class="remove-item" type="button" data-remove="${item.id}">
                    Remove
                </button>
            </div>

            <div class="cart-item-price">
                ${money(item.price * item.quantity)}
            </div>
        `;

        cartItemsContainer.appendChild(element);

    });

    cartTotal.textContent = money(total);
    cartCount.textContent = quantity.toString();

    attachCartEvents();

}


/* =========================================
   CART EVENTS
========================================= */

function attachCartEvents() {

    document.querySelectorAll("[data-minus]").forEach(button => {
        button.addEventListener("click", () => changeQuantity(button.dataset.minus, -1));
    });

    document.querySelectorAll("[data-plus]").forEach(button => {
        button.addEventListener("click", () => changeQuantity(button.dataset.plus, 1));
    });

    document.querySelectorAll("[data-remove]").forEach(button => {
        button.addEventListener("click", () => removeCartItem(button.dataset.remove));
    });

}


function changeQuantity(itemId, amount) {

    const item = cart.find(cartItem => cartItem.id === itemId);

    if (!item) {
        return;
    }

    // Soft, UX-only cap — the real enforcement happens server-side at
    // checkout regardless, since stock can change after this was added.
    if (amount > 0 && typeof item.availableStock === "number" && item.quantity + amount > item.availableStock) {
        alert(
            item.availableStock <= 0
                ? `Sorry, "${item.name}" is out of stock.`
                : `Sorry, only ${item.availableStock} of "${item.name}" ${item.availableStock === 1 ? "is" : "are"} available.`
        );
        return;
    }

    item.quantity += amount;

    if (item.quantity <= 0) {
        cart = cart.filter(cartItem => cartItem.id !== itemId);
    }

    saveCart();
    renderCart();
    refreshCheckoutIfOpen();

}


function removeCartItem(itemId) {

    cart = cart.filter(item => item.id !== itemId);

    saveCart();
    renderCart();
    refreshCheckoutIfOpen();

}


/* =========================================
   CART DRAWER
========================================= */

function openCart() {
    cartDrawer.classList.add("open");
    cartOverlay.classList.add("open");
    document.body.style.overflow = "hidden";
}


function closeCart() {
    cartDrawer.classList.remove("open");
    cartOverlay.classList.remove("open");
    document.body.style.overflow = "";
}


/* =========================================
   SHIPPING
========================================= */


// Mirrors the same mapping used server-side (data/pricing.js) — this
// copy is for display purposes only; the server always re-verifies.
const CART_CATEGORY_TO_DB_CATEGORY = {
    custom: "cutting_board",
    board: "cutting_board",
    soap: "soap_candle",
    holiday: "holiday",
    resin: "resin_craft",
    jewelry: "jewelry"
};

let shippingMethods = [];
let categoryShippingThresholds = [];
let shippingDataLoaded = false;
let selectedShippingMethodId = null;


async function loadShippingData() {

    if (shippingDataLoaded) {
        return;
    }

    const response = await fetch("/api/shipping");
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Could not load shipping options.");
    }

    shippingMethods = data.methods;
    categoryShippingThresholds = data.thresholds;
    shippingDataLoaded = true;

    if (shippingMethods.length > 0) {
        selectedShippingMethodId = shippingMethods[0].id;
    }

}


function computeCartCategoryTotals() {

    const totals = {};

    cart.forEach(item => {
        const dbCategory = CART_CATEGORY_TO_DB_CATEGORY[item.category];
        totals[dbCategory] = (totals[dbCategory] || 0) + item.price * item.quantity;
    });

    return totals;

}


function isFreeShippingEligible() {

    const totals = computeCartCategoryTotals();
    const categories = Object.keys(totals);

    if (categories.length === 0) {
        return false;
    }

    return categories.every(category => {

        const setting = categoryShippingThresholds.find(row => row.category === category);
        const threshold = setting ? setting.free_shipping_threshold : null;

        return threshold !== null && threshold !== undefined && totals[category] >= Number(threshold);

    });

}


function getShippingCost() {

    if (isFreeShippingEligible()) {
        return 0;
    }

    const method = shippingMethods.find(m => m.id === selectedShippingMethodId);
    return method ? Number(method.price) : 0;

}


function renderShippingOptions() {

    const isFree = isFreeShippingEligible();

    if (isFree) {
        shippingOptionsContainer.innerHTML = `
            <div class="shipping-free-banner">🎉 Your order qualifies for free shipping!</div>
        `;
        updateCheckoutTotalDisplay();
        return;
    }

    if (shippingMethods.length === 0) {
        shippingOptionsContainer.innerHTML = `<p class="checkout-note">No shipping methods are set up yet.</p>`;
        return;
    }

    if (!shippingMethods.some(m => m.id === selectedShippingMethodId)) {
        selectedShippingMethodId = shippingMethods[0].id;
    }

    shippingOptionsContainer.innerHTML = shippingMethods.map(method => {

        const days = (method.estimated_days_min && method.estimated_days_max)
            ? `(${method.estimated_days_min}–${method.estimated_days_max} days)`
            : "";

        return `
            <label class="shipping-option-row">
                <input type="radio" name="shippingMethod" value="${method.id}" ${method.id === selectedShippingMethodId ? "checked" : ""}>
                <div class="shipping-option-main">
                    <span>
                        <span class="shipping-option-name">${escapeHtml(method.name)}</span>
                        <span class="shipping-option-days">${days}</span>
                    </span>
                    <span class="shipping-option-price">${money(Number(method.price))}</span>
                </div>
            </label>
        `;

    }).join("");

    shippingOptionsContainer.querySelectorAll('input[name="shippingMethod"]').forEach(input => {
        input.addEventListener("change", () => {
            selectedShippingMethodId = input.value;
            updateCheckoutTotalDisplay();
        });
    });

    updateCheckoutTotalDisplay();

}


function updateCheckoutTotalDisplay() {
    checkoutTotal.textContent = money(cartTotalAmount() + getShippingCost());
}


/* =========================================
   CHECKOUT / PAYPAL
========================================= */

let paypalScriptLoaded = false;
let paypalButtonsRendered = false;

function cartTotalAmount() {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}


function refreshCheckoutIfOpen() {

    if (!checkoutModal.classList.contains("open")) {
        return;
    }

    if (cart.length === 0) {
        closeCheckout();
        return;
    }

    if (shippingDataLoaded) {
        renderShippingOptions();
    } else {
        checkoutTotal.textContent = money(cartTotalAmount());
    }

}


function showCheckoutError(message) {
    checkoutError.textContent = message;
    checkoutError.classList.add("visible");
}


function clearCheckoutError() {
    checkoutError.textContent = "";
    checkoutError.classList.remove("visible");
}


async function loadPayPalScript() {

    if (paypalScriptLoaded) {
        return;
    }

    const configResponse = await fetch("/api/config");
    const config = await configResponse.json();

    if (!config.paypalClientId) {
        showCheckoutError(
            "Online payments aren't configured yet. Add your PayPal credentials to .env on the server."
        );
        return;
    }

    await new Promise((resolve, reject) => {

        const script = document.createElement("script");

        script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypalClientId)}&currency=USD`;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Could not load PayPal."));

        document.head.appendChild(script);

    });

    paypalScriptLoaded = true;

}


function renderPayPalButtons() {

    if (paypalButtonsRendered || typeof paypal === "undefined") {
        return;
    }

    paypalButtonsRendered = true;

    paypal.Buttons({

        style: {
            layout: "vertical",
            shape: "rect"
        },

        onClick: (data, actions) => {

            clearCheckoutError();

            if (!checkoutForm.reportValidity()) {
                return actions.reject();
            }

            return actions.resolve();

        },

        createOrder: async () => {

            clearCheckoutError();

            const customer = {
                name: document.getElementById("customerName").value.trim(),
                email: document.getElementById("customerEmail").value.trim(),
                phone: document.getElementById("customerPhone").value.trim(),
                notes: document.getElementById("customerNotes").value.trim(),
                address1: document.getElementById("customerAddress1").value.trim(),
                address2: document.getElementById("customerAddress2").value.trim(),
                city: document.getElementById("customerCity").value.trim(),
                state: document.getElementById("customerState").value.trim(),
                zip: document.getElementById("customerZip").value.trim()
            };

            const shippingMethodId = isFreeShippingEligible() ? null : selectedShippingMethodId;
            const saveWallet = currentSession ? saveWalletCheckbox.checked : false;

            const response = await fetch("/api/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ cart, customer, shippingMethodId, saveWallet })
            });

            const order = await response.json();

            if (!response.ok) {
                throw new Error(order.error || "Could not start checkout.");
            }

            return order.id;

        },

        onApprove: async (data) => {

            const customer = {
                name: document.getElementById("customerName").value.trim(),
                email: document.getElementById("customerEmail").value.trim(),
                phone: document.getElementById("customerPhone").value.trim(),
                notes: document.getElementById("customerNotes").value.trim(),
                address1: document.getElementById("customerAddress1").value.trim(),
                address2: document.getElementById("customerAddress2").value.trim(),
                city: document.getElementById("customerCity").value.trim(),
                state: document.getElementById("customerState").value.trim(),
                zip: document.getElementById("customerZip").value.trim()
            };

            const shippingMethodId = isFreeShippingEligible() ? null : selectedShippingMethodId;

            const response = await fetch(`/api/orders/${data.orderID}/capture`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ cart, customer, shippingMethodId })
            });

            const details = await response.json();

            if (!response.ok) {
                throw new Error(details.error || "Payment could not be completed.");
            }

            showOrderConfirmation(details);

            cart = [];
            saveCart();
            renderCart();

            if (currentSession) {
                loadMyOrders();
                syncPendingPaymentMethods();
            }

        },

        onCancel: () => {
            showCheckoutError("Checkout was cancelled. Your cart has been saved.");
        },

        onError: (err) => {
            console.error(err);
            showCheckoutError("Something went wrong processing your payment. Please try again.");
        }

    }).render("#paypal-button-container");

}


function showOrderConfirmation(details) {

    checkoutFormFields.style.display = "none";
    paypalButtonContainer.style.display = "none";

    const payerName =
        details && details.payer && details.payer.name
            ? details.payer.name.given_name
            : "";

    orderConfirmation.innerHTML = `
        <p class="eyebrow">ORDER CONFIRMED</p>
        <h2>Thank you${payerName ? `, ${escapeHtml(payerName)}` : ""}!</h2>
        <p class="checkout-note">
            Your order has been received. A confirmation was processed
            through PayPal${details && details.id ? ` (reference ${escapeHtml(details.id)})` : ""}.
        </p>
    `;

    orderConfirmation.style.display = "block";

}


function resetCheckoutModal() {

    checkoutFormFields.style.display = "";
    paypalButtonContainer.style.display = "";
    orderConfirmation.style.display = "none";
    orderConfirmation.innerHTML = "";

    saveWalletCheckbox.checked = false;
    savedPaymentMethodsSection.classList.add("hidden");

    clearCheckoutError();

}


async function openCheckout() {

    if (cart.length === 0) {
        return;
    }

    resetCheckoutModal();

    checkoutTotal.textContent = money(cartTotalAmount());

    checkoutModal.classList.add("open");

    try {

        await loadShippingData();
        renderShippingOptions();

        if (currentSession) {
            saveWalletOption.classList.remove("hidden");
            await loadSavedMethodsForCheckout();
        } else {
            saveWalletOption.classList.add("hidden");
            savedPaymentMethodsSection.classList.add("hidden");
        }

        await loadPayPalScript();
        renderPayPalButtons();

    } catch (err) {
        console.error(err);
        showCheckoutError("Could not load checkout. Check your connection and try again.");
    }

}


async function loadSavedMethodsForCheckout() {

    try {

        const response = await fetch("/api/saved-payment-methods", { headers: authHeaders() });
        const methods = await response.json();

        if (!response.ok || methods.length === 0) {
            savedPaymentMethodsSection.classList.add("hidden");
            return;
        }

        savedPaymentMethodsSection.classList.remove("hidden");

        savedPaymentMethodsList.innerHTML = methods.map(method => {

            const label = method.method_type === "card"
                ? `${escapeHtml(method.card_brand || "Card")} ending in ${escapeHtml(method.card_last4 || "****")}`
                : `PayPal${method.paypal_email ? ` (${escapeHtml(method.paypal_email)})` : ""}`;

            return `
                <button type="button" class="saved-payment-method-button" data-pay-with-saved="${method.id}">
                    Pay with ${label}
                </button>
            `;

        }).join("");

        savedPaymentMethodsList.querySelectorAll("[data-pay-with-saved]").forEach(button => {
            button.addEventListener("click", () => payWithSavedMethod(button.dataset.payWithSaved, button));
        });

    } catch (err) {
        console.error(err);
        savedPaymentMethodsSection.classList.add("hidden");
    }

}


async function payWithSavedMethod(savedMethodId, button) {

    clearCheckoutError();

    if (!checkoutForm.reportValidity()) {
        return;
    }

    button.disabled = true;
    button.textContent = "Processing…";

    try {

        const customer = {
            name: document.getElementById("customerName").value.trim(),
            email: document.getElementById("customerEmail").value.trim(),
            phone: document.getElementById("customerPhone").value.trim(),
            notes: document.getElementById("customerNotes").value.trim(),
            address1: document.getElementById("customerAddress1").value.trim(),
            address2: document.getElementById("customerAddress2").value.trim(),
            city: document.getElementById("customerCity").value.trim(),
            state: document.getElementById("customerState").value.trim(),
            zip: document.getElementById("customerZip").value.trim()
        };

        const shippingMethodId = isFreeShippingEligible() ? null : selectedShippingMethodId;

        const response = await fetch("/api/orders/pay-with-saved", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ cart, customer, shippingMethodId, savedMethodId })
        });

        const details = await response.json();

        if (!response.ok) {

            if (details.requiresInteractiveCheckout) {
                showCheckoutError(details.error);
                return;
            }

            throw new Error(details.error || "Payment could not be completed.");

        }

        showOrderConfirmation(details);

        cart = [];
        saveCart();
        renderCart();
        loadMyOrders();

    } catch (err) {
        showCheckoutError(err.message || "Payment could not be completed. Please try again.");
    } finally {
        button.disabled = false;
        loadSavedMethodsForCheckout();
    }

}


function closeCheckout() {
    checkoutModal.classList.remove("open");
}


/* =========================================
   ACCOUNTS (Supabase Auth)
========================================= */

let supabaseClient = null;
let currentSession = null;
let currentRole = "customer";
let isSignUpMode = false;

async function initSupabaseAuth() {

    const response = await fetch("/api/config");
    const config = await response.json();

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
        console.warn("Supabase isn't configured yet — accounts and the admin panel are disabled.");
        return;
    }

    supabaseClient = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

    const { data: { session } } = await supabaseClient.auth.getSession();
    await handleAuthChange(session);

    supabaseClient.auth.onAuthStateChange((_event, session) => {
        handleAuthChange(session);
    });

}


async function handleAuthChange(session) {

    currentSession = session;

    if (!session) {
        currentRole = "customer";
        showLoggedOutView();
        updateOwnerUI();
        return;
    }

    try {

        const response = await fetch("/api/me", {
            headers: { Authorization: `Bearer ${session.access_token}` }
        });

        const me = await response.json();

        currentRole = me.role || "customer";
        showLoggedInView(me.email || session.user.email);

    } catch (err) {
        console.error(err);
        currentRole = "customer";
    }

    updateOwnerUI();

}


function updateOwnerUI() {
    manageShopButton.classList.toggle("hidden", currentRole !== "owner");
    updateNotificationUI();
}


function showLoggedInView(email) {
    accountLoggedOut.classList.add("hidden");
    accountLoggedIn.classList.remove("hidden");
    accountEmailDisplay.textContent = `Logged in as ${email}`;
    loadMyOrders();
    loadMyWishlist();
    loadMyPaymentMethods();
    renderSavePaypalButton();
}


function showLoggedOutView() {
    accountLoggedOut.classList.remove("hidden");
    accountLoggedIn.classList.add("hidden");
    wishlistProductIds = new Set();
    refreshWishlistButtonStates();
    myPaymentMethodsList.innerHTML = "";
}


const SHIPPING_STATUS_LABELS = {
    processing: "Processing",
    shipped: "Shipped",
    delivered: "Delivered"
};


// Builds a link to the carrier's own tracking page so "Track your order"
// opens the real, live status straight from USPS/UPS/FedEx — no API
// integration needed on our end. Returns null for an unrecognized
// carrier so we just don't show a link rather than guess wrong.
function buildCarrierTrackingUrl(carrier, trackingNumber) {

    if (!carrier || !trackingNumber) {
        return null;
    }

    const normalizedCarrier = carrier.trim().toLowerCase();
    const encodedTrackingNumber = encodeURIComponent(trackingNumber.trim());

    if (normalizedCarrier.includes("usps")) {
        return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodedTrackingNumber}`;
    }

    if (normalizedCarrier.includes("ups")) {
        return `https://www.ups.com/track?tracknum=${encodedTrackingNumber}`;
    }

    if (normalizedCarrier.includes("fedex")) {
        return `https://www.fedex.com/fedextrack/?trknbr=${encodedTrackingNumber}`;
    }

    return null;

}


async function loadMyOrders() {

    if (!currentSession) {
        return;
    }

    try {

        const response = await fetch("/api/orders/mine", { headers: authHeaders() });
        const orders = await response.json();

        if (!response.ok) {
            throw new Error(orders.error || "Could not load your orders.");
        }

        renderMyOrders(orders);

    } catch (err) {
        console.error(err);
        myOrdersList.innerHTML = `<p class="checkout-note">Could not load your orders right now.</p>`;
    }

}


function renderMyOrders(orders) {

    if (orders.length === 0) {
        myOrdersList.innerHTML = `<p class="checkout-note">You haven't placed any orders yet.</p>`;
        return;
    }

    myOrdersList.innerHTML = orders.map(order => {

        const date = new Date(order.created_at).toLocaleDateString("en-US", {
            year: "numeric", month: "short", day: "numeric"
        });

        const itemsSummary = (order.items || [])
            .map(item => `${item.quantity}× ${escapeHtml(item.name)}`)
            .join(", ");

        const statusClass = `order-status-${order.shipping_status}`;
        const statusLabel = SHIPPING_STATUS_LABELS[order.shipping_status] || order.shipping_status;

        let shippingInfo = "";

        if (order.shipping_status === "shipped" || order.shipping_status === "delivered") {

            const parts = [];

            if (order.carrier) {
                parts.push(escapeHtml(order.carrier));
            }

            if (order.tracking_number) {
                parts.push(`Tracking: ${escapeHtml(order.tracking_number)}`);
            }

            if (order.estimated_delivery_date && order.shipping_status === "shipped") {
                const eta = new Date(order.estimated_delivery_date + "T00:00:00").toLocaleDateString("en-US", {
                    month: "short", day: "numeric"
                });
                parts.push(`Estimated delivery: ${eta}`);
            }

            if (parts.length > 0) {
                shippingInfo = `<div class="order-card-shipping">${parts.join(" · ")}</div>`;
            }

            const trackingUrl = buildCarrierTrackingUrl(order.carrier, order.tracking_number);

            if (trackingUrl) {
                shippingInfo += `
                    <a
                        class="secondary-button track-order-button"
                        href="${trackingUrl}"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Track your order
                    </a>
                `;
            }

        }

        return `
            <div class="order-card">
                <div class="order-card-top">
                    <span class="order-card-date">${date}</span>
                    <span class="order-status-badge ${statusClass}">${statusLabel}</span>
                </div>
                <div class="order-card-items">${itemsSummary}</div>
                ${shippingInfo}
                <div class="order-card-total">${money(Number(order.subtotal))}</div>
            </div>
        `;

    }).join("");

}


/* =========================================
   WISHLIST
========================================= */

let wishlistProductIds = new Set();

const HEART_OUTLINE = `<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"></path>`;
const HEART_FILLED_STYLE = `fill="currentColor"`;


function wishlistButtonMarkup(productId) {
    return `
        <button
            type="button"
            class="wishlist-heart"
            data-wishlist="${productId}"
            aria-label="Save to wishlist"
        >
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">
                ${HEART_OUTLINE}
            </svg>
        </button>
    `;
}


function refreshWishlistButtonStates(container) {

    (container || document).querySelectorAll("[data-wishlist]").forEach(button => {

        const isSaved = wishlistProductIds.has(button.dataset.wishlist);
        button.classList.toggle("active", isSaved);

        const svg = button.querySelector("svg");
        svg.setAttribute("fill", isSaved ? "currentColor" : "none");

    });

}


function attachWishlistButtons(container) {

    container.querySelectorAll("[data-wishlist]").forEach(button => {

        button.addEventListener("click", event => {
            event.stopPropagation();
            toggleWishlist(button.dataset.wishlist);
        });

    });

    refreshWishlistButtonStates(container);

}


async function toggleWishlist(productId) {

    if (!currentSession) {
        openAccountModal();
        return;
    }

    const isSaved = wishlistProductIds.has(productId);

    // Update optimistically so the heart responds instantly.
    if (isSaved) {
        wishlistProductIds.delete(productId);
    } else {
        wishlistProductIds.add(productId);
    }

    refreshWishlistButtonStates();

    try {

        if (isSaved) {

            const response = await fetch(`/api/wishlist/${productId}`, {
                method: "DELETE",
                headers: authHeaders()
            });

            if (!response.ok && response.status !== 204) {
                throw new Error("Could not remove from wishlist.");
            }

        } else {

            const response = await fetch("/api/wishlist", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ product_id: productId })
            });

            if (!response.ok) {
                throw new Error("Could not save to wishlist.");
            }

        }

        if (accountModal.classList.contains("open") && !accountLoggedIn.classList.contains("hidden")) {
            loadMyWishlist();
        }

    } catch (err) {

        console.error(err);

        // Roll back the optimistic update since the request failed.
        if (isSaved) {
            wishlistProductIds.add(productId);
        } else {
            wishlistProductIds.delete(productId);
        }

        refreshWishlistButtonStates();

    }

}


async function loadMyWishlist() {

    if (!currentSession) {
        return;
    }

    try {

        const response = await fetch("/api/wishlist", { headers: authHeaders() });
        const items = await response.json();

        if (!response.ok) {
            throw new Error(items.error || "Could not load your wishlist.");
        }

        wishlistProductIds = new Set(items.map(item => item.product_id));
        renderMyWishlist(items);
        refreshWishlistButtonStates();

    } catch (err) {
        console.error(err);
        myWishlistList.innerHTML = `<p class="checkout-note">Could not load your wishlist right now.</p>`;
    }

}


function renderMyWishlist(items) {

    if (items.length === 0) {
        myWishlistList.innerHTML = `<p class="checkout-note">Nothing saved yet — tap the heart on any product to add it here.</p>`;
        return;
    }

    myWishlistList.innerHTML = items.map(item => {

        const product = item.products;

        if (!product) {
            return "";
        }

        const thumb = product.image_url
            ? `<img class="wishlist-item-thumb" src="${escapeHtml(product.image_url)}" alt="">`
            : `<div class="wishlist-item-thumb"></div>`;

        return `
            <div class="wishlist-item-row">
                ${thumb}
                <div class="wishlist-item-info">
                    <div class="name">${escapeHtml(product.name)}</div>
                    <div class="price">${money(Number(product.price))}</div>
                </div>
                <button type="button" class="remove-item" data-remove-wishlist="${product.id}">Remove</button>
            </div>
        `;

    }).join("");

    myWishlistList.querySelectorAll("[data-remove-wishlist]").forEach(button => {
        button.addEventListener("click", () => toggleWishlist(button.dataset.removeWishlist));
    });

}


/* =========================================
   SAVED PAYMENT METHODS (PayPal Vault)
========================================= */

let savePaypalButtonRendered = false;


async function loadMyPaymentMethods() {

    if (!currentSession) {
        return;
    }

    try {

        const response = await fetch("/api/saved-payment-methods", { headers: authHeaders() });
        const methods = await response.json();

        if (!response.ok) {
            throw new Error(methods.error || "Could not load payment methods.");
        }

        renderMyPaymentMethods(methods);

        // Catch any save that finished a moment after checkout (status
        // moved from "pending" to "saved" server-side) so it shows up
        // without the customer needing to do anything.
        syncPendingPaymentMethods();

    } catch (err) {
        console.error(err);
        myPaymentMethodsList.innerHTML = `<p class="checkout-note">Could not load payment methods right now.</p>`;
    }

}


async function syncPendingPaymentMethods() {

    try {

        const response = await fetch("/api/saved-payment-methods/sync", {
            method: "POST",
            headers: authHeaders()
        });

        const data = await response.json();

        if (response.ok && data.updated > 0) {
            loadMyPaymentMethods();
        }

    } catch (err) {
        console.error(err);
    }

}


function renderMyPaymentMethods(methods) {

    if (methods.length === 0) {
        myPaymentMethodsList.innerHTML = `<p class="checkout-note">No saved payment methods yet.</p>`;
        return;
    }

    myPaymentMethodsList.innerHTML = methods.map(method => {

        const label = method.method_type === "card"
            ? `${escapeHtml(method.card_brand || "Card")} ending in ${escapeHtml(method.card_last4 || "****")}`
            : `PayPal${method.paypal_email ? ` (${escapeHtml(method.paypal_email)})` : ""}`;

        return `
            <div class="payment-method-row">
                <span>${label}</span>
                <button type="button" class="remove-item" data-remove-payment-method="${method.id}">Remove</button>
            </div>
        `;

    }).join("");

    myPaymentMethodsList.querySelectorAll("[data-remove-payment-method]").forEach(button => {
        button.addEventListener("click", () => deleteSavedPaymentMethod(button.dataset.removePaymentMethod));
    });

}


async function deleteSavedPaymentMethod(id) {

    if (!confirm("Remove this saved payment method?")) {
        return;
    }

    try {

        const response = await fetch(`/api/saved-payment-methods/${id}`, {
            method: "DELETE",
            headers: authHeaders()
        });

        if (!response.ok && response.status !== 204) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "Could not remove this payment method.");
        }

        loadMyPaymentMethods();

    } catch (err) {
        console.error(err);
        alert(err.message || "Could not remove this payment method.");
    }

}


async function renderSavePaypalButton() {

    if (savePaypalButtonRendered || !currentSession) {
        return;
    }

    try {

        await loadPayPalScript();

        if (typeof paypal === "undefined" || !paypal.Buttons) {
            return;
        }

        savePaypalButtonRendered = true;

        paypal.Buttons({

            style: { label: "paypal", height: 40 },

            createVaultSetupToken: async () => {

                const response = await fetch("/api/paypal/vault/setup-token", {
                    method: "POST",
                    headers: authHeaders()
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || "Could not start saving your PayPal.");
                }

                return data.id;

            },

            onApprove: async ({ vaultSetupToken }) => {

                const response = await fetch("/api/paypal/vault/payment-token", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...authHeaders() },
                    body: JSON.stringify({ setupTokenId: vaultSetupToken })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || "Could not save your PayPal.");
                }

                loadMyPaymentMethods();

            },

            onError: err => {
                console.error(err);
                alert("Could not save your PayPal right now. Please try again.");
            }

        }).render("#savePaypalButtonContainer");

    } catch (err) {
        console.error(err);
    }

}


function setAccountMode(signUp) {

    isSignUpMode = signUp;
    clearAccountError();

    accountFormTitle.textContent = signUp ? "Create an Account" : "Log In";
    accountSubmitButton.textContent = signUp ? "Create Account" : "Log In";
    accountToggleText.textContent = signUp ? "Already have an account?" : "Don't have an account?";
    accountToggleMode.textContent = signUp ? "Log in" : "Create one";

}


function showAccountError(message) {
    accountError.textContent = message;
    accountError.classList.add("visible");
}


function clearAccountError() {
    accountError.textContent = "";
    accountError.classList.remove("visible");
}


async function handleAccountSubmit(event) {

    event.preventDefault();
    clearAccountError();

    if (!supabaseClient) {
        showAccountError("Accounts aren't set up yet on this site.");
        return;
    }

    const email = accountEmailInput.value.trim();
    const password = accountPasswordInput.value;

    try {

        if (isSignUpMode) {

            const { data, error } = await supabaseClient.auth.signUp({ email, password });

            if (error) {
                throw error;
            }

            if (!data.session) {
                showAccountError("Account created! Check your email to confirm it, then log in.");
                return;
            }

        } else {

            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

            if (error) {
                throw error;
            }

        }

        accountForm.reset();
        closeAccountModal();

    } catch (err) {
        showAccountError(err.message || "Something went wrong. Please try again.");
    }

}


function openAccountModal() {
    clearAccountError();
    resetPasswordVisibility();
    accountModal.classList.add("open");
}


const EYE_OPEN_ICON = `<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path><circle cx="12" cy="12" r="3"></circle>`;
const EYE_CLOSED_ICON = `<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`;


function resetPasswordVisibility() {
    accountPasswordInput.type = "password";
    passwordEyeIcon.innerHTML = EYE_OPEN_ICON;
    togglePasswordVisibility.setAttribute("aria-label", "Show password");
}


function togglePasswordVisibilityHandler() {

    const isHidden = accountPasswordInput.type === "password";

    accountPasswordInput.type = isHidden ? "text" : "password";
    passwordEyeIcon.innerHTML = isHidden ? EYE_CLOSED_ICON : EYE_OPEN_ICON;
    togglePasswordVisibility.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");

}


function closeAccountModal() {
    accountModal.classList.remove("open");
}


/* =========================================
   ADMIN — MANAGE SHOP (owner only)
========================================= */

let editingProductId = null;
let editingImageUrl = null;
let pendingImageFile = null;

const ADMIN_CATEGORY_LABELS = {
    cutting_board: "Cutting Board",
    soap_candle: "Soap & Candle",
    holiday: "Holiday",
    resin_craft: "Resin Craft",
    jewelry: "Jewelry"
};


function authHeaders() {
    return currentSession
        ? { Authorization: `Bearer ${currentSession.access_token}` }
        : {};
}


// Only shop.html defines renderCuttingBoards() and friends. If the owner
// edits a listing while on the shop page, refresh its grids immediately;
// on any other page, there's nothing to refresh, so do nothing.
async function refreshShopGridsIfPresent() {

    if (typeof loadProductData !== "function") {
        return;
    }

    await loadProductData();

    renderCuttingBoards();
    renderSoapCandles();
    renderHolidayProducts();
    renderResinCrafts();
    renderJewelry();

}


function showAdminError(message) {
    adminError.textContent = message;
    adminError.classList.add("visible");
}


function clearAdminError() {
    adminError.textContent = "";
    adminError.classList.remove("visible");
}


async function openAdminModal() {

    clearAdminError();
    resetAdminForm();
    resetAdminShippingMethodForm();
    switchAdminTab("listings");

    adminModal.classList.add("open");

    try {
        await loadAdminProducts();
    } catch (err) {
        console.error(err);
        showAdminError("Could not load your listings. Try closing and reopening this panel.");
    }

}


function closeAdminModal() {
    adminModal.classList.remove("open");
}


async function loadAdminProducts() {

    const response = await fetch("/api/admin/products", { headers: authHeaders() });
    const products = await response.json();

    if (!response.ok) {
        throw new Error(products.error || "Could not load listings.");
    }

    renderAdminProductList(products);

}


function renderAdminProductList(products) {

    adminProductList.innerHTML = "";

    if (products.length === 0) {
        adminProductList.innerHTML = `<p class="checkout-note">No listings yet — add your first one on the right.</p>`;
        return;
    }

    products.forEach(product => {

        const row = document.createElement("div");
        row.className = "admin-product-row";

        const thumb = product.image_url
            ? `<img class="admin-product-thumb" src="${escapeHtml(product.image_url)}" alt="">`
            : `<div class="admin-product-thumb"></div>`;

        row.innerHTML = `
            ${thumb}

            <div class="admin-product-info">
                <div class="name">${escapeHtml(product.name)}</div>
                <div class="meta">${escapeHtml(ADMIN_CATEGORY_LABELS[product.category] || product.category)} · ${money(Number(product.price))} · ${Number(product.stock) || 0} in stock</div>
            </div>

            <div class="admin-row-actions">
                <button type="button" data-edit="${product.id}">Edit</button>
                <button type="button" class="delete-button" data-delete="${product.id}">Delete</button>
            </div>
        `;

        adminProductList.appendChild(row);

        row.querySelector("[data-edit]").addEventListener("click", () => startEditingProduct(product));
        row.querySelector("[data-delete]").addEventListener("click", () => deleteProduct(product.id));

    });

}


function startEditingProduct(product) {

    editingProductId = product.id;
    editingImageUrl = product.image_url || null;
    pendingImageFile = null;

    adminProductId.value = product.id;
    adminCategory.value = product.category;
    adminName.value = product.name;
    adminDescription.value = product.description || "";
    adminPrice.value = Number(product.price);
    adminStock.value = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;
    adminTags.value = Array.isArray(product.tags) ? product.tags.join(", ") : "";

    if (product.image_url) {
        adminImagePreview.src = product.image_url;
        adminImagePreview.classList.remove("hidden");
        adminDropZoneText.classList.add("hidden");
    } else {
        adminImagePreview.classList.add("hidden");
        adminDropZoneText.classList.remove("hidden");
    }

    adminFormTitle.textContent = "Edit Listing";
    adminSaveButton.textContent = "Save Changes";

    adminExtraPhotosLocked.classList.add("hidden");
    adminExtraPhotosManager.classList.remove("hidden");
    loadExtraPhotos(product.id);

    clearAdminError();

}


function resetAdminForm() {

    adminProductForm.reset();
    adminProductId.value = "";

    editingProductId = null;
    editingImageUrl = null;
    pendingImageFile = null;

    adminImagePreview.classList.add("hidden");
    adminImagePreview.src = "";
    adminDropZoneText.classList.remove("hidden");

    adminExtraPhotosLocked.classList.remove("hidden");
    adminExtraPhotosManager.classList.add("hidden");
    adminExtraPhotosList.innerHTML = "";

    adminFormTitle.textContent = "Add a New Listing";
    adminSaveButton.textContent = "Add Listing";

    clearAdminError();

}


function handleSelectedImageFile(file) {

    if (!file) {
        return;
    }

    pendingImageFile = file;

    const reader = new FileReader();

    reader.onload = () => {
        adminImagePreview.src = reader.result;
        adminImagePreview.classList.remove("hidden");
        adminDropZoneText.classList.add("hidden");
    };

    reader.readAsDataURL(file);

}


async function uploadProductImage(file) {

    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const filePath = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

    const { error: uploadError } = await supabaseClient
        .storage
        .from("product-images")
        .upload(filePath, file, { upsert: false });

    if (uploadError) {
        throw new Error(`Could not upload image: ${uploadError.message}`);
    }

    const { data } = supabaseClient.storage.from("product-images").getPublicUrl(filePath);

    return data.publicUrl;

}


/* --- Extra gallery photos (only available once a listing exists) --- */

async function loadExtraPhotos(productId) {

    try {

        const response = await fetch(`/api/admin/products/${productId}/images`, {
            headers: authHeaders()
        });

        const images = await response.json();

        if (!response.ok) {
            throw new Error(images.error || "Could not load photos.");
        }

        renderExtraPhotosList(productId, images);

    } catch (err) {
        console.error(err);
        adminExtraPhotosList.innerHTML = `<p class="checkout-note">Could not load additional photos.</p>`;
    }

}


function renderExtraPhotosList(productId, images) {

    if (images.length === 0) {
        adminExtraPhotosList.innerHTML = "";
        return;
    }

    adminExtraPhotosList.innerHTML = images.map(image => `
        <div class="admin-extra-photo-item">
            <img src="${escapeHtml(image.image_url)}" alt="">
            <button
                type="button"
                class="admin-extra-photo-remove"
                data-remove-extra-photo="${image.id}"
                aria-label="Remove photo"
            >×</button>
        </div>
    `).join("");

    adminExtraPhotosList.querySelectorAll("[data-remove-extra-photo]").forEach(button => {
        button.addEventListener("click", () => {
            deleteExtraPhoto(productId, button.dataset.removeExtraPhoto);
        });
    });

}


async function deleteExtraPhoto(productId, imageId) {

    try {

        const response = await fetch(`/api/admin/products/${productId}/images/${imageId}`, {
            method: "DELETE",
            headers: authHeaders()
        });

        if (!response.ok && response.status !== 204) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "Could not remove this photo.");
        }

        await loadExtraPhotos(productId);

    } catch (err) {
        showAdminError(err.message || "Could not remove this photo.");
    }

}


async function handleExtraPhotoFiles(fileList) {

    if (!editingProductId || fileList.length === 0) {
        return;
    }

    clearAdminError();

    try {

        for (const file of fileList) {

            const imageUrl = await uploadProductImage(file);

            const response = await fetch(`/api/admin/products/${editingProductId}/images`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ image_url: imageUrl })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Could not add a photo.");
            }

        }

        await loadExtraPhotos(editingProductId);

    } catch (err) {
        showAdminError(err.message || "Could not add one or more photos.");
    }

}


async function handleAdminProductSubmit(event) {

    event.preventDefault();
    clearAdminError();

    if (!supabaseClient) {
        showAdminError("Accounts aren't set up yet on this site.");
        return;
    }

    adminSaveButton.disabled = true;

    try {

        let imageUrl = editingImageUrl;

        if (pendingImageFile) {
            imageUrl = await uploadProductImage(pendingImageFile);
        }

        if (!imageUrl) {
            throw new Error("Please add a photo for this listing.");
        }

        const payload = {
            category: adminCategory.value,
            name: adminName.value.trim(),
            description: adminDescription.value.trim(),
            price: Number(adminPrice.value),
            stock: Number(adminStock.value),
            tags: adminTags.value,
            image_url: imageUrl
        };

        const url = editingProductId
            ? `/api/admin/products/${editingProductId}`
            : "/api/admin/products";

        const method = editingProductId ? "PUT" : "POST";

        const response = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not save this listing.");
        }

        resetAdminForm();
        await loadAdminProducts();

        // If we're on the shop page right now, refresh its grids so the
        // change shows up immediately. On other pages, shop.js's render
        // functions don't exist — the edit is still saved either way.
        await refreshShopGridsIfPresent();

    } catch (err) {
        showAdminError(err.message || "Could not save this listing.");
    } finally {
        adminSaveButton.disabled = false;
    }

}


async function deleteProduct(id) {

    if (!confirm("Remove this listing? This can't be undone.")) {
        return;
    }

    clearAdminError();

    try {

        const response = await fetch(`/api/admin/products/${id}`, {
            method: "DELETE",
            headers: authHeaders()
        });

        if (!response.ok && response.status !== 204) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "Could not delete this listing.");
        }

        await loadAdminProducts();
        await refreshShopGridsIfPresent();

    } catch (err) {
        showAdminError(err.message || "Could not delete this listing.");
    }

}


/* =========================================
   ADMIN — ORDERS TAB (owner only)
========================================= */

function switchAdminTab(tab) {

    const showingOrders = tab === "orders";
    const showingShipping = tab === "shipping";
    const showingListings = !showingOrders && !showingShipping;

    adminTabListings.classList.toggle("active", showingListings);
    adminTabOrders.classList.toggle("active", showingOrders);
    adminTabShipping.classList.toggle("active", showingShipping);

    adminListingsSection.classList.toggle("hidden", !showingListings);
    adminOrdersSection.classList.toggle("hidden", !showingOrders);
    adminShippingSection.classList.toggle("hidden", !showingShipping);

    clearAdminError();

    if (showingOrders) {
        loadAdminOrders().catch(err => {
            console.error(err);
            showAdminError("Could not load orders.");
        });
    }

    if (showingShipping) {
        loadAdminShipping().catch(err => {
            console.error(err);
            showAdminError("Could not load shipping settings.");
        });
    }

}


async function loadAdminOrders() {

    const response = await fetch("/api/admin/orders", { headers: authHeaders() });
    const orders = await response.json();

    if (!response.ok) {
        throw new Error(orders.error || "Could not load orders.");
    }

    renderAdminOrdersList(orders);

}


function renderAdminOrdersList(orders) {

    if (orders.length === 0) {
        adminOrdersList.innerHTML = `<p class="checkout-note">No orders yet.</p>`;
        return;
    }

    adminOrdersList.innerHTML = "";

    orders.forEach(order => {

        const date = new Date(order.created_at).toLocaleDateString("en-US", {
            year: "numeric", month: "short", day: "numeric"
        });

        const itemsSummary = (order.items || [])
            .map(item => `${item.quantity}× ${escapeHtml(item.name)}`)
            .join(", ");

        const row = document.createElement("div");
        row.className = "admin-order-row";

        const addressLines = [
            order.customer_address1,
            order.customer_address2,
            [order.customer_city, order.customer_state, order.customer_zip].filter(Boolean).join(", ")
        ].filter(Boolean);

        const addressHtml = addressLines.length > 0
            ? `<div class="admin-order-address">${addressLines.map(escapeHtml).join("<br>")}</div>`
            : `<div class="admin-order-address checkout-note">No shipping address on file.</div>`;

        row.innerHTML = `
            <div class="admin-order-top">
                <div>
                    <div class="admin-order-customer">${escapeHtml(order.customer_name || "Guest")}</div>
                    <div class="admin-order-meta">
                        ${escapeHtml(order.customer_email || "")} · ${date} · ${money(Number(order.subtotal))}
                    </div>
                    ${addressHtml}
                </div>
            </div>

            <div class="admin-order-items">${itemsSummary}</div>

            <div class="admin-order-shipping-fields">

                <div class="field-group">
                    <label>Status</label>
                    <select data-field="shipping_status">
                        <option value="processing" ${order.shipping_status === "processing" ? "selected" : ""}>Processing</option>
                        <option value="shipped" ${order.shipping_status === "shipped" ? "selected" : ""}>Shipped</option>
                        <option value="delivered" ${order.shipping_status === "delivered" ? "selected" : ""}>Delivered</option>
                    </select>
                </div>

                <div class="field-group">
                    <label>Carrier</label>
                    <input type="text" data-field="carrier" value="${escapeHtml(order.carrier || "")}" placeholder="USPS, UPS, etc.">
                </div>

                <div class="field-group">
                    <label>Tracking #</label>
                    <input type="text" data-field="tracking_number" value="${escapeHtml(order.tracking_number || "")}">
                </div>

                <div class="field-group">
                    <label>Est. Delivery</label>
                    <input type="date" data-field="estimated_delivery_date" value="${order.estimated_delivery_date || ""}">
                </div>

                <button type="button" class="admin-order-save" data-order-id="${order.id}">Save</button>

            </div>
        `;

        adminOrdersList.appendChild(row);

        row.querySelector(".admin-order-save").addEventListener("click", () => saveOrderShipping(order.id, row));

    });

}


async function saveOrderShipping(orderId, row) {

    clearAdminError();

    const payload = {
        shipping_status: row.querySelector('[data-field="shipping_status"]').value,
        carrier: row.querySelector('[data-field="carrier"]').value.trim(),
        tracking_number: row.querySelector('[data-field="tracking_number"]').value.trim(),
        estimated_delivery_date: row.querySelector('[data-field="estimated_delivery_date"]').value || null
    };

    try {

        const response = await fetch(`/api/admin/orders/${orderId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not save this order.");
        }

    } catch (err) {
        showAdminError(err.message || "Could not save this order.");
    }

}


/* =========================================
   ADMIN — SHIPPING TAB (owner only)
========================================= */

const CATEGORY_DISPLAY_LABELS = {
    cutting_board: "Cutting Boards",
    soap_candle: "Soap & Candles",
    resin_craft: "Resin Crafts",
    jewelry: "Jewelry",
    holiday: "Holiday"
};

let editingShippingMethodId = null;

async function loadAdminShipping() {

    const [methodsResponse, thresholdsResponse] = await Promise.all([
        fetch("/api/admin/shipping-methods", { headers: authHeaders() }),
        fetch("/api/admin/category-shipping", { headers: authHeaders() })
    ]);

    const methods = await methodsResponse.json();
    const thresholds = await thresholdsResponse.json();

    if (!methodsResponse.ok) {
        throw new Error(methods.error || "Could not load shipping methods.");
    }

    if (!thresholdsResponse.ok) {
        throw new Error(thresholds.error || "Could not load free shipping thresholds.");
    }

    renderAdminShippingMethods(methods);
    renderAdminCategoryThresholds(thresholds);

}


function renderAdminShippingMethods(methods) {

    if (methods.length === 0) {
        adminShippingMethodsList.innerHTML = `<p class="checkout-note">No shipping methods yet — add one below.</p>`;
        return;
    }

    adminShippingMethodsList.innerHTML = "";

    methods.forEach(method => {

        const row = document.createElement("div");
        row.className = "admin-shipping-method-row";

        const days = (method.estimated_days_min && method.estimated_days_max)
            ? `${method.estimated_days_min}–${method.estimated_days_max} days`
            : "No estimate set";

        row.innerHTML = `
            <div>
                <div class="method-name">${escapeHtml(method.name)}${method.active ? "" : " (inactive)"}</div>
                <div class="method-meta">${money(Number(method.price))} · ${days}</div>
            </div>
            <button type="button" data-edit-shipping="${method.id}">Edit</button>
            <button type="button" data-toggle-shipping="${method.id}" data-active="${method.active}">
                ${method.active ? "Deactivate" : "Activate"}
            </button>
            <button type="button" class="delete-button" data-delete-shipping="${method.id}">Delete</button>
        `;

        adminShippingMethodsList.appendChild(row);

        row.querySelector("[data-edit-shipping]").addEventListener("click", () => startEditingShippingMethod(method));
        row.querySelector("[data-toggle-shipping]").addEventListener("click", () => toggleShippingMethodActive(method));
        row.querySelector("[data-delete-shipping]").addEventListener("click", () => deleteShippingMethod(method.id));

    });

}


function startEditingShippingMethod(method) {

    editingShippingMethodId = method.id;

    adminShippingMethodId.value = method.id;
    adminShippingName.value = method.name;
    adminShippingPrice.value = Number(method.price);
    adminShippingDaysMin.value = method.estimated_days_min ?? "";
    adminShippingDaysMax.value = method.estimated_days_max ?? "";

    adminShippingSaveButton.textContent = "Save Changes";

    clearAdminError();

}


function resetAdminShippingMethodForm() {

    adminShippingMethodForm.reset();
    adminShippingMethodId.value = "";
    editingShippingMethodId = null;
    adminShippingSaveButton.textContent = "Add Method";

    clearAdminError();

}


async function handleAdminShippingMethodSubmit(event) {

    event.preventDefault();
    clearAdminError();

    const payload = {
        name: adminShippingName.value.trim(),
        price: Number(adminShippingPrice.value),
        estimated_days_min: adminShippingDaysMin.value || null,
        estimated_days_max: adminShippingDaysMax.value || null
    };

    const url = editingShippingMethodId
        ? `/api/admin/shipping-methods/${editingShippingMethodId}`
        : "/api/admin/shipping-methods";

    const method = editingShippingMethodId ? "PUT" : "POST";

    try {

        const response = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not save this shipping method.");
        }

        resetAdminShippingMethodForm();
        await loadAdminShipping();

        // Shipping data may have changed — force checkout to reload it next time.
        shippingDataLoaded = false;

    } catch (err) {
        showAdminError(err.message || "Could not save this shipping method.");
    }

}


async function toggleShippingMethodActive(method) {

    clearAdminError();

    try {

        const response = await fetch(`/api/admin/shipping-methods/${method.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ active: !method.active })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not update this shipping method.");
        }

        await loadAdminShipping();
        shippingDataLoaded = false;

    } catch (err) {
        showAdminError(err.message || "Could not update this shipping method.");
    }

}


async function deleteShippingMethod(id) {

    if (!confirm("Delete this shipping method? This can't be undone.")) {
        return;
    }

    clearAdminError();

    try {

        const response = await fetch(`/api/admin/shipping-methods/${id}`, {
            method: "DELETE",
            headers: authHeaders()
        });

        if (!response.ok && response.status !== 204) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "Could not delete this shipping method.");
        }

        await loadAdminShipping();
        shippingDataLoaded = false;

    } catch (err) {
        showAdminError(err.message || "Could not delete this shipping method.");
    }

}


function renderAdminCategoryThresholds(thresholds) {

    adminCategoryThresholdsList.innerHTML = "";

    thresholds.forEach(setting => {

        const row = document.createElement("div");
        row.className = "admin-category-threshold-row";

        const label = CATEGORY_DISPLAY_LABELS[setting.category] || setting.category;
        const currentValue = setting.free_shipping_threshold ?? "";

        row.innerHTML = `
            <span class="category-name">${escapeHtml(label)}</span>
            <input type="number" min="0" step="0.01" placeholder="No free shipping" value="${currentValue}">
            <button type="button" class="admin-order-save">Save</button>
        `;

        adminCategoryThresholdsList.appendChild(row);

        row.querySelector("button").addEventListener("click", () => {
            saveCategoryThreshold(setting.category, row.querySelector("input").value);
        });

    });

}


async function saveCategoryThreshold(category, value) {

    clearAdminError();

    try {

        const response = await fetch(`/api/admin/category-shipping/${category}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ free_shipping_threshold: value === "" ? null : value })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not save this threshold.");
        }

        shippingDataLoaded = false;

    } catch (err) {
        showAdminError(err.message || "Could not save this threshold.");
    }

}


/* =========================================
   SECURITY HELPER
========================================= */

function escapeHtml(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}
/* =========================================
   SHARED EVENT LISTENERS
========================================= */

function wireSharedEventListeners() {

    cartButton.addEventListener("click", openCart);
    closeCartButton.addEventListener("click", closeCart);
    cartOverlay.addEventListener("click", closeCart);
    
    checkoutButton.addEventListener("click", openCheckout);
    closeCheckoutButton.addEventListener("click", closeCheckout);
    
    checkoutModal.addEventListener("click", event => {
        if (event.target === checkoutModal) {
            closeCheckout();
        }
    });
    
    // The form itself is never submitted — the PayPal buttons drive checkout —
    // but prevent a stray Enter keypress from reloading the page.
    checkoutForm.addEventListener("submit", event => {
        event.preventDefault();
    });
    
    
    /* --- Accounts --- */
    
    accountButton.addEventListener("click", openAccountModal);
    closeAccountButton.addEventListener("click", closeAccountModal);
    
    accountModal.addEventListener("click", event => {
        if (event.target === accountModal) {
            closeAccountModal();
        }
    });
    
    accountForm.addEventListener("submit", handleAccountSubmit);
    
    togglePasswordVisibility.addEventListener("click", togglePasswordVisibilityHandler);
    
    accountToggleMode.addEventListener("click", () => setAccountMode(!isSignUpMode));
    
    logoutButton.addEventListener("click", async () => {
        if (supabaseClient) {
            await supabaseClient.auth.signOut();
        }
        closeAccountModal();
    });
    
    
    /* --- Admin / Manage Shop --- */
    
    manageShopButton.addEventListener("click", openAdminModal);
    closeAdminButton.addEventListener("click", closeAdminModal);
    
    adminTabListings.addEventListener("click", () => switchAdminTab("listings"));
    adminTabOrders.addEventListener("click", () => switchAdminTab("orders"));
    adminTabShipping.addEventListener("click", () => switchAdminTab("shipping"));
    
    adminShippingMethodForm.addEventListener("submit", handleAdminShippingMethodSubmit);
    adminShippingCancelEdit.addEventListener("click", resetAdminShippingMethodForm);
    
    adminModal.addEventListener("click", event => {
        if (event.target === adminModal) {
            closeAdminModal();
        }
    });
    
    adminProductForm.addEventListener("submit", handleAdminProductSubmit);
    adminCancelEdit.addEventListener("click", resetAdminForm);
    
    adminImageInput.addEventListener("change", event => {
        handleSelectedImageFile(event.target.files[0]);
    });
    
    adminDropZone.addEventListener("dragover", event => {
        event.preventDefault();
        adminDropZone.classList.add("dragging");
    });
    
    adminDropZone.addEventListener("dragleave", () => {
        adminDropZone.classList.remove("dragging");
    });
    
    adminDropZone.addEventListener("drop", event => {
        event.preventDefault();
        adminDropZone.classList.remove("dragging");
        handleSelectedImageFile(event.dataTransfer.files[0]);
    });

    adminExtraImageInput.addEventListener("change", event => {
        handleExtraPhotoFiles(event.target.files);
        event.target.value = "";
    });

    adminExtraDropZone.addEventListener("dragover", event => {
        event.preventDefault();
        adminExtraDropZone.classList.add("dragging");
    });

    adminExtraDropZone.addEventListener("dragleave", () => {
        adminExtraDropZone.classList.remove("dragging");
    });

    adminExtraDropZone.addEventListener("drop", event => {
        event.preventDefault();
        adminExtraDropZone.classList.remove("dragging");
        handleExtraPhotoFiles(event.dataTransfer.files);
    });

}


/* =========================================
   SEARCH
========================================= */

let searchDebounceTimer = null;

function searchResultRowMarkup(product) {

    const thumb = product.image_url
        ? `<img src="${escapeHtml(product.image_url)}" alt="">`
        : `<div class="search-result-thumb-placeholder"></div>`;

    return `
        <a class="search-result-row" href="product.html?id=${encodeURIComponent(product.id)}">
            <div class="search-result-thumb">${thumb}</div>
            <div class="search-result-info">
                <div class="search-result-name">${escapeHtml(product.name)}</div>
                <div class="search-result-price">${money(product.price)}</div>
            </div>
        </a>
    `;

}

function showSearchResults(html) {
    siteSearchResults.innerHTML = html;
    siteSearchResults.classList.remove("hidden");
}

function hideSearchResults() {
    siteSearchResults.classList.add("hidden");
    siteSearchResults.innerHTML = "";
}

async function runSearch(query) {

    try {

        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Search failed.");
        }

        if (data.results.length === 0) {
            showSearchResults(`<div class="search-no-results">No products found for "${escapeHtml(query)}".</div>`);
            return;
        }

        showSearchResults(data.results.map(searchResultRowMarkup).join(""));

    } catch (err) {
        console.error(err);
        showSearchResults(`<div class="search-no-results">Could not search right now. Please try again.</div>`);
    }

}

function handleSearchInput() {

    const query = siteSearchInput.value.trim();

    siteSearchClear.classList.toggle("hidden", query.length === 0);

    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
    }

    if (query.length === 0) {
        hideSearchResults();
        return;
    }

    // Debounced so we're not hitting the server on every single
    // keystroke — waits for a short pause in typing instead.
    searchDebounceTimer = setTimeout(() => runSearch(query), 250);

}

function clearSearch() {
    siteSearchInput.value = "";
    siteSearchClear.classList.add("hidden");
    hideSearchResults();
    siteSearchInput.focus();
}

function wireSearchEventListeners() {

    if (!siteSearchInput) {
        // This page's header partial doesn't include the search bar for
        // some reason — fail quietly rather than break the whole page.
        return;
    }

    siteSearchInput.addEventListener("input", handleSearchInput);

    siteSearchInput.addEventListener("focus", () => {
        if (siteSearchInput.value.trim().length > 0) {
            siteSearchResults.classList.remove("hidden");
        }
    });

    siteSearchClear.addEventListener("click", clearSearch);

    document.addEventListener("click", event => {
        if (!headerSearchElement().contains(event.target)) {
            hideSearchResults();
        }
    });

    siteSearchInput.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            clearSearch();
            siteSearchInput.blur();
        }
    });

}

function headerSearchElement() {
    return document.getElementById("headerSearch") || document.body;
}


/* =========================================
   NOTIFICATIONS
========================================= */

const NOTIFICATION_POLL_INTERVAL_MS = 60000;
let notificationPollTimer = null;

function formatNotificationTime(isoString) {
    return new Date(isoString).toLocaleDateString("en-US", {
        month: "short", day: "numeric"
    });
}

function notificationRowMarkup(notification) {

    let linkHref = null;

    if (notification.related_order_id) {
        linkHref = "#my-orders";
    } else if (notification.related_product_id) {
        linkHref = `product.html?id=${encodeURIComponent(notification.related_product_id)}`;
    }

    const content = `
        <div class="notification-row-title">${escapeHtml(notification.title)}</div>
        ${notification.body ? `<div class="notification-row-body">${escapeHtml(notification.body)}</div>` : ""}
        <div class="notification-row-time">${formatNotificationTime(notification.created_at)}</div>
    `;

    const inner = linkHref
        ? `<a class="notification-row-link" data-notification-link="${notification.id}" href="${linkHref}">${content}</a>`
        : content;

    return `
        <div class="notification-row ${notification.is_read ? "" : "unread"}" data-notification-id="${notification.id}">
            ${inner}
            <button type="button" class="notification-dismiss" data-dismiss-notification="${notification.id}" aria-label="Dismiss">×</button>
        </div>
    `;

}

async function loadNotifications() {

    if (!currentSession || !notificationList) {
        return;
    }

    try {

        const response = await fetch("/api/notifications", { headers: authHeaders() });
        const notifications = await response.json();

        if (!response.ok) {
            throw new Error(notifications.error || "Could not load notifications.");
        }

        renderNotifications(notifications);

    } catch (err) {
        console.error(err);
    }

}

function renderNotifications(notifications) {

    const unreadCount = notifications.filter(n => !n.is_read).length;

    notificationBadge.textContent = String(unreadCount);
    notificationBadge.classList.toggle("hidden", unreadCount === 0);

    if (notifications.length === 0) {
        notificationList.innerHTML = `<p class="checkout-note">No notifications yet.</p>`;
        return;
    }

    notificationList.innerHTML = notifications.map(notificationRowMarkup).join("");

    notificationList.querySelectorAll("[data-notification-link]").forEach(link => {
        link.addEventListener("click", () => {
            markNotificationRead(link.dataset.notificationLink);
        });
    });

    notificationList.querySelectorAll("[data-dismiss-notification]").forEach(button => {
        button.addEventListener("click", event => {
            event.stopPropagation();
            event.preventDefault();
            dismissNotification(button.dataset.dismissNotification);
        });
    });

}

async function markNotificationRead(id) {

    try {
        await fetch(`/api/notifications/${id}/read`, { method: "PUT", headers: authHeaders() });
        loadNotifications();
    } catch (err) {
        console.error(err);
    }

}

async function dismissNotification(id) {

    try {
        await fetch(`/api/notifications/${id}`, { method: "DELETE", headers: authHeaders() });
        loadNotifications();
    } catch (err) {
        console.error(err);
    }

}

async function markAllNotificationsReadHandler() {

    try {
        await fetch("/api/notifications/read-all", { method: "PUT", headers: authHeaders() });
        loadNotifications();
    } catch (err) {
        console.error(err);
    }

}

function toggleNotificationPanel() {
    notificationPanel.classList.toggle("open");
    if (notificationPanel.classList.contains("open")) {
        loadNotifications();
    }
}

function updateNotificationUI() {

    if (!notificationBellButton) {
        return;
    }

    notificationBellButton.classList.toggle("hidden", !currentSession);

    if (currentSession) {

        loadNotifications();

        if (!notificationPollTimer) {
            notificationPollTimer = setInterval(loadNotifications, NOTIFICATION_POLL_INTERVAL_MS);
        }

    } else {

        notificationPanel.classList.remove("open");

        if (notificationPollTimer) {
            clearInterval(notificationPollTimer);
            notificationPollTimer = null;
        }

    }

}

function wireNotificationEventListeners() {

    if (!notificationBellButton) {
        return;
    }

    notificationBellButton.addEventListener("click", toggleNotificationPanel);
    markAllNotificationsRead.addEventListener("click", markAllNotificationsReadHandler);

    document.addEventListener("click", event => {
        if (
            notificationPanel.classList.contains("open") &&
            !notificationPanel.contains(event.target) &&
            !notificationBellButton.contains(event.target)
        ) {
            notificationPanel.classList.remove("open");
        }
    });

}


/* =========================================
   RECENTLY VIEWED (used for guest-friendly recommendations)
========================================= */

const RECENTLY_VIEWED_KEY = "cornerBarrRecentlyViewed";
const RECENTLY_VIEWED_MAX = 12;

function trackRecentlyViewed(productId) {

    try {

        let viewed = JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || "[]");
        viewed = viewed.filter(id => id !== productId);
        viewed.unshift(productId);
        viewed = viewed.slice(0, RECENTLY_VIEWED_MAX);

        localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(viewed));

    } catch (err) {
        console.error("Could not save recently viewed products.", err);
    }

}

function getRecentlyViewedIds() {

    try {
        return JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || "[]");
    } catch (err) {
        return [];
    }

}


/* =========================================
   RECOMMENDATION / SEARCH CARD (shared mini product card)
========================================= */

function miniProductCardMarkup(product) {

    const imageMarkup = product.image_url
        ? `<img class="product-photo" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">`
        : `<div class="product-photo-placeholder"></div>`;

    return `
        <article class="product-card">
            <a class="product-card-link" href="product.html?id=${encodeURIComponent(product.id)}">
                <div class="product-image">
                    ${imageMarkup}
                </div>
                <div class="product-info">
                    <div class="product-category">${escapeHtml(product.category)}</div>
                    <h3 class="product-name">${escapeHtml(product.name)}</h3>
                    <div class="product-bottom">
                        <span class="product-price">${money(product.price)}</span>
                        ${stockStatusMarkup(product.stock)}
                    </div>
                </div>
            </a>
        </article>
    `;

}


/* =========================================
   STAR RATINGS (shared between product page reviews and elsewhere)
========================================= */

function starDisplayMarkup(rating) {

    const rounded = Math.round(rating);
    let stars = "";

    for (let i = 1; i <= 5; i++) {
        stars += i <= rounded ? "★" : "☆";
    }

    return `<span class="star-display">${stars}</span>`;

}


/* =========================================
   INITIALIZE (shared)
   Every page calls this first, before its own page-specific setup.
========================================= */

async function initShared() {

    await loadPartials();
    cacheSharedDom();
    wireSharedEventListeners();
    wireSearchEventListeners();
    wireNotificationEventListeners();

    loadCart();
    renderCart();

    initSupabaseAuth().catch(err => console.error("Could not initialize accounts:", err));

    const currentYearEl = document.getElementById("currentYear");
    if (currentYearEl) {
        currentYearEl.textContent = new Date().getFullYear();
    }

}