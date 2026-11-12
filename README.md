# Shoeline

A polished, responsive sneaker storefront backed by Supabase Auth and Postgres, with a customer account area and a separate owner dashboard. Vercel serves the static storefront and a small configuration function; the browser talks to Supabase through its public key and row-level security.

## Stack

- Static HTML, CSS and JavaScript storefront (no framework build step)
- Supabase Auth and Postgres with row-level security
- Vercel static hosting and a serverless public-config endpoint
- Cash on delivery order flow with server-validated prices, stock locking and transactional order creation

## Set up Supabase

1. Open the Supabase project and go to **SQL Editor**.
2. Run [`supabase/migrations/20261112000000_shoeline_commerce.sql`](./supabase/migrations/20261112000000_shoeline_commerce.sql).
3. Run [`supabase/migrations/20261112183000_shoeline_storefront_operations.sql`](./supabase/migrations/20261112183000_shoeline_storefront_operations.sql) after the commerce migration. It configures product-image storage, verified-purchase reviews, owner order operations, and order realtime updates.
4. In **Project Settings → API Keys**, copy the project URL and the public `anon`/publishable key. Never use a `service_role` or secret key in this app.
5. In **Authentication → URL Configuration**, set the Site URL to the deployed Vercel URL. Add any preview or local URLs to the redirect allow list if you enable email confirmation or OAuth.
6. To sign customers in immediately after password signup, open **Authentication → Sign In / Providers → Email** and turn off **Confirm email**. This changes only email verification; password authentication remains enabled. If confirmation stays on, new customers must confirm their email before signing in.

The operations migration promotes `georgeandreiguiang@gmail.com` to owner only if that account already exists and has a confirmed email when the migration runs. For another verified account, an existing owner can use **Profile → Owner dashboard → Team access** to grant access. Alternatively, grant the first owner from the Supabase SQL Editor:

   ```sql
   update public.profiles
   set role = 'admin'
   where id = (
     select id
     from auth.users
     where lower(email) = lower('OWNER_EMAIL')
   );
   ```

   Replace `OWNER_EMAIL` with the exact, already-verified account email. New signups are customers by default; the owner dashboard is only shown to profiles with the `admin` role.

The migration creates profiles, products and images, addresses, carts and cart items, wishlists, orders and immutable order items, payments, inventory movements, returns, product reviews, promotions, business accounts and members, quote requests and quote items, requisition lists and items, and admin activity logs. It seeds the eight starter products and can be re-run safely.

## Deploy on Vercel

The repository is connected to Vercel. In the **ShoeLine** project, add these environment variables for Production and Preview:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your public anon/publishable key |

Save the variables and redeploy the latest `main` commit. The repo’s [`vercel.json`](./vercel.json) serves the `public` directory, while [`api/config.js`](./api/config.js) exposes only the public Supabase configuration. No service-role key or database password belongs in Vercel or Git.

## Features

- Searchable, filterable catalog with animated ambient art, realistic rotating sneaker photography, 3D-style product motion and responsive layouts
- The rotating high-top photo is by Rodrigo Paredes, cropped and cut out from its studio background under CC BY 2.0
- Shoeline brand mark in the storefront, owner dashboard and favicon; background music attempts autoplay with a play-button fallback for browser restrictions
- Floating scan-to-visit QR code linking to the live storefront
- Store locator section with searchable Google Maps preview and directions link
- Supabase Auth sign-up/sign-in, customer profile, wishlist, order history, saved delivery addresses and returns
- Transactional order creation that re-checks live prices and stock, reserves inventory and creates pending orders
- Profile-accessible, role-protected owner dashboard for products, inventory, order status, customers, returns, reviews and team access
- Product photo uploads to an admin-only Supabase Storage bucket; public catalog images are served through the bucket’s public URLs
- Verified-purchase reviews with owner moderation, live order subscriptions with automatic refresh fallback, and order status controls
- Cancellation restores reserved stock; only delivered or cancelled orders can be deleted from the owner dashboard
- Business quote submissions, promotions, customer carts and requisition lists
- Accessible modal interactions and reduced-motion support

The checkout currently supports **cash on delivery**. It does not collect card details or claim to process online payments. Add a payment provider later through a server-side integration and verified webhooks.

## Local preview

With Node.js installed, run `npx serve public` from the project directory. For the Supabase-backed app, configure the two variables in `.env` and run the Vercel development server (`npx vercel dev`) so `/api/config` is available. Do not commit `.env`.

The Supabase public key is intended for browser use; table access is constrained by row-level security. Supabase Auth tokens are stored by this frontend in browser local storage, so keep dependencies and inline/script injection under control. Review Supabase Auth confirmation settings, privacy requirements, backup plans, payment, tax and delivery operations before a production launch.
