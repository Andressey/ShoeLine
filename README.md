# Shoeline — Full-stack e-commerce starter

This project upgrades the Shoeline storefront into a Node.js + Express application with SQLite, server-side customer accounts, and Stripe Checkout.

## Requirements
- Node.js 20 or newer
- npm
- Stripe account for payment testing (optional to browse the site; required for hosted checkout)

## Run locally
1. Extract this project.
2. Open a terminal in the `Shoeline` project directory.
3. Install packages:
   ```bash
   npm install
   ```
4. Copy `.env.example` to `.env`.
5. Set a long random `SESSION_SECRET`. For example, generate one with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
6. Add your Stripe **test-mode** secret key to `STRIPE_SECRET_KEY` in `.env`.
7. Start the website:
   ```bash
   npm start
   ```
8. Visit http://localhost:3000

The SQLite database and session store are created automatically when the app starts. The sample catalog is seeded on startup.

## Stripe Checkout (test mode)
- Create/use Stripe test keys from your Stripe Dashboard.
- Set `STRIPE_SECRET_KEY=sk_test_...` in `.env`.
- Configure a webhook endpoint for local development:
  ```bash
  stripe listen --forward-to localhost:3000/api/stripe/webhook
  ```
- Copy the webhook signing secret shown by Stripe CLI into `STRIPE_WEBHOOK_SECRET`.
- Test using Stripe's published test card numbers in Stripe's test environment only. Never enter real card details in a test site.
- Stripe redirects the buyer to Stripe-hosted Checkout. The app marks an order as paid only after a verified webhook event.

## What's included
- Shoeline responsive storefront, product filtering/search, wishlists, product comparison
- SQLite products and inventory fields
- Customer registration and login with bcrypt password hashing
- HttpOnly session cookie (server-side session store)
- Stripe-hosted checkout session creation
- Verified Stripe webhook endpoint for payment status
- Customer order history
- Return request API
- Business quote request API
- Basic login rate limiting and Helmet security headers

## Adobe Commerce-inspired feature map
Adobe's product page describes AI-driven commerce, digital storefronts, personalized commerce, composable architecture, scalable operations, and B2B commerce. Its B2B documentation includes company accounts, shared catalogs/pricing, quote negotiation, quick order, requisition lists, purchase-order approvals, and company roles. See:
- https://business.adobe.com/products/commerce.html
- https://experienceleague.adobe.com/en/docs/commerce-admin/b2b/introduction

This project is a custom starter inspired by those feature categories, not a clone of Adobe Commerce. The starter has working basic storefront/account/order/payment flows and simple B2B quote requests. Enterprise features such as AI/semantic search, multi-store administration, company roles and approval workflows, shared catalogs, analytics dashboards, ERP/CRM/PIM integrations, and sophisticated inventory/fulfillment are roadmap items and need additional development/services.

## Important production checklist
This is a starter for development and learning, not ready for public production deployment. Before launch:
- Use HTTPS and a production-grade hosting platform.
- Set a strong, private `SESSION_SECRET`; never use the development fallback.
- Use a managed database such as PostgreSQL, with migrations, backups, and access controls.
- Configure session cookie security, proxy settings, CSRF protections, and account recovery/email verification.
- Add admin authentication and role-based permissions before exposing product/order administration.
- Implement inventory reservation and decrement only after verified payment; handle refunds, duplicate webhooks, and order reconciliation idempotently.
- Configure shipping, tax, delivery fees, and Philippine payment methods as needed.
- Stripe card availability and supported local payment methods depend on Stripe account country and configuration. For GCash or Maya, use a supported provider/official merchant integration rather than collecting credentials yourself.
- Add privacy policy, terms, refund policy, consent and data-retention controls.
- Validate inputs, add monitoring, backups, logging, security tests, and load tests.
- Review PCI, privacy, consumer protection, tax, and local legal requirements with qualified professionals.

## Security notes
- Passwords are hashed with bcrypt and are never saved to localStorage.
- The browser stores only a small display profile for convenience; the server session is the authentication authority.
- Stripe Checkout hosts the payment form; this site does not collect card numbers.
- Do not commit `.env`, keys, or database files.
