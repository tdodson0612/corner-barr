// /corner-barr/js/partials.js
//
// Every page shares the same header, cart drawer, checkout modal, account
// modal, admin modal, and footer. Rather than copy-pasting that markup into
// three separate HTML files (and having to edit it three places every time
// something changes), each page has an empty placeholder div, and this file
// fetches the real markup and drops it in before anything else runs.

async function loadPartial(url, placeholderId) {

    const placeholder = document.getElementById(placeholderId);

    if (!placeholder) {
        return;
    }

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Could not load ${url}`);
    }

    const html = await response.text();

    // Replace the placeholder entirely with the real markup, so the actual
    // <header>/<footer>/etc. tags end up as direct children of <body> —
    // not wrapped in an extra <div>, which would break some of the CSS.
    placeholder.outerHTML = html;

}

async function loadPartials() {

    await Promise.all([
        loadPartial("partials/header.html", "header-slot"),
        loadPartial("partials/cart-drawer.html", "cart-drawer-slot"),
        loadPartial("partials/checkout-modal.html", "checkout-modal-slot"),
        loadPartial("partials/account-modal.html", "account-modal-slot"),
        loadPartial("partials/admin-modal.html", "admin-modal-slot"),
        loadPartial("partials/footer.html", "footer-slot")
    ]);

}
