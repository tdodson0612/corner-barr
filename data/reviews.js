const { supabaseAdmin } = require("./supabase");

/**
 * Checks whether a customer has an order containing this product. Relies
 * on orders.items carrying a productId on each line — which is only true
 * for orders placed after the pricing.js update that added it. Orders
 * placed before that will not be recognized as a "verified purchase"
 * even if the customer really did buy the item.
 */
async function hasUserPurchasedProduct(userId, productId) {

    const { data, error } = await supabaseAdmin
        .from("orders")
        .select("items")
        .eq("user_id", userId);

    if (error) {
        console.error("Could not check purchase history:", error);
        return false;
    }

    return data.some(order =>
        Array.isArray(order.items) && order.items.some(item => item.productId === productId)
    );

}

// Used to pre-fill a display name on a new review, so customers don't
// have to type their name every time. Falls back gracefully if they've
// never placed a named order.
async function getMostRecentCustomerName(userId) {

    const { data } = await supabaseAdmin
        .from("orders")
        .select("customer_name")
        .eq("user_id", userId)
        .not("customer_name", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    return data?.customer_name || "Customer";

}

/**
 * Returns { average, count, distribution } for a product's reviews.
 * distribution is keyed 1–5 with a count of reviews at each star level,
 * used for the rating-breakdown bars on the product page.
 */
async function getProductReviewSummary(productId) {

    const { data, error } = await supabaseAdmin
        .from("reviews")
        .select("rating")
        .eq("product_id", productId);

    if (error) {
        console.error("Could not load review summary:", error);
        return { average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    }

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;

    data.forEach(row => {
        distribution[row.rating] = (distribution[row.rating] || 0) + 1;
        total += row.rating;
    });

    const count = data.length;
    const average = count > 0 ? Math.round((total / count) * 10) / 10 : 0;

    return { average, count, distribution };

}

module.exports = { hasUserPurchasedProduct, getMostRecentCustomerName, getProductReviewSummary };