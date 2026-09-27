// data/categories.js
//
// Shop categories, stored in the "categories" table so the owner can
// add, rename, reorder, and delete them from Manage Shop > Categories.
//
//   GET    /api/categories                 -> public list, in shop order
//   POST   /api/admin/categories           -> add one (owner only)
//   PUT    /api/admin/categories/:key      -> rename / change description
//   POST   /api/admin/categories/reorder   -> save a new order
//   DELETE /api/admin/categories/:key      -> delete (only if it's empty)
//
// A category's "key" never changes once created, so products, orders,
// and shipping settings that point to it never break. New keys start
// with "cat_" so they can never collide with older internal names.

const CACHE_MS = 30 * 1000;

// Cutting boards have special engraving features built around this key,
// so this one category can be renamed but not deleted.
const PROTECTED_KEYS = ["cutting_board"];

let cachedList = null;
let cachedAt = 0;
let labelByKey = new Map();

function slugify(value, separator) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, separator)
        .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "")
        .substring(0, 40);
}

function cleanName(value) {
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ").substring(0, 60) : "";
}

function cleanDescription(value) {
    return typeof value === "string" ? value.trim().substring(0, 300) : "";
}

function createCategoryHelpers(supabaseAdmin) {

    async function getCategories(force = false) {

        if (!force && cachedList && Date.now() - cachedAt < CACHE_MS) {
            return cachedList;
        }

        const { data, error } = await supabaseAdmin
            .from("categories")
            .select("key, name, description, anchor, sort_order")
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true });

        if (error) {
            console.error("Could not load categories:", error);
            // Keep serving the last good list rather than breaking the shop.
            return cachedList || [];
        }

        cachedList = data;
        cachedAt = Date.now();
        labelByKey = new Map(data.map(c => [c.key, c.name]));

        return cachedList;

    }

    function invalidateCategories() {
        cachedList = null;
        cachedAt = 0;
    }

    // Display name for a category key. Call getCategories() first in the
    // same request so this is up to date.
    function categoryLabel(key) {
        return labelByKey.get(key) || key;
    }

    async function categoryExists(key) {
        const list = await getCategories();
        return list.some(c => c.key === key);
    }

    return { getCategories, invalidateCategories, categoryLabel, categoryExists };

}

