// /corner-barr/js/app.js


/* =========================================
   CUTTING BOARD PRODUCTS
========================================= */

const cuttingBoards = [

    {
        id: "classic",
        name: "Classic Serving Board",
        category: "Cutting Board",
        description:
            "A beautiful everyday board for chopping, serving, and displaying.",
        price: 49,
        boardClass: "board-classic"
    },

    {
        id: "paddle",
        name: "Mountain Paddle Board",
        category: "Signature Board",
        description:
            "A rustic paddle-style board inspired by the mountains.",
        price: 59,
        boardClass: "board-paddle"
    },

    {
        id: "dark",
        name: "Rustic Walnut Board",
        category: "Premium Board",
        description:
            "A darker, richer board made for a statement piece.",
        price: 69,
        boardClass: "board-dark"
    },

    {
        id: "serving",
        name: "Family Serving Board",
        category: "Serving Board",
        description:
            "A generous board made for family dinners and gatherings.",
        price: 74,
        boardClass: "board-serving"
    }

];


/* =========================================
   SOAP & CANDLE PRODUCTS
========================================= */

const soapCandles = [

    {
        id: "soap",
        name: "Handmade Country Soap",
        category: "Handmade Soap",
        description:
            "A simple handmade soap with a warm, rustic feel.",
        price: 9,
        productClass: "soap-object"
    },

    {
        id: "candle",
        name: "Southern Oregon Candle",
        category: "Handmade Candle",
        description:
            "A warm-scented candle made to bring a little comfort home.",
        price: 18,
        productClass: "candle-object"
    },

    {
        id: "soap-set",
        name: "Soap Gift Set",
        category: "Gift Set",
        description:
            "A thoughtful collection of handmade soaps ready for gifting.",
        price: 24,
        productClass: "soap-object"
    },

    {
        id: "candle-large",
        name: "Rustic Farmhouse Candle",
        category: "Handmade Candle",
        description:
            "A larger candle with a cozy farmhouse-inspired feel.",
        price: 28,
        productClass: "candle-object"
    }

];


/* =========================================
   HOLIDAY PRODUCTS
========================================= */

const holidayProducts = [

    {
        id: "holiday-gift",
        name: "Holiday Gift Box",
        category: "Holiday Gift",
        description:
            "A special seasonal gift box filled with handmade surprises.",
        price: 39,
        holidayText: "GIFT"
    },

    {
        id: "christmas-keepsake",
        name: "Christmas Keepsake",
        category: "Christmas",
        description:
            "A personalized keepsake made to become part of your holiday traditions.",
        price: 24,
        holidayText: "JOY"
    },

    {
        id: "holiday-candle",
        name: "Holiday Candle",
        category: "Seasonal Candle",
        description:
            "A cozy seasonal candle perfect for chilly evenings and holiday gatherings.",
        price: 22,
        holidayText: "NOEL"
    },

    {
        id: "holiday-basket",
        name: "Holiday Gift Basket",
        category: "Gift Basket",
        description:
            "A rustic handmade gift basket assembled with the holidays in mind.",
        price: 55,
        holidayText: "LOVE"
    }

];


/* =========================================
   ALL CUTTING BOARD PRODUCTS
========================================= */

const products = cuttingBoards;


/* =========================================
   CUSTOMIZATION OPTIONS
========================================= */

const woodOptions = [

    {
        id: "natural",
        name: "Natural",
        extra: 0
    },

    {
        id: "walnut",
        name: "Walnut",
        extra: 12
    },

    {
        id: "mixed",
        name: "Mixed Wood",
        extra: 18
    }

];


const engravingStyles = [

    {
        id: "classic",
        name: "Classic",
        extra: 0
    },

    {
        id: "script",
        name: "Script",
        extra: 5
    },

    {
        id: "bold",
        name: "Bold",
        extra: 5
    }

];


/* =========================================
   APPLICATION STATE
========================================= */

let cart = [];


let customization = {

    boardId:
        products[0].id,

    woodId:
        woodOptions[0].id,

    engravingStyleId:
        engravingStyles[0].id,

    engravingText:
        "",

    giftMessage:
        false,

    giftMessageText:
        ""

};


/* =========================================
   DOM ELEMENTS
========================================= */

const cuttingBoardGrid =
    document.getElementById(
        "cuttingBoardGrid"
    );

const soapCandleGrid =
    document.getElementById(
        "soapCandleGrid"
    );

const holidayGrid =
    document.getElementById(
        "holidayGrid"
    );

