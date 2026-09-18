require("dotenv").config();

const express = require("express");
const path = require("path");
const { priceCart } = require("./data/pricing");
const { resolveShippingCost } = require("./data/shipping");
const { supabaseAdmin } = require("./data/supabase");
const localOptions = require("./data/products.json");
const vault = require("./data/vault");
const { checkStockAvailability, decrementStockForOrder } = require("./data/inventory");
const { hasUserPurchasedProduct, getMostRecentCustomerName, getProductReviewSummary } = require("./data/reviews");
const { createNotification, notifyOrderStatusChange, notifyOrderReceived, notifyOwnerOfNewOrder, notifyWishlistersOfStockChange } = require("./data/notifications");
const { getSimilarProducts, getRecommendationsForUser } = require("./data/recommendations");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_MODE = (process.env.PAYPAL_MODE || "sandbox").toLowerCase();
const PAYEE_EMAIL = process.env.PAYPAL_PAYEE_EMAIL || null;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || null;

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

// Pulls the actual PayPal capture ID out of a capture response, needed
// to issue a refund. Distinct from the order ID.
function extractCaptureId(capture) {
    return capture?.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;
}

/**
 * Fully refunds a PayPal capture. Used only for the rare case where
 * payment succeeds but an item sold out to someone else in the same
 * instant — we'd rather instantly give the money back than silently
 * accept an order we can't fulfill.
 */
async function refundCapture(captureId, accessToken) {

    const response = await fetch(`${PAYPAL_API_BASE}/v2/payments/captures/${captureId}/refund`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({})
    });

    const data = await response.json();

    if (!response.ok) {
        console.error("PayPal refund failed:", data);
        throw new Error("Could not automatically refund this payment.");
    }

    return data;

}

/**
 * Finds a PayPal customer ID already on file for this user, if any — so
 * saving a second payment method links to the same PayPal customer
 * record instead of creating a separate one each time.
 */
