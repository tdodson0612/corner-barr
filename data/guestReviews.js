// data/guestReviews.js
//
// Reviews from people who bought in person (at the shop or a market),
// plus the owner's review moderation tools.
//
//   POST /api/review-photos                    -> upload a review photo (anyone)
//   POST /api/products/:id/in-store-reviews    -> submit an in-store review (anyone)
//   GET  /api/admin/reviews                    -> every review, incl. pending (owner)
//   PUT  /api/admin/reviews/:id/approve        -> publish a pending review (owner)
//   (Removing a review uses the existing DELETE /api/reviews/:id, owner allowed.)
//
// In-store reviews can't be tied to an order, so they're saved as
// "pending" and only appear on the site after the owner approves them.
// The reviewer's email is private: it's never sent to the public pages.

const crypto = require("crypto");

const PHOTO_BUCKET = "review-photos";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUEST_PHOTO_PATTERN = /^guest\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic)$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Simple per-visitor limits so one person (or a bot) can't flood the form.
const attempts = new Map();
const HOUR = 60 * 60 * 1000;

function visitorKey(req) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    return forwarded || req.ip || "unknown";
}

function isLimited(kind, req, limit, windowMs) {
    const now = Date.now();
    const recent = (attempts.get(`${kind}:${visitorKey(req)}`) || []).filter(t => now - t < windowMs);
    return recent.length >= limit;
}

function recordAttempt(kind, req, windowMs) {

    const key = `${kind}:${visitorKey(req)}`;
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter(t => now - t < windowMs);

    recent.push(now);
    attempts.set(key, recent);

    // Keep the memory small.
    if (attempts.size > 5000) {
        for (const [k, times] of attempts) {
            if (times.every(t => now - t >= windowMs)) {
                attempts.delete(k);
            }
        }
    }

}

function detectImageType(buffer) {

    if (!buffer || buffer.length < 12) {
        return null;
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { ext: "jpg", contentType: "image/jpeg" };
    }
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return { ext: "png", contentType: "image/png" };
    }
    if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
        return { ext: "webp", contentType: "image/webp" };
    }
    if (buffer.toString("ascii", 4, 8) === "ftyp") {
        const brand = buffer.toString("ascii", 8, 12);
        if (["heic", "heix", "hevc", "mif1", "msf1", "heim", "heis"].includes(brand)) {
            return { ext: "heic", contentType: "image/heic" };
        }
    }
    return null;

}

function clean(value, maxLength) {
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ").substring(0, maxLength) : "";
}

function cleanMultiline(value, maxLength) {
    return typeof value === "string" ? value.trim().substring(0, maxLength) : "";
}

async function findOwnerId(supabaseAdmin) {
    const { data } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("role", "owner")
        .limit(1)
        .maybeSingle();
    return data ? data.id : null;
}

