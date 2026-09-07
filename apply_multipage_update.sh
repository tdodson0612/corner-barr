#!/usr/bin/env bash
set -e

# Run this from inside your corner-barr project folder:
#   cd ~/corner-barr
#   bash apply_multipage_update.sh
#
# It creates the new pages/partials/JS files, updates the files that
# changed, and deletes the old app.js (fully replaced by shared.js +
# shop.js + product.js + home.js).

echo "Creating folders..."
mkdir -p public/partials
mkdir -p public/js
mkdir -p public/css

echo "Writing server.js"
cat > "server.js" << 'EOF_SERVER_JS_'
require("dotenv").config();

const express = require("express");
const path = require("path");
const { priceCart } = require("./data/pricing");
const { resolveShippingCost } = require("./data/shipping");
const { supabaseAdmin } = require("./data/supabase");
const localOptions = require("./data/products.json");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_MODE = (process.env.PAYPAL_MODE || "sandbox").toLowerCase();
const PAYEE_EMAIL = process.env.PAYPAL_PAYEE_EMAIL || null;

const PAYPAL_API_BASE =
    PAYPAL_MODE === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    console.warn(
        "\n⚠️  PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set.\n" +
        "   Copy .env.example to .env and fill in your PayPal REST app credentials.\n"
    );
}

const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

/* =========================================
   PAYPAL AUTH (cached access token)
========================================= */

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getPayPalAccessToken() {
    if (cachedToken && Date.now() < cachedTokenExpiry) {
        return cachedToken;
    }

    const credentials = Buffer.from(
        `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
    ).toString("base64");

    const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`PayPal auth failed: ${response.status} ${text}`);
    }

    const data = await response.json();

    cachedToken = data.access_token;
    // Refresh a little early to be safe.
    cachedTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

    return cachedToken;
}

/* =========================================
   CONFIG (public keys only — safe to expose to the browser)
========================================= */

app.get("/api/config", (req, res) => {
    res.json({
        paypalClientId: PAYPAL_CLIENT_ID || null,
        paypalMode: PAYPAL_MODE,
        supabaseUrl: process.env.SUPABASE_URL || null,
        supabaseAnonKey: SUPABASE_ANON_KEY || null
    });
});

/* =========================================
   PRODUCTS (public read, from Supabase)
========================================= */

const CATEGORY_LABELS = {
    cutting_board: "Cutting Board",
    soap_candle: "Soap & Candle",
    holiday: "Holiday",
    resin_craft: "Resin Craft",
    jewelry: "Jewelry"
};

function mapProductRow(row) {

    const base = {
        id: row.id,
        name: row.name,
        description: row.description,
        price: Number(row.price),
        image_url: row.image_url || null,
        categoryKey: row.category,
        category: CATEGORY_LABELS[row.category] || row.category
    };

    if (row.category === "cutting_board") {
        return { ...base, boardClass: row.placeholder_class || null };
    }
    if (row.category === "soap_candle") {
        return { ...base, productClass: row.placeholder_class || null };
    }
    if (row.category === "holiday") {
        return { ...base, holidayText: row.placeholder_text || null };
    }
    return base;

}

app.get("/api/products", async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("products")
            .select("*")
            .order("created_at", { ascending: true });

        if (error) {
            console.error("Could not load products:", error);
            return res.status(502).json({ error: "Could not load products." });
        }

        const cuttingBoards = [];
        const soapCandles = [];
        const holidayProducts = [];
        const resinCrafts = [];
        const jewelryItems = [];

        for (const row of data) {

            const mapped = mapProductRow(row);

            if (row.category === "cutting_board") {
                cuttingBoards.push(mapped);
            } else if (row.category === "soap_candle") {
                soapCandles.push(mapped);
            } else if (row.category === "holiday") {
                holidayProducts.push(mapped);
            } else if (row.category === "resin_craft") {
                resinCrafts.push(mapped);
            } else if (row.category === "jewelry") {
                jewelryItems.push(mapped);
            }
        }

        res.json({
            cuttingBoards,
            soapCandles,
            holidayProducts,
            resinCrafts,
            jewelryItems,
            engravingStyles: localOptions.engravingStyles
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not load products." });
    }
});

// Single product, used by the item detail page.
app.get("/api/products/:id", async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("products")
            .select("*")
            .eq("id", req.params.id)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: "Product not found." });
        }

        res.json({
            product: mapProductRow(data),
            engravingStyles: data.category === "cutting_board" ? localOptions.engravingStyles : []
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not load this product." });
    }
});

/* =========================================
   SHIPPING (public read — needed at checkout)
========================================= */

app.get("/api/shipping", async (req, res) => {

    const [methodsResult, thresholdsResult] = await Promise.all([
        supabaseAdmin
            .from("shipping_methods")
            .select("*")
            .eq("active", true)
            .order("sort_order", { ascending: true }),
        supabaseAdmin
            .from("category_shipping_settings")
            .select("*")
    ]);

    if (methodsResult.error || thresholdsResult.error) {
        console.error(methodsResult.error || thresholdsResult.error);
        return res.status(502).json({ error: "Could not load shipping options." });
    }

    res.json({
        methods: methodsResult.data,
        thresholds: thresholdsResult.data
    });

});

/* =========================================
   AUTH HELPERS
========================================= */

// Reads "Authorization: Bearer <token>", validates it with Supabase, and
// looks up the caller's role. Returns { user, role } or null if there's
// no valid logged-in session. Uses the service role client so this check
// itself can never be blocked or spoofed by a client-side RLS bypass.
async function getAuthContext(req) {

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
        return null;
    }

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !userData?.user) {
        return null;
    }

    const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", userData.user.id)
        .single();

    if (profileError || !profile) {
        return { user: userData.user, role: "customer" };
    }

    return { user: userData.user, role: profile.role };
}

// Express middleware: rejects the request unless it comes from a logged-in
// owner. Attaches the auth context to req.auth for the route handler.
async function requireOwner(req, res, next) {

    const auth = await getAuthContext(req);

    if (!auth) {
        return res.status(401).json({ error: "You need to be logged in." });
    }

    if (auth.role !== "owner") {
        return res.status(403).json({ error: "Only the shop owner can do that." });
    }

    req.auth = auth;
    next();

}

// Express middleware: rejects the request unless it comes from any
// logged-in person (customer or owner). Attaches the auth context to
// req.auth for the route handler.
async function requireLogin(req, res, next) {

    const auth = await getAuthContext(req);

    if (!auth) {
        return res.status(401).json({ error: "You need to be logged in." });
    }

    req.auth = auth;
    next();

}

app.get("/api/me", async (req, res) => {

    const auth = await getAuthContext(req);

    if (!auth) {
        return res.json({ authenticated: false });
    }

    res.json({
        authenticated: true,
        email: auth.user.email,
        role: auth.role
    });

});

/* =========================================
   ADMIN — PRODUCT MANAGEMENT (owner only)
========================================= */

const ALLOWED_CATEGORIES = ["cutting_board", "soap_candle", "holiday", "resin_craft", "jewelry"];

function validateProductInput(body, { partial = false } = {}) {

    const errors = [];
    const clean = {};

    if (!partial || body.category !== undefined) {
        if (!ALLOWED_CATEGORIES.includes(body.category)) {
            errors.push("category must be one of: " + ALLOWED_CATEGORIES.join(", "));
        } else {
            clean.category = body.category;
        }
    }

    if (!partial || body.name !== undefined) {
        if (typeof body.name !== "string" || !body.name.trim()) {
            errors.push("name is required.");
        } else {
            clean.name = body.name.trim().substring(0, 200);
        }
    }

    if (!partial || body.description !== undefined) {
        clean.description = typeof body.description === "string"
            ? body.description.trim().substring(0, 2000)
            : "";
    }

    if (!partial || body.price !== undefined) {
        const price = Number(body.price);
        if (!Number.isFinite(price) || price < 0) {
            errors.push("price must be a non-negative number.");
        } else {
            clean.price = Math.round(price * 100) / 100;
        }
    }

    if (!partial || body.image_url !== undefined) {
        if (typeof body.image_url !== "string" || !body.image_url.trim()) {
            errors.push("image_url is required.");
        } else {
            clean.image_url = body.image_url.trim();
        }
    }

    return { errors, clean };
}

// List all products (same data as the public endpoint, but this one is
// what the admin panel calls so it's obviously part of the admin surface).
app.get("/api/admin/products", requireOwner, async (req, res) => {

    const { data, error } = await supabaseAdmin
        .from("products")
        .select("*")
        .order("created_at", { ascending: true });

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not load products." });
    }

    res.json(data);

});

app.post("/api/admin/products", requireOwner, async (req, res) => {

    const { errors, clean } = validateProductInput(req.body);

    if (errors.length > 0) {
        return res.status(400).json({ error: errors.join(" ") });
    }

    const { data, error } = await supabaseAdmin
        .from("products")
        .insert(clean)
        .select()
        .single();

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not create product." });
    }

    res.status(201).json(data);

});

app.put("/api/admin/products/:id", requireOwner, async (req, res) => {

    const { errors, clean } = validateProductInput(req.body, { partial: true });

    if (errors.length > 0) {
        return res.status(400).json({ error: errors.join(" ") });
    }

    if (Object.keys(clean).length === 0) {
        return res.status(400).json({ error: "Nothing to update." });
    }

    const { data, error } = await supabaseAdmin
        .from("products")
        .update(clean)
        .eq("id", req.params.id)
        .select()
        .single();

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not update product." });
    }

    res.json(data);

});

app.delete("/api/admin/products/:id", requireOwner, async (req, res) => {

    const { error } = await supabaseAdmin
        .from("products")
        .delete()
        .eq("id", req.params.id);

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not delete product." });
    }

    res.status(204).send();

});

/* =========================================
   CREATE ORDER
========================================= */

app.post("/api/orders", async (req, res) => {
    try {
        const { cart, shippingMethodId } = req.body;

        const { total, lines, categoryTotals } = await priceCart(cart);
        const { shippingCost } = await resolveShippingCost(categoryTotals, shippingMethodId);

        const grandTotal = Math.round((total + shippingCost) * 100) / 100;

        const accessToken = await getPayPalAccessToken();

        const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                intent: "CAPTURE",
                purchase_units: [
                    {
                        amount: {
                            currency_code: "USD",
                            value: grandTotal.toFixed(2),
                            breakdown: {
                                item_total: {
                                    currency_code: "USD",
                                    value: total.toFixed(2)
                                },
                                shipping: {
                                    currency_code: "USD",
                                    value: shippingCost.toFixed(2)
                                }
                            }
                        },
                        items: lines.map(line => ({
                            name: line.name.substring(0, 127),
                            unit_amount: {
                                currency_code: "USD",
                                value: line.unitPrice.toFixed(2)
                            },
                            quantity: String(line.quantity)
                        })),
                        description: "Corner Barr order",
                        // Send funds to a specific PayPal account rather than
                        // whichever account owns the API app credentials.
                        // Omit this entirely to default back to the app owner.
                        ...(PAYEE_EMAIL ? { payee: { email_address: PAYEE_EMAIL } } : {})
                    }
                ]
            })
        });

        const order = await response.json();

        if (!response.ok) {
            console.error("PayPal create order error:", order);
            return res.status(502).json({ error: "Could not create PayPal order." });
        }

        res.json({ id: order.id });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message || "Could not create order." });
    }
});

/* =========================================
   CAPTURE ORDER (after buyer approves) —
   this is also where the order record is created in the database.
========================================= */

app.post("/api/orders/:orderID/capture", async (req, res) => {
    try {
        const { orderID } = req.params;
        const { cart, customer, shippingMethodId } = req.body;

        // Re-verify price AND shipping at capture time too — cheap, and
        // protects against a stale/tampered cart or shipping selection.
        const { total, lines, categoryTotals } = await priceCart(cart);
        const { shippingCost, shippingMethodName } = await resolveShippingCost(categoryTotals, shippingMethodId);

        const accessToken = await getPayPalAccessToken();

        const response = await fetch(
            `${PAYPAL_API_BASE}/v2/checkout/orders/${orderID}/capture`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        const capture = await response.json();

        if (!response.ok) {
            console.error("PayPal capture error:", capture);
            return res.status(502).json({ error: "Could not capture payment." });
        }

        // If the customer was logged in, tie the order to their account so
        // they can see it in their order history. Guests (not logged in)
        // still get a working order — it just won't show up under anyone's
        // account, since there isn't one.
        const auth = await getAuthContext(req);

        const { error: insertError } = await supabaseAdmin
            .from("orders")
            .insert({
                user_id: auth ? auth.user.id : null,
                customer_name: customer?.name || null,
                customer_email: customer?.email || null,
                customer_phone: customer?.phone || null,
                customer_notes: customer?.notes || null,
                paypal_order_id: orderID,
                paypal_capture_status: capture.status || null,
                subtotal: total,
                shipping_cost: shippingCost,
                shipping_method_name: shippingMethodName,
                items: lines
            });

        if (insertError) {
            // Payment already succeeded at this point — don't fail the
            // customer's checkout over a logging problem, just log it
            // loudly so it can be investigated.
            console.error("Could not save order record after successful payment:", insertError);
        }

        res.json(capture);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message || "Could not capture order." });
    }
});

/* =========================================
   ORDER HISTORY — customer's own orders
========================================= */

app.get("/api/orders/mine", requireLogin, async (req, res) => {

    const { data, error } = await supabaseAdmin
        .from("orders")
        .select("*")
        .eq("user_id", req.auth.user.id)
        .order("created_at", { ascending: false });

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not load your orders." });
    }

    res.json(data);

});

/* =========================================
   ADMIN — ALL ORDERS + SHIPPING STATUS (owner only)
========================================= */

app.get("/api/admin/orders", requireOwner, async (req, res) => {

    const { data, error } = await supabaseAdmin
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not load orders." });
    }

    res.json(data);

});

const ALLOWED_SHIPPING_STATUSES = ["processing", "shipped", "delivered"];

app.put("/api/admin/orders/:id", requireOwner, async (req, res) => {

    const { shipping_status, carrier, tracking_number, estimated_delivery_date } = req.body;

    const clean = {};

    if (shipping_status !== undefined) {
        if (!ALLOWED_SHIPPING_STATUSES.includes(shipping_status)) {
            return res.status(400).json({
                error: "shipping_status must be one of: " + ALLOWED_SHIPPING_STATUSES.join(", ")
            });
        }
        clean.shipping_status = shipping_status;
    }

    if (carrier !== undefined) {
        clean.carrier = typeof carrier === "string" ? carrier.trim().substring(0, 100) || null : null;
    }

    if (tracking_number !== undefined) {
        clean.tracking_number = typeof tracking_number === "string"
            ? tracking_number.trim().substring(0, 100) || null
            : null;
    }

    if (estimated_delivery_date !== undefined) {
        clean.estimated_delivery_date = estimated_delivery_date || null;
    }

    if (Object.keys(clean).length === 0) {
        return res.status(400).json({ error: "Nothing to update." });
    }

    const { data, error } = await supabaseAdmin
        .from("orders")
        .update(clean)
        .eq("id", req.params.id)
        .select()
        .single();

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not update order." });
    }

    res.json(data);

});

/* =========================================
   ADMIN — SHIPPING MANAGEMENT (owner only)
========================================= */

app.get("/api/admin/shipping-methods", requireOwner, async (req, res) => {

    const { data, error } = await supabaseAdmin
        .from("shipping_methods")
        .select("*")
        .order("sort_order", { ascending: true });

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not load shipping methods." });
    }

    res.json(data);

});

function validateShippingMethodInput(body, { partial = false } = {}) {

    const errors = [];
    const clean = {};

    if (!partial || body.name !== undefined) {
        if (typeof body.name !== "string" || !body.name.trim()) {
            errors.push("name is required.");
        } else {
            clean.name = body.name.trim().substring(0, 100);
        }
    }

    if (!partial || body.price !== undefined) {
        const price = Number(body.price);
        if (!Number.isFinite(price) || price < 0) {
            errors.push("price must be a non-negative number.");
        } else {
            clean.price = Math.round(price * 100) / 100;
        }
    }

    if (body.estimated_days_min !== undefined) {
        clean.estimated_days_min = body.estimated_days_min === "" || body.estimated_days_min === null
            ? null
            : Number(body.estimated_days_min);
    }

    if (body.estimated_days_max !== undefined) {
        clean.estimated_days_max = body.estimated_days_max === "" || body.estimated_days_max === null
            ? null
            : Number(body.estimated_days_max);
    }

    if (body.active !== undefined) {
        clean.active = Boolean(body.active);
    }

    if (body.sort_order !== undefined) {
        clean.sort_order = Number(body.sort_order) || 0;
    }

    return { errors, clean };

}

app.post("/api/admin/shipping-methods", requireOwner, async (req, res) => {

    const { errors, clean } = validateShippingMethodInput(req.body);

    if (errors.length > 0) {
        return res.status(400).json({ error: errors.join(" ") });
    }

    const { data, error } = await supabaseAdmin
        .from("shipping_methods")
        .insert(clean)
        .select()
        .single();

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not create shipping method." });
    }

    res.status(201).json(data);

});

app.put("/api/admin/shipping-methods/:id", requireOwner, async (req, res) => {

    const { errors, clean } = validateShippingMethodInput(req.body, { partial: true });

    if (errors.length > 0) {
        return res.status(400).json({ error: errors.join(" ") });
    }

    const { data, error } = await supabaseAdmin
        .from("shipping_methods")
        .update(clean)
        .eq("id", req.params.id)
        .select()
        .single();

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not update shipping method." });
    }

    res.json(data);

});

app.delete("/api/admin/shipping-methods/:id", requireOwner, async (req, res) => {

    const { error } = await supabaseAdmin
        .from("shipping_methods")
        .delete()
        .eq("id", req.params.id);

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not delete shipping method." });
    }

    res.status(204).send();

});

app.get("/api/admin/category-shipping", requireOwner, async (req, res) => {

    const { data, error } = await supabaseAdmin
        .from("category_shipping_settings")
        .select("*");

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not load category shipping settings." });
    }

    res.json(data);

});

app.put("/api/admin/category-shipping/:category", requireOwner, async (req, res) => {

    const { free_shipping_threshold } = req.body;

    let threshold = null;

    if (free_shipping_threshold !== null && free_shipping_threshold !== "" && free_shipping_threshold !== undefined) {
        threshold = Number(free_shipping_threshold);
        if (!Number.isFinite(threshold) || threshold < 0) {
            return res.status(400).json({ error: "free_shipping_threshold must be a non-negative number or null." });
        }
        threshold = Math.round(threshold * 100) / 100;
    }

    const { data, error } = await supabaseAdmin
        .from("category_shipping_settings")
        .update({ free_shipping_threshold: threshold })
        .eq("category", req.params.category)
        .select()
        .single();

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not update this category's shipping setting." });
    }

    res.json(data);

});

/* =========================================
   WISHLIST (any logged-in customer)
========================================= */

app.get("/api/wishlist", requireLogin, async (req, res) => {

    const { data, error } = await supabaseAdmin
        .from("wishlist_items")
        .select("product_id, created_at, products(*)")
        .eq("user_id", req.auth.user.id)
        .order("created_at", { ascending: false });

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not load your wishlist." });
    }

    res.json(data);

});

app.post("/api/wishlist", requireLogin, async (req, res) => {

    const { product_id } = req.body;

    if (!product_id) {
        return res.status(400).json({ error: "product_id is required." });
    }

    const { error } = await supabaseAdmin
        .from("wishlist_items")
        .upsert(
            { user_id: req.auth.user.id, product_id },
            { onConflict: "user_id,product_id", ignoreDuplicates: true }
        );

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not save to your wishlist." });
    }

    res.status(201).json({ ok: true });

});

app.delete("/api/wishlist/:productId", requireLogin, async (req, res) => {

    const { error } = await supabaseAdmin
        .from("wishlist_items")
        .delete()
        .eq("user_id", req.auth.user.id)
        .eq("product_id", req.params.productId);

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not remove this item." });
    }

    res.status(204).send();

});

app.listen(PORT, () => {
    console.log(`Corner Barr server running at http://localhost:${PORT}`);
    console.log(`PayPal mode: ${PAYPAL_MODE}`);
});
EOF_SERVER_JS_

