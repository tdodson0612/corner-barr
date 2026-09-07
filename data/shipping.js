const { supabaseAdmin } = require("./supabase");

/**
 * Free shipping rule: since Ashley sets a different free-shipping
 * threshold per shop section, an order only ships free if EVERY
 * category represented in the cart has individually cleared its own
 * threshold. A category with no threshold set (null) never qualifies
 * on its own — Ashley has to opt a section in by setting a number.
 *
 * Example: threshold is $75 for cutting boards and $30 for soap/candles.
 * A cart with $80 of boards and $20 of soap does NOT ship free, because
 * the soap subtotal hasn't cleared its own $30 threshold — even though
 * the order total is $100. This matches "it's different for every shop
 * section" rather than one blended order total.
 */
async function qualifiesForFreeShipping(categoryTotals) {

    const categories = Object.keys(categoryTotals);

    if (categories.length === 0) {
        return false;
    }

    const { data: settings, error } = await supabaseAdmin
        .from("category_shipping_settings")
        .select("category, free_shipping_threshold")
        .in("category", categories);

    if (error) {
        console.error("Could not load shipping thresholds:", error);
        return false;
    }

    const thresholdByCategory = new Map(
        settings.map(row => [row.category, row.free_shipping_threshold])
    );

    return categories.every(category => {
        const threshold = thresholdByCategory.get(category);
        return threshold !== null && threshold !== undefined && categoryTotals[category] >= Number(threshold);
    });

}

/**
 * Resolves the final shipping cost for an order: $0 if the cart
 * qualifies for free shipping, otherwise the price of the chosen
 * shipping method — verified against the live, active method list so
 * a tampered price/id from the client can't be used.
 */
async function resolveShippingCost(categoryTotals, shippingMethodId) {

    const isFree = await qualifiesForFreeShipping(categoryTotals);

    if (isFree) {
        return { shippingCost: 0, shippingMethodName: "Free Shipping", isFree: true };
    }

    if (!shippingMethodId) {
        throw new Error("Please choose a shipping method.");
    }

    const { data: method, error } = await supabaseAdmin
        .from("shipping_methods")
        .select("id, name, price, active")
        .eq("id", shippingMethodId)
        .single();

    if (error || !method || !method.active) {
        throw new Error("That shipping method isn't available.");
    }

    return {
        shippingCost: Number(method.price),
        shippingMethodName: method.name,
        isFree: false
    };

}

module.exports = { qualifiesForFreeShipping, resolveShippingCost };