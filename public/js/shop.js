// /corner-barr/public/js/shop.js
//
// Renders shop.html. The categories (and their order, names, and
// descriptions) come from the database, so any category the owner adds
// in Manage Shop > Categories shows up here automatically. Cards are
// clickable and take the customer to product.html.

let shopCategories = [];

const shopCategoryNav = document.getElementById("shopCategoryNav");

// The collection sections are placed right after the category menu (or
// after "Recommended For You", once that exists), exactly where the
// fixed sections used to be, so the page's styling is unchanged.
function replaceShopSections(html) {

    document.querySelectorAll("[data-shop-dynamic]").forEach(el => el.remove());

    const anchor = document.getElementById("recommendedForYouSection") || shopCategoryNav;
    anchor.insertAdjacentHTML("afterend", html);

}

function showShopMessage(message) {
    replaceShopSections(`<section class="shop-collection" data-shop-dynamic><p>${escapeHtml(message)}</p></section>`);
}


async function loadProductData() {

    const response = await fetch("/api/products");

    if (!response.ok) {
        throw new Error("Could not load product data.");
    }

    const data = await response.json();

    shopCategories = Array.isArray(data.categories) ? data.categories : [];

}


/* =========================================
   RECOMMENDED FOR YOU
========================================= */

async function renderRecommendedForYou() {

    let section = document.getElementById("recommendedForYouSection");

    if (!section) {
        section = document.createElement("section");
        section.id = "recommendedForYouSection";
        section.className = "recommended-for-you-section hidden";

        // Insert before the ENTIRE Cutting Boards section (heading,
        // description, and grid together) — not just before the grid
        // div itself, which would land this in between the heading and
        // the products instead of cleanly above the whole thing.
        const firstCollection = document.querySelector("[data-shop-dynamic]");

        if (firstCollection) {
            firstCollection.insertAdjacentElement("beforebegin", section);
        } else {
            shopCategoryNav.insertAdjacentElement("afterend", section);
        }
    }

    try {

        const viewedIds = getRecentlyViewedIds();
        const params = new URLSearchParams({ limit: "8" });
        if (viewedIds.length > 0) {
            params.set("viewed", viewedIds.join(","));
        }

        const response = await fetch(`/api/recommendations?${params.toString()}`, { headers: authHeaders() });
        const recommendations = await response.json();

        if (!response.ok || !Array.isArray(recommendations) || recommendations.length === 0) {
            return;
        }

        section.classList.remove("hidden");
        section.innerHTML = `
            <p class="eyebrow">RECOMMENDED FOR YOU</p>
            <div class="recommended-products-grid">
                ${recommendations.map(miniProductCardMarkup).join("")}
            </div>
        `;

    } catch (err) {
        console.error(err);
    }

}


function productCardMarkup(product, imageClassName, imageMarkup) {

    const outOfStock = getStockStatus(product.stock).outOfStock;

    return `
        <article class="product-card ${outOfStock ? "product-card-out-of-stock" : ""}">

            <a class="product-card-link" href="product.html?id=${encodeURIComponent(product.id)}">

                <div class="product-image ${imageClassName}">
                    ${imageMarkup}
                </div>

                <div class="product-info">
                    <div class="product-category">${escapeHtml(product.category)}</div>
                    <h3 class="product-name">${escapeHtml(product.name)}</h3>
                    <p class="product-description">${escapeHtml(product.description)}</p>

                    <div class="product-bottom">
                        <span class="product-price">${money(product.price)}</span>
                        ${stockStatusMarkup(product.stock)}
                    </div>
                </div>

            </a>

            ${wishlistButtonMarkup(product.id)}

        </article>
    `;

}


/* =========================================
   CATEGORY SECTIONS
========================================= */

// The original categories keep their special look for products that
// don't have a photo yet. Every other category uses the standard card.
const SPECIAL_CATEGORY_STYLES = {
    cutting_board: {
        imageClassName: "cutting-board-image",
        placeholder: product => `<div class="board-shape ${escapeHtml(product.boardClass || "board-classic")}">
                   <div class="board-engraving">CORNER BARR</div>
               </div>`
    },
    soap_candle: {
        imageClassName: "soap-candle-image",
        placeholder: product => `<div class="product-object ${escapeHtml(product.productClass || "soap-object")}"></div>`
    },
    holiday: {
        imageClassName: "holiday-image",
        sectionClassName: "holiday-collection",
        placeholder: product => `<div class="holiday-object">${escapeHtml(product.holidayText || "")}</div>`
    }
};

function collectionNumber(index) {
    return String(index + 1).padStart(2, "0");
}

function renderShopCollections() {

    // Only categories that have products are shown to customers.
    const visible = shopCategories.filter(c => Array.isArray(c.products) && c.products.length > 0);

    shopCategoryNav.innerHTML = visible.map((category, index) => `
        <a href="#${escapeHtml(category.anchor)}" class="shop-category-link">
            <span>${collectionNumber(index)}</span>
            ${escapeHtml(category.name)}
        </a>
    `).join("");

    if (visible.length === 0) {
        showShopMessage("New products are coming soon. Check back shortly!");
        return;
    }

    const html = visible.map((category, index) => {

        const style = SPECIAL_CATEGORY_STYLES[category.key] || {};

        const cards = category.products.map(product => {

            const imageMarkup = product.image_url
                ? `<img class="product-photo" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">`
                : (style.placeholder ? style.placeholder(product) : `<div class="product-photo-placeholder"></div>`);

            return productCardMarkup(product, style.imageClassName || "", imageMarkup);

        }).join("");

        return `
            <section class="shop-collection ${style.sectionClassName || ""}" id="${escapeHtml(category.anchor)}" data-shop-dynamic>

                <div class="collection-heading">
                    <div>
                        <p class="eyebrow">COLLECTION ${collectionNumber(index)}</p>
                        <h2>${escapeHtml(category.name)}</h2>
                    </div>
                    ${category.description ? `<p>${escapeHtml(category.description)}</p>` : ""}
                </div>

                <div class="product-grid">${cards}</div>

            </section>
        `;

    }).join("");

    replaceShopSections(html);

    document.querySelectorAll("[data-shop-dynamic] .product-grid").forEach(grid => attachWishlistButtons(grid));

}

// Sections are built after the page loads, so jump to a link like
// shop.html#baskets ourselves once they exist.
function scrollToHashSection() {

    const id = decodeURIComponent((window.location.hash || "").slice(1));

    if (!id) {
        return;
    }

    const target = document.getElementById(id);

    if (target) {
        target.scrollIntoView();
    }

}

// Older versions of shared.js (possibly still saved in a browser) call
// these names after the owner edits a listing. Keep them working.
function renderCuttingBoards() { renderShopCollections(); }
function renderSoapCandles() {}
function renderHolidayProducts() {}
function renderResinCrafts() {}
function renderJewelry() {}


/* =========================================
   INITIALIZE
========================================= */

async function initShop() {

    await initShared();

    try {
        await loadProductData();
    } catch (err) {
        console.error(err);
        showShopMessage("Could not load products. Please refresh the page.");
        return;
    }

    renderShopCollections();
    scrollToHashSection();

    renderRecommendedForYou();

}


initShop();