echo "Writing README.md"
cat > "README.md" << 'EOF_README_MD_'
# Corner Barr — Store with Real Checkout

This adds working orders to the site: customers add items to the cart and pay
with **PayPal or a debit/credit card** through PayPal's checkout. No second
processor (like Stripe) is needed — PayPal's own buttons include a card option.

## Site structure (3 real pages, not one scrolling page)

The site used to be a single page you scrolled through. It's now three
separate pages, like Amazon:

- **`index.html`** — Home. Just the hero and "Our Story." No shop grid here
  anymore.
- **`shop.html`** — Shop. The category nav (Cutting Boards, Soap & Candles,
  Resin Crafts, Jewelry, Holiday) still auto-scrolls to sections — but only
  on this page, since this is the only page that has those sections.
- **`product.html?id=...`** — One specific item, opened by clicking any
  product card. Cutting boards show the engraving customization panel right
  above the price, and the price updates live as you change it. Every other
  category shows a plain item page with an Add to Cart button.

The header, cart drawer, checkout, login, and the owner's "Manage Shop"
panel are identical on all three pages, so they're built once as shared
**partials** (`public/partials/*.html`) and injected into each page by
`public/js/partials.js`. That way, editing the header or the admin panel
only ever has to happen in one place.

**JavaScript is split the same way:**
- `js/shared.js` — cart, checkout, PayPal, accounts, wishlist, order
  history, and the admin panel. Loaded on every page.
- `js/shop.js` — renders the 5 product grids. Only on `shop.html`.
- `js/product.js` — renders one item + customization. Only on `product.html`.
- `js/home.js` — nothing page-specific; just boots the shared stuff.

**Delete the old `public/js/app.js`** — it's fully replaced by the files
above and nothing references it anymore. Keeping it around risks accidentally
editing a file that no longer does anything.

## How it works

- `server.js` is a small Node/Express server that does two things a browser
  can't safely do:
  1. Talks to PayPal using your **secret key**, which must never be sent to
     a browser.
  2. Re-calculates the cart total from live Supabase data before creating
     a PayPal order, so a customer can't edit prices in dev tools and pay less.
- Products, accounts, orders, wishlists, and shipping settings all live in
  Supabase now — see the setup section below.

## 1. Get PayPal API credentials

1. Log into <https://developer.paypal.com/dashboard/applications> with your
   normal PayPal business account.
2. Under **Sandbox** (for testing) or **Live** (for real payments), create
   an app and copy the **Client ID** and **Secret**.
3. Start with Sandbox. PayPal also creates sandbox "test buyer" accounts
   under Sandbox → Accounts so you can run through a full test purchase
   without touching real money.

## 2. Configure the server

```bash
cp .env.example .env
```

Edit `.env`:

```
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_secret
PAYPAL_MODE=sandbox
PORT=3000
```

## 2.5. Accounts, roles, and the shop database (Supabase)