module.exports = function registerGuestReviewRoutes(app, { express, requireOwner, supabaseAdmin, createNotification }) {

    // 1) Photo upload for in-store reviews (no login needed).
    app.post(
        "/api/review-photos",
        express.raw({ type: () => true, limit: MAX_PHOTO_BYTES }),
        async (req, res) => {

            try {

                if (isLimited("photo", req, 10, HOUR)) {
                    return res.status(429).json({ error: "Too many uploads. Please try again later." });
                }

                recordAttempt("photo", req, HOUR);

                const buffer = Buffer.isBuffer(req.body) ? req.body : null;
                const type = detectImageType(buffer);

                if (!type) {
                    return res.status(400).json({ error: "Please upload a JPG, PNG, WEBP, or HEIC photo." });
                }

                const path = `guest/${crypto.randomUUID()}.${type.ext}`;

                const { error } = await supabaseAdmin.storage
                    .from(PHOTO_BUCKET)
                    .upload(path, buffer, { contentType: type.contentType, upsert: false });

                if (error) {
                    console.error("Could not save review photo:", error);
                    return res.status(502).json({ error: "Could not upload your photo. Please try again." });
                }

                res.status(201).json({ path });

            } catch (err) {
                console.error("Review photo upload failed:", err);
                res.status(500).json({ error: "Could not upload your photo. Please try again." });
            }

        }
    );

    app.use("/api/review-photos", (err, req, res, next) => {
        if (err && err.type === "entity.too.large") {
            return res.status(413).json({ error: "That photo is too large. Please use one under 10 MB." });
        }
        next(err);
    });

    // 2) Submit an in-store review. Saved as pending until approved.
    app.post("/api/products/:id/in-store-reviews", async (req, res) => {

        try {

            const body = req.body || {};

            // Hidden "website" field: people never see it, spam bots fill it
            // in. Pretend it worked so the bot doesn't retry.
            if (typeof body.website === "string" && body.website.trim() !== "") {
                return res.status(201).json({ ok: true });
            }

            // Only successful reviews count toward the limit, so typos
            // never lock anyone out.
            if (isLimited("review", req, 5, HOUR)) {
                return res.status(429).json({ error: "You've sent several reviews recently. Please try again later." });
            }

            const productId = String(req.params.id || "");

            if (!UUID_PATTERN.test(productId)) {
                return res.status(404).json({ error: "Product not found." });
            }

            const name = clean(body.name, 80);
            const email = clean(body.email, 200);
            const purchaseNote = clean(body.purchase_note, 150);
            const reviewText = cleanMultiline(body.review_text, 2000);
            const rating = Number(body.rating);
            const isAnonymous = body.is_anonymous === true;
            const photoPath = typeof body.photo_path === "string" ? body.photo_path : "";

            if (!name) {
                return res.status(400).json({ error: "Please enter your name." });
            }
            if (!EMAIL_PATTERN.test(email)) {
                return res.status(400).json({ error: "Please enter a valid email address." });
            }
            if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
                return res.status(400).json({ error: "Please choose a star rating." });
            }
            if (reviewText.length < 3) {
                return res.status(400).json({ error: "Please write a few words about the item." });
            }
            if (photoPath && !GUEST_PHOTO_PATTERN.test(photoPath)) {
                return res.status(400).json({ error: "That photo didn't upload correctly. Please add it again." });
            }

            const { data: product, error: productError } = await supabaseAdmin
                .from("products")
                .select("id, name")
                .eq("id", productId)
                .maybeSingle();

            if (productError || !product) {
                return res.status(404).json({ error: "Product not found." });
            }

            let photoUrl = null;
            if (photoPath) {
                const { data } = supabaseAdmin.storage.from(PHOTO_BUCKET).getPublicUrl(photoPath);
                photoUrl = data?.publicUrl || null;
            }

            const { error } = await supabaseAdmin
                .from("reviews")
                .insert({
                    product_id: productId,
                    user_id: null,
                    reviewer_name: name,
                    rating,
                    review_text: reviewText,
                    photo_url: photoUrl,
                    source: "in_store",
                    status: "pending",
                    guest_email: email,
                    is_anonymous: isAnonymous,
                    purchase_note: purchaseNote || null
                });

            if (error) {
                console.error("Could not save in-store review:", error);
                return res.status(502).json({ error: "Could not send your review. Please try again." });
            }

            recordAttempt("review", req, HOUR);

            // Let the owner know there's one to approve. Never blocks the reply.
            findOwnerId(supabaseAdmin)
                .then(ownerId => ownerId && createNotification({
                    userId: ownerId,
                    type: "review_pending",
                    title: "New in-store review to approve",
                    body: `${rating}★ review of ${product.name}. Approve it in Manage Shop > Reviews.`,
                    relatedProductId: productId
                }))
                .catch(err => console.error("Could not notify owner of review:", err));

            res.status(201).json({ ok: true });

        } catch (err) {
            console.error("In-store review failed:", err);
            res.status(500).json({ error: "Could not send your review. Please try again." });
        }

    });

    // 3) Owner: every review, newest first, pending ones included.
    app.get("/api/admin/reviews", requireOwner, async (req, res) => {

        const { data, error } = await supabaseAdmin
            .from("reviews")
            .select("id, product_id, reviewer_name, rating, review_text, photo_url, created_at, source, status, guest_email, is_anonymous, purchase_note, products(name)")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Could not load reviews for owner:", error);
            return res.status(502).json({ error: "Could not load reviews." });
        }

        res.json(data);

    });

    // 4) Owner: publish a pending review.
    app.put("/api/admin/reviews/:id/approve", requireOwner, async (req, res) => {

        if (!UUID_PATTERN.test(String(req.params.id || ""))) {
            return res.status(404).json({ error: "Review not found." });
        }

        const { data, error } = await supabaseAdmin
            .from("reviews")
            .update({ status: "approved" })
            .eq("id", req.params.id)
            .select("id")
            .maybeSingle();

        if (error) {
            console.error("Could not approve review:", error);
            return res.status(502).json({ error: "Could not approve this review." });
        }

        if (!data) {
            return res.status(404).json({ error: "Review not found." });
        }

        res.json({ ok: true });

    });

};
