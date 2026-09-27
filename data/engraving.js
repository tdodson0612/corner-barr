// data/engraving.js
//
// Photos customers upload to have engraved on their item (a cutting
// board, or any product Ashley allows photo engraving on).
//
//   POST /api/engraving-photos                 -> upload one photo (anyone,
//                                                 including guests at checkout)
//   GET  /api/admin/engraving-photos/url?path= -> owner only: a temporary
//                                                 link to view/save the photo
//
// Photos go in the PRIVATE "engraving-photos" storage bucket. Nobody can
// see them except through the owner-only route, because they may be
// pictures of people's family members.

const crypto = require("crypto");
const { ENGRAVING_PHOTO_PATH_PATTERN } = require("./pricing");

const BUCKET = "engraving-photos";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Only real image files, checked by their first bytes, not just by name.
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

module.exports = function registerEngravingRoutes(app, { express, requireOwner, supabaseAdmin }) {

    app.post(
        "/api/engraving-photos",
        express.raw({ type: () => true, limit: MAX_BYTES }),
        async (req, res) => {

            try {

                const buffer = Buffer.isBuffer(req.body) ? req.body : null;

                if (!buffer || buffer.length === 0) {
                    return res.status(400).json({ error: "Please choose a photo." });
                }

                const type = detectImageType(buffer);

                if (!type) {
                    return res.status(400).json({ error: "Please upload a JPG, PNG, WEBP, or HEIC photo." });
                }

                const path = `${crypto.randomUUID()}.${type.ext}`;

                const { error } = await supabaseAdmin.storage
                    .from(BUCKET)
                    .upload(path, buffer, { contentType: type.contentType, upsert: false });

                if (error) {
                    console.error("Could not save engraving photo:", error);
                    return res.status(502).json({ error: "Could not upload your photo. Please try again." });
                }

                res.status(201).json({ path });

            } catch (err) {
                console.error("Engraving photo upload failed:", err);
                res.status(500).json({ error: "Could not upload your photo. Please try again." });
            }

        }
    );

    // Too-large uploads land here instead of crashing the request.
    app.use("/api/engraving-photos", (err, req, res, next) => {
        if (err && err.type === "entity.too.large") {
            return res.status(413).json({ error: "That photo is too large. Please use one under 10 MB." });
        }
        next(err);
    });

    app.get("/api/admin/engraving-photos/url", requireOwner, async (req, res) => {

        const path = String(req.query.path || "");

        if (!ENGRAVING_PHOTO_PATH_PATTERN.test(path)) {
            return res.status(400).json({ error: "Unknown photo." });
        }

        const { data, error } = await supabaseAdmin.storage
            .from(BUCKET)
            .createSignedUrl(path, 60 * 60);

        if (error || !data?.signedUrl) {
            console.error("Could not create engraving photo link:", error);
            return res.status(502).json({ error: "Could not open this photo." });
        }

        res.json({ url: data.signedUrl });

    });

};