The product catalog, customer/owner accounts, and product photo storage
are all powered by [Supabase](https://supabase.com) — a hosted Postgres
database with built-in login and file storage.

1. Create a free Supabase project (Personal org is fine for a single-owner shop).
2. In the SQL Editor, run `supabase/schema.sql` once, then `supabase/seed.sql`
   once (seeds the original starter catalog so nothing was lost in the move
   off the old static `products.json`).
3. In Storage, create a bucket named exactly `product-images`, set to Public.
4. Also run `supabase/orders.sql` (after schema.sql and seed.sql) — adds
   the orders table that powers customer order history and Ashley's
   shipment-tracking tools.
5. Also run `supabase/wishlist.sql` and `supabase/shipping.sql` (any
   order, after the above) — wishlist adds a "save for later" table;
   shipping adds owner-managed shipping methods and per-category
   free-shipping thresholds (with two example shipping methods seeded
   in automatically — rename, reprice, or delete them from "Manage
   Shop" → Shipping).
6. From Project Settings, copy your Project URL, anon/publishable key, and
   secret/service_role key into `.env`:
   ```
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
7. Have Ashley sign up for an account on the live site once (the "Account"
   button in the header). Then, in the SQL Editor, promote her to owner:
   ```sql
   update public.profiles set role = 'owner' where email = 'her-login-email@example.com';
   ```
   Nobody can grant themselves this role from the browser — it's only ever
   set this way, by hand.

Once she's an owner, logging in shows her a "Manage Shop" button that
customers never see — even if a customer inspects the page source or
guesses the URL, the server rejects any create/edit/delete request that
doesn't come from an authenticated owner.

## 3. Run it locally on your Mac

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Visit <http://localhost:3000> — this now serves your whole site, not just
the static files, so payments will work here too.

Test with a PayPal sandbox buyer account (from the developer dashboard) to
run through checkout without real money moving.

## 4. Go live

1. In the PayPal developer dashboard, create/copy your **Live** app
   credentials.
2. Update `.env`:
   ```
   PAYPAL_CLIENT_ID=your_live_client_id
   PAYPAL_CLIENT_SECRET=your_live_secret
   PAYPAL_MODE=live
   ```
3. Restart the server. That's the only code change needed to switch from
   test to real payments.

## 5. Hosting: Mac now, rent a server later

The app is a normal Node.js server, so the same code runs in both places:

- **On your Mac (now):** `npm start` as above. Fine for local testing, but
  your Mac needs to stay on and reachable for the site to be live to
  customers — not realistic for a real storefront.
- **On a rented server (recommended for going live):** any VPS that runs
  Node.js (DigitalOcean, Linode, a basic AWS/EC2 box, Render, Railway, etc.)
  works. Copy the project over, run `npm install --production`, set the
  same `.env` values, and run it with a process manager like
  [pm2](https://pm2.keymetrics.io/) so it restarts automatically:
  ```bash
  npm install -g pm2
  pm2 start server.js --name corner-barr
  pm2 save
  ```
  Point your domain's DNS at the server and put it behind HTTPS (most of
  the platforms above handle HTTPS for you automatically; on a raw VPS,
  [Caddy](https://caddyserver.com/) or `certbot` + nginx are the easiest
  routes).

## Notes and honest caveats

- **The card button's availability isn't 100% guaranteed.** PayPal shows a
  "Debit or Credit Card" button automatically for guest checkout, but
  whether it appears depends on your account's approval status and the
  buyer's country/browser. Test this in sandbox before launch — if it
  doesn't show up, PayPal support can advise on enabling "Advanced Credit
  and Debit Card Payments" for your account.
- **Order storage is minimal.** `orders.log.json` is a plain file, not a
  database — fine for getting started, but you'll want a real database
  (or at least email notifications) before order volume grows.
- **No email confirmations yet.** The customer sees an on-screen
  confirmation, but nothing is emailed to them or to you. Let me know if
  you want that added (it needs an email-sending service, e.g. Resend or
  SendGrid).
- **Refunds/cancellations** aren't handled here — those happen from your
  PayPal dashboard directly for now.
EOF_README_MD_

echo "Writing public/index.html"
cat > "public/index.html" << 'EOF_PUBLIC_INDEX_HTML_'
<!-- /corner-barr/index.html -->

<!DOCTYPE html>
<html lang="en">

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <meta
        name="description"
        content="Corner Barr — handmade cutting boards, candles, soaps, holiday gifts, and personalized gifts made in Southern Oregon."
    >

    <title>Corner Barr | Custom Made Gifts</title>

    <link
        rel="preconnect"
        href="https://fonts.googleapis.com"
    >

    <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossorigin
    >

    <link
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Montserrat:wght@400;500;600;700&display=swap"
        rel="stylesheet"
    >

    <link
        rel="stylesheet"
        href="css/styles.css"
    >

    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

</head>


<body>


    <div id="header-slot"></div>


    <main>

        <!-- =========================================
             HERO
        ========================================== -->

        <section class="hero">

            <div class="hero-overlay"></div>

            <div class="hero-content">

                <p class="eyebrow">
                    HANDCRAFTED • PERSONALIZED • MADE WITH CARE
                </p>

                <h1>
                    Gifts made<br>
                    <em>from the heart.</em>
                </h1>

                <p class="hero-text">
                    Handmade cutting boards, candles, soaps,
                    holiday gifts, and personalized treasures
                    proudly made in Southern Oregon.
                </p>

                <a
                    href="shop.html"
                    class="primary-button"
                >
                    Explore the Shop
                </a>

            </div>

        </section>


        <!-- =========================================
             ABOUT
        ========================================== -->

        <section
            class="about-section"
            id="about"
        >

            <div class="about-inner">

                <div class="about-text">

                    <p class="eyebrow">
                        THE CORNER BARR STORY
                    </p>

                    <h2>
                        Made with heart.<br>
                        Made by hand.
                    </h2>

                    <p>
                        Welcome to Corner Barr, where a love
                        for creating, a little bit of country
                        charm, and a whole lot of heart come
                        together.
                    </p>

                    <p>
                        Corner Barr was born from a simple love
                        of making things that are beautiful,
                        useful, and meaningful. What started as
                        creating pieces for family, friends,
                        and special occasions grew into something
                        much bigger—a little local business built
                        around the joy of turning an idea into
                        something you can hold, use, gift,
                        and treasure.
                    </p>

                    <p>
                        Every piece is created with care, from
                        custom laser engraving and rustic wood
                        pieces to personalized cutting boards,
                        home décor, candles, gift baskets,
                        and unique keepsakes.
                    </p>

                    <p>
                        We're proud to call Southern Oregon home.
                        Every Corner Barr creation is made locally,
                        right here in our community.
                    </p>

                    <a
                        href="shop.html"
                        class="secondary-button"
                    >
                        Shop Handmade Gifts
                    </a>

                </div>


                <div class="about-card">

                    <div class="wood-grain"></div>

                    <div class="about-card-content">

                        <span>
                            PROUDLY MADE IN
                        </span>

                        <strong>
                            SOUTHERN<br>
                            OREGON
                        </strong>

                        <small>
                            CORNER BARR
                        </small>

                    </div>

                </div>

            </div>

        </section>

    </main>


    <div id="footer-slot"></div>

    <div id="cart-drawer-slot"></div>
    <div id="checkout-modal-slot"></div>
    <div id="account-modal-slot"></div>
    <div id="admin-modal-slot"></div>


    <script src="js/partials.js"></script>
    <script src="js/shared.js"></script>
    <script src="js/home.js"></script>

</body>

</html>
EOF_PUBLIC_INDEX_HTML_

echo "Writing public/shop.html"
cat > "public/shop.html" << 'EOF_PUBLIC_SHOP_HTML_'
<!-- /corner-barr/shop.html -->

<!DOCTYPE html>
<html lang="en">

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <meta
        name="description"
        content="Shop handmade cutting boards, candles, soaps, resin crafts, jewelry, and holiday gifts at Corner Barr."
    >

    <title>Shop | Corner Barr</title>

    <link
        rel="preconnect"
        href="https://fonts.googleapis.com"
    >

    <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossorigin
    >

    <link
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Montserrat:wght@400;500;600;700&display=swap"
        rel="stylesheet"
    >

    <link
        rel="stylesheet"
        href="css/styles.css"
    >

    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

</head>


<body>


    <div id="header-slot"></div>


    <main>

        <!-- =========================================
             SHOP
        ========================================== -->

        <section
            class="shop-section"
            id="shop"
        >

            <div class="shop-header">

                <p class="eyebrow">
                    THE CORNER BARR SHOP
                </p>

                <h2>
                    Something for every occasion.
                </h2>

                <p>
                    Browse our handmade collections,
                    find something special, or create
                    a personalized gift of your own.
                </p>

            </div>


            <!-- =====================================
                 SHOP CATEGORY NAVIGATION
            ====================================== -->

            <nav class="shop-category-nav">

                <a
                    href="#cutting-boards"
                    class="shop-category-link"
                >
                    <span>01</span>
                    Cutting Boards
                </a>

                <a
                    href="#soap-candles"
                    class="shop-category-link"
                >
                    <span>02</span>
                    Soap & Candles
                </a>

                <a
                    href="#resin-crafts"
                    class="shop-category-link"
                >
                    <span>03</span>
                    Resin Crafts
                </a>

                <a
                    href="#jewelry"
                    class="shop-category-link"
                >
                    <span>04</span>
                    Jewelry
                </a>

                <a
                    href="#holiday"
                    class="shop-category-link"
                >
                    <span>05</span>
                    Holiday
                </a>

            </nav>



            <!-- =====================================
                 CUTTING BOARDS
            ====================================== -->

            <section
                class="shop-collection"
                id="cutting-boards"
            >

                <div class="collection-heading">

                    <div>

                        <p class="eyebrow">
                            COLLECTION 01
                        </p>

                        <h2>
                            Cutting Boards
                        </h2>

                    </div>

                    <p>
                        Handcrafted wood pieces made to
                        be used, displayed, and passed down.
                    </p>

                </div>


                <div
                    class="product-grid"
                    id="cuttingBoardGrid"
                ></div>

            </section>



            <!-- =====================================
                 SOAP & CANDLES
            ====================================== -->

            <section
                class="shop-collection"
                id="soap-candles"
            >

                <div class="collection-heading">

                    <div>

                        <p class="eyebrow">
                            COLLECTION 02
                        </p>

                        <h2>
                            Soap & Candles
                        </h2>

                    </div>

                    <p>
                        Handmade scents and simple comforts
                        for your home, bath, and everyday life.
                    </p>

                </div>


                <div
                    class="product-grid"
                    id="soapCandleGrid"
                ></div>

            </section>



            <!-- =====================================
                 RESIN CRAFTS
            ====================================== -->

            <section
                class="shop-collection"
                id="resin-crafts"
            >

                <div class="collection-heading">

                    <div>

                        <p class="eyebrow">
                            COLLECTION 03
                        </p>

                        <h2>
                            Resin Crafts
                        </h2>

                    </div>

                    <p>
                        Hand-poured resin pieces — chess boards, coasters,
                        and more, each one one-of-a-kind.
                    </p>

                </div>


                <div
                    class="product-grid"
                    id="resinGrid"
                ></div>

            </section>



            <!-- =====================================
                 JEWELRY
            ====================================== -->

            <section
                class="shop-collection"
                id="jewelry"
            >

                <div class="collection-heading">

                    <div>

                        <p class="eyebrow">
                            COLLECTION 04
                        </p>

                        <h2>
                            Jewelry
                        </h2>

                    </div>

                    <p>
                        Handmade jewelry pieces, crafted with the same care
                        as everything else at Corner Barr.
                    </p>

                </div>


                <div
                    class="product-grid"
                    id="jewelryGrid"
                ></div>

            </section>



            <!-- =====================================
                 HOLIDAY
            ====================================== -->

            <section
                class="shop-collection holiday-collection"
                id="holiday"
            >

                <div class="collection-heading">

                    <div>

                        <p class="eyebrow">
                            COLLECTION 05
                        </p>

                        <h2>
                            Holiday
                        </h2>

                    </div>

                    <p>
                        Seasonal gifts and handmade treasures
                        for the people who mean the most.
                    </p>

                </div>


                <div
                    class="product-grid"
                    id="holidayGrid"
                ></div>

            </section>

        </section>

    </main>


    <div id="footer-slot"></div>

    <div id="cart-drawer-slot"></div>
    <div id="checkout-modal-slot"></div>
    <div id="account-modal-slot"></div>
    <div id="admin-modal-slot"></div>


    <script src="js/partials.js"></script>
    <script src="js/shared.js"></script>
    <script src="js/shop.js"></script>

</body>

</html>
EOF_PUBLIC_SHOP_HTML_

echo "Writing public/product.html"
cat > "public/product.html" << 'EOF_PUBLIC_PRODUCT_HTML_'
<!-- /corner-barr/product.html -->

<!DOCTYPE html>
<html lang="en">

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>Corner Barr | Item</title>

    <link
        rel="preconnect"
        href="https://fonts.googleapis.com"
    >

    <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossorigin
    >

    <link
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Montserrat:wght@400;500;600;700&display=swap"
        rel="stylesheet"
    >

    <link
        rel="stylesheet"
        href="css/styles.css"
    >

    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

</head>


<body>


    <div id="header-slot"></div>


    <main>

        <div id="productLoading" class="product-loading">Loading…</div>

        <div id="productError" class="product-error hidden">
            <p class="eyebrow">NOT FOUND</p>
            <h2>We couldn't find that item.</h2>
            <p class="checkout-note">
                It may have been removed. <a href="shop.html">Back to the shop</a>
            </p>
        </div>

        <section id="productDetail" class="product-detail hidden">

            <div class="product-detail-image" id="productDetailImage"></div>

            <div class="product-detail-info">

                <p class="eyebrow" id="productDetailCategory"></p>

                <h1 id="productDetailName"></h1>

                <p class="product-detail-description" id="productDetailDescription"></p>


                <!-- CUSTOMIZATION (cutting boards only) -->
                <div id="customizationSection" class="customization-section hidden">

                    <div class="form-group">
                        <label for="engravingText">Engraving</label>
                        <input
                            type="text"
                            id="engravingText"
                            maxlength="30"
                            placeholder="Example: The Smith Family"
                        >
                        <div class="input-help">Up to 30 characters</div>
                    </div>

                    <div class="form-group">
                        <label>Engraving style</label>
                        <div class="style-options" id="styleOptions"></div>
                    </div>

                </div>


                <div class="product-detail-price" id="productDetailPrice"></div>


                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="giftMessage">
                        <span>This is a gift</span>
                    </label>
                </div>

                <div class="gift-message-container" id="giftMessageContainer">
                    <label for="giftMessageText">Gift message</label>
                    <textarea
                        id="giftMessageText"
                        maxlength="200"
                        placeholder="Write a short message..."
                    ></textarea>
                </div>


                <button
                    type="button"
                    class="primary-button full-width product-detail-add-button"
                    id="productAddToCartButton"
                >
                    Add to Cart
                </button>

            </div>

        </section>

    </main>


    <div id="footer-slot"></div>

    <div id="cart-drawer-slot"></div>
    <div id="checkout-modal-slot"></div>
    <div id="account-modal-slot"></div>
    <div id="admin-modal-slot"></div>


    <script src="js/partials.js"></script>
    <script src="js/shared.js"></script>
    <script src="js/product.js"></script>

</body>

</html>
EOF_PUBLIC_PRODUCT_HTML_

echo "Writing public/css/styles.css"
cat > "public/css/styles.css" << 'EOF_PUBLIC_CSS_STYLES_CSS_'
/* /corner-barr/css/styles.css */


/* =========================================
   VARIABLES
========================================= */

:root {

    --forest: #26382d;
    --forest-dark: #18251d;

    --wood: #8a5c39;
    --wood-light: #c49a6c;

    --cream: #f5f0e7;
    --cream-dark: #e9dfcf;

    --charcoal: #292825;
    --muted: #716d64;

    --white: #ffffff;

    --border:
        rgba(41, 40, 37, 0.15);

    --shadow:
        0 18px 45px rgba(31, 27, 20, 0.14);

    --serif:
        "Cormorant Garamond",
        Georgia,
        serif;

    --sans:
        "Montserrat",
        Arial,
        sans-serif;
}


/* =========================================
   RESET
========================================= */

* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

html {
    scroll-behavior: smooth;
    scroll-padding-top: 100px;
}

body {
    background: var(--cream);
    color: var(--charcoal);

    font-family: var(--sans);

    line-height: 1.6;
}

button,
input,
select,
textarea {
    font: inherit;
}

button {
    cursor: pointer;
}

a {
    color: inherit;
    text-decoration: none;
}


/* =========================================
   HEADER
========================================= */

.site-header {

    position: sticky;
    top: 0;

    z-index: 100;

    background-image:
        linear-gradient(
            rgba(0, 0, 0, 0.25),
            rgba(0, 0, 0, 0.25)
        ),
        url("../assets/images/mountains.jpg");

    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;

    border-bottom:
        2px solid #000;

    box-shadow:
        0 4px 15px rgba(0, 0, 0, 0.25);
}

.header-inner {

    width: min(1200px, 92%);

    min-height: 100px;

    margin: auto;

    display: flex;

    align-items: center;

    justify-content: space-between;

    gap: 25px;
}


/* =========================================
   BRAND
========================================= */

.brand {

    display: flex;

    align-items: center;

    gap: 12px;

    background: #000;

    color: #fff;

    padding: 10px 16px;
}

.brand-mark {

    width: 42px;
    height: 42px;

    display: grid;

    place-items: center;

    border: 1px solid #fff;

    color: #fff;

    transform: rotate(-5deg);
}

.brand-mark span {

    font-size: 27px;

    transform:
        rotate(5deg);
}

.brand-name {

    font-family: var(--serif);

    font-size: 25px;

    font-weight: 700;

    letter-spacing: 2px;

    line-height: 1;

    color: #fff;
}

.brand-tagline {

    margin-top: 4px;

    font-size: 8px;

    letter-spacing: 2px;

    font-weight: 600;

    color: #fff;
}


/* =========================================
   MAIN NAV
========================================= */

.main-nav {

    display: flex;

    gap: 10px;

    font-size: 12px;

    font-weight: 600;

    text-transform: uppercase;

    letter-spacing: 1.5px;
}

.main-nav a {

    background: #000;

    color: #fff;

    padding:
        13px 20px;

    transition:
        transform 0.2s ease,
        background 0.2s ease;
}

.main-nav a:hover {

    background: #222;

    transform:
        translateY(-2px);
}


/* =========================================
   CART BUTTON
========================================= */

.cart-button {

    border: none;

    background: #000;

    color: #fff;

    display: flex;

    align-items: center;

    gap: 9px;

    padding:
        13px 16px;

    font-size: 12px;

    font-weight: 700;

    text-transform: uppercase;

    letter-spacing: 1.3px;
}

.cart-button:hover {
    background: #222;
}

.cart-count {

    width: 24px;
    height: 24px;

    display: grid;

    place-items: center;

    border:
        1px solid #fff;

    border-radius: 50%;

    font-size: 11px;
}


/* =========================================
   HERO
========================================= */

.hero {

    min-height: 650px;

    position: relative;

    overflow: hidden;

    display: flex;

    align-items: center;

    background:
        linear-gradient(
            135deg,
            #ddd5c6 0%,
            #c9c0b0 55%,
            #a99e8d 100%
        );
}

.hero::after {

    content: "";

    position: absolute;

    left: 0;
    right: 0;
    bottom: 0;

    height: 45%;

    background:
        linear-gradient(
            transparent,
            rgba(24, 37, 29, 0.8)
        );

    pointer-events: none;
}

.hero-overlay {

    position: absolute;

    inset: 0;

    background:
        radial-gradient(
            circle at 70% 25%,
            rgba(255,255,255,0.5),
            transparent 35%
        );
}

.hero-content {

    width: min(1200px, 92%);

    margin: auto;

    position: relative;

    z-index: 3;

    padding:
        100px 0;
}

.eyebrow {

    color: var(--forest);

    font-size: 10px;

    font-weight: 700;

    letter-spacing: 2.5px;

    text-transform: uppercase;
}

.hero h1 {

    max-width: 700px;

    margin-top: 12px;

    font-family: var(--serif);

    font-size:
        clamp(58px, 8vw, 105px);

    line-height: 0.86;

    font-weight: 600;
}

.hero h1 em {

    color: var(--forest);

    font-weight: 500;
}

.hero-text {

    max-width: 540px;

    margin-top: 28px;

    font-size: 15px;

    line-height: 1.8;
}

.hero .primary-button {

    margin-top: 35px;
}


/* =========================================
   BUTTONS
========================================= */

.primary-button,
.secondary-button {

    display: inline-flex;

    align-items: center;

    justify-content: center;

    min-height: 52px;

    padding:
        0 26px;

    border-radius: 2px;

    font-size: 11px;

    font-weight: 700;

    text-transform: uppercase;

    letter-spacing: 1.5px;

    transition:
        transform 0.2s ease,
        background 0.2s ease;
}

.primary-button {

    border: none;

    background:
        var(--forest);

    color: white;
}

.primary-button:hover {

    background:
        var(--forest-dark);

    transform:
        translateY(-2px);
}

.secondary-button {

    border:
        1px solid var(--forest);

    color:
        var(--forest);
}

.secondary-button:hover {

    background:
        var(--forest);

    color: white;
}

.full-width {
    width: 100%;
}


/* =========================================
   SHOP
========================================= */

.shop-section {

    width: min(1200px, 92%);

    margin: auto;

    padding:
        110px 0 120px;
}

.shop-header {

    max-width: 700px;

    margin-bottom: 55px;
}

.shop-header h2 {

    margin-top: 8px;

    font-family: var(--serif);

    font-size:
        clamp(45px, 5vw, 70px);

    line-height: 0.95;
}

.shop-header > p:last-child {

    max-width: 620px;

    margin-top: 20px;

    color: var(--muted);

    font-size: 14px;
}


/* =========================================
   SHOP CATEGORY NAVIGATION
========================================= */

.shop-category-nav {

    position: sticky;

    top: 100px;

    z-index: 20;

    display: grid;

    grid-template-columns:
        repeat(5, 1fr);

    gap: 2px;

    margin-bottom: 90px;

    background:
        var(--charcoal);

    box-shadow:
        0 8px 20px rgba(0,0,0,0.12);
}

.shop-category-link {

    min-height: 80px;

    padding:
        18px 25px;

    display: flex;

    align-items: center;

    justify-content: center;

    gap: 15px;

    background:
        var(--forest);

    color: white;

    font-size: 12px;

    font-weight: 700;

    text-transform: uppercase;

    letter-spacing: 1.4px;

    transition:
        background 0.2s ease;
}

.shop-category-link:hover {

    background:
        var(--forest-dark);
}

.shop-category-link span {

    font-size: 9px;

    color:
        #c8b38f;
}


/* =========================================
   COLLECTIONS
========================================= */

.shop-collection {

    scroll-margin-top: 190px;

    padding-bottom: 115px;
}

.shop-collection + .shop-collection {

    padding-top: 25px;

    border-top:
        1px solid var(--border);
}

.collection-heading {

    display: grid;

    grid-template-columns:
        1fr 1fr;

    align-items: end;

    gap: 50px;

    margin-bottom: 45px;
}

.collection-heading h2 {

    margin-top: 7px;

    font-family: var(--serif);

    font-size:
        clamp(42px, 5vw, 65px);

    line-height: 0.9;
}

.collection-heading > p {

    max-width: 430px;

    color: var(--muted);

    font-size: 13px;
}


/* =========================================
   PRODUCT GRID
========================================= */

.product-grid {

    display: grid;

    grid-template-columns:
        repeat(3, 1fr);

    gap: 25px;
}

.product-card {

    position: relative;

    background: white;

    box-shadow:
        var(--shadow);

    overflow: hidden;

    transition:
        transform 0.25s ease,
        box-shadow 0.25s ease;
}

.product-card-link {
    display: block;
    color: inherit;
    text-decoration: none;
}

.product-card:hover {

    transform:
        translateY(-6px);

    box-shadow:
        0 25px 55px rgba(31,27,20,0.18);
}


/* =========================================
   PRODUCT IMAGE
========================================= */

.product-image {

    height: 280px;

    position: relative;

    overflow: hidden;

    display: flex;

    align-items: center;

    justify-content: center;
}

.product-photo {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.product-photo-placeholder {
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #e2d2bd, #c2aa8c);
}

.wishlist-heart {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 5;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.85);
    color: var(--charcoal);
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
}

.wishlist-heart:hover {
    background: white;
}

.wishlist-heart.active {
    color: #8d4c40;
}


/* Cutting boards */

.product-image.cutting-board-image {

    background:
        linear-gradient(
            135deg,
            #e2d2bd,
            #c2aa8c
        );
}

.board-shape {

    width: 76%;
    height: 68%;

    position: relative;

    display: flex;

    align-items: center;

    justify-content: center;

    border-radius: 15px;

    box-shadow:
        0 16px 30px rgba(0,0,0,0.25);

    transform:
        rotate(-2deg);
}

.board-shape::after {

    content: "";

    position: absolute;

    width: 12px;
    height: 12px;

    top: 13px;
    right: 13px;

    border-radius: 50%;

    background:
        rgba(45,35,24,0.4);
}

.board-classic {

    background:
        repeating-linear-gradient(
            90deg,
            #9b6842 0px,
            #9b6842 22px,
            #c49768 23px,
            #c49768 45px
        );
}

.board-paddle {

    width: 65%;
    height: 73%;

    border-radius:
        18px 18px 48% 48%;
}

.board-dark {

    background:
        repeating-linear-gradient(
            90deg,
            #5d4634 0px,
            #5d4634 20px,
            #80644c 21px,
            #80644c 42px
        );
}

.board-serving {

    width: 80%;
    height: 58%;

    background:
        repeating-linear-gradient(
            90deg,
            #bd966a 0px,
            #bd966a 28px,
            #73523a 29px,
            #73523a 48px
        );
}

.board-engraving {

    color:
        rgba(48,34,23,0.65);

    font-family:
        var(--serif);

    font-size: 22px;

    font-weight: 700;

    text-align: center;
}


/* =========================================
   SOAP & CANDLE PRODUCTS
========================================= */

.product-image.soap-candle-image {

    background:
        linear-gradient(
            135deg,
            #d9d0bd,
            #eee7d9
        );
}

.product-object {

    position: relative;

    display: flex;

    align-items: center;

    justify-content: center;

    box-shadow:
        0 16px 30px rgba(0,0,0,0.18);
}

.soap-object {

    width: 130px;
    height: 90px;

    border-radius:
        15px 15px 20px 20px;

    background:
        linear-gradient(
            135deg,
            #c9b18b,
            #e8d8ba
        );
}

.soap-object::before {

    content: "";

    position: absolute;

    width: 75px;
    height: 18px;

    top: 20px;

    border-radius: 50%;

    background:
        rgba(255,255,255,0.35);
}

.candle-object {

    width: 105px;
    height: 135px;

    border-radius:
        8px 8px 14px 14px;

    background:
        linear-gradient(
            90deg,
            #d7c4a4,
            #f0e5d0,
            #c4aa83
        );
}

.candle-object::before {

    content: "";

    position: absolute;

    width: 3px;
    height: 22px;

    top: -20px;

    background: #29231c;
}

.candle-object::after {

    content: "";

    position: absolute;

    width: 10px;
    height: 15px;

    top: -34px;

    border-radius:
        50% 50% 50% 50%;

    background:
        #d39a46;
}


/* =========================================
   HOLIDAY PRODUCTS
========================================= */

.holiday-collection {

    padding-top: 30px;
}

.product-image.holiday-image {

    background:
        linear-gradient(
            135deg,
            #26382d,
            #536655
        );
}

.holiday-object {

    width: 150px;
    height: 150px;

    display: grid;

    place-items: center;

    border:
        3px solid #c8b38f;

    background:
        #18251d;

    color:
        #c8b38f;

    font-family:
        var(--serif);

    font-size: 32px;

    text-align: center;

    transform:
        rotate(-4deg);

    box-shadow:
        0 18px 30px rgba(0,0,0,0.3);
}

.holiday-object::before {

    content: "";

    position: absolute;

    inset: 10px;

    border:
        1px solid rgba(200,179,143,0.4);
}


/* =========================================
   PRODUCT INFO
========================================= */

.product-info {

    padding: 24px;
}

.product-category {

    color:
        var(--muted);

    font-size: 9px;

    font-weight: 700;

    letter-spacing: 1.5px;

    text-transform: uppercase;
}

.product-name {

    margin-top: 5px;

    font-family:
        var(--serif);

    font-size: 30px;

    line-height: 1;
}

.product-description {

    margin-top: 10px;

    color:
        var(--muted);

    font-size: 12px;

    line-height: 1.7;
}

.product-bottom {

    margin-top: 22px;

    display: flex;

    align-items: center;

    justify-content: space-between;

    gap: 15px;
}

.product-price {

    font-weight: 700;
}

.small-button {

    padding:
        10px 15px;

    border:
        1px solid var(--forest);

    background:
        transparent;

    color:
        var(--forest);

    font-size: 9px;

    font-weight: 700;

    letter-spacing: 1px;

    text-transform: uppercase;
}

.small-button:hover {

    background:
        var(--forest);

    color:
        white;
}


/* =========================================
   CUSTOM SECTION
========================================= */

.custom-section {

    background:
        var(--forest);

    color:
        white;

    padding:
        110px 0;
}

.custom-container {

    width:
        min(1200px, 92%);

    margin:
        auto;

    display:
        grid;

    grid-template-columns:
        1fr 1fr;

    gap:
        80px;

    align-items:
        center;
}

.custom-preview .eyebrow,
.builder-header .eyebrow {

    color:
        #c8b38f;
}

.custom-preview h2,
.builder-header h2 {

    color:
        white;

    margin-top: 8px;

    font-family:
        var(--serif);

    font-size:
        clamp(42px, 5vw, 65px);

    line-height:
        0.95;
}

.custom-preview > p:not(.eyebrow) {

    max-width:
        500px;

    margin-top:
        18px;

    color:
        rgba(255,255,255,0.7);

    font-size:
        14px;
}


/* =========================================
   PREVIEW BOARD
========================================= */

.preview-board {

    margin-top:
        50px;

    min-height:
        390px;

    display:
        grid;

    place-items:
        center;
}

.preview-wood {

    width:
        82%;

    height:
        300px;

    border-radius:
        18px;

    position:
        relative;

    display:
        grid;

    place-items:
        center;

    box-shadow:
        0 30px 50px rgba(0,0,0,0.35);

    transform:
        rotate(-4deg);

    background:
        repeating-linear-gradient(
            90deg,
            #b17b4f 0px,
            #b17b4f 28px,
            #d0a478 29px,
            #d0a478 52px,
            #8d5f3f 53px,
            #8d5f3f 68px
        );
}

.preview-wood::before {

    content:
        "";

    position:
        absolute;

    inset:
        12px;

    border:
        2px solid rgba(255,255,255,0.25);

    border-radius:
        12px;
}

.preview-engraving {

    position:
        relative;

    z-index:
        2;

    color:
        rgba(50,33,22,0.72);

    font-family:
        var(--serif);

    font-size:
        clamp(25px,4vw,40px);

    font-weight:
        700;

    text-align:
        center;

    padding:
        20px;
}


/* =========================================
   CUSTOM BUILDER
========================================= */

.custom-builder {

    background:
        rgba(255,255,255,0.08);

    border:
        1px solid rgba(255,255,255,0.12);

    padding:
        35px;

    border-radius:
        3px;
}

.form-group {

    margin-top:
        25px;
}

.form-group label {

    display:
        block;

    margin-bottom:
        8px;

    font-size:
        10px;

    font-weight:
        700;

    text-transform:
        uppercase;

    letter-spacing:
        1.3px;
}

select,
input[type="text"],
input[type="email"],
input[type="tel"],
input[type="password"],
textarea {

    width:
        100%;

    padding:
        14px 15px;

    border:
        1px solid rgba(255,255,255,0.2);

    border-radius:
        2px;

    background:
        rgba(255,255,255,0.07);

    color:
        white;

    outline:
        none;
}

select option {

    color:
        var(--charcoal);
}

input::placeholder,
textarea::placeholder {

    color:
        rgba(255,255,255,0.4);
}

textarea {

    min-height:
        110px;

    resize:
        vertical;
}

input:focus,
select:focus,
textarea:focus {

    border-color:
        #c8b38f;
}

.input-help {

    margin-top:
        5px;

    color:
        rgba(255,255,255,0.4);

    font-size:
        9px;
}


/* =========================================
   OPTIONS
========================================= */

.option-grid {

    display:
        grid;

    grid-template-columns:
        repeat(3,1fr);

    gap:
        8px;
}

.wood-option {

    padding:
        13px 8px;

    border:
        1px solid rgba(255,255,255,0.2);

    background:
        transparent;

    color:
        white;

    font-size:
        10px;
}

.wood-option.active {

    border-color:
        #c8b38f;

    background:
        rgba(200,179,143,0.15);
}

.style-options {

    display:
        flex;

    gap:
        8px;

    flex-wrap:
        wrap;
}

.style-option {

    padding:
        11px 14px;

    border:
        1px solid rgba(255,255,255,0.2);

    background:
        transparent;

    color:
        white;

    font-size:
        10px;
}

.style-option.active {

    border-color:
        #c8b38f;

    background:
        rgba(200,179,143,0.15);
}

.checkbox-label {

    display:
        flex !important;

    align-items:
        center;

    gap:
        10px;
}

.checkbox-label input {

    width:
        17px;

    height:
        17px;
}

.gift-message-container {

    display:
        none;
}

.gift-message-container.visible {

    display:
        block;
}

.builder-total {

    margin-top:
        35px;

    padding-top:
        25px;

    border-top:
        1px solid rgba(255,255,255,0.15);

    display:
        flex;

    align-items:
        center;

    justify-content:
        space-between;

    gap:
        20px;
}

.builder-total span {

    display:
        block;

    color:
        rgba(255,255,255,0.55);

    font-size:
        9px;

    text-transform:
        uppercase;

    letter-spacing:
        1px;
}

.builder-total strong {

    display:
        block;

    margin-top:
        2px;

    font-family:
        var(--serif);

    font-size:
        34px;
}


/* =========================================
   ABOUT
========================================= */

.about-section {

    padding:
        120px 0;

    background:
        var(--cream-dark);
}

.about-inner {

    width:
        min(1050px,90%);

    margin:
        auto;

    display:
        grid;

    grid-template-columns:
        1fr 1fr;

    gap:
        90px;

    align-items:
        center;
}

.about-text h2 {

    margin-top:
        8px;

    font-family:
        var(--serif);

    font-size:
        clamp(42px,5vw,65px);

    line-height:
        0.95;
}

.about-text p:not(.eyebrow) {

    max-width:
        520px;

    margin-top:
        18px;

    color:
        var(--muted);

    font-size:
        14px;
}

.about-text .secondary-button {

    margin-top:
        28px;
}

.about-card {

    min-height:
        450px;

    position:
        relative;

    display:
        grid;

    place-items:
        center;

    overflow:
        hidden;

    background:
        repeating-linear-gradient(
            8deg,
            #9c6c46 0px,
            #9c6c46 23px,
            #b47f52 24px,
            #b47f52 47px
        );

    box-shadow:
        var(--shadow);

    transform:
        rotate(2deg);
}

.wood-grain {

    position:
        absolute;

    inset:
        0;

    opacity:
        0.2;

    background:
        repeating-radial-gradient(
            ellipse,
            transparent 0,
            transparent 16px,
            rgba(50,30,20,0.35) 17px,
            transparent 19px
        );
}

.about-card-content {

    position:
        relative;

    z-index:
        2;

    text-align:
        center;

    color:
        rgba(46,31,21,0.7);
}

.about-card-content span {

    display:
        block;

    font-size:
        11px;

    letter-spacing:
        4px;
}

.about-card-content strong {

    display:
        block;

    margin-top:
        8px;

    font-family:
        var(--serif);

    font-size:
        55px;

    line-height:
        0.78;
}

.about-card-content small {

    display:
        block;

    margin-top:
        20px;

    font-size:
        9px;

    letter-spacing:
        3px;
}


/* =========================================
   CART
========================================= */

.cart-overlay {

    position:
        fixed;

    inset:
        0;

    z-index:
        200;

    background:
        rgba(0,0,0,0.5);

    opacity:
        0;

    visibility:
        hidden;

    transition:
        0.25s ease;
}

.cart-overlay.open {

    opacity:
        1;

    visibility:
        visible;
}

.cart-drawer {

    position:
        fixed;

    top:
        0;

    right:
        0;

    z-index:
        201;

    width:
        min(460px,94vw);

    height:
        100vh;

    background:
        var(--cream);

    transform:
        translateX(100%);

    transition:
        transform 0.3s ease;

    display:
        flex;

    flex-direction:
        column;
}

.cart-drawer.open {

    transform:
        translateX(0);
}

.cart-header {

    padding:
        30px;

    display:
        flex;

    align-items:
        flex-start;

    justify-content:
        space-between;

    border-bottom:
        1px solid var(--border);
}

.cart-header h2 {

    font-family:
        var(--serif);

    font-size:
        40px;

    line-height:
        0.9;
}

.close-button {

    width:
        38px;

    height:
        38px;

    border:
        1px solid var(--border);

    background:
        transparent;

    font-size:
        25px;

    line-height:
        1;
}

.cart-items {

    flex:
        1;

    overflow-y:
        auto;

    padding:
        20px 30px;
}

.empty-cart {

    padding:
        60px 10px;

    text-align:
        center;

    color:
        var(--muted);

    font-size:
        13px;
}

.cart-item {

    padding:
        18px 0;

    display:
        grid;

    grid-template-columns:
        80px 1fr auto;

    gap:
        15px;

    border-bottom:
        1px solid var(--border);
}

.cart-item-image {

    width:
        80px;

    height:
        80px;

    border-radius:
        5px;

    background:
        repeating-linear-gradient(
            90deg,
            #9b6842 0px,
            #9b6842 20px,
            #c49768 21px,
            #c49768 40px
        );
}

.cart-item-name {

    font-family:
        var(--serif);

    font-size:
        21px;

    font-weight:
        700;
}

.cart-item-details {

    margin-top:
        3px;

    color:
        var(--muted);

    font-size:
        10px;
}

.cart-item-price {

    font-weight:
        700;
}

.quantity-controls {

    margin-top:
        12px;

    display:
        flex;

    align-items:
        center;

    gap:
        8px;
}

.quantity-controls button {

    width:
        25px;

    height:
        25px;

    border:
        1px solid var(--border);

    background:
        transparent;
}

.quantity-controls span {

    min-width:
        20px;

    text-align:
        center;

    font-size:
        11px;
}

.remove-item {

    margin-top:
        10px;

    border:
        none;

    background:
        none;

    color:
        #8d4c40;

    font-size:
        9px;

    font-weight:
        700;

    text-transform:
        uppercase;

    letter-spacing:
        1px;
}

.cart-footer {

    padding:
        25px 30px;

    border-top:
        1px solid var(--border);
}

.cart-total {

    margin-bottom:
        18px;

    display:
        flex;

    align-items:
        center;

    justify-content:
        space-between;
}

.cart-total strong {

    font-family:
        var(--serif);

    font-size:
        32px;
}


/* =========================================
   CHECKOUT
========================================= */

.modal-overlay {

    position:
        fixed;

    inset:
        0;

    z-index:
        300;

    display:
        grid;

    place-items:
        center;

    padding:
        20px;

    background:
        rgba(0,0,0,0.65);

    opacity:
        0;

    visibility:
        hidden;

    transition:
        0.25s ease;
}

.modal-overlay.open {

    opacity:
        1;

    visibility:
        visible;
}

.checkout-modal {

    width:
        min(550px,100%);

    max-height:
        90vh;

    overflow-y:
        auto;

    position:
        relative;

    padding:
        40px;

    background:
        var(--cream);

    box-shadow:
        0 30px 80px rgba(0,0,0,0.35);
}

.checkout-modal > h2 {

    margin-top:
        5px;

    font-family:
        var(--serif);

    font-size:
        48px;

    line-height:
        0.9;
}

.modal-close {

    position:
        absolute;

    top:
        20px;

    right:
        20px;
}

.checkout-note {

    margin-top:
        15px;

    color:
        var(--muted);

    font-size:
        12px;
}

.checkout-modal .form-group label {

    color:
        var(--charcoal);
}

.checkout-modal input,
.checkout-modal textarea {

    color:
        var(--charcoal);

    background:
        white;

    border:
        1px solid var(--border);
}

.checkout-modal input::placeholder,
.checkout-modal textarea::placeholder {

    color:
        #999;
}

.checkout-summary {

    margin-top:
        25px;

    padding-top:
        20px;

    border-top:
        1px solid var(--border);

    display:
        flex;

    justify-content:
        space-between;

    align-items:
        center;
}

.checkout-summary strong {

    font-family:
        var(--serif);

    font-size:
        32px;
}

.payment-placeholder {

    margin-top:
        12px;

    text-align:
        center;

    color:
        var(--muted);

    font-size:
        9px;
}


/* =========================================
   CHECKOUT — PAYPAL & CONFIRMATION
========================================= */

.checkout-error {

    display:
        none;

    margin-top:
        18px;

    padding:
        12px 14px;

    border:
        1px solid #8d4c40;

    background:
        rgba(141, 76, 64, 0.08);

    color:
        #8d4c40;

    font-size:
        12px;

    line-height:
        1.5;
}

.checkout-error.visible {
    display: block;
}

.shipping-section {
    margin-top: 25px;
}

.shipping-section-label {
    display: block;
    margin-bottom: 8px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.3px;
    color: var(--charcoal);
}

.shipping-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.shipping-option-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    background: white;
    font-size: 12px;
    cursor: pointer;
}

.shipping-option-row input[type="radio"] {
    width: auto;
}

.shipping-option-main {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.shipping-option-name {
    font-weight: 700;
}

.shipping-option-days {
    color: var(--muted);
    font-size: 11px;
    margin-left: 6px;
}

.shipping-option-price {
    font-weight: 700;
}

.shipping-free-banner {
    padding: 10px 14px;
    background: rgba(38, 56, 45, 0.08);
    color: var(--forest);
    font-size: 12px;
    font-weight: 700;
    text-align: center;
}

.paypal-button-container {

    margin-top:
        22px;

    min-height:
        45px;
}

.order-confirmation {

    display:
        none;

    padding:
        10px 0 5px;
}

.order-confirmation h2 {

    margin-top:
        8px;

    font-family:
        var(--serif);

    font-size:
        42px;

    line-height:
        0.95;
}

.order-confirmation .checkout-note {
    color: var(--muted);
}


/* =========================================
   HEADER ACTIONS / ACCOUNT
========================================= */

.header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
}

.account-button {
    border: none;
    background: #000;
    color: #fff;
    padding: 13px 16px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.3px;
}

.account-button:hover {
    background: #222;
}

.hidden {
    display: none !important;
}

.account-toggle {
    margin-top: 20px;
    text-align: center;
    font-size: 12px;
    color: var(--muted);
}

.account-toggle button {
    border: none;
    background: none;
    color: var(--forest);
    font-weight: 700;
    text-decoration: underline;
    margin-left: 5px;
}

.password-field-wrapper {
    position: relative;
}

.password-field-wrapper input {
    padding-right: 44px;
}

.password-toggle-button {
    position: absolute;
    top: 0;
    right: 0;
    height: 100%;
    width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    color: var(--muted);
}

.password-toggle-button:hover {
    color: var(--charcoal);
}


/* =========================================
   ADMIN — MANAGE SHOP
========================================= */

.admin-modal {
    width: min(900px, 100%);
}

.admin-layout {
    margin-top: 20px;
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    gap: 35px;
    align-items: start;
}

.admin-list h3,
.admin-form-panel h3 {
    font-family: var(--serif);
    font-size: 24px;
    margin-bottom: 15px;
}

#adminProductList {
    max-height: 520px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.admin-product-row {
    display: grid;
    grid-template-columns: 56px 1fr auto;
    gap: 12px;
    align-items: center;
    padding: 10px;
    background: white;
    border: 1px solid var(--border);
}

.admin-product-thumb {
    width: 56px;
    height: 56px;
    object-fit: cover;
    background: var(--cream-dark);
}

.admin-product-info .name {
    font-weight: 700;
    font-size: 13px;
}

.admin-product-info .meta {
    color: var(--muted);
    font-size: 11px;
    margin-top: 2px;
}

.admin-row-actions {
    display: flex;
    gap: 6px;
}

.admin-row-actions button {
    border: 1px solid var(--border);
    background: transparent;
    padding: 6px 10px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.admin-row-actions button:hover {
    background: var(--cream-dark);
}

.admin-row-actions .delete-button {
    color: #8d4c40;
    border-color: #8d4c40;
}

.admin-drop-zone {
    position: relative;
    border: 2px dashed var(--border);
    padding: 25px 15px;
    text-align: center;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    background: var(--cream-dark);
}

.admin-drop-zone.dragging {
    border-color: var(--forest);
    background: rgba(38, 56, 45, 0.06);
}

.admin-image-preview {
    display: block;
    max-width: 100%;
    max-height: 160px;
    margin: 0 auto 12px;
    object-fit: cover;
}

.admin-file-input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
}

.admin-form-actions {
    margin-top: 20px;
    display: flex;
    gap: 10px;
}

.admin-form-actions .primary-button,
.admin-form-actions .secondary-button {
    flex: 1;
}

@media (max-width: 700px) {
    .admin-layout {
        grid-template-columns: 1fr;
    }
}


/* =========================================
   MY ORDERS (customer account view)
========================================= */

.account-orders-heading {
    margin-top: 30px;
    margin-bottom: 12px;
    font-family: var(--serif);
    font-size: 22px;
}

.my-orders-list {
    max-height: 320px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 20px;
}

.my-wishlist-list {
    max-height: 280px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 20px;
}

.wishlist-item-row {
    display: grid;
    grid-template-columns: 48px 1fr auto;
    gap: 12px;
    align-items: center;
    padding: 8px;
    border: 1px solid var(--border);
    background: white;
}

.wishlist-item-thumb {
    width: 48px;
    height: 48px;
    object-fit: cover;
    background: var(--cream-dark);
}

.wishlist-item-info .name {
    font-size: 12px;
    font-weight: 700;
}

.wishlist-item-info .price {
    font-size: 11px;
    color: var(--muted);
    margin-top: 2px;
}

.order-card {
    border: 1px solid var(--border);
    background: white;
    padding: 14px;
    font-size: 12px;
}

.order-card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
}

.order-card-date {
    color: var(--muted);
}

.order-status-badge {
    display: inline-block;
    padding: 3px 10px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-radius: 2px;
}

.order-status-processing {
    background: rgba(138, 92, 57, 0.15);
    color: var(--wood);
}

.order-status-shipped {
    background: rgba(38, 56, 45, 0.12);
    color: var(--forest);
}

.order-status-delivered {
    background: rgba(38, 56, 45, 0.85);
    color: white;
}

.order-card-items {
    color: var(--muted);
    margin-bottom: 6px;
}

.order-card-shipping {
    color: var(--charcoal);
}

.order-card-total {
    margin-top: 6px;
    font-weight: 700;
}


/* =========================================
   ADMIN TABS + ORDERS
========================================= */

.admin-tabs {
    margin-top: 15px;
    display: flex;
    gap: 8px;
    border-bottom: 1px solid var(--border);
}

.admin-tab {
    border: none;
    background: none;
    padding: 10px 4px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
}

.admin-tab.active {
    color: var(--forest);
    border-bottom-color: var(--forest);
}

.admin-orders-section {
    margin-top: 20px;
}

#adminOrdersList {
    max-height: 560px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.admin-order-row {
    border: 1px solid var(--border);
    background: white;
    padding: 16px;
}

.admin-order-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 15px;
    margin-bottom: 10px;
}

.admin-order-customer {
    font-weight: 700;
    font-size: 13px;
}

.admin-order-meta {
    color: var(--muted);
    font-size: 11px;
    margin-top: 2px;
}

.admin-order-items {
    color: var(--muted);
    font-size: 11px;
    margin-bottom: 12px;
}

.admin-order-shipping-fields {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    align-items: end;
}

.admin-order-shipping-fields .field-group label {
    display: block;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--muted);
    margin-bottom: 5px;
}

.admin-order-shipping-fields select,
.admin-order-shipping-fields input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    background: white;
    color: var(--charcoal);
    font-size: 12px;
}

.admin-order-save {
    border: 1px solid var(--forest);
    background: var(--forest);
    color: white;
    padding: 9px 12px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    white-space: nowrap;
}

.admin-order-save:hover {
    background: var(--forest-dark);
}

@media (max-width: 700px) {
    .admin-order-shipping-fields {
        grid-template-columns: 1fr 1fr;
    }
}


/* =========================================
   ADMIN — SHIPPING TAB
========================================= */

.admin-shipping-section h3 {
    font-family: var(--serif);
    font-size: 22px;
    margin-top: 25px;
    margin-bottom: 6px;
}

.admin-shipping-section h3:first-child {
    margin-top: 0;
}

.admin-shipping-thresholds-heading {
    margin-top: 35px !important;
}

.admin-shipping-methods-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 20px;
}

.admin-shipping-method-row {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    gap: 12px;
    align-items: center;
    padding: 12px 14px;
    border: 1px solid var(--border);
    background: white;
    font-size: 12px;
}

.admin-shipping-method-row .method-name {
    font-weight: 700;
}

.admin-shipping-method-row .method-meta {
    color: var(--muted);
    font-size: 11px;
}

.admin-shipping-method-row button {
    border: 1px solid var(--border);
    background: transparent;
    padding: 6px 10px;
    font-size: 10px;
    text-transform: uppercase;
}

.admin-shipping-method-row .delete-button {
    color: #8d4c40;
    border-color: #8d4c40;
}

.admin-shipping-method-form {
    padding: 18px;
    background: var(--cream-dark);
    margin-bottom: 10px;
}

.admin-shipping-form-row {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: 12px;
}

.admin-shipping-form-row .field-group label {
    display: block;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--muted);
    margin-bottom: 5px;
}

.admin-shipping-form-row input {
    width: 100%;
    padding: 10px;
    border: 1px solid var(--border);
    background: white;
    color: var(--charcoal);
    font-size: 12px;
}

.admin-category-thresholds-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.admin-category-threshold-row {
    display: grid;
    grid-template-columns: 1fr 160px auto;
    gap: 12px;
    align-items: center;
    padding: 10px 14px;
    border: 1px solid var(--border);
    background: white;
}

.admin-category-threshold-row .category-name {
    font-weight: 700;
    font-size: 12px;
}

.admin-category-threshold-row input {
    padding: 8px 10px;
    border: 1px solid var(--border);
    background: white;
    color: var(--charcoal);
    font-size: 12px;
}

@media (max-width: 700px) {
    .admin-shipping-method-row {
        grid-template-columns: 1fr;
    }
    .admin-shipping-form-row {
        grid-template-columns: 1fr 1fr;
    }
    .admin-category-threshold-row {
        grid-template-columns: 1fr;
    }
}


/* =========================================
   PRODUCT DETAIL PAGE
========================================= */

.product-loading,
.product-error {
    padding: 160px 20px;
    text-align: center;
    color: var(--muted);
}

.product-error h2 {
    margin-top: 10px;
    font-family: var(--serif);
    font-size: 40px;
}

.product-error a {
    color: var(--forest);
    text-decoration: underline;
}

.product-detail {
    width: min(1100px, 92%);
    margin: 60px auto 120px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 60px;
    align-items: start;
}

.product-detail-image {
    position: relative;
    aspect-ratio: 1 / 1;
    background: linear-gradient(135deg, #e2d2bd, #c2aa8c);
    box-shadow: var(--shadow);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
}

.product-detail-info h1 {
    margin-top: 8px;
    font-family: var(--serif);
    font-size: clamp(36px, 4vw, 52px);
    line-height: 1.05;
}

.product-detail-description {
    margin-top: 18px;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.8;
}

.customization-section {
    margin-top: 30px;
    padding: 25px;
    background: var(--cream-dark);
}

.customization-section .form-group:first-child {
    margin-top: 0;
}

.customization-section .form-group label,
.product-detail-info .form-group label {
    color: var(--charcoal);
}

.product-detail-info input,
.product-detail-info textarea,
.product-detail-info select {
    background: white;
    color: var(--charcoal);
    border: 1px solid var(--border);
}

.product-detail-info input::placeholder,
.product-detail-info textarea::placeholder {
    color: #999;
}

.product-detail-info .style-option {
    color: var(--charcoal);
    border-color: var(--border);
}

.product-detail-info .style-option.active {
    border-color: var(--forest);
    background: rgba(38, 56, 45, 0.08);
}

.product-detail-price {
    margin-top: 25px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    font-family: var(--serif);
    font-size: 40px;
}

.product-detail-add-button {
    margin-top: 20px;
}

@media (max-width: 800px) {
    .product-detail {
        grid-template-columns: 1fr;
        margin-top: 30px;
    }
}


/* =========================================
   FOOTER
========================================= */

.site-footer {

    padding:
        60px 0 25px;

    background-image:
        linear-gradient(
            rgba(0,0,0,0.18),
            rgba(0,0,0,0.18)
        ),
        url("../assets/images/hunter-camo.jpg");

    background-size:
        cover;

    background-position:
        center;

    background-repeat:
        repeat;

    color:
        white;

    border-top:
        2px solid #000;
}

.footer-inner {

    width:
        min(1200px,92%);

    margin:
        auto;

    display:
        grid;

    grid-template-columns:
        2fr 1fr 1fr;

    gap:
        40px;
}

.footer-brand {

    display:
        inline-block;

    background:
        #000;

    color:
        white;

    padding:
        12px 18px;

    font-family:
        var(--serif);

    font-size:
        32px;

    letter-spacing:
        2px;
}

.footer-inner p {

    display:
        table;

    margin-top:
        10px;

    padding:
        7px 10px;

    background:
        #000;

    color:
        white;

    font-size:
        11px;
}

.footer-inner h3 {

    display:
        table;

    margin-bottom:
        12px;

    padding:
        7px 12px;

    background:
        #000;

    color:
        white;

    font-size:
        10px;

    text-transform:
        uppercase;

    letter-spacing:
        1.5px;
}

.footer-inner a {

    display:
        table;

    margin-bottom:
        7px;

    padding:
        7px 12px;

    background:
        #000;

    color:
        white;

    font-size:
        11px;

    transition:
        transform 0.2s ease,
        background 0.2s ease;
}

.footer-inner a:hover {

    background:
        #222;

    transform:
        translateX(3px);
}

.footer-bottom {

    width:
        min(1200px,92%);

    margin:
        45px auto 0;

    padding-top:
        20px;

    border-top:
        1px solid rgba(255,255,255,0.35);

    display:
        flex;

    justify-content:
        space-between;

    color:
        white;

    font-size:
        9px;
}

.footer-bottom span {

    background:
        #000;

    padding:
        7px 10px;
}


/* =========================================
   RESPONSIVE
========================================= */

@media (max-width: 850px) {

    .main-nav {
        display: none;
    }

    .header-inner {
        min-height: 82px;
    }

    .shop-category-nav {
        top: 82px;
        grid-template-columns:
            repeat(2, 1fr);
    }

    .product-grid {
        grid-template-columns:
            1fr 1fr;
    }

    .collection-heading {
        grid-template-columns:
            1fr;
    }

    .custom-container,
    .about-inner {
        grid-template-columns:
            1fr;

        gap:
            60px;
    }

    .footer-inner {
        grid-template-columns:
            1fr 1fr;
    }

    .footer-inner > div:first-child {
        grid-column:
            1 / -1;
    }
}


@media (max-width: 560px) {

    html {
        scroll-padding-top:
            80px;
    }

    .header-inner {
        min-height:
            75px;
    }

    .brand {
        padding:
            7px 10px;
    }

    .brand-name {
        font-size:
            21px;
    }

    .brand-tagline {
        font-size:
            7px;
    }

    .brand-mark {
        width:
            35px;

        height:
            35px;
    }

    .cart-button {
        padding:
            10px 11px;
    }

    .hero {
        min-height:
            590px;
    }

    .hero h1 {
        font-size:
            60px;
    }

    .shop-section,
    .custom-section,
    .about-section {
        padding-top:
            75px;

        padding-bottom:
            75px;
    }

    .shop-category-nav {
        position:
            static;

        grid-template-columns:
            1fr;

        margin-bottom:
            60px;
    }

    .shop-category-link {
        min-height:
            60px;
    }

    .shop-collection {
        scroll-margin-top:
            25px;

        padding-bottom:
            80px;
    }

    .product-grid {
        grid-template-columns:
            1fr;
    }

    .custom-builder {
        padding:
            22px;
    }

    .builder-total {
        flex-direction:
            column;

        align-items:
            stretch;
    }

    .preview-wood {
        width:
            95%;

        height:
            250px;
    }

    .about-card {
        min-height:
            330px;
    }

    .about-card-content strong {
        font-size:
            45px;
    }

    .footer-inner {
        grid-template-columns:
            1fr;
    }

    .footer-inner > div:first-child {
        grid-column:
            auto;
    }

    .footer-bottom {
        flex-direction:
            column;

        gap:
            8px;
    }

    .checkout-modal {
        padding:
            30px 22px;
    }
}
EOF_PUBLIC_CSS_STYLES_CSS_

echo "Writing public/js/partials.js"
cat > "public/js/partials.js" << 'EOF_PUBLIC_JS_PARTIALS_JS_'
// /corner-barr/js/partials.js
//
// Every page shares the same header, cart drawer, checkout modal, account
// modal, admin modal, and footer. Rather than copy-pasting that markup into
// three separate HTML files (and having to edit it three places every time
// something changes), each page has an empty placeholder div, and this file
// fetches the real markup and drops it in before anything else runs.

async function loadPartial(url, placeholderId) {

    const placeholder = document.getElementById(placeholderId);

    if (!placeholder) {
        return;
    }

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Could not load ${url}`);
    }

    const html = await response.text();

    // Replace the placeholder entirely with the real markup, so the actual
    // <header>/<footer>/etc. tags end up as direct children of <body> —
    // not wrapped in an extra <div>, which would break some of the CSS.
    placeholder.outerHTML = html;

}

