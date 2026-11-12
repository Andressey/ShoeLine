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
3. In **Project Settings → API Keys**, copy the project URL and the public `anon`/publishable key. Never use a `service_role` or secret key in this app.
4. In **Authentication → URL Configuration**, set the Site URL to the deployed Vercel URL. Add any preview or local URLs to the redirect allow list if you enable email confirmation or OAuth.
5. After the store owner creates and confirms their customer account, grant owner access in the Supabase SQL Editor:

   ```sql
   update public.profiles
   set role = 'admin'
   where id = (
     select id
     from auth.users
     where lower(email) = lower('OWNER_EMAIL')
   );
   ```

   Replace `OWNER_EMAIL` with the exact owner account email. New signups are customers by default; the owner dashboard is only shown to profiles with the `admin` role.

The migration creates profiles, products and images, addresses, carts and cart items, wishlists, orders and immutable order items, payments, inventory movements, returns, product reviews, promotions, business accounts and members, quote requests and quote items, requisition lists and items, and admin activity logs. It seeds the eight starter products and can be re-run safely.

## Deploy on Vercel

The repository is connected to Vercel. In the **ShoeLine** project, add these environment variables for Production and Preview:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your public anon/publishable key |

Save the variables and redeploy the latest `main` commit. The repo’s [`vercel.json`](./vercel.json) serves the `public` directory, while [`api/config.js`](./api/config.js) exposes only the public Supabase configuration. No service-role key or database password belongs in Vercel or Git.

## Features

- Searchable, filterable catalog with animated ambient art, 3D-style product motion and responsive layouts
- Supabase Auth sign-up/sign-in, customer profile, wishlist, order history, saved delivery addresses and returns
- Transactional order creation that re-checks live prices and stock, reserves inventory and creates pending orders
- Role-protected owner dashboard for products, inventory, order status, customers, returns and team quotes
- Business quote submissions, promotion/review schema, customer carts and requisition lists
- Accessible modal interactions and reduced-motion support

The checkout currently supports **cash on delivery**. It does not collect card details or claim to process online payments. Add a payment provider later through a server-side integration and verified webhooks.

## Local preview

With Node.js installed, run `npx serve public` from the project directory. For the Supabase-backed app, configure the two variables in `.env` and run the Vercel development server (`npx vercel dev`) so `/api/config` is available. Do not commit `.env`.

The Supabase public key is intended for browser use; table access is constrained by row-level security. Supabase Auth tokens are stored by this frontend in browser local storage, so keep dependencies and inline/script injection under control. Review Supabase Auth confirmation settings, privacy requirements, backup plans, payment, tax and delivery operations before a production launch.
