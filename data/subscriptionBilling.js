// data/subscriptionBilling.js
//
// Subscriptions, Phase 2: customers signing up and paying, through
// PayPal Subscriptions (PayPal charges the card automatically).
//
// How a subscription works (agreed with Ashley):
//   - At signup the customer pays for their first box right away, and it
//     ships like a normal order.
//   - After that PayPal charges them automatically on the 1st, and each
//     charge becomes a new order for Ashley to ship.
//   - Monthly boxes: the first automatic charge is on the 1st of next
//     month, or the month after that if they sign up after the 20th.
//   - Every-3-months boxes: the first automatic charge is on the 1st,
//     3 months after the month they signed up (Feb -> May 1).
//   - The price (box + shipping, if charged separately) is locked in at
//     signup. Ashley changing a price only affects new subscribers.
//
// Routes:
//   GET  /api/subscription-plans        -> boxes customers can sign up for
//   POST /api/subscriptions/start       -> starts a signup, returns the PayPal page (login required)
//   POST /api/subscriptions/confirm     -> after PayPal, confirms the signup (login required)
//
// Every payment is turned into an order by recordPayment(), which is safe
// to call more than once for the same payment: the database allows only
// one order per subscription per month. Payments arrive three ways (so
// none are ever missed): the confirm step, PayPal webhooks, and a
// background check every 6 hours.

const { notifyOrderReceived, notifyOwnerOfNewOrder, createNotification } = require("./notifications");
const { emailOwnerNewOrder, emailCustomerOrderReceived } = require("./email");

const SITE_URL = process.env.SITE_URL || "https://cornerbarr.com";
const SHOP_TIME_ZONE = "America/Los_Angeles";
const MONTHLY_CUTOFF_DAY = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYPAL_ID_PATTERN = /^[A-Za-z0-9-]{6,64}$/;
const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;
const MAX_PENDING_PER_HOUR = 5;

const PUBLIC_PLAN_COLUMNS = "id, name, description, image_url, interval_months, price, regular_price, options, shipping_included, shipping_price";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

class BillingError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status || 400;
    }
}

function round2(value) {
    return Math.round(Number(value) * 100) / 100;
}

/* ---------- Dates (always in the shop's time zone) ---------- */

// Today's date in Oregon, as { year, month (1-12), day }.
function shopToday(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: SHOP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
    }).format(now).split("-").map(Number);
    return { year: parts[0], month: parts[1], day: parts[2] };
}