const boardSelect =
    document.getElementById(
        "boardSelect"
    );

const woodOptionsContainer =
    document.getElementById(
        "woodOptions"
    );

const styleOptionsContainer =
    document.getElementById(
        "styleOptions"
    );

const engravingTextInput =
    document.getElementById(
        "engravingText"
    );

const giftMessageCheckbox =
    document.getElementById(
        "giftMessage"
    );

const giftMessageContainer =
    document.getElementById(
        "giftMessageContainer"
    );

const giftMessageText =
    document.getElementById(
        "giftMessageText"
    );

const previewEngraving =
    document.getElementById(
        "previewEngraving"
    );

const builderPrice =
    document.getElementById(
        "builderPrice"
    );

const cartButton =
    document.getElementById(
        "cartButton"
    );

const cartDrawer =
    document.getElementById(
        "cartDrawer"
    );

const cartOverlay =
    document.getElementById(
        "cartOverlay"
    );

const closeCartButton =
    document.getElementById(
        "closeCart"
    );

const cartItemsContainer =
    document.getElementById(
        "cartItems"
    );

const cartTotal =
    document.getElementById(
        "cartTotal"
    );

const cartCount =
    document.getElementById(
        "cartCount"
    );

const addCustomButton =
    document.getElementById(
        "addCustomButton"
    );

const checkoutButton =
    document.getElementById(
        "checkoutButton"
    );

const checkoutModal =
    document.getElementById(
        "checkoutModal"
    );

const closeCheckoutButton =
    document.getElementById(
        "closeCheckout"
    );

const checkoutTotal =
    document.getElementById(
        "checkoutTotal"
    );

const checkoutForm =
    document.getElementById(
        "checkoutForm"
    );


/* =========================================
   MONEY
========================================= */

function money(value) {

    return new Intl.NumberFormat(
        "en-US",
        {
            style: "currency",
            currency: "USD"
        }
    ).format(value);

}


/* =========================================
   LOCAL STORAGE
========================================= */

function loadCart() {

    const savedCart =
        localStorage.getItem(
            "cornerBarrCart"
        );

    if (!savedCart) {
        return;
    }

    try {

        cart =
            JSON.parse(
                savedCart
            );

    } catch (error) {

        console.error(
            "Could not load saved cart.",
            error
        );

        cart = [];

    }

}


function saveCart() {

    localStorage.setItem(
        "cornerBarrCart",
        JSON.stringify(cart)
    );

}


/* =========================================
   CUTTING BOARD PRODUCTS
========================================= */

function renderCuttingBoards() {

    cuttingBoardGrid.innerHTML = "";

    cuttingBoards.forEach(
        product => {

            const card =
                document.createElement(
                    "article"
                );

            card.className =
                "product-card";

            card.innerHTML = `

                <div class="product-image cutting-board-image">

                    <div
                        class="board-shape ${product.boardClass}"
                    >

                        <div class="board-engraving">
                            CORNER BARR
                        </div>

                    </div>

                </div>


                <div class="product-info">

                    <div class="product-category">
                        ${product.category}
                    </div>

                    <h3 class="product-name">
                        ${product.name}
                    </h3>

                    <p class="product-description">
                        ${product.description}
                    </p>

                    <div class="product-bottom">

                        <span class="product-price">
                            ${money(product.price)}
                        </span>

                        <button
                            class="small-button"
                            type="button"
                            data-customize="${product.id}"
                        >
                            Customize
                        </button>

                    </div>

                </div>

            `;

            cuttingBoardGrid.appendChild(
                card
            );

        }
    );


    document
        .querySelectorAll(
            "[data-customize]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        selectBoard(
                            button.dataset.customize
                        );

                        document
                            .getElementById(
                                "custom"
                            )
                            .scrollIntoView({
                                behavior:
                                    "smooth"
                            });

                    }
                );

            }
        );

}


/* =========================================
   SOAP & CANDLES
========================================= */

