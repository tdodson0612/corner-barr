// data/subscriptions.js
//
// Subscription boxes (Phase 1: the owner's side only).
//
// Ashley sets up each box in Manage Shop > Subscriptions: name,
// description, photo, how often it ships, price, optional "regular price"
// (to show the subscriber discount), and whether shipping is included or
// charged separately. Each box has an On/Off switch, and can only be
// switched on once it has a price.
//
// Nothing here is shown to customers yet. The customer sign-up and
// PayPal billing come in Phase 2.
//
//   GET    /api/admin/subscription-plans       -> all boxes (owner only)
//   POST   /api/admin/subscription-plans       -> add a new box (owner only)
//   PUT    /api/admin/subscription-plans/:id   -> save changes (owner only)
//   DELETE /api/admin/subscription-plans/:id   -> delete a box (owner only)

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_PRICE = 1000;
const MAX_SHIPPING = 100;

const MAX_OPTIONS = 10;

const PLAN_COLUMNS = "id, name, description, image_url, interval_months, price, regular_price, options, shipping_included, shipping_price, is_active, sort_order, created_at";

function cleanText(value, maxLength) {
    return typeof value === "string" ? value.trim().substring(0, maxLength) : "";
}

// Money from the form: "" or null means "not set". Otherwise a number with
// at most 2 decimal places, inside the allowed range.
function parseMoney(value, { min, max, label, allowEmpty }) {

    if (value === null || value === undefined || value === "") {
        if (allowEmpty) {
            return { value: null };
        }
        return { error: `${label} is required.` };
    }

    const number = Number(value);

    if (!Number.isFinite(number)) {
        return { error: `${label} must be a number.` };
    }

    if (Math.round(number * 100) !== Number((number * 100).toFixed(6))) {
        return { error: `${label} can't have more than 2 decimal places.` };
    }

    if (number < min || number > max) {
        return { error: `${label} must be between $${min.toFixed(2)} and $${max.toFixed(2)}.` };
    }

    return { value: Math.round(number * 100) / 100 };

}

function validatePlan(body, supabaseUrl) {

    const errors = [];
    const input = body || {};

    const name = cleanText(input.name, 80).replace(/\s+/g, " ");
    if (!name) {
        errors.push("Please give the subscription a name.");
    }

    const description = cleanText(input.description, 1000);

    let imageUrl = null;
    if (typeof input.image_url === "string" && input.image_url.trim()) {
        const allowedPrefix = `${supabaseUrl}/storage/v1/object/public/product-images/`;
        const candidate = input.image_url.trim();
        if (!candidate.startsWith(allowedPrefix) || candidate.length > 500) {
            errors.push("That photo couldn't be used. Please upload it again.");
        } else {
            imageUrl = candidate;
        }
    }

    const intervalMonths = Number(input.interval_months);
    if (intervalMonths !== 1 && intervalMonths !== 3) {
        errors.push("Please choose how often it ships.");
    }

    // Size options (like candle sizes). When there are options, each has
    // its own price and the box's price is the lowest one.
    const options = [];
    const rawOptions = Array.isArray(input.options) ? input.options : [];

    if (rawOptions.length > MAX_OPTIONS) {
        errors.push(`A box can have at most ${MAX_OPTIONS} size options.`);
    }

    rawOptions.slice(0, MAX_OPTIONS).forEach((option, index) => {
        const label = cleanText(option && option.label, 40).replace(/\s+/g, " ");
        const optionPrice = parseMoney(option && option.price, { min: 1, max: MAX_PRICE, label: `Price for option ${index + 1}`, allowEmpty: false });
        if (!label) {
            errors.push(`Option ${index + 1} needs a name (like "12 oz").`);
        } else if (options.some(o => o.label.toLowerCase() === label.toLowerCase())) {
            errors.push(`There are two options called "${label}".`);
        }
        if (optionPrice.error) {
            errors.push(optionPrice.error);
        }
        if (label && !optionPrice.error) {
            options.push({ label, price: optionPrice.value });
        }
    });

    const hasOptions = rawOptions.length > 0;

    let price = hasOptions
        ? { value: options.length > 0 ? Math.min(...options.map(o => o.price)) : null }
        : parseMoney(input.price, { min: 1, max: MAX_PRICE, label: "Price", allowEmpty: true });
    if (price.error) {
        errors.push(price.error);
    }

    const regularPrice = hasOptions
        ? { value: null }
        : parseMoney(input.regular_price, { min: 1, max: MAX_PRICE, label: "Regular price", allowEmpty: true });
    if (regularPrice.error) {
        errors.push(regularPrice.error);
    }

    if (!price.error && !regularPrice.error && regularPrice.value !== null) {
        if (price.value === null) {
            errors.push("Set the subscription price before adding a regular price.");
        } else if (regularPrice.value <= price.value) {
            errors.push("The regular price should be higher than the subscription price (it shows how much subscribers save). Leave it blank if there's no discount.");
        }
    }

    const shippingIncluded = input.shipping_included !== false;

    let shippingPrice = { value: 0 };
    if (!shippingIncluded) {
        shippingPrice = parseMoney(input.shipping_price, { min: 0, max: MAX_SHIPPING, label: "Shipping charge", allowEmpty: false });
        if (shippingPrice.error) {
            errors.push(shippingPrice.error);
        }
    }

    const isActive = input.is_active === true;

    if (isActive) {
        if (price.value === null && !price.error && options.length === rawOptions.length) {
            errors.push("Set a price before switching this subscription on.");
        }
        if (!description) {
            errors.push("Add a description before switching this subscription on, so customers know what's in the box.");
        }
    }

    return {
        errors,
        clean: {
            name,
            description,
            image_url: imageUrl,
            interval_months: intervalMonths,
            price: price.value ?? null,
            regular_price: regularPrice.value ?? null,
            options,
            shipping_included: shippingIncluded,
            shipping_price: shippingIncluded ? 0 : (shippingPrice.value ?? 0),
            is_active: isActive
        }
    };

}

