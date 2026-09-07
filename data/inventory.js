const { supabaseAdmin } = require("./supabase");

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

    for (const item of cart) {
        const quantity = Number(item.quantity) || 0;
        requestedByProduct.set(
            item.productId,
            (requestedByProduct.get(item.productId) || 0) + quantity
        );
    }

    const productIds = [...requestedByProduct.keys()];

    if (productIds.length === 0) {
        return { ok: true, issues: [] };
    }

    const { data, error } = await supabaseAdmin
        .from("products")
        .select("id, name, stock")
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
            issues.push({
                productId: product.id,
                name: product.name,
                requested,
                available
            });
        }

    }

    return { ok: issues.length === 0, issues };

}

/**
 * Atomically decrements stock for every line item in an order, all in a
 * single database transaction (via the decrement_products_stock Postgres
 * function defined in inventory-migration.sql). Either every line
 * succeeds or none do — this is what actually prevents overselling the
 * last unit when two customers check out at nearly the same moment.
 *
 * Throws if any item doesn't have enough stock left. The caller is
 * responsible for refunding the payment if this throws AFTER a
 * successful PayPal capture — see refundCapture() in server.js.
 */
async function decrementStockForOrder(lines) {

    // Combine quantities for the same product (e.g. two cart lines that
    // happen to reference the same product) before sending to Postgres.
    const combined = new Map();

    for (const line of lines) {
        combined.set(
            line.productId,
            (combined.get(line.productId) || 0) + line.quantity
        );
    }

    const items = [...combined.entries()].map(([product_id, quantity]) => ({
        product_id,
        quantity
    }));

    const { error } = await supabaseAdmin.rpc("decrement_products_stock", { items });

    if (error) {
        console.error("Stock decrement failed:", error);
        throw new Error("One or more items in this order sold out while checking out.");
    }

}

module.exports = { checkStockAvailability, decrementStockForOrder };