function renderSoapCandles() {

    soapCandleGrid.innerHTML = "";

    soapCandles.forEach(
        product => {

            const card =
                document.createElement(
                    "article"
                );

            card.className =
                "product-card";

            card.innerHTML = `

                <div class="product-image soap-candle-image">

                    <div
                        class="product-object ${product.productClass}"
                    ></div>

                </div>


                <div class="product-info">

                    <div class="product-category">
                        ${product.category}
                    </div>

                    <h3 class="product-name">
                        ${product.name}
                    </h3>

                    <p class="product-description">
                        ${product.description}
                    </p>

                    <div class="product-bottom">

                        <span class="product-price">
                            ${money(product.price)}
                        </span>

                        <button
                            class="small-button"
                            type="button"
                            data-product="${product.id}"
                            data-category="soap"
                        >
                            Add to Cart
                        </button>

                    </div>

                </div>

            `;

            soapCandleGrid.appendChild(
                card
            );

        }
    );


    document
        .querySelectorAll(
            '[data-category="soap"]'
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        const product =
                            soapCandles.find(
                                item =>
                                    item.id ===
                                    button.dataset.product
                            );

                        if (!product) {
                            return;
                        }

                        addStandardProductToCart(
                            product
                        );

                    }
                );

            }
        );

}


/* =========================================
   HOLIDAY PRODUCTS
========================================= */

function renderHolidayProducts() {

    holidayGrid.innerHTML = "";

    holidayProducts.forEach(
        product => {

            const card =
                document.createElement(
                    "article"
                );

            card.className =
                "product-card";

            card.innerHTML = `

                <div class="product-image holiday-image">

                    <div class="holiday-object">

                        ${product.holidayText}

                    </div>

                </div>


                <div class="product-info">

                    <div class="product-category">
                        ${product.category}
                    </div>

                    <h3 class="product-name">
                        ${product.name}
                    </h3>

                    <p class="product-description">
                        ${product.description}
                    </p>

                    <div class="product-bottom">

                        <span class="product-price">
                            ${money(product.price)}
                        </span>

                        <button
                            class="small-button"
                            type="button"
                            data-product="${product.id}"
                            data-category="holiday"
                        >
                            Add to Cart
                        </button>

                    </div>

                </div>

            `;

            holidayGrid.appendChild(
                card
            );

        }
    );


    document
        .querySelectorAll(
            '[data-category="holiday"]'
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        const product =
                            holidayProducts.find(
                                item =>
                                    item.id ===
                                    button.dataset.product
                            );

                        if (!product) {
                            return;
                        }

                        addStandardProductToCart(
                            product
                        );

                    }
                );

            }
        );

}


/* =========================================
   STANDARD PRODUCT CART
========================================= */

function addStandardProductToCart(
    product
) {

    const item = {

        id:
            Date.now().toString(),

        productId:
            product.id,

        name:
            product.name,

        price:
            product.price,

        quantity:
            1,

        engraving:
            "",

        wood:
            "",

        style:
            "",

        giftMessage:
            ""

    };


    cart.push(item);

    saveCart();

    renderCart();

    openCart();

}


/* =========================================
   CUSTOM BUILDER
========================================= */

function renderBoardSelect() {

    boardSelect.innerHTML = "";

    products.forEach(
        product => {

            const option =
                document.createElement(
                    "option"
                );

            option.value =
                product.id;

            option.textContent =
                `${product.name} — ${money(product.price)}`;

            boardSelect.appendChild(
                option
            );

        }
    );

    boardSelect.value =
        customization.boardId;

}


function renderWoodOptions() {

    woodOptionsContainer.innerHTML = "";

    woodOptions.forEach(
        wood => {

            const button =
                document.createElement(
                    "button"
                );

            button.type =
                "button";

            button.className =
                "wood-option";

            if (
                wood.id ===
                customization.woodId
            ) {

                button.classList.add(
                    "active"
                );

            }

            button.textContent =
                `${wood.name}${
                    wood.extra
                        ? ` +${money(wood.extra)}`
                        : ""
                }`;


            button.addEventListener(
                "click",
                () => {

                    customization.woodId =
                        wood.id;

                    renderWoodOptions();

                    updateBuilder();

                }
            );


            woodOptionsContainer.appendChild(
                button
            );

        }
    );

}


function renderStyleOptions() {

    styleOptionsContainer.innerHTML = "";

    engravingStyles.forEach(
        style => {

            const button =
                document.createElement(
                    "button"
                );

            button.type =
                "button";

            button.className =
                "style-option";


            if (
                style.id ===
                customization.engravingStyleId
            ) {

                button.classList.add(
                    "active"
                );

            }


            button.textContent =
                `${style.name}${
                    style.extra
                        ? ` +${money(style.extra)}`
                        : ""
                }`;


            button.addEventListener(
                "click",
                () => {

                    customization.engravingStyleId =
                        style.id;

                    renderStyleOptions();

                    updateBuilder();

                }
            );


            styleOptionsContainer.appendChild(
                button
            );

        }
    );

}


