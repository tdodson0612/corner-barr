const { supabaseAdmin } = require("./supabase");

async function fetchAllActiveProducts() {
    const { data, error } = await supabaseAdmin
        .from("products")
        .select("id, category, name, description, price, image_url, stock, tags, created_at");

    if (error) {
        console.error("Could not load products for recommendations:", error);
        return [];
    }

    return data;
}

// Rough popularity score per product: total quantity ever purchased,
// derived from existing orders. Works automatically for any product,
// including ones added after this code was written.
async function getPopularityScores() {

    const { data, error } = await supabaseAdmin
        .from("orders")
        .select("items");

    const scores = new Map();

    if (error) {
        console.error("Could not load orders for popularity scoring:", error);
        return scores;
    }

    for (const order of data) {
        for (const item of (order.items || [])) {
            if (!item.productId) {
                continue;
            }
            scores.set(item.productId, (scores.get(item.productId) || 0) + (item.quantity || 1));
        }
    }

    return scores;

}

/**
 * "You May Also Like" — same category as the given product, ranked by
 * how many tags they share with it, falling back to newest-first.
 */
async function getSimilarProducts(productId, limit = 4) {

    const allProducts = await fetchAllActiveProducts();
    const target = allProducts.find(p => p.id === productId);

    if (!target) {
        return [];
    }

    const targetTags = new Set(target.tags || []);

    const candidates = allProducts.filter(p => p.id !== productId && p.category === target.category);

    const scored = candidates.map(product => {
        const sharedTags = (product.tags || []).filter(tag => targetTags.has(tag)).length;
        return { product, score: sharedTags };
    });

    scored.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return new Date(b.product.created_at) - new Date(a.product.created_at);
    });

    return scored.slice(0, limit).map(entry => entry.product);

}

/**
 * "Recommended For You" — combines purchase history, wishlist, and
 * recently-viewed signals (all optional) into a category/tag preference
 * score, with a popularity fallback so guests with no history still see
 * something relevant rather than an empty section.
 */
async function getRecommendationsForUser({ userId, viewedIds = [], excludeIds = [], limit = 8 }) {

    const allProducts = await fetchAllActiveProducts();
    const productById = new Map(allProducts.map(p => [p.id, p]));

    const alreadyHave = new Set(excludeIds);
    const categoryWeight = new Map();
    const tagWeight = new Map();

    function addSignal(product, weight) {
        if (!product) {
            return;
        }
        categoryWeight.set(product.category, (categoryWeight.get(product.category) || 0) + weight);
        for (const tag of (product.tags || [])) {
            tagWeight.set(tag, (tagWeight.get(tag) || 0) + weight);
        }
    }

    // Signal 1: recently viewed (works for guests too, via localStorage
    // ids sent up from the browser).
    for (const id of viewedIds) {
        addSignal(productById.get(id), 1);
        alreadyHave.add(id);
    }

    if (userId) {

        // Signal 2: purchase history — strongest signal, and also excluded
        // from results (no point recommending what they already bought).
        const { data: orders } = await supabaseAdmin
            .from("orders")
            .select("items")
            .eq("user_id", userId);

        for (const order of (orders || [])) {
            for (const item of (order.items || [])) {
                if (item.productId) {
                    addSignal(productById.get(item.productId), 3);
                    alreadyHave.add(item.productId);
                }
            }
        }

        // Signal 3: wishlist.
        const { data: wishlist } = await supabaseAdmin
            .from("wishlist_items")
            .select("product_id")
            .eq("user_id", userId);

        for (const row of (wishlist || [])) {
            addSignal(productById.get(row.product_id), 2);
            alreadyHave.add(row.product_id);
        }

    }

    const popularity = await getPopularityScores();

    const candidates = allProducts.filter(p => !alreadyHave.has(p.id));

    const scored = candidates.map(product => {

        let score = categoryWeight.get(product.category) || 0;

        for (const tag of (product.tags || [])) {
            score += tagWeight.get(tag) || 0;
        }

        // Small popularity nudge so ties break toward proven sellers,
        // and so a brand-new guest with zero signals still gets a
        // sensible, non-random list instead of database order.
        score += (popularity.get(product.id) || 0) * 0.1;

        return { product, score };

    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(entry => entry.product);

}

module.exports = { getSimilarProducts, getRecommendationsForUser };