function addMonths({ year, month }, count) {
    const index = (year * 12 + (month - 1)) + count;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

// The date of the first automatic charge (always the 1st), as "YYYY-MM-01".
function firstRenewalDate(intervalMonths, now = new Date()) {
    const today = shopToday(now);
    const monthsAhead = intervalMonths === 3
        ? 3
        : (today.day <= MONTHLY_CUTOFF_DAY ? 1 : 2);
    const target = addMonths(today, monthsAhead);
    return `${target.year}-${String(target.month).padStart(2, "0")}-01`;
}

// "December 1, 2026"
function prettyDate(isoDate) {
    const [year, month, day] = isoDate.split("-").map(Number);
    return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

// Billing month of a payment, in the shop's time zone: "2026-12".
function periodKey(time) {
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    const today = shopToday(date);
    return `${today.year}-${String(today.month).padStart(2, "0")}`;
}

/* ---------- Plan helpers ---------- */

function planOptions(plan) {
    return Array.isArray(plan.options) ? plan.options : [];
}

// Customers only ever see (or can buy) a box that Ashley has published,
// with a price, a photo, and a description.
function isPlanLive(plan) {
    return Boolean(
        plan &&
        plan.is_active === true &&
        plan.price !== null && Number(plan.price) > 0 &&
        typeof plan.image_url === "string" && plan.image_url.trim() !== "" &&
        typeof plan.description === "string" && plan.description.trim() !== ""
    );
}

// What one box costs this customer: { boxPrice, shippingPrice, charge, optionLabel }.
function priceForSignup(plan, optionLabel) {

    const options = planOptions(plan);
    let boxPrice;
    let label = null;

    if (options.length > 0) {
        const wanted = typeof optionLabel === "string" ? optionLabel.trim().toLowerCase() : "";
        const match = options.find(o => String(o.label).toLowerCase() === wanted);
        if (!match) {
            throw new BillingError("Please choose a size.");
        }
        boxPrice = round2(match.price);
        label = match.label;
    } else {
        boxPrice = round2(plan.price);
    }

    const shippingPrice = plan.shipping_included ? 0 : round2(plan.shipping_price || 0);

    if (!(boxPrice > 0)) {
        throw new BillingError("This subscription isn't available right now.");
    }

    return { boxPrice, shippingPrice, charge: round2(boxPrice + shippingPrice), optionLabel: label };

}

function publicPlan(plan, now) {
    return {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        image_url: plan.image_url,
        interval_months: plan.interval_months,
        price: plan.price === null ? null : Number(plan.price),
        regular_price: plan.regular_price === null ? null : Number(plan.regular_price),
        options: planOptions(plan).map(o => ({ label: o.label, price: Number(o.price) })),
        shipping_included: plan.shipping_included,
        shipping_price: Number(plan.shipping_price || 0),
        first_renewal_date: firstRenewalDate(Number(plan.interval_months), now)
    };
}

/* ---------- Customer details ---------- */

function cleanField(value, maxLength) {
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ").substring(0, maxLength) : "";
}

function validateCustomer(input) {

    const c = input || {};
    const errors = [];

    const customer = {
        name: cleanField(c.name, 100),
        phone: cleanField(c.phone, 30),
        notes: typeof c.notes === "string" ? c.notes.trim().substring(0, 500) : "",
        address1: cleanField(c.address1, 200),
        address2: cleanField(c.address2, 200),
        city: cleanField(c.city, 100),
        state: cleanField(c.state, 3).toUpperCase(),
        zip: cleanField(c.zip, 10)
    };

    if (!customer.name) errors.push("Please enter your name.");
    if (!customer.address1) errors.push("Street address is required.");
    if (!customer.city) errors.push("City is required.");
    if (!/^[A-Z]{2}$/.test(customer.state)) errors.push("Please enter your state as 2 letters (like OR).");
    if (!/^\d{5}(-\d{4})?$/.test(customer.zip)) errors.push("Please enter a valid ZIP code.");

    return { errors, customer };

}

/* ---------- Module ---------- */

function createSubscriptionBilling({ supabaseAdmin, getPayPalAccessToken, paypalApiBase }) {

    async function paypal(method, path, body, requestId) {

        const accessToken = await getPayPalAccessToken();
        const headers = {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        };
        if (requestId) {
            headers["PayPal-Request-Id"] = requestId;
        }

        const response = await fetch(`${paypalApiBase}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });

        let data = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }

        if (!response.ok) {
            console.error(`PayPal ${method} ${path} failed:`, response.status, JSON.stringify(data));
            throw new BillingError("PayPal had a problem setting up the subscription. Please try again in a minute.", 502);
        }

        return data;

    }

    async function notifyOwner(title, body) {
        const { data: owner } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("role", "owner")
            .limit(1)
            .maybeSingle();
        if (owner) {
            await createNotification({ userId: owner.id, type: "subscription_alert", title, body });
        }
    }

    // Makes sure the box has a PayPal product and plan with the right
    // billing frequency. Each subscriber's actual price is set on their own
    // subscription, so Ashley changing a price never needs a new plan.
    async function ensurePayPalPlan(plan) {

        const interval = Number(plan.interval_months);

        if (plan.paypal_plan_id && Number(plan.paypal_plan_interval) === interval) {
            return plan.paypal_plan_id;
        }

        let productId = plan.paypal_product_id;

        if (!productId) {
            const product = await paypal("POST", "/v1/catalogs/products", {
                name: String(plan.name).substring(0, 127),
                description: String(plan.description || plan.name).substring(0, 256),
                type: "PHYSICAL"
            }, `cb-product-${plan.id}`);
            productId = product.id;
            await supabaseAdmin.from("subscription_plans").update({ paypal_product_id: productId }).eq("id", plan.id);
        }

        const created = await paypal("POST", "/v1/billing/plans", {
            product_id: productId,
            name: `${String(plan.name).substring(0, 100)} (every ${interval === 1 ? "month" : "3 months"})`,
            description: String(plan.description || plan.name).substring(0, 127),
            status: "ACTIVE",
            billing_cycles: [{
                frequency: { interval_unit: "MONTH", interval_count: interval },
                tenure_type: "REGULAR",
                sequence: 1,
                total_cycles: 0,
                pricing_scheme: { fixed_price: { value: Number(plan.price).toFixed(2), currency_code: "USD" } }
            }],
            payment_preferences: {
                auto_bill_outstanding: true,
                setup_fee: { value: "0", currency_code: "USD" },
                setup_fee_failure_action: "CANCEL",
                payment_failure_threshold: 2
            }
        }, `cb-plan-${plan.id}-${interval}`);

        await supabaseAdmin
            .from("subscription_plans")
            .update({ paypal_plan_id: created.id, paypal_plan_interval: interval })
            .eq("id", plan.id);

        return created.id;

    }

    // Turns one PayPal payment into an order. Returns true if a new order
    // was created, false if this payment already has one.
    async function recordPayment(sub, payment) {

        const key = periodKey(payment.time);
        const gross = round2(payment.amount);

        if (!key || !(gross > 0)) {
            console.error("Subscription payment with no usable date or amount:", sub.id, payment);
            return false;
        }

        const shippingCost = round2(Math.min(Number(sub.shipping_price || 0), gross));
        const subtotal = round2(gross - shippingCost);
        const itemName = `${sub.plan_name}${sub.option_label ? ` (${sub.option_label})` : ""} (subscription)`;

        const { data: order, error } = await supabaseAdmin
            .from("orders")
            .insert({
                user_id: sub.user_id,
                customer_name: sub.customer_name,
                customer_email: sub.customer_email,
                customer_phone: sub.customer_phone,
                customer_notes: sub.customer_notes,
                customer_address1: sub.customer_address1,
                customer_address2: sub.customer_address2,
                customer_city: sub.customer_city,
                customer_state: sub.customer_state,
                customer_zip: sub.customer_zip,
                paypal_capture_status: "COMPLETED",
                subtotal,
                shipping_cost: shippingCost,
                shipping_method_name: "Subscription box",
                items: [{
                    name: itemName,
                    quantity: 1,
                    unitPrice: subtotal,
                    lineTotal: subtotal,
                    subscription: true,
                    subscriptionInterval: sub.interval_months
                }],
                paypal_fee: payment.fee !== null && payment.fee !== undefined && Number.isFinite(Number(payment.fee)) ? round2(payment.fee) : null,
                subscription_id: sub.id,
                subscription_payment_id: payment.id ? String(payment.id).substring(0, 64) : null,
                subscription_period: key
            })
            .select()
            .single();

        if (error) {
            if (error.code === "23505") {
                return false; // This month's box already has an order.
            }
            console.error("CRITICAL - subscription payment received but order NOT saved:", sub.id, payment, error);
            return false;
        }

        await notifyOrderReceived(sub.user_id, order.id);
        await notifyOwnerOfNewOrder(order);
        emailOwnerNewOrder(order).catch(err => console.error("New order email failed:", err));
        emailCustomerOrderReceived(order).catch(err => console.error("Order confirmation email failed:", err));

        return true;

    }

    // Asks PayPal for every payment on this subscription and makes sure
    // each one has an order.
    async function syncPayments(sub) {

        if (!sub.paypal_subscription_id) {
            return 0;
        }

        const start = new Date(new Date(sub.created_at).getTime() - 24 * 60 * 60 * 1000).toISOString();
        const end = new Date().toISOString();

        const data = await paypal(
            "GET",
            `/v1/billing/subscriptions/${encodeURIComponent(sub.paypal_subscription_id)}/transactions?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`
        );

        let created = 0;

        for (const txn of (data && data.transactions) || []) {
            if (txn.status !== "COMPLETED" && txn.status !== "PARTIALLY_REFUNDED") {
                continue;
            }
            const made = await recordPayment(sub, {
                id: txn.id,
                amount: txn.amount_with_breakdown?.gross_amount?.value,
                fee: txn.amount_with_breakdown?.fee_amount?.value,
                time: txn.time
            });
            if (made) {
                created++;
            }
        }

        return created;

    }

    // The first box is paid at signup (PayPal's "setup fee"). PayPal only
    // marks the subscription ACTIVE once that payment succeeds, so if PayPal
    // hasn't listed the payment yet, the first box's order is made from the
    // locked-in price. The one-order-per-month rule means the real payment,
    // when it shows up, never makes a second order.
    async function ensureFirstBoxOrder(sub) {

        const { count, error } = await supabaseAdmin
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("subscription_id", sub.id);

        if (error) {
            console.error("Could not check for a subscription's first order:", sub.id, error);
            return false;
        }

        if ((count || 0) > 0) {
            return false;
        }

        return recordPayment(sub, {
            id: null,
            amount: sub.charge_amount,
            fee: null,
            time: sub.activated_at || new Date().toISOString()
        });

    }

    async function setStatus(sub, status, extra = {}) {
        const { data } = await supabaseAdmin
            .from("subscriptions")
            .update({ status, updated_at: new Date().toISOString(), ...extra })
            .eq("id", sub.id)
            .select()
            .maybeSingle();
        return data || { ...sub, status, ...extra };
    }

    // Brings our record in line with PayPal's. Returns the updated record.
    async function refreshFromPayPal(sub) {

        const remote = await paypal("GET", `/v1/billing/subscriptions/${encodeURIComponent(sub.paypal_subscription_id)}`);

        // Make sure this PayPal subscription really is the one we started.
        if (remote.custom_id !== sub.id) {
            console.error("PayPal subscription does not match our record:", sub.id, remote.id, remote.custom_id);
            throw new BillingError("We couldn't match this subscription. Please contact us.", 409);
        }

        const remoteStatus = remote.status;

        if (remoteStatus === "ACTIVE" && sub.status !== "active" && sub.status !== "paused") {
            sub = await setStatus(sub, "active", { activated_at: sub.activated_at || new Date().toISOString() });
        } else if (remoteStatus === "CANCELLED" && sub.status !== "cancelled") {
            sub = await setStatus(sub, "cancelled", { cancelled_at: new Date().toISOString() });
        } else if (remoteStatus === "EXPIRED" && sub.status !== "expired") {
            sub = await setStatus(sub, "expired");
        } else if (remoteStatus === "SUSPENDED" && sub.status === "active") {
            // Phase 2 has no customer pause, so a suspension means PayPal
            // stopped it after failed payments.
            sub = await setStatus(sub, "payment_failed");
            await notifyOwner("A subscription payment failed", `${sub.customer_name || "A subscriber"}'s ${sub.plan_name} subscription was paused by PayPal after failed payments.`);
        }

        return { sub, remoteStatus };

    }

    async function findByPayPalId(paypalSubscriptionId) {
        if (!PAYPAL_ID_PATTERN.test(String(paypalSubscriptionId || ""))) {
            return null;
        }
        const { data } = await supabaseAdmin
            .from("subscriptions")
            .select("*")
            .eq("paypal_subscription_id", paypalSubscriptionId)
            .maybeSingle();
        return data || null;
    }

    /* ---------- Webhooks (signature already checked by server.js) ---------- */

    async function handleWebhookEvent(event) {

        const type = event && event.event_type;
        const resource = (event && event.resource) || {};

        if (type === "PAYMENT.SALE.COMPLETED") {
            const sub = await findByPayPalId(resource.billing_agreement_id);
            if (!sub) {
                return false;
            }
            if (sub.status === "pending") {
                await setStatus(sub, "active", { activated_at: new Date().toISOString() });
            }
            await recordPayment(sub, {
                id: resource.id,
                amount: resource.amount?.total,
                fee: resource.transaction_fee?.value,
                time: resource.create_time || new Date().toISOString()
            });
            return true;
        }

        if (typeof type === "string" && type.startsWith("BILLING.SUBSCRIPTION.")) {

            const sub = await findByPayPalId(resource.id);
            if (!sub) {
                return false;
            }

            if (type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED") {
                await notifyOwner("A subscription payment failed", `PayPal couldn't charge ${sub.customer_name || "a subscriber"} for their ${sub.plan_name}. PayPal will try again.`);
                return true;
            }

            const { sub: updated, remoteStatus } = await refreshFromPayPal(sub);

            if (type === "BILLING.SUBSCRIPTION.CANCELLED" && remoteStatus === "CANCELLED") {
                await notifyOwner("A subscription was cancelled", `${updated.customer_name || "A subscriber"} cancelled their ${updated.plan_name} subscription.`);
            }

            if (remoteStatus === "ACTIVE") {
                await syncPayments(updated).catch(err => console.error("Subscription payment check failed:", updated.id, err.message));
                await ensureFirstBoxOrder(updated);
            }

            return true;
        }

        return false;

    }

    /* ---------- Background check every 6 hours ---------- */

    async function syncAll() {

        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

        const { data: subs, error } = await supabaseAdmin
            .from("subscriptions")
            .select("*")
            .not("paypal_subscription_id", "is", null)
            .or(`status.in.(active,payment_failed,paused),and(status.eq.pending,created_at.gte.${twoDaysAgo})`);

        if (error) {
            console.error("Subscription background check could not load subscriptions:", error);
            return;
        }

        for (const sub of subs || []) {
            try {
                const { sub: updated, remoteStatus } = await refreshFromPayPal(sub);
                if (remoteStatus === "ACTIVE" || remoteStatus === "SUSPENDED" || remoteStatus === "CANCELLED") {
                    await syncPayments(updated).catch(err => console.error("Subscription payment check failed:", updated.id, err.message));
                }
                if (remoteStatus === "ACTIVE") {
                    await ensureFirstBoxOrder(updated);
                }
            } catch (err) {
                console.error("Subscription background check failed for", sub.id, err.message);
            }
        }

    }

    function startBackgroundSync() {
        setTimeout(() => {
            syncAll().catch(err => console.error("Subscription background check failed:", err));
            setInterval(() => {
                syncAll().catch(err => console.error("Subscription background check failed:", err));
            }, SYNC_EVERY_MS);
        }, 2 * 60 * 1000);
    }

    return {
        ensurePayPalPlan,
        recordPayment,
        syncPayments,
        ensureFirstBoxOrder,
        refreshFromPayPal,
        handleWebhookEvent,
        syncAll,
        startBackgroundSync,
        paypal
    };

}

function registerSubscriptionBillingRoutes(app, { requireLogin, supabaseAdmin, billing }) {

    async function loadPlan(planId) {
        if (!UUID_PATTERN.test(String(planId || ""))) {
            return null;
        }
        const { data, error } = await supabaseAdmin
            .from("subscription_plans")
            .select("*")
            .eq("id", planId)
            .maybeSingle();
        if (error) {
            console.error("Could not load subscription plan:", error);
            throw new BillingError("Could not load this subscription. Please try again.", 502);
        }
        return data;
    }

    function sendError(res, err, fallback) {
        if (err instanceof BillingError) {
            return res.status(err.status).json({ error: err.message });
        }
        console.error(fallback, err);
        return res.status(500).json({ error: fallback });
    }

    // Boxes customers can sign up for: published, with a price and a photo.
    app.get("/api/subscription-plans", async (req, res) => {

        const { data, error } = await supabaseAdmin
            .from("subscription_plans")
            .select(`${PUBLIC_PLAN_COLUMNS}, is_active`)
            .eq("is_active", true)
            .not("price", "is", null)
            .not("image_url", "is", null)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true });

        if (error) {
            console.error("Could not load public subscription plans:", error);
            return res.status(502).json({ error: "Could not load subscriptions." });
        }

        const now = new Date();
        res.json(data.filter(isPlanLive).map(plan => publicPlan(plan, now)));

    });

    app.post("/api/subscriptions/start", requireLogin, async (req, res) => {

        try {

            const plan = await loadPlan(req.body?.plan_id);

            if (!isPlanLive(plan)) {
                throw new BillingError("This subscription isn't available right now.", 404);
            }

            const pricing = priceForSignup(plan, req.body?.option_label);

            const { errors, customer } = validateCustomer(req.body?.customer);
            if (errors.length > 0) {
                throw new BillingError(errors.join(" "));
            }

            const email = req.auth.user.email;
            if (!email) {
                throw new BillingError("Your account needs an email address to subscribe.");
            }

            // Stops runaway repeated signups (e.g. a stuck button).
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            const { count } = await supabaseAdmin
                .from("subscriptions")
                .select("id", { count: "exact", head: true })
                .eq("user_id", req.auth.user.id)
                .eq("status", "pending")
                .gte("created_at", oneHourAgo);
            if ((count || 0) >= MAX_PENDING_PER_HOUR) {
                throw new BillingError("Too many signup attempts. Please wait a little while and try again.", 429);
            }

            const paypalPlanId = await billing.ensurePayPalPlan(plan);
            const renewalDate = firstRenewalDate(Number(plan.interval_months));

            const { data: sub, error: insertError } = await supabaseAdmin
                .from("subscriptions")
                .insert({
                    plan_id: plan.id,
                    user_id: req.auth.user.id,
                    status: "pending",
                    paypal_plan_id: paypalPlanId,
                    plan_name: plan.name,
                    option_label: pricing.optionLabel,
                    interval_months: Number(plan.interval_months),
                    box_price: pricing.boxPrice,
                    shipping_price: pricing.shippingPrice,
                    charge_amount: pricing.charge,
                    first_renewal_date: renewalDate,
                    customer_name: customer.name,
                    customer_email: email,
                    customer_phone: customer.phone || null,
                    customer_notes: customer.notes || null,
                    customer_address1: customer.address1,
                    customer_address2: customer.address2 || null,
                    customer_city: customer.city,
                    customer_state: customer.state,
                    customer_zip: customer.zip
                })
                .select()
                .single();

            if (insertError) {
                console.error("Could not save new subscription:", insertError);
                throw new BillingError("Could not start the subscription. Please try again.", 502);
            }

            const charge = pricing.charge.toFixed(2);

            const created = await billing.paypal("POST", "/v1/billing/subscriptions", {
                plan_id: paypalPlanId,
                start_time: `${renewalDate}T16:00:00Z`,
                custom_id: sub.id,
                subscriber: {
                    email_address: email,
                    shipping_address: {
                        name: { full_name: customer.name },
                        address: {
                            address_line_1: customer.address1,
                            ...(customer.address2 ? { address_line_2: customer.address2 } : {}),
                            admin_area_2: customer.city,
                            admin_area_1: customer.state,
                            postal_code: customer.zip,
                            country_code: "US"
                        }
                    }
                },
                // This customer's locked-in price: the first box is charged
                // right away (setup fee), then the same amount on each 1st.
                plan: {
                    billing_cycles: [{
                        sequence: 1,
                        total_cycles: 0,
                        pricing_scheme: { fixed_price: { value: charge, currency_code: "USD" } }
                    }],
                    payment_preferences: {
                        auto_bill_outstanding: true,
                        setup_fee: { value: charge, currency_code: "USD" },
                        setup_fee_failure_action: "CANCEL",
                        payment_failure_threshold: 2
                    }
                },
                application_context: {
                    brand_name: "Corner Barr",
                    shipping_preference: "SET_PROVIDED_ADDRESS",
                    user_action: "SUBSCRIBE_NOW",
                    return_url: `${SITE_URL}/subscription-confirmed.html?sub=${sub.id}`,
                    cancel_url: `${SITE_URL}/shop.html#subscriptions`
                }
            }, `cb-sub-${sub.id}`);

            const approveLink = (created.links || []).find(link => link.rel === "approve");

            if (!created.id || !approveLink || !/^https:\/\/(www\.)?(sandbox\.)?paypal\.com\//i.test(approveLink.href)) {
                console.error("PayPal subscription created without a usable approve link:", JSON.stringify(created));
                throw new BillingError("PayPal had a problem setting up the subscription. Please try again.", 502);
            }

            await supabaseAdmin
                .from("subscriptions")
                .update({ paypal_subscription_id: created.id, updated_at: new Date().toISOString() })
                .eq("id", sub.id);

            res.json({ approveUrl: approveLink.href });

        } catch (err) {
            sendError(res, err, "Could not start the subscription.");
        }

    });

    // After the customer approves on PayPal's page and comes back.
    app.post("/api/subscriptions/confirm", requireLogin, async (req, res) => {

        try {

            const id = String(req.body?.id || "");

            if (!UUID_PATTERN.test(id)) {
                throw new BillingError("Subscription not found.", 404);
            }

            const { data: sub, error } = await supabaseAdmin
                .from("subscriptions")
                .select("*")
                .eq("id", id)
                .eq("user_id", req.auth.user.id)
                .maybeSingle();

            if (error) {
                console.error("Could not load subscription to confirm:", error);
                throw new BillingError("Could not check your subscription. Please refresh the page.", 502);
            }

            if (!sub || !sub.paypal_subscription_id) {
                throw new BillingError("Subscription not found.", 404);
            }

            const { sub: updated, remoteStatus } = await billing.refreshFromPayPal(sub);

            if (remoteStatus === "ACTIVE") {
                await billing.syncPayments(updated).catch(err => console.error("Subscription payment check failed:", updated.id, err.message));
                await billing.ensureFirstBoxOrder(updated);
                return res.json({
                    status: "active",
                    planName: updated.plan_name,
                    optionLabel: updated.option_label,
                    charge: Number(updated.charge_amount),
                    intervalMonths: updated.interval_months,
                    firstRenewalDate: updated.first_renewal_date,
                    firstRenewalPretty: prettyDate(String(updated.first_renewal_date).substring(0, 10))
                });
            }

            if (remoteStatus === "APPROVED" || remoteStatus === "APPROVAL_PENDING") {
                return res.json({ status: "processing" });
            }

            return res.json({ status: "not_active" });

        } catch (err) {
            sendError(res, err, "Could not confirm the subscription.");
        }

    });

}

module.exports = {
    createSubscriptionBilling,
    registerSubscriptionBillingRoutes,
    // Exported for testing.
    firstRenewalDate,
    periodKey,
    priceForSignup,
    validateCustomer,
    prettyDate
};