function selectBoard(
    productId
) {

    const product =
        products.find(
            item =>
                item.id ===
                productId
        );

    if (!product) {
        return;
    }

    customization.boardId =
        productId;

    boardSelect.value =
        productId;

    updateBuilder();

}


function getCustomizationPrice() {

    const product =
        products.find(
            item =>
                item.id ===
                customization.boardId
        );

    const wood =
        woodOptions.find(
            item =>
                item.id ===
                customization.woodId
        );

    const style =
        engravingStyles.find(
            item =>
                item.id ===
                customization.engravingStyleId
        );

    if (!product) {
        return 0;
    }

    return (

        product.price +

        (wood
            ? wood.extra
            : 0) +

        (style
            ? style.extra
            : 0)

    );

}


function updateBuilder() {

    const price =
        getCustomizationPrice();

    builderPrice.textContent =
        money(price);


    const text =
        customization.engravingText.trim();

    previewEngraving.textContent =
        text ||
        "YOUR NAME";


    previewEngraving.style.fontStyle =
        customization.engravingStyleId ===
        "script"
            ? "italic"
            : "normal";


    previewEngraving.style.fontWeight =
        customization.engravingStyleId ===
        "bold"
            ? "800"
            : "700";

}


/* =========================================
   CUSTOM PRODUCT CART
========================================= */

function addCustomProductToCart() {

    const product =
        products.find(
            item =>
                item.id ===
                customization.boardId
        );

    const wood =
        woodOptions.find(
            item =>
                item.id ===
                customization.woodId
        );

    const style =
        engravingStyles.find(
            item =>
                item.id ===
                customization.engravingStyleId
        );

    if (!product) {
        return;
    }


    const item = {

        id:
            Date.now().toString(),

        productId:
            product.id,

        name:
            product.name,

        price:
            getCustomizationPrice(),

        quantity:
            1,

        engraving:
            customization
                .engravingText
                .trim(),

        wood:
            wood
                ? wood.name
                : "",

        style:
            style
                ? style.name
                : "",

        giftMessage:
            customization.giftMessage
                ? customization
                    .giftMessageText
                    .trim()
                : ""

    };


    cart.push(item);

    saveCart();

    renderCart();

    openCart();

}


/* =========================================
   CART RENDERING
========================================= */

function renderCart() {

    cartItemsContainer.innerHTML =
        "";


    if (
        cart.length ===
        0
    ) {

        cartItemsContainer.innerHTML = `

            <div class="empty-cart">

                Your cart is empty.

                <br><br>

                Choose something handmade
                and make it yours.

            </div>

        `;


        cartTotal.textContent =
            money(0);

        cartCount.textContent =
            "0";

        checkoutButton.disabled =
            true;

        checkoutButton.style.opacity =
            "0.5";

        return;

    }


    checkoutButton.disabled =
        false;

    checkoutButton.style.opacity =
        "1";


    let total =
        0;

    let quantity =
        0;


    cart.forEach(
        item => {

            total +=
                item.price *
                item.quantity;

            quantity +=
                item.quantity;


            const element =
                document.createElement(
                    "div"
                );

            element.className =
                "cart-item";


            const engraving =
                item.engraving
                    ? `Engraving: ${escapeHtml(item.engraving)}`
                    : "No engraving";


            const details = [

                item.wood,

                item.style,

                engraving

            ]
                .filter(Boolean)
                .map(
                    escapeHtml
                )
                .join("<br>");


            const gift =
                item.giftMessage
                    ? "<br>Gift message included"
                    : "";


            element.innerHTML = `

                <div class="cart-item-image"></div>


                <div>

                    <div class="cart-item-name">
                        ${escapeHtml(item.name)}
                    </div>


                    <div class="cart-item-details">

                        ${details}

                        ${gift}

                    </div>


                    <div class="quantity-controls">

                        <button
                            type="button"
                            data-minus="${item.id}"
                        >
                            −
                        </button>

                        <span>
                            ${item.quantity}
                        </span>

                        <button
                            type="button"
                            data-plus="${item.id}"
                        >
                            +
                        </button>

                    </div>


                    <button
                        class="remove-item"
                        type="button"
                        data-remove="${item.id}"
                    >
                        Remove
                    </button>

                </div>


                <div class="cart-item-price">

                    ${money(
                        item.price *
                        item.quantity
                    )}

                </div>

            `;


            cartItemsContainer.appendChild(
                element
            );

        }
    );


    cartTotal.textContent =
        money(total);

    cartCount.textContent =
        quantity.toString();


    attachCartEvents();

}