async function findExistingPaypalCustomerId(userId) {

    const { data } = await supabaseAdmin
        .from("saved_payment_methods")
        .select("paypal_customer_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();

    return data ? data.paypal_customer_id : null;

}

/**
 * After a capture, checks whether PayPal was asked to vault the payment
 * source and, if so, records what we know. PayPal may finish vaulting
 * immediately (status VAULTED) or a moment later (status APPROVED, with
 * the actual vault ID arriving via webhook shortly after).
 */
async function recordVaultResultIfPresent(userId, capture) {

    const vaultInfo = capture?.payment_source?.paypal?.attributes?.vault;

    if (!vaultInfo) {
        return;
    }

    const customerId = capture?.payment_source?.paypal?.attributes?.customer?.id
        || capture?.payment_source?.paypal?.attributes?.vault?.customer?.id;

    if (!customerId) {
        return;
    }

    const summary = vault.summarizePaymentSource(capture.payment_source);

    if (vaultInfo.status === "VAULTED" && vaultInfo.id) {

        await supabaseAdmin
            .from("saved_payment_methods")
            .upsert(
                {
                    user_id: userId,
                    paypal_customer_id: customerId,
                    vault_id: vaultInfo.id,
                    status: "saved",
                    method_type: summary.methodType,
                    paypal_email: summary.paypalEmail || null
                },
                { onConflict: "vault_id" }
            );

    } else if (vaultInfo.status === "APPROVED") {

        // Vault ID isn't known yet — save a pending placeholder. The
        // webhook handler (or the manual /sync endpoint) will find this
        // row by customer ID and fill in the vault ID once PayPal finishes.
        const { data: existingPending } = await supabaseAdmin
            .from("saved_payment_methods")
            .select("id")
            .eq("user_id", userId)
            .eq("paypal_customer_id", customerId)
            .is("vault_id", null)
            .maybeSingle();

        if (!existingPending) {
            await supabaseAdmin
                .from("saved_payment_methods")
                .insert({
                    user_id: userId,
                    paypal_customer_id: customerId,
                    status: "pending",
                    method_type: summary.methodType
                });
        }

    }

}

/**
 * Validates the shipping address fields on a customer object. Used as a
 * defense-in-depth check server-side — the checkout form already marks
 * these fields "required" in the browser, so this should only ever catch
 * a tampered or malformed request.
 */
function validateShippingAddress(customer) {

    const errors = [];

    if (!customer || typeof customer !== "object") {
        return ["A shipping address is required."];
    }

    if (typeof customer.address1 !== "string" || !customer.address1.trim()) {
        errors.push("Street address is required.");
    }

    if (typeof customer.city !== "string" || !customer.city.trim()) {
        errors.push("City is required.");
    }

    if (typeof customer.state !== "string" || !customer.state.trim()) {
        errors.push("State is required.");
    }

    if (typeof customer.zip !== "string" || !customer.zip.trim()) {
        errors.push("ZIP code is required.");
    }

    return errors;

}

// Builds the address columns for an orders insert from a customer object,
// trimming and capping lengths, and normalizing blanks to null.
function buildAddressColumns(customer) {

    const clean = value => (typeof value === "string" && value.trim())
        ? value.trim().substring(0, 200)
        : null;

    return {
        customer_address1: clean(customer?.address1),
        customer_address2: clean(customer?.address2),
        customer_city: clean(customer?.city),
        customer_state: customer?.state ? customer.state.trim().substring(0, 50).toUpperCase() : null,
        customer_zip: clean(customer?.zip)
    };

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
        category: CATEGORY_LABELS[row.category] || row.category,
        stock: Number.isFinite(Number(row.stock)) ? Number(row.stock) : 0
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

        const { data: extraImages, error: imagesError } = await supabaseAdmin
            .from("product_images")
            .select("image_url")
            .eq("product_id", req.params.id)
            .order("sort_order", { ascending: true });

        if (imagesError) {
            console.error("Could not load extra product images:", imagesError);
        }

        // Cover photo always comes first, followed by any extra gallery photos.
        const images = [data.image_url, ...(extraImages || []).map(row => row.image_url)]
            .filter(Boolean);

        res.json({
            product: mapProductRow(data),
            images,
            engravingStyles: data.category === "cutting_board" ? localOptions.engravingStyles : []
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not load this product." });
    }
});

/* =========================================
   SEARCH (public)
   Small catalog, so the simplest correct thing is to fetch everything
   and filter/rank in Node — this automatically covers future products
   with zero extra work, and partial/case-insensitive matching for free.
========================================= */

app.get("/api/search", async (req, res) => {

    const query = (req.query.q || "").trim().toLowerCase();

    if (!query) {
        return res.json({ results: [] });
    }

    try {

        const { data, error } = await supabaseAdmin
            .from("products")
            .select("*");

        if (error) {
            console.error("Search query failed:", error);
            return res.status(502).json({ error: "Could not search products right now." });
        }

        const scored = data.map(row => {

            const name = (row.name || "").toLowerCase();
            const description = (row.description || "").toLowerCase();
            const categoryLabel = (CATEGORY_LABELS[row.category] || row.category || "").toLowerCase();
            const tags = (row.tags || []).map(t => t.toLowerCase());

            let score = 0;

            if (name.includes(query)) score += 5;
            if (name.startsWith(query)) score += 3;
            if (tags.some(tag => tag.includes(query))) score += 3;
            if (categoryLabel.includes(query)) score += 2;
            if (description.includes(query)) score += 1;

            return { row, score };

        }).filter(entry => entry.score > 0);

        scored.sort((a, b) => b.score - a.score);

        const results = scored.slice(0, 20).map(entry => mapProductRow(entry.row));

        res.json({ results });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not search products right now." });
    }

});

/* =========================================
   RECOMMENDATIONS (public — personalizes automatically if logged in)
========================================= */

app.get("/api/products/:id/similar", async (req, res) => {

    try {
        const limit = Math.min(Number(req.query.limit) || 4, 12);
        const similar = await getSimilarProducts(req.params.id, limit);
        res.json(similar.map(mapProductRow));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not load similar products." });
    }

});

app.get("/api/recommendations", async (req, res) => {

    try {

        const auth = await getAuthContext(req);

        const viewedIds = (req.query.viewed || "")
            .split(",")
            .map(id => id.trim())
            .filter(Boolean);

        const excludeIds = (req.query.exclude || "")
            .split(",")
            .map(id => id.trim())
            .filter(Boolean);

        const limit = Math.min(Number(req.query.limit) || 8, 20);

        const recommendations = await getRecommendationsForUser({
            userId: auth ? auth.user.id : null,
            viewedIds,
            excludeIds,
            limit
        });

        res.json(recommendations.map(mapProductRow));

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not load recommendations." });
    }

});

/* =========================================
   REVIEWS (public read, logged-in customers write their own)
========================================= */

app.get("/api/products/:id/reviews", async (req, res) => {

    try {

        const summary = await getProductReviewSummary(req.params.id);

        const { data, error } = await supabaseAdmin
            .from("reviews")
            .select("*")
            .eq("product_id", req.params.id)
            .order("created_at", { ascending: false });

        if (error) {
            console.error(error);
            return res.status(502).json({ error: "Could not load reviews." });
        }

        res.json({ summary, reviews: data });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not load reviews." });
    }

});

app.post("/api/products/:id/reviews", requireLogin, async (req, res) => {

    try {

        const { rating, review_text, photo_url } = req.body;
        const productId = req.params.id;

        const ratingNumber = Number(rating);

        if (!Number.isInteger(ratingNumber) || ratingNumber < 1 || ratingNumber > 5) {
            return res.status(400).json({ error: "rating must be a whole number from 1 to 5." });
        }

        // Only allow reviewing products this customer has actually
        // ordered. Note: this only recognizes orders placed after
        // productId started being stored on each order line — earlier
        // orders won't count toward this check.
        const purchased = await hasUserPurchasedProduct(req.auth.user.id, productId);

        if (!purchased) {
            return res.status(403).json({ error: "You can only review products you've purchased." });
        }

        const reviewerName = await getMostRecentCustomerName(req.auth.user.id);

        const { data, error } = await supabaseAdmin
            .from("reviews")
            .insert({
                product_id: productId,
                user_id: req.auth.user.id,
                reviewer_name: reviewerName,
                rating: ratingNumber,
                review_text: typeof review_text === "string" ? review_text.trim().substring(0, 2000) : null,
                photo_url: typeof photo_url === "string" && photo_url.trim() ? photo_url.trim() : null
            })
            .select()
            .single();

        if (error) {
            if (error.code === "23505") {
                // unique(product_id, user_id) violation
                return res.status(409).json({ error: "You've already reviewed this product. You can edit your existing review instead." });
            }
            console.error(error);
            return res.status(502).json({ error: "Could not save your review." });
        }

        res.status(201).json(data);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not save your review." });
    }

});

app.put("/api/reviews/:id", requireLogin, async (req, res) => {

    try {

        const { rating, review_text, photo_url } = req.body;
        const clean = {};

        if (rating !== undefined) {
            const ratingNumber = Number(rating);
            if (!Number.isInteger(ratingNumber) || ratingNumber < 1 || ratingNumber > 5) {
                return res.status(400).json({ error: "rating must be a whole number from 1 to 5." });
            }
            clean.rating = ratingNumber;
        }

        if (review_text !== undefined) {
            clean.review_text = typeof review_text === "string" ? review_text.trim().substring(0, 2000) : null;
        }

        if (photo_url !== undefined) {
            clean.photo_url = typeof photo_url === "string" && photo_url.trim() ? photo_url.trim() : null;
        }

        clean.updated_at = new Date().toISOString();

        // .eq("user_id", ...) is what makes this "own reviews only" —
        // a customer can never edit someone else's review this way.
        const { data, error } = await supabaseAdmin
            .from("reviews")
            .update(clean)
            .eq("id", req.params.id)
            .eq("user_id", req.auth.user.id)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({ error: "Review not found." });
        }

        res.json(data);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not update your review." });
    }

});

