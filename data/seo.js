// data/seo.js
//
// Helps Google and Bing find every page of the site:
//   /robots.txt  -> tells search engines what they may look at
//   /sitemap.xml -> lists every public page, including every product
//
// The sitemap is built fresh from the database each time, so new
// listings show up in it automatically.

const SITE_URL = "https://cornerbarr.com";

const STATIC_PAGES = [
    { path: "/", priority: "1.0" },
    { path: "/shop.html", priority: "0.9" },
    { path: "/refund-policy.html", priority: "0.3" },
    { path: "/terms-of-service.html", priority: "0.3" },
    { path: "/privacy-policy.html", priority: "0.3" }
];

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

module.exports = function registerSeoRoutes(app, { supabaseAdmin }) {

    app.get("/robots.txt", (req, res) => {
        res.type("text/plain").send(
            "User-agent: *\n" +
            "Allow: /\n" +
            "Disallow: /api/\n" +
            `Sitemap: ${SITE_URL}/sitemap.xml\n`
        );
    });

    app.get("/sitemap.xml", async (req, res) => {

        const urls = STATIC_PAGES.map(page => ({
            loc: `${SITE_URL}${page.path}`,
            priority: page.priority,
            lastmod: null
        }));

        try {

            const { data, error } = await supabaseAdmin
                .from("products")
                .select("id, updated_at");

            if (error) {
                console.error("Sitemap: could not load products:", error);
            } else {
                for (const product of data) {
                    urls.push({
                        loc: `${SITE_URL}/product.html?id=${encodeURIComponent(product.id)}`,
                        priority: "0.8",
                        lastmod: product.updated_at ? new Date(product.updated_at).toISOString().slice(0, 10) : null
                    });
                }
            }

        } catch (err) {
            console.error("Sitemap failed:", err);
        }

        const body = urls.map(url => `  <url>
    <loc>${xmlEscape(url.loc)}</loc>${url.lastmod ? `
    <lastmod>${url.lastmod}</lastmod>` : ""}
    <priority>${url.priority}</priority>
  </url>`).join("\n");

        res.type("application/xml").send(
            `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
        );

    });

};