async function loadPartials() {

    await Promise.all([
        loadPartial("partials/header.html", "header-slot"),
        loadPartial("partials/cart-drawer.html", "cart-drawer-slot"),
        loadPartial("partials/checkout-modal.html", "checkout-modal-slot"),
        loadPartial("partials/account-modal.html", "account-modal-slot"),
        loadPartial("partials/admin-modal.html", "admin-modal-slot"),
        loadPartial("partials/footer.html", "footer-slot")
    ]);

}
EOF_PUBLIC_JS_PARTIALS_JS_

echo "Writing public/js/shared.js"
cat > "public/js/shared.js" << 'EOF_PUBLIC_JS_SHARED_JS_'
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
    myWishlistList;

let adminModal, closeAdminButton, adminError, adminTabListings, adminTabOrders,
    adminTabShipping, adminListingsSection, adminOrdersSection,
    adminShippingSection, adminOrdersList, adminProductList, adminProductForm,
    adminProductId, adminCategory, adminName, adminDescription, adminPrice,
    adminDropZone, adminImagePreview, adminDropZoneText, adminImageInput,
    adminCancelEdit, adminSaveButton, adminFormTitle;

let adminShippingMethodsList, adminShippingMethodForm, adminShippingMethodId,
    adminShippingName, adminShippingPrice, adminShippingDaysMin,
    adminShippingDaysMax, adminShippingCancelEdit, adminShippingSaveButton,
    adminCategoryThresholdsList;


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
    adminDropZone = document.getElementById("adminDropZone");
    adminImagePreview = document.getElementById("adminImagePreview");
    adminDropZoneText = document.getElementById("adminDropZoneText");
    adminImageInput = document.getElementById("adminImageInput");
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

}


