// data/labels.js
//
// Shipping labels through Shippo (owner only).
//
// Three routes, all behind requireOwner:
//   POST /api/admin/orders/:id/label-rates  -> get prices for a package
//   POST /api/admin/orders/:id/label        -> buy one of those prices
//   GET  /api/admin/orders/:id/labels       -> list labels already bought
//
// Labels are saved in the private "order_labels" table (RLS on, no
// policies), so customers can never see label links or postage costs.
// Buying a label fills in the order's carrier + tracking number, but
// NEVER changes the order's status. Ashley marks it Shipped herself.

const SHIPPO_API_BASE = "https://api.goshippo.com";

// Only these carriers are offered. They match the "Track your order"
// links already built into shared.js.
const ALLOWED_PROVIDERS = ["usps", "ups", "fedex"];

// Return address printed on every label. This is the SHOP address.
// It must never be changed to Ashley's home address.
function shipFromAddress() {
    const address = {
        name: "Corner Barr",
        company: "Corner Barr, LLC",
        street1: "211 N Front St",
        city: "Central Point",
        state: "OR",
        zip: "97502",
        country: "US",
        email: "Ashley@cornerbarr.com"
    };
    if (process.env.SHIP_FROM_PHONE) {
        address.phone = process.env.SHIP_FROM_PHONE;
    }
    return address;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_ID_PATTERN = /^[A-Za-z0-9]{10,64}$/;

class LabelError extends Error {
    constructor(message, status, code) {
        super(message);
        this.status = status || 400;
        this.code = code || null;
    }
}

// Tags every Shippo shipment with its order, so a price from one order
// can never be used to buy a label for a different order.
function metadataFor(orderId) {
    return `corner-barr-order:${orderId}`;
}

function messagesText(messages) {
    if (!Array.isArray(messages)) {
        return "";
    }
    return messages
        .map(m => (m && typeof m.text === "string" ? m.text.trim() : ""))
        .filter(Boolean)
        .join(" ");
}

async function shippoRequest(method, path, body) {

    const apiKey = process.env.SHIPPO_API_KEY;

    if (!apiKey) {
        throw new LabelError("Shipping labels aren't set up yet (SHIPPO_API_KEY is missing).", 503);
    }

    const response = await fetch(`${SHIPPO_API_BASE}${path}`, {
        method,
        headers: {
            Authorization: `ShippoToken ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
    });

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        console.error(`Shippo ${method} ${path} failed:`, response.status, data);
        throw new LabelError("The shipping service returned an error. Please try again.", 502);
    }

    return data;

}

// Turns Ashley's typed-in weight and box size into a Shippo parcel.
function parsePackage(body) {

    const pounds = Number(body.weight_lb || 0);
    const ounces = Number(body.weight_oz || 0);
    const length = Number(body.length);
    const width = Number(body.width);
    const height = Number(body.height);

    if (![pounds, ounces, length, width, height].every(Number.isFinite) || pounds < 0 || ounces < 0) {
        throw new LabelError("Enter the weight and all three box measurements as numbers.", 400);
    }

    const totalOunces = Math.round((pounds * 16 + ounces) * 100) / 100;

    if (totalOunces <= 0) {
        throw new LabelError("Enter the package weight.", 400);
    }

    if (totalOunces > 70 * 16) {
        throw new LabelError("Packages over 70 lb can't be shipped this way.", 400);
    }

    for (const size of [length, width, height]) {
        if (size <= 0 || size > 108) {
            throw new LabelError("Each box measurement must be between 0 and 108 inches.", 400);
        }
    }

    return {
        length: String(length),
        width: String(width),
        height: String(height),
        distance_unit: "in",
        weight: String(totalOunces),
        mass_unit: "oz"
    };

}

async function loadOrder(supabaseAdmin, orderId) {

    if (!UUID_PATTERN.test(String(orderId || ""))) {
        throw new LabelError("Order not found.", 404);
    }

    const { data, error } = await supabaseAdmin
        .from("orders")
        .select("id, customer_name, customer_email, customer_phone, customer_address1, customer_address2, customer_city, customer_state, customer_zip, shipping_status")
        .eq("id", orderId)
        .maybeSingle();

    if (error) {
        console.error("Could not load order for label:", error);
        throw new LabelError("Could not load this order.", 502);
    }

    if (!data) {
        throw new LabelError("Order not found.", 404);
    }

    if (data.shipping_status === "canceled") {
        throw new LabelError("This order is canceled, so it can't get a label.", 400);
    }

    if (!data.customer_address1 || !data.customer_city || !data.customer_state || !data.customer_zip) {
        throw new LabelError("This order doesn't have a complete shipping address.", 400);
    }

    return data;

}

function sendError(res, err, fallbackMessage) {
    if (err instanceof LabelError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error(fallbackMessage, err);
    return res.status(500).json({ error: fallbackMessage });
}

module.exports = function registerLabelRoutes(app, { requireOwner, supabaseAdmin }) {

    // 1) Get prices for a package.
    app.post("/api/admin/orders/:id/label-rates", requireOwner, async (req, res) => {

        try {

            const order = await loadOrder(supabaseAdmin, req.params.id);
            const parcel = parsePackage(req.body || {});

            const shipment = await shippoRequest("POST", "/shipments/", {
                address_from: shipFromAddress(),
                address_to: {
                    name: order.customer_name || "Customer",
                    street1: order.customer_address1,
                    street2: order.customer_address2 || "",
                    city: order.customer_city,
                    state: order.customer_state,
                    zip: order.customer_zip,
                    country: "US",
                    phone: order.customer_phone || "",
                    email: order.customer_email || ""
                },
                parcels: [parcel],
                async: false,
                metadata: metadataFor(order.id)
            });

            const rates = (shipment.rates || [])
                .filter(rate => ALLOWED_PROVIDERS.includes(String(rate.provider || "").toLowerCase()))
                .map(rate => ({
                    rate_id: rate.object_id,
                    provider: rate.provider,
                    service: rate.servicelevel?.name || "",
                    amount: rate.amount,
                    currency: rate.currency,
                    estimated_days: rate.estimated_days ?? null
                }))
                .sort((a, b) => Number(a.amount) - Number(b.amount));

            if (rates.length === 0) {
                const detail = messagesText(shipment.messages);
                throw new LabelError(
                    "No shipping options were found. Double-check the address and package size." + (detail ? ` (${detail})` : ""),
                    422
                );
            }

            res.json({ rates });

        } catch (err) {
            sendError(res, err, "Could not get shipping prices.");
        }

    });

    // 2) Buy a label. After Shippo says SUCCESS, money has been spent,
    //    so from that point on this route never fails. It always hands
    //    the label back, plus warnings if anything couldn't be saved.
    app.post("/api/admin/orders/:id/label", requireOwner, async (req, res) => {

        try {

            const order = await loadOrder(supabaseAdmin, req.params.id);

            const rateId = typeof req.body?.rate_id === "string" ? req.body.rate_id.trim() : "";

            if (!RATE_ID_PATTERN.test(rateId)) {
                throw new LabelError("Pick a shipping option first.", 400);
            }

            // Block accidental second labels unless Ashley confirmed it.
            const { data: existing, error: existingError } = await supabaseAdmin
                .from("order_labels")
                .select("id")
                .eq("order_id", order.id)
                .limit(1);

            if (existingError) {
                console.error("Could not check existing labels:", existingError);
                throw new LabelError("Could not check whether this order already has a label.", 502);
            }

            if (existing.length > 0 && req.body.allow_another !== true) {
                throw new LabelError("This order already has a label.", 409, "HAS_LABEL");
            }

            // Make sure this price really came from THIS order.
            const rate = await shippoRequest("GET", `/rates/${rateId}`);

            if (!ALLOWED_PROVIDERS.includes(String(rate?.provider || "").toLowerCase())) {
                throw new LabelError("That carrier isn't allowed.", 400);
            }

            const shipmentId = typeof rate.shipment === "string" ? rate.shipment : "";

            if (!RATE_ID_PATTERN.test(shipmentId)) {
                throw new LabelError("Couldn't confirm that price. Please get prices again.", 400);
            }

            const shipment = await shippoRequest("GET", `/shipments/${shipmentId}`);

            if (shipment?.metadata !== metadataFor(order.id)) {
                throw new LabelError("That price belongs to a different order. Please get prices again.", 400);
            }

            const transaction = await shippoRequest("POST", "/transactions/", {
                rate: rateId,
                label_file_type: "PDF",
                async: false,
                metadata: metadataFor(order.id)
            });

            if (transaction?.status !== "SUCCESS") {
                const detail = messagesText(transaction?.messages);
                throw new LabelError("The label could not be created." + (detail ? ` (${detail})` : ""), 422);
            }

            // ---- Money has been spent. Never throw past this line. ----

            const label = {
                carrier: rate.provider,
                service: rate.servicelevel?.name || "",
                tracking_number: transaction.tracking_number || "",
                label_url: transaction.label_url || "",
                cost: Number(rate.amount)
            };

            const warnings = [];

            const { error: insertError } = await supabaseAdmin
                .from("order_labels")
                .insert({
                    order_id: order.id,
                    shippo_transaction_id: transaction.object_id,
                    ...label
                });

            if (insertError) {
                console.error("LABEL PURCHASED BUT NOT SAVED:", {
                    orderId: order.id,
                    shippoTransactionId: transaction.object_id,
                    trackingNumber: label.tracking_number,
                    labelUrl: label.label_url
                }, insertError);
                warnings.push("The label was bought, but the site couldn't save a copy of it. Print it now. It won't be listed on this order later.");
            }

            const { error: updateError } = await supabaseAdmin
                .from("orders")
                .update({ carrier: label.carrier, tracking_number: label.tracking_number })
                .eq("id", order.id);

            if (updateError) {
                console.error("Label bought but order tracking not updated:", order.id, updateError);
                warnings.push(`Type this tracking number into the order yourself: ${label.tracking_number}`);
            }

            res.json({ label, warnings });

        } catch (err) {
            sendError(res, err, "Could not buy this label.");
        }

    });

    // 3) Labels already bought for an order (for reprinting).
    app.get("/api/admin/orders/:id/labels", requireOwner, async (req, res) => {

        if (!UUID_PATTERN.test(String(req.params.id || ""))) {
            return res.status(404).json({ error: "Order not found." });
        }

        const { data, error } = await supabaseAdmin
            .from("order_labels")
            .select("carrier, service, tracking_number, label_url, cost, created_at")
            .eq("order_id", req.params.id)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Could not load labels:", error);
            return res.status(502).json({ error: "Could not load labels." });
        }

        res.json(data);

    });

};