# Corner Barr — Store with Real Checkout

This adds working orders to the site: customers add items to the cart and pay
with **PayPal or a debit/credit card** through PayPal's checkout. No second
processor (like Stripe) is needed — PayPal's own buttons include a card option.

## Site structure (3 real pages, not one scrolling page)

The site used to be a single page you scrolled through. It's now three
separate pages, like Amazon:

- **`index.html`** — Home. Just the hero and "Our Story." No shop grid here
  anymore.
- **`shop.html`** — Shop. The category nav (Cutting Boards, Soap & Candles,
  Resin Crafts, Jewelry, Holiday) still auto-scrolls to sections — but only
  on this page, since this is the only page that has those sections.
- **`product.html?id=...`** — One specific item, opened by clicking any
  product card. Cutting boards show the engraving customization panel right
  above the price, and the price updates live as you change it. Every other
  category shows a plain item page with an Add to Cart button.

The header, cart drawer, checkout, login, and the owner's "Manage Shop"
panel are identical on all three pages, so they're built once as shared
**partials** (`public/partials/*.html`) and injected into each page by
`public/js/partials.js`. That way, editing the header or the admin panel
only ever has to happen in one place.

**JavaScript is split the same way:**
- `js/shared.js` — cart, checkout, PayPal, accounts, wishlist, order
  history, and the admin panel. Loaded on every page.
- `js/shop.js` — renders the 5 product grids. Only on `shop.html`.
- `js/product.js` — renders one item + customization. Only on `product.html`.
- `js/home.js` — nothing page-specific; just boots the shared stuff.

**Delete the old `public/js/app.js`** — it's fully replaced by the files
above and nothing references it anymore. Keeping it around risks accidentally
editing a file that no longer does anything.

## How it works

- `server.js` is a small Node/Express server that does two things a browser
  can't safely do:
  1. Talks to PayPal using your **secret key**, which must never be sent to
     a browser.
  2. Re-calculates the cart total from live Supabase data before creating
     a PayPal order, so a customer can't edit prices in dev tools and pay less.
- Products, accounts, orders, wishlists, and shipping settings all live in
  Supabase now — see the setup section below.

## 1. Get PayPal API credentials

1. Log into <https://developer.paypal.com/dashboard/applications> with your
   normal PayPal business account.
2. Under **Sandbox** (for testing) or **Live** (for real payments), create
   an app and copy the **Client ID** and **Secret**.
3. Start with Sandbox. PayPal also creates sandbox "test buyer" accounts
   under Sandbox → Accounts so you can run through a full test purchase
   without touching real money.

## 2. Configure the server

```bash
cp .env.example .env
```

Edit `.env`:

```
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_secret
PAYPAL_MODE=sandbox
PORT=3000
```

## 2.5. Accounts, roles, and the shop database (Supabase)