function money(value) {

    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD"
    }).format(value);

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
                notes: document.getElementById("customerNotes").value.trim()
            };

            const shippingMethodId = isFreeShippingEligible() ? null : selectedShippingMethodId;

            const response = await fetch("/api/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cart, customer, shippingMethodId })
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
                notes: document.getElementById("customerNotes").value.trim()
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

        await loadPayPalScript();
        renderPayPalButtons();

    } catch (err) {
        console.error(err);
        showCheckoutError("Could not load checkout. Check your connection and try again.");
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
}


function showLoggedInView(email) {
    accountLoggedOut.classList.add("hidden");
    accountLoggedIn.classList.remove("hidden");
    accountEmailDisplay.textContent = `Logged in as ${email}`;
    loadMyOrders();
    loadMyWishlist();
}


function showLoggedOutView() {
    accountLoggedOut.classList.remove("hidden");
    accountLoggedIn.classList.add("hidden");
    wishlistProductIds = new Set();
    refreshWishlistButtonStates();
}


const SHIPPING_STATUS_LABELS = {
    processing: "Processing",
    shipped: "Shipped",
    delivered: "Delivered"
};


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
                <div class="meta">${escapeHtml(ADMIN_CATEGORY_LABELS[product.category] || product.category)} · ${money(Number(product.price))}</div>
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

        row.innerHTML = `
            <div class="admin-order-top">
                <div>
                    <div class="admin-order-customer">${escapeHtml(order.customer_name || "Guest")}</div>
                    <div class="admin-order-meta">
                        ${escapeHtml(order.customer_email || "")} · ${date} · ${money(Number(order.subtotal))}
                    </div>
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

}


/* =========================================
   INITIALIZE (shared)
   Every page calls this first, before its own page-specific setup.
========================================= */

async function initShared() {

    await loadPartials();
    cacheSharedDom();
    wireSharedEventListeners();

    loadCart();
    renderCart();

    initSupabaseAuth().catch(err => console.error("Could not initialize accounts:", err));

    const currentYearEl = document.getElementById("currentYear");
    if (currentYearEl) {
        currentYearEl.textContent = new Date().getFullYear();
    }

}
EOF_PUBLIC_JS_SHARED_JS_

echo "Writing public/js/shop.js"
cat > "public/js/shop.js" << 'EOF_PUBLIC_JS_SHOP_JS_'
// /corner-barr/js/shop.js
//
// Renders the 5 category grids on shop.html. Cards are clickable — like
// Amazon's search results — and take the customer to product.html for
// details, customization (cutting boards), and Add to Cart.

let cuttingBoards = [];
let soapCandles = [];
let holidayProducts = [];
let resinCrafts = [];
let jewelryItems = [];

const cuttingBoardGrid = document.getElementById("cuttingBoardGrid");
const soapCandleGrid = document.getElementById("soapCandleGrid");
const holidayGrid = document.getElementById("holidayGrid");
const resinGrid = document.getElementById("resinGrid");
const jewelryGrid = document.getElementById("jewelryGrid");


async function loadProductData() {

    const response = await fetch("/api/products");

    if (!response.ok) {
        throw new Error("Could not load product data.");
    }

    const data = await response.json();

    cuttingBoards = data.cuttingBoards;
    soapCandles = data.soapCandles;
    holidayProducts = data.holidayProducts;
    resinCrafts = data.resinCrafts;
    jewelryItems = data.jewelryItems;

}


function productCardMarkup(product, imageClassName, imageMarkup) {

    return `
        <article class="product-card">

            <a class="product-card-link" href="product.html?id=${encodeURIComponent(product.id)}">

                <div class="product-image ${imageClassName}">
                    ${imageMarkup}
                </div>

                <div class="product-info">
                    <div class="product-category">${escapeHtml(product.category)}</div>
                    <h3 class="product-name">${escapeHtml(product.name)}</h3>
                    <p class="product-description">${escapeHtml(product.description)}</p>

                    <div class="product-bottom">
                        <span class="product-price">${money(product.price)}</span>
                    </div>
                </div>

            </a>

            ${wishlistButtonMarkup(product.id)}

        </article>
    `;

}


/* =========================================
   CUTTING BOARDS
========================================= */

function renderCuttingBoards() {

    cuttingBoardGrid.innerHTML = cuttingBoards.map(product => {

        const imageMarkup = product.image_url
            ? `<img class="product-photo" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">`
            : `<div class="board-shape ${product.boardClass || "board-classic"}">
                   <div class="board-engraving">CORNER BARR</div>
               </div>`;

        return productCardMarkup(product, "cutting-board-image", imageMarkup);

    }).join("");

    attachWishlistButtons(cuttingBoardGrid);

}


