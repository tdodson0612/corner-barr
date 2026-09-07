const { engravingStyles } = require("./products.json");
const { supabaseAdmin } = require("./supabase");

// Maps the category a cart item is tagged with (from the browser) to the
// category value stored in the database.
const CART_CATEGORY_TO_DB_CATEGORY = {
    custom: "cutting_board",
    board: "cutting_board",
    soap: "soap_candle",
    holiday: "holiday",
    resin: "resin_craft",
    jewelry: "jewelry"
};

function findOption(list, id) {
    return list.find(o => o.id === id);
}

/**
 * Recomputes the authoritative unit price for a single cart line item
 * using the live product row fetched from Supabase. Never trusts a
 * price sent by the client.
 */
function priceForItem(item, dbProduct) {

    if (!dbProduct) {
        throw new Error(`Unknown product: ${item.productId}`);
    }

    const expectedCategory = CART_CATEGORY_TO_DB_CATEGORY[item.category];

    if (!expectedCategory || dbProduct.category !== expectedCategory) {
        throw new Error(`Product/category mismatch for: ${item.productId}`);
    }

    let price = Number(dbProduct.price);

    if (item.category === "custom") {

        const style = findOption(engravingStyles, item.engravingStyleId);

        if (!style) {
            throw new Error(`Unknown engraving style: ${item.engravingStyleId}`);
        }

        price += style.extra;

    }

    return price;

}

/**
 * Validates a cart (array of line items from the client) against live
 * Supabase product data and returns the server-verified total plus a
 * normalized line-item breakdown. Throws if anything in the cart doesn't
 * match a real, current product/option.
 */
async function priceCart(cart) {

    if (!Array.isArray(cart) || cart.length === 0) {
        throw new Error("Cart is empty.");
    }

    const productIds = [...new Set(cart.map(item => item.productId))];

    const { data: dbProducts, error } = await supabaseAdmin
        .from("products")
        .select("id, category, name, price")
        .in("id", productIds);

    if (error) {
        console.error("Supabase price lookup failed:", error);
        throw new Error("Could not verify product prices.");
    }

    const productById = new Map(dbProducts.map(p => [p.id, p]));

    let total = 0;
    const lines = [];
    const categoryTotals = {}; // db category -> subtotal, used for free-shipping checks

    for (const item of cart) {

        const quantity = Number(item.quantity);

        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
            throw new Error("Invalid quantity in cart.");
        }

        const dbProduct = productById.get(item.productId);
        const unitPrice = priceForItem(item, dbProduct);
        const lineTotal = unitPrice * quantity;

        total += lineTotal;

        const dbCategory = CART_CATEGORY_TO_DB_CATEGORY[item.category];
        categoryTotals[dbCategory] = (categoryTotals[dbCategory] || 0) + lineTotal;

        lines.push({
            productId: item.productId,
            name: item.name || dbProduct.name,
            quantity,
            unitPrice,
            lineTotal
        });

    }

    return {
        total: Math.round(total * 100) / 100,
        lines,
        categoryTotals
    };

}

module.exports = { priceCart, priceForItem };