function registerCategoryRoutes(app, { requireOwner, supabaseAdmin, helpers }) {

    const { getCategories, invalidateCategories } = helpers;

    app.get("/api/categories", async (req, res) => {

        const list = await getCategories();

        // Which categories have at least one listing (customers only see
        // those; the owner sees all of them in Manage Shop).
        const { data: rows, error } = await supabaseAdmin
            .from("products")
            .select("category");

        if (error) {
            console.error("Could not check which categories have listings:", error);
        }

        const counts = new Map();
        for (const row of (rows || [])) {
            counts.set(row.category, (counts.get(row.category) || 0) + 1);
        }

        res.json(list.map(c => ({
            key: c.key,
            name: c.name,
            description: c.description,
            anchor: c.anchor,
            productCount: counts.get(c.key) || 0
        })));

    });

    app.post("/api/admin/categories", requireOwner, async (req, res) => {

        try {

            const name = cleanName(req.body?.name);
            const description = cleanDescription(req.body?.description);

            if (!name) {
                return res.status(400).json({ error: "Please give the category a name." });
            }

            const existing = await getCategories(true);

            if (existing.some(c => c.name.toLowerCase() === name.toLowerCase())) {
                return res.status(409).json({ error: "There's already a category with that name." });
            }

            const baseSlug = slugify(name, "_") || "category";
            const baseAnchor = slugify(name, "-") || "category";

            let key = `cat_${baseSlug}`;
            let anchor = baseAnchor;
            let n = 2;

            const reservedAnchors = ["shop", "about"];

            while (existing.some(c => c.key === key)) {
                key = `cat_${baseSlug}_${n}`;
                n += 1;
            }

            n = 2;
            while (existing.some(c => c.anchor === anchor) || reservedAnchors.includes(anchor)) {
                anchor = `${baseAnchor}-${n}`;
                n += 1;
            }

            const nextSort = existing.reduce((max, c) => Math.max(max, Number(c.sort_order) || 0), 0) + 1;

            const { data, error } = await supabaseAdmin
                .from("categories")
                .insert({ key, name, description, anchor, sort_order: nextSort })
                .select("key, name, description, anchor, sort_order")
                .single();

            if (error) {
                console.error("Could not add category:", error);
                return res.status(502).json({ error: "Could not add this category." });
            }

            // Its own free-shipping setting (starts as "no free shipping").
            const { error: shippingError } = await supabaseAdmin
                .from("category_shipping_settings")
                .insert({ category: key, free_shipping_threshold: null });

            if (shippingError) {
                console.error("Category added, but its shipping setting wasn't created:", key, shippingError);
            }

            invalidateCategories();
            res.status(201).json(data);

        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Could not add this category." });
        }

    });

    app.put("/api/admin/categories/:key", requireOwner, async (req, res) => {

        try {

            const clean = {};

            if (req.body?.name !== undefined) {
                const name = cleanName(req.body.name);
                if (!name) {
                    return res.status(400).json({ error: "The category needs a name." });
                }
                const existing = await getCategories(true);
                if (existing.some(c => c.key !== req.params.key && c.name.toLowerCase() === name.toLowerCase())) {
                    return res.status(409).json({ error: "There's already a category with that name." });
                }
                clean.name = name;
            }

            if (req.body?.description !== undefined) {
                clean.description = cleanDescription(req.body.description);
            }

            if (Object.keys(clean).length === 0) {
                return res.status(400).json({ error: "Nothing to update." });
            }

            const { data, error } = await supabaseAdmin
                .from("categories")
                .update(clean)
                .eq("key", req.params.key)
                .select("key, name, description, anchor, sort_order")
                .maybeSingle();

            if (error) {
                console.error("Could not update category:", error);
                return res.status(502).json({ error: "Could not update this category." });
            }

            if (!data) {
                return res.status(404).json({ error: "Category not found." });
            }

            invalidateCategories();
            res.json(data);

        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Could not update this category." });
        }

    });

    app.post("/api/admin/categories/reorder", requireOwner, async (req, res) => {

        try {

            const keys = Array.isArray(req.body?.keys) ? req.body.keys.map(String) : null;
            const existing = await getCategories(true);

            const valid = keys
                && keys.length === existing.length
                && new Set(keys).size === keys.length
                && keys.every(key => existing.some(c => c.key === key));

            if (!valid) {
                return res.status(400).json({ error: "Could not save that order. Please refresh and try again." });
            }

            for (let i = 0; i < keys.length; i += 1) {
                const { error } = await supabaseAdmin
                    .from("categories")
                    .update({ sort_order: i + 1 })
                    .eq("key", keys[i]);

                if (error) {
                    console.error("Could not reorder categories:", error);
                    invalidateCategories();
                    return res.status(502).json({ error: "Could not save the new order." });
                }
            }

            invalidateCategories();
            res.json({ ok: true });

        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Could not save the new order." });
        }

    });

    app.delete("/api/admin/categories/:key", requireOwner, async (req, res) => {

        try {

            const key = req.params.key;

            if (PROTECTED_KEYS.includes(key)) {
                return res.status(400).json({ error: "Cutting Boards has special engraving features, so it can be renamed but not deleted." });
            }

            const { count, error: countError } = await supabaseAdmin
                .from("products")
                .select("id", { count: "exact", head: true })
                .eq("category", key);

            if (countError) {
                console.error("Could not count products in category:", countError);
                return res.status(502).json({ error: "Could not check this category's listings." });
            }

            if (count > 0) {
                return res.status(409).json({
                    error: `This category still has ${count} listing${count === 1 ? "" : "s"}. Move ${count === 1 ? "it" : "them"} to another category (or delete ${count === 1 ? "it" : "them"}) first.`
                });
            }

            const { data, error } = await supabaseAdmin
                .from("categories")
                .delete()
                .eq("key", key)
                .select("key");

            if (error) {
                console.error("Could not delete category:", error);
                return res.status(502).json({ error: "Could not delete this category." });
            }

            if (!data || data.length === 0) {
                return res.status(404).json({ error: "Category not found." });
            }

            invalidateCategories();
            res.status(204).send();

        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Could not delete this category." });
        }

    });

}

module.exports = { createCategoryHelpers, registerCategoryRoutes };
