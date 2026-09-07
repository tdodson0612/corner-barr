/**
 * Thin wrappers around PayPal's Vault v3 endpoints. Every function takes
 * the API base URL and a valid access token explicitly, rather than
 * fetching its own, so server.js's single cached token can be reused.
 */

async function createVaultSetupToken({ paypalApiBase, accessToken, existingCustomerId }) {

    const response = await fetch(`${paypalApiBase}/v3/vault/setup-tokens`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
            ...(existingCustomerId ? { customer: { id: existingCustomerId } } : {}),
            payment_source: {
                paypal: {}
            }
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || "Could not start saving this payment method.");
    }

    return data;

}


async function exchangeSetupTokenForPaymentToken({ paypalApiBase, accessToken, setupTokenId }) {

    const response = await fetch(`${paypalApiBase}/v3/vault/payment-tokens`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
            payment_source: {
                token: {
                    id: setupTokenId,
                    type: "SETUP_TOKEN"
                }
            }
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || "Could not save this payment method.");
    }

    return data;

}


async function listPaymentTokensForCustomer({ paypalApiBase, accessToken, customerId }) {

    const response = await fetch(
        `${paypalApiBase}/v3/vault/payment-tokens?customer_id=${encodeURIComponent(customerId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || "Could not look up saved payment methods.");
    }

    return data.payment_tokens || [];

}


async function deletePaymentToken({ paypalApiBase, accessToken, vaultId }) {

    const response = await fetch(`${paypalApiBase}/v3/vault/payment-tokens/${vaultId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    // PayPal returns 204 on success, and treats deleting an already-gone
    // token as success too rather than erroring — we mirror that.
    if (!response.ok && response.status !== 404) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Could not remove this payment method from PayPal.");
    }

}


async function verifyWebhookSignature({ paypalApiBase, accessToken, webhookId, headers, body }) {

    const response = await fetch(`${paypalApiBase}/v1/notifications/verify-webhook-signature`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
            auth_algo: headers["paypal-auth-algo"],
            cert_url: headers["paypal-cert-url"],
            transmission_id: headers["paypal-transmission-id"],
            transmission_sig: headers["paypal-transmission-sig"],
            transmission_time: headers["paypal-transmission-time"],
            webhook_id: webhookId,
            webhook_event: body
        })
    });

    const data = await response.json();

    return data.verification_status === "SUCCESS";

}


/**
 * Extracts a human-friendly summary (email, or card brand/last4/expiry)
 * from a PayPal payment token response, whatever payment_source it holds.
 */
function summarizePaymentSource(paymentSource) {

    if (paymentSource?.paypal) {
        return {
            methodType: "paypal",
            paypalEmail: paymentSource.paypal.email_address || null
        };
    }

    if (paymentSource?.card) {
        return {
            methodType: "card",
            cardBrand: paymentSource.card.brand || null,
            cardLast4: paymentSource.card.last_digits || null,
            cardExpiry: paymentSource.card.expiry || null
        };
    }

    return { methodType: "paypal" };

}


module.exports = {
    createVaultSetupToken,
    exchangeSetupTokenForPaymentToken,
    listPaymentTokensForCustomer,
    deletePaymentToken,
    verifyWebhookSignature,
    summarizePaymentSource
};