/* =========================================
   SOAP & CANDLES
========================================= */

function renderSoapCandles() {

    soapCandleGrid.innerHTML = soapCandles.map(product => {

        const imageMarkup = product.image_url
            ? `<img class="product-photo" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">`
            : `<div class="product-object ${product.productClass || "soap-object"}"></div>`;

        return productCardMarkup(product, "soap-candle-image", imageMarkup);

    }).join("");

    attachWishlistButtons(soapCandleGrid);

}


/* =========================================
   HOLIDAY
========================================= */

function renderHolidayProducts() {

    holidayGrid.innerHTML = holidayProducts.map(product => {

        const imageMarkup = product.image_url
            ? `<img class="product-photo" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">`
            : `<div class="holiday-object">${escapeHtml(product.holidayText || "")}</div>`;

        return productCardMarkup(product, "holiday-image", imageMarkup);

    }).join("");

    attachWishlistButtons(holidayGrid);

}


/* =========================================
   RESIN CRAFTS
========================================= */

function renderResinCrafts() {

    resinGrid.innerHTML = resinCrafts.map(product => {

        const imageMarkup = product.image_url
            ? `<img class="product-photo" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">`
            : `<div class="product-photo-placeholder"></div>`;

        return productCardMarkup(product, "", imageMarkup);

    }).join("");

    attachWishlistButtons(resinGrid);

}


