// /corner-barr/js/product.js
//
// Powers product.html. Reads ?id= from the URL, fetches that one product,
// and renders it. Cutting boards get a customization panel (engraving text
// + style) that sits right above the price — the price updates instantly
// as the customer changes their selection.

const CATEGORY_KEY_TO_CART_CATEGORY = {
    soap_candle: "soap",
    holiday: "holiday",
    resin_craft: "resin",
    jewelry: "jewelry",
    basket: "basket"
    // cutting_board is handled separately, as "custom", since it always
    // carries engraving/style details.
};

const productLoading = document.getElementById("productLoading");
const productErrorEl = document.getElementById("productError");
const productDetail = document.getElementById("productDetail");
const productDetailImage = document.getElementById("productDetailImage");
const productGalleryThumbs = document.getElementById("productGalleryThumbs");
const productDetailCategory = document.getElementById("productDetailCategory");
const productDetailName = document.getElementById("productDetailName");
const productDetailDescription = document.getElementById("productDetailDescription");
const productDetailPrice = document.getElementById("productDetailPrice");
const customizationSection = document.getElementById("customizationSection");
const engravingTextInput = document.getElementById("engravingText");
const styleOptionsContainer = document.getElementById("styleOptions");
const giftMessageCheckbox = document.getElementById("giftMessage");
const giftMessageContainer = document.getElementById("giftMessageContainer");
const giftMessageText = document.getElementById("giftMessageText");
const productAddToCartButton = document.getElementById("productAddToCartButton");

let currentProduct = null;
let currentImages = [];
let currentImageIndex = 0;
let currentEngravingStyles = [];
let selectedEngravingStyleId = null;

// Photo engraving (cutting boards by default, plus any product Ashley
// turns it on for). The photo uploads as soon as it's chosen; the cart
// item only stores the uploaded file's name.
let engravingPhotoPath = null;
let engravingPhotoUploading = false;

// Product options (like Size). One option type per product; each option
// has its own full price and its own stock count.
let selectedOptionValue = null;

function getProductOptions() {
    const first = Array.isArray(currentProduct?.variations) ? currentProduct.variations[0] : null;
    return first && Array.isArray(first.options) && first.options.length > 0 ? first : null;
}

function getSelectedOption() {
    const options = getProductOptions();
    return options ? options.options.find(o => o.value === selectedOptionValue) || null : null;
}

// The price before engraving extras: the chosen option's price, or the
// product's own price if it has no options.
function getBasePrice() {
    const option = getSelectedOption();
    return option ? Number(option.price) : currentProduct.price;
}

// Stock for what's currently selected.
function getEffectiveStock() {
    const options = getProductOptions();
    if (!options) {
        return currentProduct.stock;
    }
    const option = getSelectedOption();
    return option ? Number(option.stock) || 0 : currentProduct.stock;
}


function getProductIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("id");
}