/* =========================================
   CART EVENTS
========================================= */

function attachCartEvents() {

    document
        .querySelectorAll(
            "[data-minus]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        changeQuantity(
                            button.dataset.minus,
                            -1
                        );

                    }
                );

            }
        );


    document
        .querySelectorAll(
            "[data-plus]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        changeQuantity(
                            button.dataset.plus,
                            1
                        );

                    }
                );

            }
        );


    document
        .querySelectorAll(
            "[data-remove]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        removeCartItem(
                            button.dataset.remove
                        );

                    }
                );

            }
        );

}


function changeQuantity(
    itemId,
    amount
) {

    const item =
        cart.find(
            cartItem =>
                cartItem.id ===
                itemId
        );

    if (!item) {
        return;
    }

    item.quantity +=
        amount;


    if (
        item.quantity <=
        0
    ) {

        cart =
            cart.filter(
                cartItem =>
                    cartItem.id !==
                    itemId
            );

    }


    saveCart();

    renderCart();

}


function removeCartItem(
    itemId
) {

    cart =
        cart.filter(
            item =>
                item.id !==
                itemId
        );

    saveCart();

    renderCart();

}


/* =========================================
   CART DRAWER
========================================= */

function openCart() {

    cartDrawer.classList.add(
        "open"
    );

    cartOverlay.classList.add(
        "open"
    );

    document.body.style.overflow =
        "hidden";

}


function closeCart() {

    cartDrawer.classList.remove(
        "open"
    );

    cartOverlay.classList.remove(
        "open"
    );

    document.body.style.overflow =
        "";

}


/* =========================================
   CHECKOUT
========================================= */

function openCheckout() {

    if (
        cart.length ===
        0
    ) {

        return;

    }


    const total =
        cart.reduce(
            (
                sum,
                item
            ) =>
                sum +
                item.price *
                item.quantity,

            0
        );


    checkoutTotal.textContent =
        money(total);


    checkoutModal.classList.add(
        "open"
    );

}


function closeCheckout() {

    checkoutModal.classList.remove(
        "open"
    );

}


/* =========================================
   SECURITY HELPER
========================================= */

function escapeHtml(
    value
) {

    return String(value)

        .replaceAll(
            "&",
            "&amp;"
        )

        .replaceAll(
            "<",
            "&lt;"
        )

        .replaceAll(
            ">",
            "&gt;"
        )

        .replaceAll(
            '"',
            "&quot;"
        )

        .replaceAll(
            "'",
            "&#039;"
        );

}


/* =========================================
   EVENT LISTENERS
========================================= */

boardSelect.addEventListener(
    "change",
    event => {

        customization.boardId =
            event.target.value;

        updateBuilder();

    }
);


engravingTextInput.addEventListener(
    "input",
    event => {

        customization.engravingText =
            event.target.value;

        updateBuilder();

    }
);


giftMessageCheckbox.addEventListener(
    "change",
    event => {

        customization.giftMessage =
            event.target.checked;

        giftMessageContainer.classList.toggle(
            "visible",
            event.target.checked
        );

    }
);


giftMessageText.addEventListener(
    "input",
    event => {

        customization.giftMessageText =
            event.target.value;

    }
);


addCustomButton.addEventListener(
    "click",
    addCustomProductToCart
);


cartButton.addEventListener(
    "click",
    openCart
);


closeCartButton.addEventListener(
    "click",
    closeCart
);


cartOverlay.addEventListener(
    "click",
    closeCart
);


checkoutButton.addEventListener(
    "click",
    openCheckout
);


closeCheckoutButton.addEventListener(
    "click",
    closeCheckout
);


checkoutModal.addEventListener(
    "click",
    event => {

        if (
            event.target ===
            checkoutModal
        ) {

            closeCheckout();

        }

    }
);


checkoutForm.addEventListener(
    "submit",
    event => {

        event.preventDefault();

        alert(
            "Your order information was received by the demo storefront. Real online payment still needs to be connected."
        );

    }
);


/* =========================================
   INITIALIZE
========================================= */

function initialize() {

    loadCart();

    renderCuttingBoards();

    renderSoapCandles();

    renderHolidayProducts();

    renderBoardSelect();

    renderWoodOptions();

    renderStyleOptions();

    renderCart();

    updateBuilder();


    document.getElementById(
        "currentYear"
    ).textContent =
        new Date().getFullYear();

}


initialize();