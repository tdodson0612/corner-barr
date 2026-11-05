// public/js/subscriptions.js
//
// Subscription boxes on the shop page, and the "Subscribe" window.
// Only boxes Ashley has switched on (with a price) are shown. If none are,
// nothing about subscriptions appears on the page at all.
//
// Signing up: the customer picks a size (if the box has sizes), enters a
// shipping address, and continues to PayPal to approve. PayPal sends them
// back to subscription-confirmed.html.

let subscriptionPlans = [];
let subscriptionSignupPlan = null;

function subscriptionFrequencyText(intervalMonths) {
    return Number(intervalMonths) === 3 ? "every 3 months" : "every month";
}

function subscriptionPrettyDate(isoDate) {
    const [year, month, day] = String(isoDate).split("-").map(Number);
    const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${names[month - 1]} ${day}, ${year}`;
}

function subscriptionPriceText(plan) {
    if (plan.options && plan.options.length > 0) {
        const lowest = Math.min(...plan.options.map(o => Number(o.price)));
        return `From ${money(lowest)}`;
    }
    return money(plan.price);
}

function subscriptionShippingText(plan) {
    return plan.shipping_included ? "Free shipping" : `+ ${money(plan.shipping_price)} shipping`;
}

function subscriptionSavingsBadge(plan) {
    if (plan.options && plan.options.length > 0) {
        return "";
    }
    const price = Number(plan.price);
    const regular = Number(plan.regular_price);
    if (!(regular > price && price > 0)) {
        return "";
    }
    const percent = Math.round(((regular - price) / regular) * 100);
    return `<span class="stock-status subscription-save-badge">Save ${percent}% vs. buying separately</span>`;
}

function subscriptionCardMarkup(plan) {

    const imageMarkup = plan.image_url
        ? `<img class="product-photo" loading="lazy" decoding="async" src="${escapeHtml(plan.image_url)}" alt="${escapeHtml(plan.name)}">`
        : `<div class="product-photo-placeholder"></div>`;

    return `
        <article class="product-card subscription-card">
            <div class="product-image">${imageMarkup}</div>
            <div class="product-info">
                <div class="product-category">Ships ${subscriptionFrequencyText(plan.interval_months)}</div>
                <h3 class="product-name">${escapeHtml(plan.name)}</h3>
                <p class="product-description">${escapeHtml(plan.description || "")}</p>
                <div class="product-bottom">
                    <span class="product-price">${escapeHtml(subscriptionPriceText(plan))}</span>
                    <span class="subscription-shipping-note">${escapeHtml(subscriptionShippingText(plan))}</span>
                </div>
                ${subscriptionSavingsBadge(plan)}
                <button type="button" class="primary-button full-width subscription-subscribe-button" data-subscribe-plan="${escapeHtml(plan.id)}">Subscribe</button>
            </div>
        </article>
    `;

}

async function loadSubscriptionSection() {

    const section = document.getElementById("subscriptions");

    if (!section) {
        return;
    }

    try {
        const response = await fetch("/api/subscription-plans");
        const plans = await response.json();
        if (!response.ok || !Array.isArray(plans)) {
            throw new Error("Could not load subscriptions.");
        }
        subscriptionPlans = plans;
    } catch (err) {
        console.error(err);
        subscriptionPlans = [];
    }

    if (subscriptionPlans.length === 0) {
        section.classList.add("hidden");
        return;
    }

    section.querySelector("[data-subscription-grid]").innerHTML = subscriptionPlans.map(subscriptionCardMarkup).join("");
    section.classList.remove("hidden");

    section.querySelectorAll("[data-subscribe-plan]").forEach(button => {
        button.addEventListener("click", () => openSubscriptionSignup(button.getAttribute("data-subscribe-plan")));
    });

    if (window.location.hash === "#subscriptions") {
        section.scrollIntoView();
    }

}

/* ---------- Signup window ---------- */

function ensureSubscriptionModal() {

    let modal = document.getElementById("subscriptionModal");

    if (modal) {
        return modal;
    }

    document.body.insertAdjacentHTML("beforeend", `
        <div class="modal-overlay" id="subscriptionModal">
            <div class="checkout-modal subscription-modal">
                <button class="close-button modal-close" id="closeSubscriptionModal" type="button">×</button>
                <p class="eyebrow">SUBSCRIBE</p>
                <h2 id="subscriptionModalTitle"></h2>
                <p class="checkout-note" id="subscriptionModalFrequency"></p>

                <div class="form-group hidden" id="subscriptionSizeGroup">
                    <label for="subscriptionSize">Size</label>
                    <select id="subscriptionSize"></select>
                </div>

                <div class="subscription-summary" id="subscriptionSummary"></div>

                <form id="subscriptionForm">
                    <div class="form-group">
                        <label for="subName">Full name</label>
                        <input id="subName" type="text" required autocomplete="name" maxlength="100">
                    </div>
                    <div class="form-group">
                        <label for="subPhone">Phone (optional)</label>
                        <input id="subPhone" type="tel" autocomplete="tel" maxlength="30">
                    </div>
                    <div class="form-group">
                        <label for="subAddress1">Street address</label>
                        <input id="subAddress1" type="text" required autocomplete="address-line1" maxlength="200">
                    </div>
                    <div class="form-group">
                        <label for="subAddress2">Apt, suite, etc. (optional)</label>
                        <input id="subAddress2" type="text" autocomplete="address-line2" maxlength="200">
                    </div>
                    <div class="form-group">
                        <label for="subCity">City</label>
                        <input id="subCity" type="text" required autocomplete="address-level2" maxlength="100">
                    </div>
                    <div class="form-group">
                        <label for="subState">State</label>
                        <input id="subState" type="text" required autocomplete="address-level1" maxlength="2" placeholder="OR" style="text-transform: uppercase;">
                    </div>
                    <div class="form-group">
                        <label for="subZip">ZIP</label>
                        <input id="subZip" type="text" required autocomplete="postal-code" inputmode="numeric" maxlength="10">
                    </div>
                    <div class="form-group">
                        <label for="subNotes">Notes (optional)</label>
                        <textarea id="subNotes" maxlength="500" placeholder="Scent preferences, gift note, anything we should know"></textarea>
                    </div>
                </form>

                <div id="subscriptionError" class="checkout-error"></div>

                <button type="button" class="primary-button full-width" id="subscriptionContinueButton">Continue to PayPal</button>
                <p class="checkout-note">You'll approve the subscription on PayPal's secure page, then come right back here.</p>
            </div>
        </div>
    `);

    modal = document.getElementById("subscriptionModal");

    document.getElementById("closeSubscriptionModal").addEventListener("click", closeSubscriptionSignup);
    modal.addEventListener("click", event => {
        if (event.target === modal) {
            closeSubscriptionSignup();
        }
    });
    document.getElementById("subscriptionSize").addEventListener("change", renderSubscriptionSummary);
    document.getElementById("subscriptionContinueButton").addEventListener("click", startSubscriptionCheckout);

    return modal;

}

function selectedSubscriptionPrice() {

    const plan = subscriptionSignupPlan;

    if (!plan) {
        return null;
    }

    let boxPrice = Number(plan.price);
    let optionLabel = null;

    if (plan.options && plan.options.length > 0) {
        const select = document.getElementById("subscriptionSize");
        const option = plan.options.find(o => o.label === select.value);
        if (!option) {
            return null;
        }
        boxPrice = Number(option.price);
        optionLabel = option.label;
    }

    const shipping = plan.shipping_included ? 0 : Number(plan.shipping_price || 0);

    return { boxPrice, shipping, charge: Math.round((boxPrice + shipping) * 100) / 100, optionLabel };

}

function renderSubscriptionSummary() {

    const plan = subscriptionSignupPlan;
    const summary = document.getElementById("subscriptionSummary");
    const price = selectedSubscriptionPrice();

    if (!plan || !price) {
        summary.innerHTML = "";
        return;
    }

    const shippingLine = plan.shipping_included
        ? `<p>Box: ${money(price.boxPrice)} (free shipping)</p>`
        : `<p>Box: ${money(price.boxPrice)} + shipping: ${money(price.shipping)}</p>`;

    summary.innerHTML = `
        ${shippingLine}
        <p><strong>Today: ${money(price.charge)}</strong> for your first box, which ships right away.</p>
        <p>Then <strong>${money(price.charge)}</strong> on <strong>${escapeHtml(subscriptionPrettyDate(plan.first_renewal_date))}</strong>,
           and ${subscriptionFrequencyText(plan.interval_months)} after that, on the 1st.</p>
        <p class="checkout-note">Your price is locked in. Boxes ship on the 1st.</p>
    `;

}

async function openSubscriptionSignup(planId) {

    const plan = subscriptionPlans.find(p => p.id === planId);

    if (!plan) {
        return;
    }

    if (!currentSession) {
        alert("Please log in or create an account to subscribe. That way you can see and manage your subscription later.");
        openAccountModal();
        return;
    }

    subscriptionSignupPlan = plan;

    const modal = ensureSubscriptionModal();

    document.getElementById("subscriptionModalTitle").textContent = plan.name;
    document.getElementById("subscriptionModalFrequency").textContent = `Ships ${subscriptionFrequencyText(plan.interval_months)}.`;
    document.getElementById("subscriptionError").textContent = "";

    const sizeGroup = document.getElementById("subscriptionSizeGroup");
    const sizeSelect = document.getElementById("subscriptionSize");

    if (plan.options && plan.options.length > 0) {
        sizeSelect.innerHTML = plan.options
            .map(o => `<option value="${escapeHtml(o.label)}">${escapeHtml(o.label)}: ${money(o.price)}</option>`)
            .join("");
        sizeGroup.classList.remove("hidden");
    } else {
        sizeSelect.innerHTML = "";
        sizeGroup.classList.add("hidden");
    }

    renderSubscriptionSummary();

    const continueButton = document.getElementById("subscriptionContinueButton");
    continueButton.disabled = false;
    continueButton.textContent = "Continue to PayPal";

    modal.classList.add("open");

}

function closeSubscriptionSignup() {
    const modal = document.getElementById("subscriptionModal");
    if (modal) {
        modal.classList.remove("open");
    }
}

async function startSubscriptionCheckout() {

    const errorEl = document.getElementById("subscriptionError");
    const form = document.getElementById("subscriptionForm");
    const button = document.getElementById("subscriptionContinueButton");

    errorEl.textContent = "";

    if (!form.reportValidity()) {
        return;
    }

    const price = selectedSubscriptionPrice();

    if (!price) {
        errorEl.textContent = "Please choose a size.";
        return;
    }

    if (!currentSession) {
        closeSubscriptionSignup();
        openAccountModal();
        return;
    }

    const value = id => document.getElementById(id).value;

    button.disabled = true;
    button.textContent = "Connecting to PayPal…";

    try {

        const response = await fetch("/api/subscriptions/start", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
                plan_id: subscriptionSignupPlan.id,
                option_label: price.optionLabel,
                customer: {
                    name: value("subName"),
                    phone: value("subPhone"),
                    address1: value("subAddress1"),
                    address2: value("subAddress2"),
                    city: value("subCity"),
                    state: value("subState"),
                    zip: value("subZip"),
                    notes: value("subNotes")
                }
            })
        });

        const data = await response.json();

        if (!response.ok || !data.approveUrl) {
            throw new Error(data.error || "Could not start the subscription. Please try again.");
        }

        window.location.href = data.approveUrl;

    } catch (err) {
        errorEl.textContent = err.message;
        button.disabled = false;
        button.textContent = "Continue to PayPal";
    }

}

/* ---------- Confirmation page (subscription-confirmed.html) ---------- */

async function confirmSubscriptionReturn() {

    const box = document.getElementById("subscriptionConfirmBox");

    if (!box) {
        return;
    }

    const id = new URLSearchParams(window.location.search).get("sub") || "";

    const show = html => { box.innerHTML = html; };

    // The login check finishes a moment after the page loads.
    for (let waited = 0; !currentSession && waited < 6000; waited += 250) {
        await new Promise(resolve => setTimeout(resolve, 250));
    }

    if (!currentSession) {
        show(`<h2>Almost done</h2><p>Please log in, then refresh this page to finish confirming your subscription.</p>
              <button type="button" class="primary-button" id="subscriptionConfirmLogin">Log In</button>`);
        document.getElementById("subscriptionConfirmLogin").addEventListener("click", openAccountModal);
        return;
    }

    for (let attempt = 0; attempt < 8; attempt++) {

        try {

            const response = await fetch("/api/subscriptions/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ id })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Could not check your subscription.");
            }

            if (data.status === "active") {
                show(`
                    <p class="eyebrow">YOU'RE SUBSCRIBED</p>
                    <h2>Thank you!</h2>
                    <p>Your <strong>${escapeHtml(data.planName)}${data.optionLabel ? ` (${escapeHtml(data.optionLabel)})` : ""}</strong> subscription is all set.</p>
                    <p>Your first box ships soon. Your next payment of <strong>${money(data.charge)}</strong>
                       will be on <strong>${escapeHtml(data.firstRenewalPretty)}</strong>, then ${subscriptionFrequencyText(data.intervalMonths)} after that.</p>
                    <p>You'll get an email confirmation for each box.</p>
                    <a class="primary-button" href="shop.html">Back to the Shop</a>
                `);
                return;
            }

            if (data.status !== "processing") {
                show(`<h2>Subscription not finished</h2>
                      <p>It looks like the subscription wasn't completed on PayPal, so you weren't charged.</p>
                      <a class="primary-button" href="shop.html#subscriptions">Try Again</a>`);
                return;
            }

        } catch (err) {
            show(`<h2>Something went wrong</h2><p>${escapeHtml(err.message)}</p>
                  <p>If PayPal showed that you subscribed, don't sign up again. Contact us at Ashley@cornerbarr.com and we'll sort it out.</p>`);
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 3000));

    }

    show(`<h2>Still finishing up</h2>
          <p>PayPal is still processing your subscription. You don't need to do anything, and please don't sign up again.
             You'll get an email as soon as it's confirmed.</p>
          <a class="primary-button" href="shop.html">Back to the Shop</a>`);

}


// On the shop page, show the subscription boxes as soon as the page loads.
if (document.getElementById("subscriptions")) {
    loadSubscriptionSection();
}
