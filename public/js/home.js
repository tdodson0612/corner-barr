// /corner-barr/js/home.js
//
// The home page: the hero ("Gifts made from the heart"), the category
// tiles that take customers into the shop, the Corner Barr story, the
// map, and the social links. Only the category tiles need code; the rest
// is plain HTML in index.html. The header, cart, login, and admin panel
// come from shared.js.

initShared();


/* =========================================
   CATEGORY TILES
   One tile per category that has products, in shop order. The photo is
   picked automatically: the first product in that category that has a
   photo (in-stock items first). Tapping a tile opens that category in
   the shop.
========================================= */

function pickCategoryPhoto(products) {

    const withPhoto = products.filter(p => p && p.image_url);

    if (withPhoto.length === 0) {
        return "";
    }

    const inStock = withPhoto.find(p => !getStockStatus(p.stock).outOfStock);

    return (inStock || withPhoto[0]).image_url;

}

function homeCategoryTileMarkup(category) {

    const photo = pickCategoryPhoto(category.products);

    const photoMarkup = photo
        ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy" decoding="async">`
        : "";

    return `
        <a class="home-category-tile" href="shop.html#${encodeURIComponent(category.anchor)}">
            <span class="home-category-photo">${photoMarkup}</span>
            <span class="home-category-name">${escapeHtml(category.name)}</span>
        </a>
    `;

}

async function renderHomeCategories() {

    const grid = document.getElementById("homeCategoryGrid");

    if (!grid) {
        return;
    }

    try {

        const response = await fetch("/api/products");

        if (!response.ok) {
            throw new Error("Could not load categories.");
        }

        const data = await response.json();

        const categories = (Array.isArray(data.categories) ? data.categories : [])
            .filter(c => Array.isArray(c.products) && c.products.length > 0 && c.anchor);

        if (categories.length === 0) {
            throw new Error("No categories with products yet.");
        }

        grid.innerHTML = categories.map(homeCategoryTileMarkup).join("");
        grid.classList.add("home-category-grid-loaded");

    } catch (err) {

        // If the shop can't be reached, show a plain button to the shop
        // instead of empty boxes.
        console.error(err);
        grid.innerHTML = `<a href="shop.html" class="primary-button">Explore the Shop</a>`;
        grid.classList.add("home-category-grid-fallback");

    }

}


renderHomeCategories();