/* =========================================
   JEWELRY
========================================= */

function renderJewelry() {

    jewelryGrid.innerHTML = jewelryItems.map(product => {

        const imageMarkup = product.image_url
            ? `<img class="product-photo" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">`
            : `<div class="product-photo-placeholder"></div>`;

        return productCardMarkup(product, "", imageMarkup);

    }).join("");

    attachWishlistButtons(jewelryGrid);

}


/* =========================================
   INITIALIZE
========================================= */

async function initShop() {

    await initShared();

    try {
        await loadProductData();
    } catch (err) {
        console.error(err);
        cuttingBoardGrid.innerHTML = "<p>Could not load products. Please refresh the page.</p>";
        return;
    }

    renderCuttingBoards();
    renderSoapCandles();
    renderHolidayProducts();
    renderResinCrafts();
    renderJewelry();

}


initShop();
EOF_PUBLIC_JS_SHOP_JS_

echo "Writing public/js/product.js"
cat > "public/js/product.js" << 'EOF_PUBLIC_JS_PRODUCT_JS_'
// /corner-barr/js/product.js
//
// Powers product.html. Reads ?id= from the URL, fetches that one product,
// and renders it. Cutting boards get a customization panel (engraving text
// + style) that sits right above the price — the price updates instantly
// as the customer changes their selection.

const CATEGORY_KEY_TO_CART_CATEGORY = {
    soap_candle: "soap",
    holiday: "holiday",
    resin_craft: "resin",
    jewelry: "jewelry"
    // cutting_board is handled separately, as "custom", since it always
    // carries engraving/style details.
};

const productLoading = document.getElementById("productLoading");
const productErrorEl = document.getElementById("productError");
const productDetail = document.getElementById("productDetail");
const productDetailImage = document.getElementById("productDetailImage");
const productDetailCategory = document.getElementById("productDetailCategory");
const productDetailName = document.getElementById("productDetailName");
const productDetailDescription = document.getElementById("productDetailDescription");
const productDetailPrice = document.getElementById("productDetailPrice");
const customizationSection = document.getElementById("customizationSection");
const engravingTextInput = document.getElementById("engravingText");
const styleOptionsContainer = document.getElementById("styleOptions");
const giftMessageCheckbox = document.getElementById("giftMessage");
const giftMessageContainer = document.getElementById("giftMessageContainer");
const giftMessageText = document.getElementById("giftMessageText");
const productAddToCartButton = document.getElementById("productAddToCartButton");

let currentProduct = null;
let currentEngravingStyles = [];
let selectedEngravingStyleId = null;


function getProductIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("id");
}