The product catalog, customer/owner accounts, and product photo storage
are all powered by [Supabase](https://supabase.com) — a hosted Postgres
database with built-in login and file storage.

1. Create a free Supabase project (Personal org is fine for a single-owner shop).
2. In the SQL Editor, run `supabase/schema.sql` once, then `supabase/seed.sql`
   once (seeds the original starter catalog so nothing was lost in the move
   off the old static `products.json`).
3. In Storage, create a bucket named exactly `product-images`, set to Public.
4. Also run `supabase/orders.sql` (after schema.sql and seed.sql) — adds
   the orders table that powers customer order history and Ashley's
   shipment-tracking tools.
5. Also run `supabase/wishlist.sql` and `supabase/shipping.sql` (any
   order, after the above) — wishlist adds a "save for later" table;
   shipping adds owner-managed shipping methods and per-category
   free-shipping thresholds (with two example shipping methods seeded
   in automatically — rename, reprice, or delete them from "Manage
   Shop" → Shipping).
6. Also run `supabase/product-images.sql` — adds a photo gallery per
   item (e.g. a chess set's board, pieces, and box shown as a swipeable
   gallery on its item page). The existing cover photo still works
   exactly as before; this just adds the option for more.
7. Also run `supabase/saved-payment-methods.sql` — adds "save my PayPal
   for next time" for logged-in customers (see the dedicated section
   below for the extra PayPal-side setup this needs).
8. From Project Settings, copy your Project URL, anon/publishable key, and
   secret/service_role key into `.env`:
   ```
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
9. Have Ashley sign up for an account on the live site once (the "Account"
   button in the header). Then, in the SQL Editor, promote her to owner:
   ```sql
   update public.profiles set role = 'owner' where email = 'her-login-email@example.com';
   ```
   Nobody can grant themselves this role from the browser — it's only ever
   set this way, by hand.

Once she's an owner, logging in shows her a "Manage Shop" button that
customers never see — even if a customer inspects the page source or
guesses the URL, the server rejects any create/edit/delete request that
doesn't come from an authenticated owner.

## 3. Run it locally on your Mac

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Visit <http://localhost:3000> — this now serves your whole site, not just
the static files, so payments will work here too.

Test with a PayPal sandbox buyer account (from the developer dashboard) to
run through checkout without real money moving.

## 4. Go live

1. In the PayPal developer dashboard, create/copy your **Live** app
   credentials.
2. Update `.env`:
   ```
   PAYPAL_CLIENT_ID=your_live_client_id
   PAYPAL_CLIENT_SECRET=your_live_secret
   PAYPAL_MODE=live
   ```
3. Restart the server. That's the only code change needed to switch from
   test to real payments.

## 5. Hosting: Mac now, rent a server later

The app is a normal Node.js server, so the same code runs in both places:

- **On your Mac (now):** `npm start` as above. Fine for local testing, but
  your Mac needs to stay on and reachable for the site to be live to
  customers — not realistic for a real storefront.
- **On a rented server (recommended for going live):** any VPS that runs
  Node.js (DigitalOcean, Linode, a basic AWS/EC2 box, Render, Railway, etc.)
  works. Copy the project over, run `npm install --production`, set the
  same `.env` values, and run it with a process manager like
  [pm2](https://pm2.keymetrics.io/) so it restarts automatically:
  ```bash
  npm install -g pm2
  pm2 start server.js --name corner-barr
  pm2 save
  ```
  Point your domain's DNS at the server and put it behind HTTPS (most of
  the platforms above handle HTTPS for you automatically; on a raw VPS,
  [Caddy](https://caddyserver.com/) or `certbot` + nginx are the easiest
  routes).

## Saved PayPal payment methods

Logged-in customers can save their PayPal for a faster checkout next
time, using PayPal's Vault. A few things worth knowing:

- **This saves the PayPal wallet, not a credit card number.** Saving an
  actual card requires PayPal's separate Card Fields component and
  approval for "Advanced Credit and Debit Card Processing" — a bigger
  change we can build later if that's ever approved on the account. The
  schema (`saved_payment_methods` table) already has room for it.
- **Turn on Vaulting for your app** in the PayPal Developer Dashboard
  (Apps & Credentials → your app → look for a Vaulting/"save payment
  methods" toggle) — for sandbox first, then again for Live once you get
  there.
- **The webhook only works once the site has a real public URL.** PayPal
  sometimes finishes saving a payment method a moment after checkout
  completes, and notifies your server by calling
  `https://yourdomain.com/api/webhooks/paypal` — which can't reach
  `localhost`. To set it up (once hosted): PayPal Developer Dashboard →
  your app → Add Webhook → point it at that URL → subscribe to
  `VAULT.PAYMENT-TOKEN.CREATED` → copy the Webhook ID it gives you into
  `PAYPAL_WEBHOOK_ID` in `.env`.
- **Local testing still works without the webhook**, via a fallback: the
  account page automatically asks the server to double-check with PayPal
  directly (`/api/saved-payment-methods/sync`) shortly after checkout, so
  a saved payment method usually still shows up correctly even on
  localhost — just possibly a second or two later than on a live site
  with the webhook wired up.

## Notes and honest caveats

- **The card button's availability isn't 100% guaranteed.** PayPal shows a
  "Debit or Credit Card" button automatically for guest checkout, but
  whether it appears depends on your account's approval status and the
  buyer's country/browser. Test this in sandbox before launch — if it
  doesn't show up, PayPal support can advise on enabling "Advanced Credit
  and Debit Card Payments" for your account.
- **Order storage is minimal.** `orders.log.json` is a plain file, not a
  database — fine for getting started, but you'll want a real database
  (or at least email notifications) before order volume grows.
- **No email confirmations yet.** The customer sees an on-screen
  confirmation, but nothing is emailed to them or to you. Let me know if
  you want that added (it needs an email-sending service, e.g. Resend or
  SendGrid).
- **Refunds/cancellations** aren't handled here — those happen from your
  PayPal dashboard directly for now.