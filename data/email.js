// data/email.js
//
// Order emails, sent through Resend (resend.com). Turned OFF until
// RESEND_API_KEY is set on Render, so this file is harmless until then.
//
//   - Ashley gets an email for every new order.
//   - Customers (including guests) get an order confirmation, and a
//     "your order shipped" email with a tracking link.
//
// An email problem never stops an order or a save: every send is
// wrapped so failures are only logged.

const RESEND_API_KEY = process.env.RESEND_API_KEY || null;
const EMAIL_FROM = process.env.EMAIL_FROM || "Corner Barr <orders@cornerbarr.com>";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "Ashley@cornerbarr.com";
const SITE_URL = "https://cornerbarr.com";

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function money(value) {
    return `$${Number(value || 0).toFixed(2)}`;
}

function looksLikeEmail(value) {
    return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function trackingUrl(carrier, trackingNumber) {

    if (!carrier || !trackingNumber) {
        return null;
    }

    const c = String(carrier).toLowerCase();
    const t = encodeURIComponent(String(trackingNumber).trim());

    if (c.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`;
    if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${t}`;
    if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${t}`;

    return null;

}

function itemsHtml(order) {

    return (order.items || []).map(item => {

        const extras = [];

        if (item.engraving) extras.push(`Engraving: "${escapeHtml(item.engraving)}"`);
        if (item.engravingStyle) extras.push(`Style: ${escapeHtml(item.engravingStyle)}`);
        if (item.engravingPhotoPath) extras.push("Photo engraving included");
        if (item.giftMessage) extras.push(`Gift message: "${escapeHtml(item.giftMessage)}"`);

        return `
            <tr>
                <td style="padding:6px 0;">
                    ${escapeHtml(item.quantity)}× ${escapeHtml(item.name)}
                    ${extras.length ? `<br><span style="color:#666;font-size:13px;">${extras.join("<br>")}</span>` : ""}
                </td>
                <td style="padding:6px 0;text-align:right;vertical-align:top;">${money(item.lineTotal)}</td>
            </tr>
        `;

    }).join("");

}

function totalsHtml(order) {

    const shipping = Number(order.shipping_cost || 0);
    const total = Number(order.subtotal || 0) + shipping;

    return `
        <tr><td style="padding-top:10px;border-top:1px solid #ddd;">Subtotal</td><td style="padding-top:10px;border-top:1px solid #ddd;text-align:right;">${money(order.subtotal)}</td></tr>
        <tr><td>Shipping${order.shipping_method_name ? ` (${escapeHtml(order.shipping_method_name)})` : ""}</td><td style="text-align:right;">${money(shipping)}</td></tr>
        <tr><td><strong>Total</strong></td><td style="text-align:right;"><strong>${money(total)}</strong></td></tr>
    `;

}

function addressHtml(order) {

    const lines = [
        order.customer_name,
        order.customer_address1,
        order.customer_address2,
        [order.customer_city, order.customer_state, order.customer_zip].filter(Boolean).join(", ")
    ].filter(Boolean);

    return lines.map(escapeHtml).join("<br>");

}

function layout(title, bodyHtml) {

    return `
        <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#222;">
            <h1 style="font-size:22px;letter-spacing:2px;margin-bottom:4px;">CORNER BARR</h1>
            <p style="margin-top:0;color:#666;font-size:13px;">Custom Made Gifts · Southern Oregon</p>
            <h2 style="font-size:18px;">${escapeHtml(title)}</h2>
            ${bodyHtml}
            <p style="color:#666;font-size:13px;margin-top:30px;">
                Questions? Just reply to this email.<br>
                <a href="${SITE_URL}" style="color:#2f4a36;">cornerbarr.com</a>
            </p>
        </div>
    `;

}

async function sendEmail({ to, subject, html }) {

    if (!RESEND_API_KEY) {
        return; // Email not set up yet.
    }

    if (!looksLikeEmail(to)) {
        return;
    }

    try {

        const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${RESEND_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                from: EMAIL_FROM,
                to: [to.trim()],
                reply_to: OWNER_EMAIL,
                subject,
                html
            }),
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`Email "${subject}" to ${to} failed:`, response.status, text);
        }

    } catch (err) {
        console.error(`Email "${subject}" to ${to} failed:`, err);
    }

}

async function emailOwnerNewOrder(order) {

    const html = layout(`New order from ${order.customer_name || order.customer_email || "a customer"}`, `
        <table style="width:100%;border-collapse:collapse;font-size:15px;">${itemsHtml(order)}${totalsHtml(order)}</table>
        <h3 style="font-size:15px;margin-top:20px;">Ship to</h3>
        <p>${addressHtml(order)}</p>
        ${order.customer_phone ? `<p>Phone: ${escapeHtml(order.customer_phone)}</p>` : ""}
        ${order.customer_email ? `<p>Email: ${escapeHtml(order.customer_email)}</p>` : ""}
        ${order.customer_notes ? `<p>Notes: ${escapeHtml(order.customer_notes)}</p>` : ""}
        <p>Open <strong>Manage Shop → Orders</strong> on the website to see the order and any engraving photos.</p>
    `);

    await sendEmail({
        to: OWNER_EMAIL,
        subject: `New order: ${money(Number(order.subtotal || 0) + Number(order.shipping_cost || 0))} from ${order.customer_name || "a customer"}`,
        html
    });

}

async function emailCustomerOrderReceived(order) {

    const html = layout("Thanks for your order!", `
        <p>Hi ${escapeHtml(order.customer_name || "there")}, we've received your order and we're getting it ready. We'll email you again when it ships.</p>
        <table style="width:100%;border-collapse:collapse;font-size:15px;">${itemsHtml(order)}${totalsHtml(order)}</table>
        <h3 style="font-size:15px;margin-top:20px;">Shipping to</h3>
        <p>${addressHtml(order)}</p>
    `);

    await sendEmail({ to: order.customer_email, subject: "Your Corner Barr order is confirmed", html });

}

async function emailCustomerShipped(order) {

    const link = trackingUrl(order.carrier, order.tracking_number);

    const trackingHtml = order.tracking_number
        ? `<p>${escapeHtml(order.carrier || "Tracking")} number: <strong>${escapeHtml(order.tracking_number)}</strong></p>
           ${link ? `<p><a href="${escapeHtml(link)}" style="background:#2f4a36;color:#fff;padding:10px 18px;text-decoration:none;display:inline-block;">Track your package</a></p>` : ""}`
        : "";

    const html = layout("Your order is on its way!", `
        <p>Hi ${escapeHtml(order.customer_name || "there")}, good news: your Corner Barr order has shipped.</p>
        ${trackingHtml}
        <table style="width:100%;border-collapse:collapse;font-size:15px;">${itemsHtml(order)}</table>
    `);

    await sendEmail({ to: order.customer_email, subject: "Your Corner Barr order has shipped", html });

}

module.exports = { emailOwnerNewOrder, emailCustomerOrderReceived, emailCustomerShipped };