module.exports = function registerSubscriptionRoutes(app, { requireOwner, supabaseAdmin }) {

    const supabaseUrl = process.env.SUPABASE_URL;

    app.get("/api/admin/subscription-plans", requireOwner, async (req, res) => {

        const { data, error } = await supabaseAdmin
            .from("subscription_plans")
            .select(PLAN_COLUMNS)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true });

        if (error) {
            console.error("Could not load subscription plans:", error);
            return res.status(502).json({ error: "Could not load subscriptions." });
        }

        res.json(data);

    });

    app.post("/api/admin/subscription-plans", requireOwner, async (req, res) => {

        const name = cleanText(req.body?.name, 80).replace(/\s+/g, " ");

        if (!name) {
            return res.status(400).json({ error: "Please give the new subscription a name." });
        }

        const { data: last, error: lastError } = await supabaseAdmin
            .from("subscription_plans")
            .select("sort_order")
            .order("sort_order", { ascending: false })
            .limit(1);

        if (lastError) {
            console.error("Could not read subscription order:", lastError);
            return res.status(502).json({ error: "Could not add the subscription." });
        }

        const nextOrder = (last && last.length > 0 ? Number(last[0].sort_order) || 0 : 0) + 1;

        // New boxes always start switched off with no price.
        const { data, error } = await supabaseAdmin
            .from("subscription_plans")
            .insert({ name, interval_months: 1, sort_order: nextOrder })
            .select(PLAN_COLUMNS)
            .single();

        if (error) {
            console.error("Could not add subscription plan:", error);
            return res.status(502).json({ error: "Could not add the subscription." });
        }

        res.status(201).json(data);

    });

    app.put("/api/admin/subscription-plans/:id", requireOwner, async (req, res) => {

        if (!UUID_PATTERN.test(String(req.params.id || ""))) {
            return res.status(404).json({ error: "Subscription not found." });
        }

        const { errors, clean } = validatePlan(req.body, supabaseUrl);

        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join(" ") });
        }

        const { data, error } = await supabaseAdmin
            .from("subscription_plans")
            .update({ ...clean, updated_at: new Date().toISOString() })
            .eq("id", req.params.id)
            .select(PLAN_COLUMNS)
            .maybeSingle();

        if (error) {
            console.error("Could not save subscription plan:", error);
            return res.status(502).json({ error: "Could not save the subscription." });
        }

        if (!data) {
            return res.status(404).json({ error: "Subscription not found." });
        }

        res.json(data);

    });

    app.delete("/api/admin/subscription-plans/:id", requireOwner, async (req, res) => {

        if (!UUID_PATTERN.test(String(req.params.id || ""))) {
            return res.status(404).json({ error: "Subscription not found." });
        }

        const { data, error } = await supabaseAdmin
            .from("subscription_plans")
            .delete()
            .eq("id", req.params.id)
            .select("id");

        if (error) {
            console.error("Could not delete subscription plan:", error);
            return res.status(502).json({ error: "Could not delete the subscription." });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: "Subscription not found." });
        }

        res.status(204).end();

    });

};

module.exports.validatePlan = validatePlan;
