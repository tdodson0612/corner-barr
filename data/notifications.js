const { supabaseAdmin } = require("./supabase");

async function createNotification({ userId, type, title, body = null, relatedOrderId = null, relatedProductId = null }) {

    const { error } = await supabaseAdmin
        .from("notifications")
        .insert({
            user_id: userId,
            type,
            title,
            body,
            related_order_id: relatedOrderId,
            related_product_id: relatedProductId
        });

    if (error) {
        // Notifications are a nice-to-have, never worth failing the
        // request that triggered them (an order, a stock update, etc.).
        console.error(`Could not create notification (${type}) for user ${userId}:`, error);
    }

}

const ORDER_STATUS_MESSAGES = {
    processing: {
        title: "Your order is being prepared",
        body: "We've got your order and we're getting it ready."
    },
    shipped: {
        title: "Your order has shipped",
        body: "It's on its way! Check your order for tracking details."
    },
    delivered: {
        title: "Your order has been delivered",
        body: "Your order has arrived. We hope you love it!"
    }
};

async function notifyOrderStatusChange(order) {

    if (!order.user_id) {
        // Guest checkout — no account to notify.
        return;
    }

    const message = ORDER_STATUS_MESSAGES[order.shipping_status];

    if (!message) {
        return;
    }

    await createNotification({
        userId: order.user_id,
        type: `order_${order.shipping_status}`,
        title: message.title,
        body: message.body,
        relatedOrderId: order.id
    });

}

async function notifyOrderReceived(userId, orderId) {

    if (!userId) {
        return;
    }

    await createNotification({
        userId,
        type: "order_received",
        title: "Your order has been received",
        body: "Thanks for your order! We'll let you know as it's prepared and shipped.",
        relatedOrderId: orderId
    });

}

/**
 * Notifies the shop owner whenever ANY new order comes in — regardless of
 * whether the customer was logged in. This is separate from
 * notifyOrderReceived(), which notifies the customer.
 */
async function notifyOwnerOfNewOrder(order) {

    const { data: owner, error } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("role", "owner")
        .limit(1)
        .maybeSingle();

    if (error || !owner) {
        console.error("Could not find an owner to notify about a new order:", error);
        return;
    }

    const itemCount = Array.isArray(order.items)
        ? order.items.reduce((sum, item) => sum + (item.quantity || 1), 0)
        : 0;

    const customerLabel = order.customer_name || order.customer_email || "A customer";

    await createNotification({
        userId: owner.id,
        type: "new_order",
        title: `New order from ${customerLabel}`,
        body: `${itemCount} item${itemCount === 1 ? "" : "s"} — $${Number(order.subtotal).toFixed(2)}`,
        relatedOrderId: order.id
    });

}

// Avoids re-notifying the same person about the same product/type more
// than once a day — e.g. if the admin nudges stock up and down a few
// times while restocking, wishlisters don't get spammed.
async function alreadyNotifiedRecently(userId, productId, type) {

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabaseAdmin
        .from("notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("related_product_id", productId)
        .eq("type", type)
        .gte("created_at", oneDayAgo)
        .limit(1)
        .maybeSingle();

    return Boolean(data);

}

/**
 * Called whenever the admin updates a product's stock. Notifies anyone
 * who has the product on their wishlist if it just came back in stock,
 * or if it just became low ("running low") — skipped entirely if stock
 * didn't cross one of those thresholds.
 */
async function notifyWishlistersOfStockChange(product, previousStock, newStock) {

    const justBackInStock = previousStock <= 0 && newStock > 0;
    const justRunningLow = previousStock > 5 && newStock > 0 && newStock <= 5;

    if (!justBackInStock && !justRunningLow) {
        return;
    }

    const { data: wishlisters, error } = await supabaseAdmin
        .from("wishlist_items")
        .select("user_id")
        .eq("product_id", product.id);

    if (error) {
        console.error("Could not look up wishlisters for stock notification:", error);
        return;
    }

    const type = justBackInStock ? "back_in_stock" : "running_low";
    const title = justBackInStock
        ? `${product.name} is back in stock!`
        : `${product.name} is running low`;
    const body = justBackInStock
        ? "An item you favorited is available again."
        : `Only ${newStock} left of an item you favorited.`;

    for (const row of wishlisters) {

        const alreadyNotified = await alreadyNotifiedRecently(row.user_id, product.id, type);

        if (!alreadyNotified) {
            await createNotification({
                userId: row.user_id,
                type,
                title,
                body,
                relatedProductId: product.id
            });
        }

    }

}

module.exports = {
    createNotification,
    notifyOrderStatusChange,
    notifyOrderReceived,
    notifyOwnerOfNewOrder,
    notifyWishlistersOfStockChange
};