async function loadProduct() {

    const id = getProductIdFromUrl();

    if (!id) {
        showProductError();
        return;
    }

    try {

        const response = await fetch(`/api/products/${encodeURIComponent(id)}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Product not found.");
        }

        currentProduct = data.product;
        currentEngravingStyles = data.engravingStyles || [];

        renderProduct();

    } catch (err) {
        console.error(err);
        showProductError();
    }

}


function showProductError() {
    productLoading.classList.add("hidden");
    productErrorEl.classList.remove("hidden");
}


function renderProduct() {

    productLoading.classList.add("hidden");
    productDetail.classList.remove("hidden");

    document.title = `Corner Barr | ${currentProduct.name}`;

    productDetailImage.innerHTML = currentProduct.image_url
        ? `<img class="product-photo" src="${escapeHtml(currentProduct.image_url)}" alt="${escapeHtml(currentProduct.name)}">`
        : renderFallbackImage(currentProduct);

    // The wishlist heart overlays the image, same as on the shop grid.
    productDetailImage.insertAdjacentHTML("beforeend", wishlistButtonMarkup(currentProduct.id));
    attachWishlistButtons(productDetailImage);

    productDetailCategory.textContent = currentProduct.category;
    productDetailName.textContent = currentProduct.name;
    productDetailDescription.textContent = currentProduct.description;

    if (currentProduct.categoryKey === "cutting_board") {
        customizationSection.classList.remove("hidden");
        renderStyleOptions();
    }

    updatePriceDisplay();

}


function renderFallbackImage(product) {

    if (product.categoryKey === "cutting_board") {
        return `
            <div class="board-shape ${product.boardClass || "board-classic"}">
                <div class="board-engraving">CORNER BARR</div>
            </div>
        `;
    }

    if (product.categoryKey === "soap_candle") {
        return `<div class="product-object ${product.productClass || "soap-object"}"></div>`;
    }

    if (product.categoryKey === "holiday") {
        return `<div class="holiday-object">${escapeHtml(product.holidayText || "")}</div>`;
    }

    return `<div class="product-photo-placeholder"></div>`;

}


function renderStyleOptions() {

    if (currentEngravingStyles.length === 0) {
        return;
    }

    if (!selectedEngravingStyleId) {
        selectedEngravingStyleId = currentEngravingStyles[0].id;
    }

    styleOptionsContainer.innerHTML = currentEngravingStyles.map(style => `
        <button
            type="button"
            class="style-option ${style.id === selectedEngravingStyleId ? "active" : ""}"
            data-style="${style.id}"
        >
            ${escapeHtml(style.name)}${style.extra ? ` +${money(style.extra)}` : ""}
        </button>
    `).join("");

    styleOptionsContainer.querySelectorAll("[data-style]").forEach(button => {
        button.addEventListener("click", () => {
            selectedEngravingStyleId = button.dataset.style;
            renderStyleOptions();
            updatePriceDisplay();
        });
    });

}


function getSelectedStyleExtra() {

    if (currentProduct.categoryKey !== "cutting_board") {
        return 0;
    }

    const style = currentEngravingStyles.find(s => s.id === selectedEngravingStyleId);
    return style ? style.extra : 0;

}


function updatePriceDisplay() {
    const total = currentProduct.price + getSelectedStyleExtra();
    productDetailPrice.textContent = money(total);
}


function handleAddToCart() {

    if (!currentProduct) {
        return;
    }

    const giftMessage = giftMessageCheckbox.checked ? giftMessageText.value.trim() : "";

    let item;

    if (currentProduct.categoryKey === "cutting_board") {

        const style = currentEngravingStyles.find(s => s.id === selectedEngravingStyleId);

        item = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            productId: currentProduct.id,
            category: "custom",
            engravingStyleId: selectedEngravingStyleId,
            name: currentProduct.name,
            price: currentProduct.price + getSelectedStyleExtra(),
            quantity: 1,
            engraving: engravingTextInput.value.trim(),
            style: style ? style.name : "",
            giftMessage
        };

    } else {

        const cartCategory = CATEGORY_KEY_TO_CART_CATEGORY[currentProduct.categoryKey] || currentProduct.categoryKey;

        item = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            productId: currentProduct.id,
            category: cartCategory,
            name: currentProduct.name,
            price: currentProduct.price,
            quantity: 1,
            engraving: "",
            style: "",
            giftMessage
        };

    }

    cart.push(item);
    saveCart();
    renderCart();
    openCart();

}


/* =========================================
   INITIALIZE
========================================= */

async function initProduct() {

    await initShared();

    engravingTextInput.addEventListener("input", updatePriceDisplay);

    giftMessageCheckbox.addEventListener("change", event => {
        giftMessageContainer.classList.toggle("visible", event.target.checked);
    });

    productAddToCartButton.addEventListener("click", handleAddToCart);

    await loadProduct();

}


initProduct();
EOF_PUBLIC_JS_PRODUCT_JS_

echo "Writing public/js/home.js"
cat > "public/js/home.js" << 'EOF_PUBLIC_JS_HOME_JS_'
// /corner-barr/js/home.js
//
// The home page has no product grids of its own — just the hero and the
// "Our Story" section — so all it needs is the shared header, cart,
// login, and admin panel to be wired up.

initShared();
EOF_PUBLIC_JS_HOME_JS_

echo "Writing public/partials/header.html"
cat > "public/partials/header.html" << 'EOF_PUBLIC_PARTIALS_HEADER_HTML_'
    <header class="site-header">

        <div class="header-inner">

            <a
                href="index.html"
                class="brand"
            >

                <div class="brand-mark">
                    <span>⌁</span>
                </div>

                <div>

                    <div class="brand-name">
                        CORNER BARR
                    </div>

                    <div class="brand-tagline">
                        CUSTOM MADE GIFTS
                    </div>

                </div>

            </a>


            <nav class="main-nav">

                <a href="shop.html">
                    Shop
                </a>

                <a href="index.html#about">
                    Our Story
                </a>

            </nav>


            <div class="header-actions">

                <button
                    class="account-button"
                    id="accountButton"
                    type="button"
                >
                    Account
                </button>

                <button
                    class="account-button owner-only hidden"
                    id="manageShopButton"
                    type="button"
                >
                    Manage Shop
                </button>

                <button
                    class="cart-button"
                    id="cartButton"
                    type="button"
                >

                    <span>
                        Cart
                    </span>

                    <span
                        class="cart-count"
                        id="cartCount"
                    >
                        0
                    </span>

                </button>

            </div>

        </div>

    </header>
EOF_PUBLIC_PARTIALS_HEADER_HTML_

echo "Writing public/partials/cart-drawer.html"
cat > "public/partials/cart-drawer.html" << 'EOF_PUBLIC_PARTIALS_CART_DRAWER_HTML_'
    <!-- =========================================
         CART DRAWER
    ========================================== -->

    <div
        class="cart-overlay"
        id="cartOverlay"
    ></div>


    <aside
        class="cart-drawer"
        id="cartDrawer"
    >

        <div class="cart-header">

            <div>

                <p class="eyebrow">
                    YOUR ORDER
                </p>

                <h2>
                    Your Cart
                </h2>

            </div>

            <button
                class="close-button"
                id="closeCart"
                type="button"
            >
                ×
            </button>

        </div>


        <div
            class="cart-items"
            id="cartItems"
        ></div>


        <div class="cart-footer">

            <div class="cart-total">

                <span>
                    Total
                </span>

                <strong id="cartTotal">
                    $0.00
                </strong>

            </div>

            <button
                class="primary-button full-width"
                id="checkoutButton"
                type="button"
            >
                Checkout
            </button>

        </div>

    </aside>
EOF_PUBLIC_PARTIALS_CART_DRAWER_HTML_

echo "Writing public/partials/checkout-modal.html"
cat > "public/partials/checkout-modal.html" << 'EOF_PUBLIC_PARTIALS_CHECKOUT_MODAL_HTML_'
    <!-- =========================================
         CHECKOUT MODAL
    ========================================== -->

    <div
        class="modal-overlay"
        id="checkoutModal"
    >

        <div class="checkout-modal">

            <button
                class="close-button modal-close"
                id="closeCheckout"
                type="button"
            >
                ×
            </button>

            <p class="eyebrow">
                CHECKOUT
            </p>

            <h2>
                Almost there.
            </h2>

            <p class="checkout-note">
                Enter your information, then pay securely
                with PayPal or a debit/credit card below.
            </p>


            <div id="checkoutFormFields">

                <form id="checkoutForm">

                    <div class="form-group">

                        <label for="customerName">
                            Name
                        </label>

                        <input
                            id="customerName"
                            type="text"
                            required
                            placeholder="Your name"
                        >

                    </div>


                    <div class="form-group">

                        <label for="customerEmail">
                            Email
                        </label>

                        <input
                            id="customerEmail"
                            type="email"
                            required
                            placeholder="you@example.com"
                        >

                    </div>


                    <div class="form-group">

                        <label for="customerPhone">
                            Phone
                        </label>

                        <input
                            id="customerPhone"
                            type="tel"
                            placeholder="Optional"
                        >

                    </div>


                    <div class="form-group">

                        <label for="customerNotes">
                            Order notes
                        </label>

                        <textarea
                            id="customerNotes"
                            placeholder="Anything we should know?"
                        ></textarea>

                    </div>

                </form>


                <div class="shipping-section">

                    <label class="shipping-section-label">Shipping</label>

                    <div id="shippingOptions" class="shipping-options"></div>

                </div>


                <div class="checkout-summary">

                    <span>
                        Order total
                    </span>

                    <strong id="checkoutTotal">
                        $0.00
                    </strong>

                </div>


                <div
                    id="checkoutError"
                    class="checkout-error"
                ></div>


                <div
                    id="paypal-button-container"
                    class="paypal-button-container"
                ></div>


                <p class="payment-placeholder">
                    Secured by PayPal. Pay with PayPal or a debit/credit card.
                </p>

            </div>


            <div
                id="orderConfirmation"
                class="order-confirmation"
            ></div>

        </div>

    </div>
EOF_PUBLIC_PARTIALS_CHECKOUT_MODAL_HTML_

echo "Writing public/partials/account-modal.html"
cat > "public/partials/account-modal.html" << 'EOF_PUBLIC_PARTIALS_ACCOUNT_MODAL_HTML_'
    <!-- =========================================
         ACCOUNT / LOGIN MODAL
    ========================================== -->

    <div
        class="modal-overlay"
        id="accountModal"
    >

        <div class="checkout-modal">

            <button
                class="close-button modal-close"
                id="closeAccount"
                type="button"
            >
                ×
            </button>

            <div id="accountLoggedOut">

                <p class="eyebrow">
                    ACCOUNT
                </p>

                <h2 id="accountFormTitle">
                    Log In
                </h2>

                <p class="checkout-note">
                    Log in or create an account to check out faster next time.
                </p>

                <form id="accountForm">

                    <div class="form-group">
                        <label for="accountEmail">Email</label>
                        <input
                            id="accountEmail"
                            type="email"
                            required
                            placeholder="you@example.com"
                        >
                    </div>

                    <div class="form-group">
                        <label for="accountPassword">Password</label>
                        <div class="password-field-wrapper">
                            <input
                                id="accountPassword"
                                type="password"
                                required
                                minlength="6"
                                placeholder="At least 6 characters"
                            >
                            <button
                                type="button"
                                class="password-toggle-button"
                                id="togglePasswordVisibility"
                                aria-label="Show password"
                            >
                                <svg id="passwordEyeIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div
                        id="accountError"
                        class="checkout-error"
                    ></div>

                    <button
                        type="submit"
                        class="primary-button full-width"
                        id="accountSubmitButton"
                    >
                        Log In
                    </button>

                </form>

                <p class="account-toggle">
                    <span id="accountToggleText">Don't have an account?</span>
                    <button type="button" id="accountToggleMode">Create one</button>
                </p>

            </div>

            <div id="accountLoggedIn" class="hidden">

                <p class="eyebrow">
                    ACCOUNT
                </p>

                <h2>Welcome back</h2>

                <p class="checkout-note" id="accountEmailDisplay"></p>

                <h3 class="account-orders-heading">My Orders</h3>

                <div id="myOrdersList" class="my-orders-list"></div>

                <h3 class="account-orders-heading">My Wishlist</h3>

                <div id="myWishlistList" class="my-wishlist-list"></div>

                <button
                    type="button"
                    class="secondary-button full-width"
                    id="logoutButton"
                >
                    Log Out
                </button>

            </div>

        </div>

    </div>
EOF_PUBLIC_PARTIALS_ACCOUNT_MODAL_HTML_

echo "Writing public/partials/admin-modal.html"
cat > "public/partials/admin-modal.html" << 'EOF_PUBLIC_PARTIALS_ADMIN_MODAL_HTML_'
    <!-- =========================================
         ADMIN — MANAGE SHOP MODAL (owner only)
    ========================================== -->

    <div
        class="modal-overlay"
        id="adminModal"
    >

        <div class="checkout-modal admin-modal">

            <button
                class="close-button modal-close"
                id="closeAdmin"
                type="button"
            >
                ×
            </button>

            <p class="eyebrow">
                OWNER TOOLS
            </p>

            <h2>Manage Shop</h2>

            <div class="admin-tabs">
                <button type="button" class="admin-tab active" id="adminTabListings">Listings</button>
                <button type="button" class="admin-tab" id="adminTabOrders">Orders</button>
                <button type="button" class="admin-tab" id="adminTabShipping">Shipping</button>
            </div>

            <div
                id="adminError"
                class="checkout-error"
            ></div>

            <div class="admin-layout" id="adminListingsSection">

                <div class="admin-list">

                    <h3>Current Listings</h3>

                    <div id="adminProductList"></div>

                </div>

                <div class="admin-form-panel">

                    <h3 id="adminFormTitle">Add a New Listing</h3>

                    <form id="adminProductForm">

                        <input type="hidden" id="adminProductId">

                        <div class="form-group">
                            <label for="adminCategory">Category</label>
                            <select id="adminCategory" required>
                                <option value="cutting_board">Cutting Board</option>
                                <option value="soap_candle">Soap & Candle</option>
                                <option value="resin_craft">Resin Craft</option>
                                <option value="jewelry">Jewelry</option>
                                <option value="holiday">Holiday</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="adminName">Name</label>
                            <input id="adminName" type="text" required placeholder="Product name">
                        </div>

                        <div class="form-group">
                            <label for="adminDescription">Description</label>
                            <textarea id="adminDescription" placeholder="A short description customers will see"></textarea>
                        </div>

                        <div class="form-group">
                            <label for="adminPrice">Price (USD)</label>
                            <input id="adminPrice" type="number" min="0" step="0.01" required placeholder="49.00">
                        </div>

                        <div class="form-group">
                            <label>Photo</label>

                            <div id="adminDropZone" class="admin-drop-zone">
                                <img id="adminImagePreview" class="admin-image-preview hidden">
                                <span id="adminDropZoneText">Drag a photo here, or click to choose one</span>
                                <input type="file" id="adminImageInput" accept="image/*" class="admin-file-input">
                            </div>

                        </div>

                        <div class="admin-form-actions">

                            <button
                                type="button"
                                class="secondary-button"
                                id="adminCancelEdit"
                            >
                                Cancel
                            </button>

                            <button
                                type="submit"
                                class="primary-button"
                                id="adminSaveButton"
                            >
                                Add Listing
                            </button>

                        </div>

                    </form>

                </div>

            </div>

            <div class="admin-orders-section hidden" id="adminOrdersSection">

                <h3>All Orders</h3>

                <div id="adminOrdersList"></div>

            </div>

            <div class="admin-shipping-section hidden" id="adminShippingSection">

                <h3>Shipping Methods</h3>
                <p class="checkout-note">These are the options customers choose between at checkout.</p>

                <div id="adminShippingMethodsList" class="admin-shipping-methods-list"></div>

                <form id="adminShippingMethodForm" class="admin-shipping-method-form">

                    <input type="hidden" id="adminShippingMethodId">

                    <div class="admin-shipping-form-row">
                        <div class="field-group">
                            <label for="adminShippingName">Name</label>
                            <input id="adminShippingName" type="text" required placeholder="Standard Shipping">
                        </div>
                        <div class="field-group">
                            <label for="adminShippingPrice">Price (USD)</label>
                            <input id="adminShippingPrice" type="number" min="0" step="0.01" required placeholder="6.00">
                        </div>
                        <div class="field-group">
                            <label for="adminShippingDaysMin">Min Days</label>
                            <input id="adminShippingDaysMin" type="number" min="0" placeholder="5">
                        </div>
                        <div class="field-group">
                            <label for="adminShippingDaysMax">Max Days</label>
                            <input id="adminShippingDaysMax" type="number" min="0" placeholder="8">
                        </div>
                    </div>

                    <div class="admin-form-actions">
                        <button type="button" class="secondary-button" id="adminShippingCancelEdit">Cancel</button>
                        <button type="submit" class="primary-button" id="adminShippingSaveButton">Add Method</button>
                    </div>

                </form>

                <h3 class="admin-shipping-thresholds-heading">Free Shipping Thresholds</h3>
                <p class="checkout-note">
                    Set a dollar amount per shop section. When a customer's items
                    in that section add up to at least this much, shipping is
                    free. Leave blank to never offer free shipping for that section.
                </p>

                <div id="adminCategoryThresholdsList" class="admin-category-thresholds-list"></div>

            </div>

        </div>

    </div>
EOF_PUBLIC_PARTIALS_ADMIN_MODAL_HTML_

echo "Writing public/partials/footer.html"
cat > "public/partials/footer.html" << 'EOF_PUBLIC_PARTIALS_FOOTER_HTML_'

    <!-- =========================================
         FOOTER
    ========================================== -->

    <footer class="site-footer">

        <div class="footer-inner">


            <div>

                <div class="footer-brand">
                    CORNER BARR
                </div>

                <p>
                    Custom Made Gifts
                </p>

                <p class="footer-location">
                    Proudly made in Southern Oregon.
                </p>

            </div>


            <div>

                <h3>
                    Shop
                </h3>

                <a href="shop.html#cutting-boards">
                    Cutting Boards
                </a>

                <a href="shop.html#soap-candles">
                    Soap & Candles
                </a>

                <a href="shop.html#resin-crafts">
                    Resin Crafts
                </a>

                <a href="shop.html#jewelry">
                    Jewelry
                </a>

                <a href="shop.html#holiday">
                    Holiday
                </a>

            </div>


            <div>

                <h3>
                    Contact
                </h3>

                <a href="mailto:hello@cornerbarr.com">
                    hello@cornerbarr.com
                </a>

                <a href="index.html#about">
                    Our Story
                </a>

            </div>

        </div>


        <div class="footer-bottom">

            <span>
                © <span id="currentYear"></span>
                Corner Barr. All rights reserved.
            </span>

            <span>
                Handmade with care.
            </span>

        </div>

    </footer>
EOF_PUBLIC_PARTIALS_FOOTER_HTML_

echo "Removing old app.js (fully replaced)..."
rm -f public/js/app.js

echo ""
echo "Done. New structure:"
find public -type f -not -path "*/node_modules/*" | sort