app.delete("/api/reviews/:id", requireLogin, async (req, res) => {

    try {

        // Owners can moderate (delete) any review; everyone else can only
        // delete their own.
        const query = supabaseAdmin.from("reviews").delete().eq("id", req.params.id);

        if (req.auth.role !== "owner") {
            query.eq("user_id", req.auth.user.id);
        }

        const { error } = await query;

        if (error) {
            console.error(error);
            return res.status(502).json({ error: "Could not delete this review." });
        }

        res.status(204).send();

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not delete this review." });
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

    if (!partial || body.stock !== undefined) {
        const stock = Number(body.stock);
        if (!Number.isInteger(stock) || stock < 0) {
            errors.push("stock must be a non-negative whole number.");
        } else {
            clean.stock = stock;
        }
    }

    if (body.tags !== undefined) {
        // Accept either a real array or a comma-separated string from a
        // plain text input, and normalize either into a clean array.
        const rawTags = Array.isArray(body.tags) ? body.tags : String(body.tags || "").split(",");
        clean.tags = rawTags
            .map(tag => tag.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 20);
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

    // Grab the current stock BEFORE updating, so we can tell afterward
    // whether this update just brought something back in stock or made
    // it newly low — only relevant if stock is actually being changed.
    let previousStock = null;

    if (clean.stock !== undefined) {
        const { data: existing } = await supabaseAdmin
            .from("products")
            .select("stock")
            .eq("id", req.params.id)
            .single();
        previousStock = existing ? Number(existing.stock) : null;
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

    if (clean.stock !== undefined && previousStock !== null) {
        await notifyWishlistersOfStockChange(data, previousStock, Number(data.stock));
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
   ADMIN — EXTRA PRODUCT PHOTOS (owner only)
   The cover photo lives on products.image_url (managed above). These
   endpoints manage any additional gallery photos for an existing product.
========================================= */

app.get("/api/admin/products/:id/images", requireOwner, async (req, res) => {

    const { data, error } = await supabaseAdmin
        .from("product_images")
        .select("*")
        .eq("product_id", req.params.id)
        .order("sort_order", { ascending: true });

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not load photos." });
    }

    res.json(data);

});

app.post("/api/admin/products/:id/images", requireOwner, async (req, res) => {

    const { image_url } = req.body;

    if (typeof image_url !== "string" || !image_url.trim()) {
        return res.status(400).json({ error: "image_url is required." });
    }

    // New photos go at the end of the current order.
    const { data: existing, error: countError } = await supabaseAdmin
        .from("product_images")
        .select("sort_order")
        .eq("product_id", req.params.id)
        .order("sort_order", { ascending: false })
        .limit(1);

    if (countError) {
        console.error(countError);
        return res.status(502).json({ error: "Could not add this photo." });
    }

    const nextSortOrder = existing.length > 0 ? existing[0].sort_order + 1 : 0;

    const { data, error } = await supabaseAdmin
        .from("product_images")
        .insert({
            product_id: req.params.id,
            image_url: image_url.trim(),
            sort_order: nextSortOrder
        })
        .select()
        .single();

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not add this photo." });
    }

    res.status(201).json(data);

});

app.delete("/api/admin/products/:id/images/:imageId", requireOwner, async (req, res) => {

    const { error } = await supabaseAdmin
        .from("product_images")
        .delete()
        .eq("id", req.params.imageId)
        .eq("product_id", req.params.id);

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not remove this photo." });
    }

    res.status(204).send();

});

/* =========================================
   CREATE ORDER
========================================= */

app.post("/api/orders", async (req, res) => {
    try {
        const { cart, shippingMethodId, saveWallet } = req.body;

        // Fail fast with a clear message if something's already sold out —
        // this is a courtesy check only. The real, race-proof enforcement
        // happens atomically in decrementStockForOrder() at capture time,
        // since stock can still change between this check and payment.
        const stockCheck = await checkStockAvailability(cart);

        if (!stockCheck.ok) {
            const message = stockCheck.issues
                .map(issue => `${issue.name} (only ${issue.available} left)`)
                .join(", ");
            return res.status(409).json({
                error: `Some items in your cart aren't available in the quantity requested: ${message}.`
            });
        }

        const { total, lines, categoryTotals } = await priceCart(cart);
        const { shippingCost } = await resolveShippingCost(categoryTotals, shippingMethodId);

        const grandTotal = Math.round((total + shippingCost) * 100) / 100;

        const accessToken = await getPayPalAccessToken();

        // If the customer is logged in and checked "save my PayPal for
        // next time," ask PayPal to vault this payment source once the
        // order is captured. If they've saved one before, link this save
        // to that same PayPal customer record instead of creating a
        // second, separate one.
        let vaultPaymentSource = {};

        if (saveWallet) {

            const auth = await getAuthContext(req);

            if (auth) {

                const existingCustomerId = await findExistingPaypalCustomerId(auth.user.id);

                vaultPaymentSource = {
                    payment_source: {
                        paypal: {
                            attributes: {
                                ...(existingCustomerId ? { customer: { id: existingCustomerId } } : {}),
                                vault: {
                                    store_in_vault: "ON_SUCCESS",
                                    usage_type: "MERCHANT"
                                }
                            },
                            experience_context: {
                                return_url: "https://cornerbarr.com/",
                                cancel_url: "https://cornerbarr.com/"
                            }
                        }
                    }
                };

            }

        }

        const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                intent: "CAPTURE",
                ...vaultPaymentSource,
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

        // Defense in depth: the checkout form already marks address fields
        // "required" in the browser, so this should only ever catch a
        // tampered or malformed request, not a normal customer.
        const addressErrors = validateShippingAddress(customer);

        if (addressErrors.length > 0) {
            return res.status(400).json({ error: addressErrors.join(" ") });
        }

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

        // THE ACTUAL ENFORCEMENT: atomically decrement stock for every line
        // in this order, all in one database transaction. If anything sold
        // out in the seconds between the earlier soft check and now (e.g.
        // another customer bought the last one), this throws and we refund
        // the payment we just took rather than accept an order we can't
        // fulfill.
        try {
            await decrementStockForOrder(lines);
        } catch (stockErr) {
            console.error("Stock unavailable after successful payment — refunding:", stockErr);

            const captureId = extractCaptureId(capture);

            if (captureId) {
                try {
                    await refundCapture(captureId, accessToken);
                } catch (refundErr) {
                    console.error(
                        "CRITICAL — payment captured, stock unavailable, AND automatic refund failed. " +
                        "This capture must be refunded manually in the PayPal dashboard:", captureId, refundErr
                    );
                }
            } else {
                console.error("CRITICAL — could not find a capture ID to refund for PayPal order:", orderID);
            }

            return res.status(409).json({
                error: "One or more items in your cart just sold out. Your payment has been refunded — please review your cart and try again."
            });
        }

        // If the customer was logged in, tie the order to their account so
        // they can see it in their order history. Guests (not logged in)
        // still get a working order — it just won't show up under anyone's
        // account, since there isn't one.
        const auth = await getAuthContext(req);

        const { data: insertedOrder, error: insertError } = await supabaseAdmin
            .from("orders")
            .insert({
                user_id: auth ? auth.user.id : null,
                customer_name: customer?.name || null,
                customer_email: customer?.email || null,
                customer_phone: customer?.phone || null,
                customer_notes: customer?.notes || null,
                ...buildAddressColumns(customer),
                paypal_order_id: orderID,
                paypal_capture_status: capture.status || null,
                subtotal: total,
                shipping_cost: shippingCost,
                shipping_method_name: shippingMethodName,
                items: lines
            })
            .select()
            .single();

        if (insertError) {
            // Payment already succeeded at this point — don't fail the
            // customer's checkout over a logging problem, just log it
            // loudly so it can be investigated.
            console.error("Could not save order record after successful payment:", insertError);
        } else {
            if (auth) {
                await notifyOrderReceived(auth.user.id, insertedOrder.id);
            }
            // The owner gets notified of every new order, guest or not.
            await notifyOwnerOfNewOrder(insertedOrder);
        }

        // If this order asked PayPal to vault the payment source, record
        // what we can now — PayPal sometimes finishes vaulting a moment
        // after capture, in which case we save a "pending" row and the
        // webhook (or a manual sync) fills in the rest later.
        if (auth) {
            await recordVaultResultIfPresent(auth.user.id, capture);
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

    const { shipping_status, carrier, tracking_number, estimated_delivery_date, expected_ship_date } = req.body;

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

    if (expected_ship_date !== undefined) {
        clean.expected_ship_date = expected_ship_date || null;
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

    if (shipping_status !== undefined) {
        await notifyOrderStatusChange(data);
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

/* =========================================
   NOTIFICATIONS (any logged-in customer, own only)
========================================= */

app.get("/api/notifications", requireLogin, async (req, res) => {

    const { data, error } = await supabaseAdmin
        .from("notifications")
        .select("*")
        .eq("user_id", req.auth.user.id)
        .order("created_at", { ascending: false })
        .limit(50);

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not load notifications." });
    }

    res.json(data);

});

app.put("/api/notifications/:id/read", requireLogin, async (req, res) => {

    const { error } = await supabaseAdmin
        .from("notifications")
        .update({ is_read: true })
        .eq("id", req.params.id)
        .eq("user_id", req.auth.user.id);

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not update this notification." });
    }

    res.status(204).send();

});

app.put("/api/notifications/read-all", requireLogin, async (req, res) => {

    const { error } = await supabaseAdmin
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", req.auth.user.id)
        .eq("is_read", false);

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not update notifications." });
    }

    res.status(204).send();

});

app.delete("/api/notifications/:id", requireLogin, async (req, res) => {

    const { error } = await supabaseAdmin
        .from("notifications")
        .delete()
        .eq("id", req.params.id)
        .eq("user_id", req.auth.user.id);

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not dismiss this notification." });
    }

    res.status(204).send();

});

/* =========================================
   SAVED PAYMENT METHODS (PayPal Vault)
========================================= */

app.get("/api/saved-payment-methods", requireLogin, async (req, res) => {

    const { data, error } = await supabaseAdmin
        .from("saved_payment_methods")
        .select("id, method_type, paypal_email, card_brand, card_last4, card_expiry, status, created_at")
        .eq("user_id", req.auth.user.id)
        .eq("status", "saved")
        .order("created_at", { ascending: false });

    if (error) {
        console.error(error);
        return res.status(502).json({ error: "Could not load saved payment methods." });
    }

    res.json(data);

});

app.delete("/api/saved-payment-methods/:id", requireLogin, async (req, res) => {

    try {

        const { data: method, error: lookupError } = await supabaseAdmin
            .from("saved_payment_methods")
            .select("vault_id")
            .eq("id", req.params.id)
            .eq("user_id", req.auth.user.id)
            .single();

        if (lookupError || !method) {
            return res.status(404).json({ error: "Saved payment method not found." });
        }

        const accessToken = await getPayPalAccessToken();

        if (method.vault_id) {
            await vault.deletePaymentToken({
                paypalApiBase: PAYPAL_API_BASE,
                accessToken,
                vaultId: method.vault_id
            });
        }

        await supabaseAdmin
            .from("saved_payment_methods")
            .delete()
            .eq("id", req.params.id)
            .eq("user_id", req.auth.user.id);

        res.status(204).send();

    } catch (err) {
        console.error(err);
        res.status(502).json({ error: err.message || "Could not remove this payment method." });
    }

});

// Manual fallback for when PayPal finishes vaulting a moment after
// capture (status was APPROVED, not VAULTED) and the webhook either
// hasn't arrived yet or isn't reachable (e.g. testing on localhost,
// where PayPal can't reach a webhook URL at all).
app.post("/api/saved-payment-methods/sync", requireLogin, async (req, res) => {

    try {

        const { data: pending, error } = await supabaseAdmin
            .from("saved_payment_methods")
            .select("id, paypal_customer_id")
            .eq("user_id", req.auth.user.id)
            .eq("status", "pending");

        if (error) {
            throw new Error("Could not check pending payment methods.");
        }

        if (pending.length === 0) {
            return res.json({ updated: 0 });
        }

        const accessToken = await getPayPalAccessToken();
        let updated = 0;

        for (const row of pending) {

            const tokens = await vault.listPaymentTokensForCustomer({
                paypalApiBase: PAYPAL_API_BASE,
                accessToken,
                customerId: row.paypal_customer_id
            });

            const match = tokens[0];

            if (match) {

                const summary = vault.summarizePaymentSource(match.payment_source);

                await supabaseAdmin
                    .from("saved_payment_methods")
                    .update({
                        vault_id: match.id,
                        status: "saved",
                        method_type: summary.methodType,
                        paypal_email: summary.paypalEmail || null
                    })
                    .eq("id", row.id);

                updated += 1;

            }

        }

        res.json({ updated });

    } catch (err) {
        console.error(err);
        res.status(502).json({ error: err.message || "Could not sync saved payment methods." });
    }

});

app.post("/api/paypal/vault/setup-token", requireLogin, async (req, res) => {

    try {

        const existingCustomerId = await findExistingPaypalCustomerId(req.auth.user.id);
        const accessToken = await getPayPalAccessToken();

        const setupToken = await vault.createVaultSetupToken({
            paypalApiBase: PAYPAL_API_BASE,
            accessToken,
            existingCustomerId
        });

        res.json({ id: setupToken.id });

    } catch (err) {
        console.error(err);
        res.status(502).json({ error: err.message || "Could not start saving this payment method." });
    }

});

app.post("/api/paypal/vault/payment-token", requireLogin, async (req, res) => {

    try {

        const { setupTokenId } = req.body;

        if (!setupTokenId) {
            return res.status(400).json({ error: "setupTokenId is required." });
        }

        const accessToken = await getPayPalAccessToken();

        const paymentToken = await vault.exchangeSetupTokenForPaymentToken({
            paypalApiBase: PAYPAL_API_BASE,
            accessToken,
            setupTokenId
        });

        const summary = vault.summarizePaymentSource(paymentToken.payment_source);

        const { error } = await supabaseAdmin
            .from("saved_payment_methods")
            .upsert(
                {
                    user_id: req.auth.user.id,
                    paypal_customer_id: paymentToken.customer.id,
                    vault_id: paymentToken.id,
                    status: "saved",
                    method_type: summary.methodType,
                    paypal_email: summary.paypalEmail || null
                },
                { onConflict: "vault_id" }
            );

        if (error) {
            console.error(error);
            return res.status(502).json({ error: "Payment method was saved with PayPal, but we couldn't record it. Please try again." });
        }

        res.status(201).json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(502).json({ error: err.message || "Could not save this payment method." });
    }

});

// Pay with a saved PayPal wallet — no popup/approval needed since the
// customer already consented when they first saved it.
app.post("/api/orders/pay-with-saved", requireLogin, async (req, res) => {

    try {

        const { cart, customer, shippingMethodId, savedMethodId } = req.body;

        const addressErrors = validateShippingAddress(customer);

        if (addressErrors.length > 0) {
            return res.status(400).json({ error: addressErrors.join(" ") });
        }

        const { data: method, error: lookupError } = await supabaseAdmin
            .from("saved_payment_methods")
            .select("vault_id")
            .eq("id", savedMethodId)
            .eq("user_id", req.auth.user.id)
            .eq("status", "saved")
            .single();

        if (lookupError || !method) {
            return res.status(404).json({ error: "Saved payment method not found." });
        }

        const stockCheck = await checkStockAvailability(cart);

        if (!stockCheck.ok) {
            const message = stockCheck.issues
                .map(issue => `${issue.name} (only ${issue.available} left)`)
                .join(", ");
            return res.status(409).json({
                error: `Some items in your cart aren't available in the quantity requested: ${message}.`
            });
        }

        const { total, lines, categoryTotals } = await priceCart(cart);
        const { shippingCost, shippingMethodName } = await resolveShippingCost(categoryTotals, shippingMethodId);
        const grandTotal = Math.round((total + shippingCost) * 100) / 100;

        const accessToken = await getPayPalAccessToken();

        const createResponse = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                intent: "CAPTURE",
                payment_source: {
                    paypal: { vault_id: method.vault_id }
                },
                purchase_units: [
                    {
                        amount: {
                            currency_code: "USD",
                            value: grandTotal.toFixed(2),
                            breakdown: {
                                item_total: { currency_code: "USD", value: total.toFixed(2) },
                                shipping: { currency_code: "USD", value: shippingCost.toFixed(2) }
                            }
                        },
                        items: lines.map(line => ({
                            name: line.name.substring(0, 127),
                            unit_amount: { currency_code: "USD", value: line.unitPrice.toFixed(2) },
                            quantity: String(line.quantity)
                        })),
                        description: "Corner Barr order",
                        ...(PAYEE_EMAIL ? { payee: { email_address: PAYEE_EMAIL } } : {})
                    }
                ]
            })
        });

        const order = await createResponse.json();

        if (!createResponse.ok) {
            console.error("PayPal create (saved method) error:", order);
            return res.status(502).json({ error: "Could not start checkout with your saved PayPal." });
        }

        if (order.status === "PAYER_ACTION_REQUIRED") {
            // Rare, but possible — PayPal wants the customer to re-approve.
            // Fall back to normal interactive checkout for this order.
            return res.status(409).json({
                error: "Your saved PayPal needs to be re-approved. Please use the regular PayPal button instead.",
                requiresInteractiveCheckout: true
            });
        }

        // Usually a separate capture call is still needed even with a
        // saved payment source, but handle the case where PayPal already
        // completed it during creation, so we don't call capture twice.
        let capture = order;

        if (order.status !== "COMPLETED") {

            const captureResponse = await fetch(
                `${PAYPAL_API_BASE}/v2/checkout/orders/${order.id}/capture`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${accessToken}`
                    }
                }
            );

            capture = await captureResponse.json();

            if (!captureResponse.ok) {
                console.error("PayPal capture (saved method) error:", capture);
                return res.status(502).json({ error: "Could not complete payment with your saved PayPal." });
            }

        }

        try {
            await decrementStockForOrder(lines);
        } catch (stockErr) {
            console.error("Stock unavailable after successful payment (saved method) — refunding:", stockErr);

            const captureId = extractCaptureId(capture);

            if (captureId) {
                try {
                    await refundCapture(captureId, accessToken);
                } catch (refundErr) {
                    console.error(
                        "CRITICAL — payment captured, stock unavailable, AND automatic refund failed. " +
                        "This capture must be refunded manually in the PayPal dashboard:", captureId, refundErr
                    );
                }
            } else {
                console.error("CRITICAL — could not find a capture ID to refund for PayPal order:", order.id);
            }

            return res.status(409).json({
                error: "One or more items in your cart just sold out. Your payment has been refunded — please review your cart and try again."
            });
        }

        const { data: insertedOrder } = await supabaseAdmin
            .from("orders")
            .insert({
                user_id: req.auth.user.id,
                customer_name: customer?.name || null,
                customer_email: customer?.email || null,
                customer_phone: customer?.phone || null,
                customer_notes: customer?.notes || null,
                ...buildAddressColumns(customer),
                paypal_order_id: order.id,
                paypal_capture_status: capture.status || null,
                subtotal: total,
                shipping_cost: shippingCost,
                shipping_method_name: shippingMethodName,
                items: lines
            })
            .select()
            .single();

        if (insertedOrder) {
            await notifyOrderReceived(req.auth.user.id, insertedOrder.id);
        }

        res.json(capture);

    } catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message || "Could not complete this order." });
    }

});

/* =========================================
   PAYPAL WEBHOOK
   Only works once the site has a real public URL PayPal can reach —
   see PAYPAL_WEBHOOK_ID in .env.example for setup notes.
========================================= */

app.post("/api/webhooks/paypal", async (req, res) => {

    // Always 200 quickly so PayPal doesn't retry a webhook we've already
    // safely ignored (e.g. before PAYPAL_WEBHOOK_ID is configured).
    if (!PAYPAL_WEBHOOK_ID) {
        console.warn("Received a PayPal webhook but PAYPAL_WEBHOOK_ID isn't set — ignoring.");
        return res.status(200).send();
    }

    try {

        const accessToken = await getPayPalAccessToken();

        const isValid = await vault.verifyWebhookSignature({
            paypalApiBase: PAYPAL_API_BASE,
            accessToken,
            webhookId: PAYPAL_WEBHOOK_ID,
            headers: req.headers,
            body: req.body
        });

        if (!isValid) {
            console.warn("Rejected a PayPal webhook with an invalid signature.");
            return res.status(400).send();
        }

        if (req.body.event_type === "VAULT.PAYMENT-TOKEN.CREATED") {

            const resource = req.body.resource;
            const customerId = resource?.customer?.id;
            const vaultId = resource?.id;

            if (customerId && vaultId) {

                const summary = vault.summarizePaymentSource(resource.payment_source);

                // Complete whichever pending row matches this customer —
                // created earlier in recordVaultResultIfPresent().
                await supabaseAdmin
                    .from("saved_payment_methods")
                    .update({
                        vault_id: vaultId,
                        status: "saved",
                        method_type: summary.methodType,
                        paypal_email: summary.paypalEmail || null
                    })
                    .eq("paypal_customer_id", customerId)
                    .eq("status", "pending");

            }

        }

        res.status(200).send();

    } catch (err) {
        console.error("Error handling PayPal webhook:", err);
        // Still 200 — a broken webhook handler shouldn't make PayPal hammer
        // us with retries. The /sync endpoint is the fallback either way.
        res.status(200).send();
    }

});

app.listen(PORT, () => {
    console.log(`Corner Barr server running at http://localhost:${PORT}`);
    console.log(`PayPal mode: ${PAYPAL_MODE}`);
});