async function loadProduct() {

    const id = getProductIdFromUrl();

    if (!id) {
        showProductError();
        return;
    }

    try {

        const response = await fetch(`/api/products/${encodeURIComponent(id)}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Product not found.");
        }

        currentProduct = data.product;
        currentImages = (data.images && data.images.length > 0) ? data.images : null;
        currentEngravingStyles = data.engravingStyles || [];

        renderProduct();

    } catch (err) {
        console.error(err);
        showProductError();
    }

}


function showProductError() {
    productLoading.classList.add("hidden");
    productErrorEl.classList.remove("hidden");
}


function renderProduct() {

    productLoading.classList.add("hidden");
    productDetail.classList.remove("hidden");

    document.title = `Corner Barr | ${currentProduct.name}`;

    currentImageIndex = 0;
    renderGalleryImage();
    renderGalleryThumbs();

    productDetailCategory.textContent = currentProduct.category;
    productDetailName.textContent = currentProduct.name;
    productDetailDescription.textContent = currentProduct.description;

    if (currentProduct.categoryKey === "cutting_board") {
        customizationSection.classList.remove("hidden");
        renderStyleOptions();
    }

    renderOptionPicker();
    renderPhotoEngravingSection();

    updatePriceDisplay();
    renderStockStatus();

    trackRecentlyViewed(currentProduct.id);
    loadAndRenderReviews();
    loadAndRenderSimilarProducts();

}


// The button's original label, captured once so we can restore it after
// showing "Out of Stock" — rather than hardcoding text we don't own.
let defaultAddToCartLabel = null;

function renderStockStatus() {

    if (defaultAddToCartLabel === null) {
        defaultAddToCartLabel = productAddToCartButton.textContent;
    }

    const status = getStockStatus(getEffectiveStock());

    // No matching element exists in product.html yet, so create one once
    // and reuse it on subsequent renders rather than duplicating it.
    let statusEl = document.getElementById("productStockStatus");

    if (!statusEl) {
        statusEl = document.createElement("div");
        statusEl.id = "productStockStatus";
        productDetailPrice.insertAdjacentElement("afterend", statusEl);
    }

    statusEl.className = `product-stock-status ${status.className}`;
    statusEl.textContent = status.label;

    productAddToCartButton.disabled = status.outOfStock;
    productAddToCartButton.textContent = status.outOfStock ? "Out of Stock" : defaultAddToCartLabel;

}


function renderGalleryImage() {

    const hasRealPhotos = Array.isArray(currentImages) && currentImages.length > 0;
    const showArrows = hasRealPhotos && currentImages.length > 1;

    const imageMarkup = hasRealPhotos
        ? `<img class="product-photo" src="${escapeHtml(currentImages[currentImageIndex])}" alt="${escapeHtml(currentProduct.name)}">`
        : renderFallbackImage(currentProduct);

    const arrowsMarkup = showArrows
        ? `
            <button type="button" class="gallery-arrow gallery-arrow-prev" aria-label="Previous photo">‹</button>
            <button type="button" class="gallery-arrow gallery-arrow-next" aria-label="Next photo">›</button>
        `
        : "";

    productDetailImage.innerHTML = imageMarkup + arrowsMarkup;

    // The wishlist heart overlays the image, same as on the shop grid.
    productDetailImage.insertAdjacentHTML("beforeend", wishlistButtonMarkup(currentProduct.id));
    attachWishlistButtons(productDetailImage);

    if (showArrows) {

        productDetailImage.querySelector(".gallery-arrow-prev").addEventListener("click", () => showImageAt(currentImageIndex - 1));
        productDetailImage.querySelector(".gallery-arrow-next").addEventListener("click", () => showImageAt(currentImageIndex + 1));

        // Swipe support — same left/right gesture as Amazon's item pages.
        let touchStartX = null;

        productDetailImage.addEventListener("touchstart", event => {
            touchStartX = event.touches[0].clientX;
        }, { passive: true });

        productDetailImage.addEventListener("touchend", event => {

            if (touchStartX === null) {
                return;
            }

            const deltaX = event.changedTouches[0].clientX - touchStartX;
            const SWIPE_THRESHOLD = 40;

            if (deltaX > SWIPE_THRESHOLD) {
                showImageAt(currentImageIndex - 1);
            } else if (deltaX < -SWIPE_THRESHOLD) {
                showImageAt(currentImageIndex + 1);
            }

            touchStartX = null;

        });

    }

}


function showImageAt(index) {

    if (!Array.isArray(currentImages) || currentImages.length === 0) {
        return;
    }

    // Wrap around at either end, like Amazon's gallery does.
    currentImageIndex = (index + currentImages.length) % currentImages.length;

    renderGalleryImage();
    renderGalleryThumbs();

}


function renderGalleryThumbs() {

    if (!Array.isArray(currentImages) || currentImages.length <= 1) {
        productGalleryThumbs.classList.add("hidden");
        productGalleryThumbs.innerHTML = "";
        return;
    }

    productGalleryThumbs.classList.remove("hidden");

    productGalleryThumbs.innerHTML = currentImages.map((url, index) => `
        <button
            type="button"
            class="product-gallery-thumb ${index === currentImageIndex ? "active" : ""}"
            data-index="${index}"
            aria-label="Photo ${index + 1}"
        >
            <img src="${escapeHtml(url)}" alt="">
        </button>
    `).join("");

    productGalleryThumbs.querySelectorAll("[data-index]").forEach(button => {
        button.addEventListener("click", () => showImageAt(Number(button.dataset.index)));
    });

}


function renderFallbackImage(product) {

    if (product.categoryKey === "cutting_board") {
        return `
            <div class="board-shape ${product.boardClass || "board-classic"}">
                <div class="board-engraving">CORNER BARR</div>
            </div>
        `;
    }

    if (product.categoryKey === "soap_candle") {
        return `<div class="product-object ${product.productClass || "soap-object"}"></div>`;
    }

    if (product.categoryKey === "holiday") {
        return `<div class="holiday-object">${escapeHtml(product.holidayText || "")}</div>`;
    }

    return `<div class="product-photo-placeholder"></div>`;

}


function renderStyleOptions() {

    if (currentEngravingStyles.length === 0) {
        return;
    }

    if (!selectedEngravingStyleId) {
        selectedEngravingStyleId = currentEngravingStyles[0].id;
    }

    styleOptionsContainer.innerHTML = currentEngravingStyles.map(style => `
        <button
            type="button"
            class="style-option ${style.id === selectedEngravingStyleId ? "active" : ""}"
            data-style="${style.id}"
        >
            ${escapeHtml(style.name)}${style.extra ? ` +${money(style.extra)}` : ""}
        </button>
    `).join("");

    styleOptionsContainer.querySelectorAll("[data-style]").forEach(button => {
        button.addEventListener("click", () => {
            selectedEngravingStyleId = button.dataset.style;
            renderStyleOptions();
            updatePriceDisplay();
        });
    });

}


function getSelectedStyleExtra() {

    if (currentProduct.categoryKey !== "cutting_board") {
        return 0;
    }

    const style = currentEngravingStyles.find(s => s.id === selectedEngravingStyleId);
    return style ? style.extra : 0;

}


function getPhotoEngravingExtra() {
    if (!engravingPhotoPath || !currentProduct.allowPhotoEngraving) {
        return 0;
    }
    return Number(currentProduct.photoEngravingPrice || 0);
}


function updatePriceDisplay() {
    const total = getBasePrice() + getSelectedStyleExtra() + getPhotoEngravingExtra();
    productDetailPrice.textContent = money(total);
}


function handleAddToCart() {

    if (!currentProduct || getEffectiveStock() <= 0) {
        return;
    }

    const productOptions = getProductOptions();
    const selectedOption = getSelectedOption();

    if (productOptions && !selectedOption) {
        const errorEl = document.getElementById("productOptionError");
        if (errorEl) {
            errorEl.textContent = `Please choose a ${productOptions.type.toLowerCase()}.`;
        }
        return;
    }

    const optionFields = selectedOption
        ? { variationType: productOptions.type, variationValue: selectedOption.value }
        : {};

    const displayName = selectedOption
        ? `${currentProduct.name} (${selectedOption.value})`
        : currentProduct.name;

    if (engravingPhotoUploading) {
        alert("Your photo is still uploading. Please wait a moment and try again.");
        return;
    }

    const photoPath = currentProduct.allowPhotoEngraving ? engravingPhotoPath : null;

    const giftMessage = giftMessageCheckbox.checked ? giftMessageText.value.trim() : "";

    let item;

    if (currentProduct.categoryKey === "cutting_board") {

        const style = currentEngravingStyles.find(s => s.id === selectedEngravingStyleId);

        item = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            productId: currentProduct.id,
            category: "custom",
            engravingStyleId: selectedEngravingStyleId,
            name: displayName,
            ...optionFields,
            price: getBasePrice() + getSelectedStyleExtra() + getPhotoEngravingExtra(),
            quantity: 1,
            engraving: engravingTextInput.value.trim(),
            style: style ? style.name : "",
            giftMessage,
            engravingPhotoPath: photoPath,
            // A UX-only hint so the cart drawer can warn before the
            // customer tries to raise the quantity past what's available.
            // The server re-checks the real number regardless at checkout.
            availableStock: getEffectiveStock()
        };

    } else {

        const cartCategory = CATEGORY_KEY_TO_CART_CATEGORY[currentProduct.categoryKey] || currentProduct.categoryKey;

        item = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            productId: currentProduct.id,
            category: cartCategory,
            name: displayName,
            ...optionFields,
            price: getBasePrice() + getPhotoEngravingExtra(),
            quantity: 1,
            engraving: "",
            style: "",
            giftMessage,
            engravingPhotoPath: photoPath,
            availableStock: getEffectiveStock()
        };

    }

    cart.push(item);
    saveCart();
    renderCart();
    openCart();

}


/* =========================================
   REVIEWS
========================================= */

let currentReviews = [];
let currentReviewSummary = { average: 0, count: 0, distribution: {} };
let selectedReviewRating = 0;
let pendingReviewPhotoUrl = null;

function getOrCreateSection(id, insertAfterEl) {

    let section = document.getElementById(id);

    if (!section) {
        section = document.createElement("section");
        section.id = id;
        insertAfterEl.insertAdjacentElement("afterend", section);
    }

    return section;

}

async function loadAndRenderReviews() {

    // Reviews go BELOW the whole product area (full width), so the price
    // and Add to Cart button stay right under the item's options.
    const section = getOrCreateSection("productReviewsSection", productDetail);
    section.className = "product-reviews-section";
    section.innerHTML = `<p class="checkout-note">Loading reviews…</p>`;

    try {

        const response = await fetch(`/api/products/${encodeURIComponent(currentProduct.id)}/reviews`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not load reviews.");
        }

        currentReviews = data.reviews;
        currentReviewSummary = data.summary;

        renderReviewsSection(section);

    } catch (err) {
        console.error(err);
        section.innerHTML = `<p class="checkout-note">Could not load reviews right now.</p>`;
    }

}

function renderReviewsSection(section) {

    reviewsRenderedForAuth = currentAuthKey();

    const { average, count, distribution } = currentReviewSummary;

    const distributionRows = [5, 4, 3, 2, 1].map(star => {
        const starCount = distribution[star] || 0;
        const pct = count > 0 ? Math.round((starCount / count) * 100) : 0;
        return `
            <div class="rating-distribution-row">
                <span>${star}★</span>
                <div class="rating-distribution-bar"><div class="rating-distribution-fill" style="width:${pct}%"></div></div>
                <span class="rating-distribution-count">${starCount}</span>
            </div>
        `;
    }).join("");

    const photos = currentReviews.filter(r => r.photo_url);

    const photosMarkup = photos.length > 0 ? `
        <div class="review-photos-gallery">
            ${photos.map(r => `
                <a href="${escapeHtml(r.photo_url)}" target="_blank" rel="noopener noreferrer">
                    <img src="${escapeHtml(r.photo_url)}" alt="Customer photo">
                </a>
            `).join("")}
        </div>
    ` : "";

    const myReview = currentSession ? currentReviews.find(r => r.user_id === currentSession.user.id) : null;

    const reviewsListMarkup = currentReviews.length > 0
        ? currentReviews.map(review => reviewRowMarkup(review, myReview)).join("")
        : `<p class="checkout-note">No reviews yet — be the first!</p>`;

    section.innerHTML = `
        <p class="eyebrow">REVIEWS</p>
        <h2>What customers say</h2>

        <div class="review-summary">
            <div class="review-summary-average">
                ${starDisplayMarkup(average)}
                <strong>${average > 0 ? average.toFixed(1) : "—"}</strong>
            </div>
            <div class="review-summary-count">${count} review${count === 1 ? "" : "s"}</div>
        </div>

        <div class="rating-distribution">${distributionRows}</div>

        ${photosMarkup}

        <div id="reviewFormContainer"></div>

        <div id="inStoreReviewContainer"></div>

        <div class="reviews-list">${reviewsListMarkup}</div>
    `;

    renderReviewFormArea(myReview);
    renderInStoreReviewArea();
    attachReviewRowEvents(section);

}

function reviewRowMarkup(review, myReview) {

    const isMine = myReview && myReview.id === review.id;
    const isOwner = typeof currentRole !== "undefined" && currentRole === "owner";
    const sourceLabel = review.source === "in_store"
        ? `<span class="checkout-note" style="margin-left:8px;">Purchased in store</span>`
        : "";

    return `
        <div class="review-row">
            <div class="review-row-top">
                <span class="review-row-name">${escapeHtml(review.reviewer_name || "Customer")}${sourceLabel}</span>
                ${starDisplayMarkup(review.rating)}
            </div>
            ${review.review_text ? `<p class="review-row-text">${escapeHtml(review.review_text)}</p>` : ""}
            ${review.photo_url ? `<img class="review-row-photo" src="${escapeHtml(review.photo_url)}" alt="Customer photo">` : ""}
            ${isMine ? `<button type="button" class="remove-item" data-delete-review="${review.id}">Delete my review</button>` : ""}
            ${isOwner && !isMine ? `<button type="button" class="remove-item" data-owner-remove-review="${review.id}">Remove review</button>` : ""}
        </div>
    `;

}

function attachReviewRowEvents(section) {
    section.querySelectorAll("[data-delete-review]").forEach(button => {
        button.addEventListener("click", () => deleteMyReview(button.dataset.deleteReview));
    });
    section.querySelectorAll("[data-owner-remove-review]").forEach(button => {
        button.addEventListener("click", () => ownerRemoveReview(button.dataset.ownerRemoveReview));
    });
}

// Owner only: take any review off the site.
async function ownerRemoveReview(reviewId) {

    if (!confirm("Remove this review from the site? This can't be undone.")) {
        return;
    }

    try {
        const response = await fetch(`/api/reviews/${reviewId}`, { method: "DELETE", headers: authHeaders() });
        if (!response.ok) {
            throw new Error("Could not remove this review.");
        }
        loadAndRenderReviews();
    } catch (err) {
        console.error(err);
        alert("Could not remove this review right now.");
    }

}

// Called by shared.js once we know who's logged in (it can finish after
// the reviews first load), so the right buttons and forms show.
let reviewsRenderedForAuth = null;

function currentAuthKey() {
    const userId = currentSession && currentSession.user ? currentSession.user.id : "guest";
    const role = typeof currentRole !== "undefined" ? currentRole : "customer";
    return `${userId}|${role}`;
}

function refreshReviewsForAuth() {

    // Only re-draw if who's logged in actually changed (this also runs on
    // routine login refreshes, which shouldn't wipe a half-typed review).
    if (currentAuthKey() === reviewsRenderedForAuth) {
        return;
    }

    const section = document.getElementById("productReviewsSection");

    if (currentProduct && section && Array.isArray(currentReviews) && currentReviewSummary) {
        renderReviewsSection(section);
    }

}

async function deleteMyReview(reviewId) {

    if (!confirm("Delete your review?")) {
        return;
    }

    try {
        await fetch(`/api/reviews/${reviewId}`, { method: "DELETE", headers: authHeaders() });
        loadAndRenderReviews();
    } catch (err) {
        console.error(err);
        alert("Could not delete your review right now.");
    }

}

function renderReviewFormArea(myReview) {

    const container = document.getElementById("reviewFormContainer");

    if (!currentSession) {
        container.innerHTML = `<p class="checkout-note">Log in to leave a review.</p>`;
        return;
    }

    selectedReviewRating = myReview ? myReview.rating : 0;
    pendingReviewPhotoUrl = myReview ? myReview.photo_url : null;

    container.innerHTML = `
        <div class="review-form">
            <h3>${myReview ? "Edit your review" : "Write a review"}</h3>
            <div class="review-star-input" id="reviewStarInput"></div>
            <textarea id="reviewTextInput" placeholder="What did you think?">${myReview ? escapeHtml(myReview.review_text || "") : ""}</textarea>
            <div class="admin-drop-zone" id="reviewPhotoDropZone">
                <img id="reviewPhotoPreview" class="admin-image-preview ${pendingReviewPhotoUrl ? "" : "hidden"}" src="${pendingReviewPhotoUrl ? escapeHtml(pendingReviewPhotoUrl) : ""}">
                <span id="reviewPhotoDropZoneText" class="${pendingReviewPhotoUrl ? "hidden" : ""}">Add a photo (optional)</span>
                <input type="file" id="reviewPhotoInput" accept="image/*" class="admin-file-input">
            </div>
            <div id="reviewFormError" class="checkout-error"></div>
            <button type="button" class="primary-button" id="submitReviewButton">${myReview ? "Save Changes" : "Submit Review"}</button>
        </div>
    `;

    renderReviewStarInput();
    wireReviewFormEvents(myReview);

}

function renderReviewStarInput() {

    const starInput = document.getElementById("reviewStarInput");

    starInput.innerHTML = [1, 2, 3, 4, 5].map(star => `
        <button type="button" class="review-star-button ${star <= selectedReviewRating ? "active" : ""}" data-star="${star}" aria-label="${star} star">★</button>
    `).join("");

    starInput.querySelectorAll("[data-star]").forEach(button => {
        button.addEventListener("click", () => {
            selectedReviewRating = Number(button.dataset.star);
            renderReviewStarInput();
        });
    });

}

function wireReviewFormEvents(myReview) {

    const photoInput = document.getElementById("reviewPhotoInput");
    const dropZone = document.getElementById("reviewPhotoDropZone");

    photoInput.addEventListener("change", event => handleReviewPhotoFile(event.target.files[0]));

    dropZone.addEventListener("dragover", event => {
        event.preventDefault();
        dropZone.classList.add("dragging");
    });

    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));

    dropZone.addEventListener("drop", event => {
        event.preventDefault();
        dropZone.classList.remove("dragging");
        handleReviewPhotoFile(event.dataTransfer.files[0]);
    });

    document.getElementById("submitReviewButton").addEventListener("click", () => submitReview(myReview));

}

let pendingReviewPhotoFile = null;

function handleReviewPhotoFile(file) {

    if (!file) {
        return;
    }

    pendingReviewPhotoFile = file;

    const reader = new FileReader();
    reader.onload = () => {
        const preview = document.getElementById("reviewPhotoPreview");
        preview.src = reader.result;
        preview.classList.remove("hidden");
        document.getElementById("reviewPhotoDropZoneText").classList.add("hidden");
    };
    reader.readAsDataURL(file);

}

async function uploadReviewPhoto(file) {

    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const filePath = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

    const { error } = await supabaseClient.storage.from("review-photos").upload(filePath, file, { upsert: false });

    if (error) {
        throw new Error(`Could not upload photo: ${error.message}`);
    }

    const { data } = supabaseClient.storage.from("review-photos").getPublicUrl(filePath);
    return data.publicUrl;

}

async function submitReview(myReview) {

    const errorEl = document.getElementById("reviewFormError");
    errorEl.textContent = "";
    errorEl.classList.remove("visible");

    if (selectedReviewRating < 1) {
        errorEl.textContent = "Please select a star rating.";
        errorEl.classList.add("visible");
        return;
    }

    const button = document.getElementById("submitReviewButton");
    button.disabled = true;

    try {

        let photoUrl = pendingReviewPhotoUrl;

        if (pendingReviewPhotoFile) {
            photoUrl = await uploadReviewPhoto(pendingReviewPhotoFile);
        }

        const payload = {
            rating: selectedReviewRating,
            review_text: document.getElementById("reviewTextInput").value.trim(),
            photo_url: photoUrl
        };

        const url = myReview ? `/api/reviews/${myReview.id}` : `/api/products/${currentProduct.id}/reviews`;
        const method = myReview ? "PUT" : "POST";

        const response = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not save your review.");
        }

        pendingReviewPhotoFile = null;
        loadAndRenderReviews();

    } catch (err) {
        errorEl.textContent = err.message || "Could not save your review.";
        errorEl.classList.add("visible");
    } finally {
        button.disabled = false;
    }

}


/* =========================================
   IN-STORE REVIEWS
   For people who bought in person. No login needed; the review shows
   up after the owner approves it.
========================================= */

let inStoreRating = 0;
let inStorePhotoFile = null;

function renderInStoreReviewArea() {

    const container = document.getElementById("inStoreReviewContainer");

    if (!container) {
        return;
    }

    inStoreRating = 0;
    inStorePhotoFile = null;

    container.innerHTML = `
        <button type="button" class="secondary-button" id="inStoreReviewToggle" style="margin:12px 0;">
            Bought this at our shop or a market? Leave a review
        </button>
        <div class="review-form hidden" id="inStoreReviewForm">
            <h3>Review an in-store purchase</h3>
            <p class="checkout-note">Reviews from in-store purchases appear after a quick check by Corner Barr.</p>

            <div class="form-group">
                <label for="inStoreName">Your name</label>
                <input type="text" id="inStoreName" maxlength="80" autocomplete="name">
            </div>

            <div class="form-group">
                <label for="inStoreEmail">Your email</label>
                <input type="email" id="inStoreEmail" maxlength="200" autocomplete="email">
                <div class="input-help">Never shown publicly. Only Corner Barr sees it.</div>
            </div>

            <div class="form-group">
                <label for="inStorePurchaseNote">Where did you buy it? (optional)</label>
                <input type="text" id="inStorePurchaseNote" maxlength="150" placeholder="e.g. Medford Farmers Market, September">
            </div>

            <div class="form-group">
                <label>Your rating</label>
                <div class="review-star-input" id="inStoreStarInput"></div>
            </div>

            <div class="form-group">
                <label for="inStoreText">Your review</label>
                <textarea id="inStoreText" maxlength="2000" placeholder="What did you think?"></textarea>
            </div>

            <div class="admin-drop-zone" id="inStorePhotoDropZone">
                <img id="inStorePhotoPreview" class="admin-image-preview hidden" alt="Your photo">
                <span id="inStorePhotoText">Add a photo (optional)</span>
                <input type="file" id="inStorePhotoInput" accept="image/*" class="admin-file-input">
            </div>

            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="inStoreAnonymous">
                    <span>Post my review anonymously (your name won't be shown)</span>
                </label>
            </div>

            <div style="position:absolute; left:-10000px; width:1px; height:1px; overflow:hidden;" aria-hidden="true">
                <label for="inStoreWebsite">Leave this empty</label>
                <input type="text" id="inStoreWebsite" tabindex="-1" autocomplete="off">
            </div>

            <div id="inStoreError" class="checkout-error"></div>
            <button type="button" class="primary-button" id="inStoreSubmit">Send Review</button>
        </div>
    `;

    container.querySelector("#inStoreReviewToggle").addEventListener("click", () => {
        container.querySelector("#inStoreReviewForm").classList.toggle("hidden");
    });

    renderInStoreStars();

    const photoInput = container.querySelector("#inStorePhotoInput");
    const dropZone = container.querySelector("#inStorePhotoDropZone");

    photoInput.addEventListener("change", event => setInStorePhoto(event.target.files[0]));
    dropZone.addEventListener("dragover", event => event.preventDefault());
    dropZone.addEventListener("drop", event => {
        event.preventDefault();
        setInStorePhoto(event.dataTransfer.files[0]);
    });

    container.querySelector("#inStoreSubmit").addEventListener("click", submitInStoreReview);

}

function renderInStoreStars() {

    const starInput = document.getElementById("inStoreStarInput");

    starInput.innerHTML = [1, 2, 3, 4, 5].map(star => `
        <button type="button" class="review-star-button ${star <= inStoreRating ? "active" : ""}" data-star="${star}" aria-label="${star} star">★</button>
    `).join("");

    starInput.querySelectorAll("[data-star]").forEach(button => {
        button.addEventListener("click", () => {
            inStoreRating = Number(button.dataset.star);
            renderInStoreStars();
        });
    });

}

function setInStorePhoto(file) {

    const errorEl = document.getElementById("inStoreError");
    errorEl.textContent = "";

    if (!file) {
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        errorEl.textContent = "That photo is too large. Please use one under 10 MB.";
        errorEl.classList.add("visible");
        return;
    }

    inStorePhotoFile = file;

    const preview = document.getElementById("inStorePhotoPreview");
    preview.src = URL.createObjectURL(file);
    preview.classList.remove("hidden");
    document.getElementById("inStorePhotoText").classList.add("hidden");

}

async function submitInStoreReview() {

    const errorEl = document.getElementById("inStoreError");
    const button = document.getElementById("inStoreSubmit");

    errorEl.textContent = "";
    errorEl.classList.remove("visible");

    const showError = message => {
        errorEl.textContent = message;
        errorEl.classList.add("visible");
    };

    const name = document.getElementById("inStoreName").value.trim();
    const email = document.getElementById("inStoreEmail").value.trim();
    const reviewText = document.getElementById("inStoreText").value.trim();

    if (!name) {
        return showError("Please enter your name.");
    }
    if (!email || !email.includes("@")) {
        return showError("Please enter a valid email address.");
    }
    if (inStoreRating < 1) {
        return showError("Please choose a star rating.");
    }
    if (reviewText.length < 3) {
        return showError("Please write a few words about the item.");
    }

    button.disabled = true;
    button.textContent = "Sending…";

    try {

        let photoPath = null;

        if (inStorePhotoFile) {

            const uploadResponse = await fetch("/api/review-photos", {
                method: "POST",
                headers: { "Content-Type": inStorePhotoFile.type || "application/octet-stream" },
                body: inStorePhotoFile
            });

            const uploadData = await uploadResponse.json();

            if (!uploadResponse.ok) {
                throw new Error(uploadData.error || "Could not upload your photo.");
            }

            photoPath = uploadData.path;

        }

        const response = await fetch(`/api/products/${encodeURIComponent(currentProduct.id)}/in-store-reviews`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name,
                email,
                purchase_note: document.getElementById("inStorePurchaseNote").value.trim(),
                rating: inStoreRating,
                review_text: reviewText,
                is_anonymous: document.getElementById("inStoreAnonymous").checked,
                photo_path: photoPath,
                website: document.getElementById("inStoreWebsite").value
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not send your review.");
        }

        document.getElementById("inStoreReviewContainer").innerHTML = `
            <div class="review-form">
                <h3>Thank you!</h3>
                <p class="checkout-note">We got your review. It will appear here once Corner Barr has had a quick look.</p>
            </div>
        `;

    } catch (err) {
        showError(err.message || "Could not send your review. Please try again.");
        button.disabled = false;
        button.textContent = "Send Review";
    }

}


/* =========================================
   YOU MAY ALSO LIKE
========================================= */

async function loadAndRenderSimilarProducts() {

    const anchor = document.getElementById("productReviewsSection") || productDetail;
    const section = getOrCreateSection("similarProductsSection", anchor);
    section.className = "similar-products-section hidden";

    try {

        const response = await fetch(`/api/products/${encodeURIComponent(currentProduct.id)}/similar?limit=4`);
        const similar = await response.json();

        if (!response.ok || !Array.isArray(similar) || similar.length === 0) {
            return;
        }

        section.classList.remove("hidden");
        section.innerHTML = `
            <p class="eyebrow">YOU MAY ALSO LIKE</p>
            <div class="similar-products-grid">
                ${similar.map(miniProductCardMarkup).join("")}
            </div>
        `;

    } catch (err) {
        console.error(err);
    }

}


/* =========================================
   PRODUCT OPTIONS (like Size)
========================================= */

function renderOptionPicker() {

    const existing = document.getElementById("productOptionSection");
    if (existing) {
        existing.remove();
    }

    const options = getProductOptions();
    if (!options) {
        return;
    }

    // Pick the first in-stock option to start, so the price shown is real.
    const firstInStock = options.options.find(o => Number(o.stock) > 0);
    selectedOptionValue = firstInStock ? firstInStock.value : null;

    const section = document.createElement("div");
    section.id = "productOptionSection";
    section.className = "form-group";
    section.innerHTML = `
        <label>${escapeHtml(options.type)}</label>
        <div class="style-options" id="productOptionButtons"></div>
        <div id="productOptionError" class="checkout-error"></div>
    `;

    productDetailPrice.parentNode.insertBefore(section, productDetailPrice);

    const buttons = section.querySelector("#productOptionButtons");

    options.options.forEach(option => {

        const soldOut = Number(option.stock) <= 0;

        const button = document.createElement("button");
        button.type = "button";
        button.className = `style-option ${option.value === selectedOptionValue ? "active" : ""}`;
        button.disabled = soldOut;
        button.textContent = soldOut
            ? `${option.value} (sold out)`
            : `${option.value} · ${money(Number(option.price))}`;

        button.addEventListener("click", () => {
            selectedOptionValue = option.value;
            buttons.querySelectorAll(".style-option").forEach(b => b.classList.remove("active"));
            button.classList.add("active");
            section.querySelector("#productOptionError").textContent = "";
            updatePriceDisplay();
            renderStockStatus();
        });

        buttons.appendChild(button);

    });

}


/* =========================================
   PHOTO ENGRAVING
========================================= */

function renderPhotoEngravingSection() {

    const existing = document.getElementById("photoEngravingSection");
    if (existing) {
        existing.remove();
    }

    if (!currentProduct.allowPhotoEngraving) {
        return;
    }

    const extra = Number(currentProduct.photoEngravingPrice || 0);
    const priceNote = extra > 0 ? ` (+${money(extra)})` : "";

    const section = document.createElement("div");
    section.id = "photoEngravingSection";
    section.className = "form-group";
    section.innerHTML = `
        <label>Engrave a photo (optional)${escapeHtml(priceNote)}</label>
        <div class="admin-drop-zone" id="engravingPhotoDropZone">
            <img id="engravingPhotoPreview" class="admin-image-preview hidden" alt="Your photo">
            <span id="engravingPhotoText">Add a photo of a loved one, a pet, a favorite place, or anything you'd like engraved</span>
            <input type="file" id="engravingPhotoInput" accept="image/*" class="admin-file-input">
        </div>
        <div class="input-help" style="color:#5f5a52;">Clear, well-lit photos engrave best. Only Corner Barr can see your photo.</div>
        <button type="button" class="remove-item hidden" id="engravingPhotoRemove">Remove photo</button>
        <div id="engravingPhotoError" class="checkout-error"></div>
    `;

    productDetailPrice.parentNode.insertBefore(section, productDetailPrice);

    const input = section.querySelector("#engravingPhotoInput");
    const dropZone = section.querySelector("#engravingPhotoDropZone");

    input.addEventListener("change", event => uploadEngravingPhoto(event.target.files[0]));

    dropZone.addEventListener("dragover", event => {
        event.preventDefault();
    });

    dropZone.addEventListener("drop", event => {
        event.preventDefault();
        uploadEngravingPhoto(event.dataTransfer.files[0]);
    });

    section.querySelector("#engravingPhotoRemove").addEventListener("click", () => {
        engravingPhotoPath = null;
        input.value = "";
        showEngravingPhoto(null);
        updatePriceDisplay();
    });

}


function showEngravingPhoto(previewSrc) {

    const preview = document.getElementById("engravingPhotoPreview");
    const text = document.getElementById("engravingPhotoText");
    const removeButton = document.getElementById("engravingPhotoRemove");

    if (previewSrc) {
        preview.src = previewSrc;
        preview.classList.remove("hidden");
        text.classList.add("hidden");
        removeButton.classList.remove("hidden");
    } else {
        preview.src = "";
        preview.classList.add("hidden");
        text.classList.remove("hidden");
        removeButton.classList.add("hidden");
    }

}


async function uploadEngravingPhoto(file) {

    const errorEl = document.getElementById("engravingPhotoError");
    const text = document.getElementById("engravingPhotoText");

    errorEl.textContent = "";

    if (!file) {
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        errorEl.textContent = "That photo is too large. Please use one under 10 MB.";
        return;
    }

    engravingPhotoUploading = true;
    engravingPhotoPath = null;
    productAddToCartButton.disabled = true;
    showEngravingPhoto(null);
    text.textContent = "Uploading your photo…";

    try {

        const response = await fetch("/api/engraving-photos", {
            method: "POST",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not upload your photo.");
        }

        engravingPhotoPath = data.path;
        showEngravingPhoto(URL.createObjectURL(file));

    } catch (err) {
        errorEl.textContent = err.message || "Could not upload your photo. Please try again.";
    } finally {
        engravingPhotoUploading = false;
        text.textContent = "Add a photo of a loved one, a pet, a favorite place, or anything you'd like engraved";
        productAddToCartButton.disabled = getEffectiveStock() <= 0;
        updatePriceDisplay();
    }

}


/* =========================================
   INITIALIZE
========================================= */

async function initProduct() {

    await initShared();

    engravingTextInput.addEventListener("input", updatePriceDisplay);

    giftMessageCheckbox.addEventListener("change", event => {
        giftMessageContainer.classList.toggle("visible", event.target.checked);
    });

    productAddToCartButton.addEventListener("click", handleAddToCart);

    await loadProduct();

}


initProduct();