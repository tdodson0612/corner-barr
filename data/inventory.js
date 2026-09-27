const { supabaseAdmin } = require("./supabase");

// A product's options (like Size), if it has any. One option type per
// product; each option has its own price and its own stock count.
function getProductOptions(product) {
    const first = Array.isArray(product?.variations) ? product.variations[0] : null;
    return first && Array.isArray(first.options) && first.options.length > 0 ? first : null;
}

function itemKey(productId, variationValue) {
    return `${productId}::${variationValue || ""}`;
}

/**
 * Best-effort, NON-atomic pre-check of whether a cart's requested
 * quantities are covered by current stock. Used right when the customer
 * starts checkout, purely so they see a clear error before ever reaching
 * PayPal. This is NOT the real enforcement — another customer could
 * still buy in between this check and payment. The actual, race-proof
 * enforcement is decrementStockForOrder() below, at capture time.
 */
async function checkStockAvailability(cart) {

    const requestedByProduct = new Map();
    const requestedByOption = new Map();

    for (const item of cart) {
        const quantity = Number(item.quantity) || 0;
        requestedByProduct.set(item.productId, (requestedByProduct.get(item.productId) || 0) + quantity);
        if (item.variationValue) {
            const key = itemKey(item.productId, item.variationValue);
            requestedByOption.set(key, (requestedByOption.get(key) || 0) + quantity);
        }
    }

    const productIds = [...requestedByProduct.keys()];

    if (productIds.length === 0) {
        return { ok: true, issues: [] };
    }

    const { data, error } = await supabaseAdmin
        .from("products")
        .select("id, name, stock, variations")
        .in("id", productIds);

    if (error) {
        console.error("Could not check stock availability:", error);
        throw new Error("Could not verify item availability.");
    }

    const issues = [];

    for (const product of data) {

        const requested = requestedByProduct.get(product.id) || 0;
        const available = Number(product.stock);

        if (requested > available) {
            issues.push({ productId: product.id, name: product.name, requested, available });
            continue;
        }

        const options = getProductOptions(product);

        if (options) {
            for (const option of options.options) {
                const wanted = requestedByOption.get(itemKey(product.id, option.value)) || 0;
                const optionStock = Number(option.stock) || 0;
                if (wanted > optionStock) {
                    issues.push({
                        productId: product.id,
                        name: `${product.name} (${option.value})`,
                        requested: wanted,
                        available: optionStock
                    });
                }
            }
        }

    }

    return { ok: issues.length === 0, issues };

}

/**
 * Atomically decrements stock for every line item in an order, all in a
 * single database transaction (via the decrement_stock_for_order Postgres
 * function). Either every line succeeds or none do — this is what
 * prevents overselling the last unit when two customers check out at
 * nearly the same moment. Lines with a chosen option (like Size: Large)
 * also decrement that option's own stock.
 *
 * Throws if any item doesn't have enough stock left. The caller is
 * responsible for refunding the payment if this throws AFTER a
 * successful PayPal capture — see refundCapture() in server.js.
 */
async function decrementStockForOrder(lines) {

    const combined = new Map();

    for (const line of lines) {
        const key = itemKey(line.productId, line.variationValue);
        const existing = combined.get(key);
        if (existing) {
            existing.quantity += line.quantity;
        } else {
            combined.set(key, {
                product_id: line.productId,
                quantity: line.quantity,
                variation_value: line.variationValue || null
            });
        }
    }

    const items = [...combined.values()];

    const { error } = await supabaseAdmin.rpc("decrement_stock_for_order", { items });

    if (error) {
        console.error("Stock decrement failed:", error);
        throw new Error("One or more items in this order sold out while checking out.");
    }

}

module.exports = { checkStockAvailability, decrementStockForOrder, getProductOptions };
