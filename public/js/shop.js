// /corner-barr/public/js/shop.js
//
// Renders the 5 category grids on shop.html. Cards are clickable — like
// Amazon's search results — and take the customer to product.html for
// details, customization (cutting boards), and Add to Cart.

let cuttingBoards = [];
let soapCandles = [];
let holidayProducts = [];
let resinCrafts = [];
let jewelryItems = [];

const cuttingBoardGrid = document.getElementById("cuttingBoardGrid");
const soapCandleGrid = document.getElementById("soapCandleGrid");
const holidayGrid = document.getElementById("holidayGrid");
const resinGrid = document.getElementById("resinGrid");
const jewelryGrid = document.getElementById("jewelryGrid");


async function loadProductData() {

    const response = await fetch("/api/products");

    if (!response.ok) {
        throw new Error("Could not load product data.");
    }

    const data = await response.json();

    cuttingBoards = data.cuttingBoards;
    soapCandles = data.soapCandles;
    holidayProducts = data.holidayProducts;
    resinCrafts = data.resinCrafts;
    jewelryItems = data.jewelryItems;

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
        const cuttingBoardsWrapper = cuttingBoardGrid.closest("section") || cuttingBoardGrid;
        cuttingBoardsWrapper.insertAdjacentElement("beforebegin", section);
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
   CUTTING BOARDS
========================================= */

function renderCuttingBoards() {

    cuttingBoardGrid.innerHTML = cuttingBoards.map(product => {

        const imageMarkup = product.image_url
            ? `<img class="product-photo" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">`
            : `<div class="board-shape ${product.boardClass || "board-classic"}">
                   <div class="board-engraving">CORNER BARR</div>
               </div>`;

        return productCardMarkup(product, "cutting-board-image", imageMarkup);

    }).join("");

    attachWishlistButtons(cuttingBoardGrid);

}


/* =========================================
   SOAP & CANDLES
========================================= */

function renderSoapCandles() {

    soapCandleGrid.innerHTML = soapCandles.map(product => {

        const imageMarkup = product.image_url
            ? `<img class="product-photo" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">`
            : `<div class="product-object ${product.productClass || "soap-object"}"></div>`;

        return productCardMarkup(product, "soap-candle-image", imageMarkup);

    }).join("");

    attachWishlistButtons(soapCandleGrid);

}


/* =========================================
   HOLIDAY
========================================= */

function renderHolidayProducts() {

    holidayGrid.innerHTML = holidayProducts.map(product => {

        const imageMarkup = product.image_url
            ? `<img class="product-photo" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">`
            : `<div class="holiday-object">${escapeHtml(product.holidayText || "")}</div>`;

        return productCardMarkup(product, "holiday-image", imageMarkup);

    }).join("");

    attachWishlistButtons(holidayGrid);

}


/* =========================================
   RESIN CRAFTS
========================================= */

function renderResinCrafts() {

    resinGrid.innerHTML = resinCrafts.map(product => {

        const imageMarkup = product.image_url
            ? `<img class="product-photo" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">`
            : `<div class="product-photo-placeholder"></div>`;

        return productCardMarkup(product, "", imageMarkup);

    }).join("");

    attachWishlistButtons(resinGrid);

}


/* =========================================
   JEWELRY
========================================= */

function renderJewelry() {

    jewelryGrid.innerHTML = jewelryItems.map(product => {

        const imageMarkup = product.image_url
            ? `<img class="product-photo" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">`
            : `<div class="product-photo-placeholder"></div>`;

        return productCardMarkup(product, "", imageMarkup);

    }).join("");

    attachWishlistButtons(jewelryGrid);

}


/* =========================================
   INITIALIZE
========================================= */

async function initShop() {

    await initShared();

    try {
        await loadProductData();
    } catch (err) {
        console.error(err);
        cuttingBoardGrid.innerHTML = "<p>Could not load products. Please refresh the page.</p>";
        return;
    }

    renderCuttingBoards();
    renderSoapCandles();
    renderHolidayProducts();
    renderResinCrafts();
    renderJewelry();

    renderRecommendedForYou();

}


initShop();