# Corner Barr — To-Do / Backlog

**Update:** the database prerequisite is done — we went with **Supabase**
(hosted Postgres + built-in accounts) instead of SQLite, since it also
gives us login, roles, and file storage for photos out of the box.
Items 1 and 2 below are now built. 3 and 4 are next.

---

## 1. Customer accounts with saved cards — ACCOUNTS DONE, SAVED PAYPAL DONE, CARDS PENDING

- ✅ Sign up / log in (Supabase Auth, email + password).
- ✅ A logged-in session so the site knows who's browsing.
- ✅ **Saved PayPal wallet** — logged-in customers can save their PayPal
  from their Account page or at checkout ("Save my PayPal for next
  time"), then pay with one click next time, no re-approval needed.
  Uses PayPal's own Vault — we never see or store real payment details,
  only PayPal's own reference IDs.
- ⬜ **Saved credit/debit cards** specifically (not just PayPal) needs
  PayPal's Card Fields component instead of the buttons we use now, and
  requires the account be approved for "Advanced Credit and Debit Card
  Processing" first. Worth revisiting if/when that's approved — the
  database is already set up to support it.

## 2. Owner accounts with special access — DONE

- ✅ Every account has a `role`: `customer` or `owner`, stored in a
  `profiles` table (nobody can grant themselves this from the browser —
  it's set by hand in the Supabase SQL editor).
- ✅ A "Manage Shop" panel only visible to, and only usable by, owners —
  enforced on the server, not just hidden in the UI.
- ✅ Owner screens to **create, edit, and delete** shop listings — price,
  description, and a drag-and-drop photo upload — writing straight to
  the Supabase `products` table. The old static `products.json` is gone;
  the shop's 5 sections (Cutting Boards, Soap & Candles, Resin Crafts,
  Jewelry, Holiday) all read live from the database now.
- ✅ Multi-photo galleries — once a listing is saved, editing it unlocks
  an "Additional Photos" uploader so Ashley can add more angles (e.g. a
  chess set's board, pieces, and box). Shown on the item's page as a
  swipeable gallery with thumbnails and arrows, same idea as Amazon.

## 3. Purchase history + wish list — ORDER HISTORY DONE, WISHLIST PENDING

- ✅ Every order is tied to the logged-in account at checkout time (guests
  who don't log in can still check out, they just won't have order
  history to look back on).
- ✅ Customers see their own orders — items, total, and shipment
  status — under the "My Orders" section in their Account panel.
- ✅ Ashley sees **every** order under a new "Orders" tab inside "Manage
  Shop," and can set each order's shipping status (Processing / Shipped
  / Delivered), carrier, tracking number, and estimated delivery date.
  Customers see that info reflected on their own order as soon as she
  saves it.
- ✅ Wishlist ("save for later") — a heart icon on every product card
  saves it to the customer's account. Saved items show under "My
  Wishlist" in their Account panel, with a quick "Remove" action.
  Clicking the heart while logged out opens the login panel instead of
  silently failing.

## 4. Shipping options (owner-managed) — DONE

- ✅ Ashley manages her own shipping methods (name, price, estimated
  delivery window) from a new "Shipping" tab inside "Manage Shop" —
  add, edit, deactivate, or delete any time.
- ✅ Free shipping is per shop section, exactly as she wanted — she sets
  a dollar threshold for each of the 5 categories independently (e.g.
  Cutting Boards vs Jewelry can have completely different free-shipping
  amounts, or no free shipping offer at all for a section).
- ✅ At checkout, the customer sees either a "you qualify for free
  shipping!" banner, or a list of Ashley's shipping methods to choose
  from — whichever applies. The order total updates live as they pick.
- The free-shipping rule: an order only ships free if **every** category
  represented in the cart has individually cleared its own threshold.
  A $200 cart split across two sections doesn't get free shipping just
  because the total is high — each section's subtotal has to clear its
  own bar. Worth showing Ashley this logic once real numbers are set, in
  case she'd rather it work differently.

---

*Not yet scheduled, but worth flagging for later: email order
confirmations, and moving `orders.log.json` into the database too (see
item 3).*