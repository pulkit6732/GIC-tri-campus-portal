# GIC Tri-Campus Portal

A GIC 2026 VDC staff portal for managing teams and venture-coach evaluations. It runs as a Cloudflare Worker using Hono, D1, and static assets in `public/`. This is a replacement for a compiled-only static build; that build is not used. No embedded master keys, client-side roles, or browser-stored evaluations.

## Features

- One-time administrator bootstrap using a server-only secret
- Email/password login with salted PBKDF2 hashes, HttpOnly SameSite session cookies and server-side authorization
- Staff accounts, teams, one evaluation per coach per team, leaderboard and recent audit history
- Login attempt limits, request size and input validation, same-origin write checks, restrictive content security policy
- D1-backed state, daily cleanup of expired sessions and rate-limit records

The portal does **not** implement Google OAuth, Google Drive permission changes, Google Sheets synchronization, public team submissions, or the full feature set of the old compiled UI. Deck URLs are external links managed by an administrator; Google Drive permissions must be configured separately in Google Drive. Do not claim those features are present.

## Local development

Requires Node.js 20+ and npm. Clone the repository (or use an existing checkout), then install dependencies and create the local database:

```sh
git clone https://github.com/pulkit6732/GIC-tri-campus-portal.git
cd GIC-tri-campus-portal
npm ci
npm run db:local
```

Copy `.dev.vars.example` to `.dev.vars` and replace `REPLACE_ME` with a unique random secret of at least 32 characters (for example, generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`). The `.dev.vars` file is ignored by Git; never share or commit it. Start:

```sh
npm run dev
```

Visit http://127.0.0.1:8787/ and create your first administrator with the value from `.dev.vars`. Password must be at least 12 characters. Store your credentials securely. Do not reuse the published passwords from the original ZIP.

Run `npm test` for repeatable integration tests, even before creating `.dev.vars`. The test runner generates its own secret and starts a separate local Worker with an isolated temporary D1 database, creates test accounts, checks authorization and evaluates teams, then removes its test data. The 64 parallel health requests are only a bounded local smoke test, not a production capacity benchmark. GitHub Actions runs `npm ci`, the tests, and a deployment dry run on pushes and pull requests; it does not deploy.

## Cloudflare deployment

The checked-in `wrangler.jsonc` contains a **local-only placeholder database ID**. `npm run db:remote` and `npm run deploy` refuse to run until it is replaced with a valid D1 ID; direct Wrangler commands bypass this check. A dry run or passing CI does not mean production is configured. No Cloudflare credentials or production secrets belong in GitHub; deployment is manual until you deliberately set up a protected deployment workflow.

1. Authenticate with `npx wrangler login` in your own Cloudflare account.
2. Create a D1 database: `npx wrangler d1 create gic-portal`.
3. Put the **actual** database ID returned by that command in `wrangler.jsonc` instead of `00000000-0000-0000-0000-000000000000`. The placeholder is for local development only.
4. Apply migrations: `npm run db:remote`. Double-check your selected account and database before running this command.
5. Generate an independent production bootstrap secret of at least 32 random characters. Set it using `npx wrangler secret put BOOTSTRAP_SECRET`. Never put this secret in `wrangler.jsonc` or the frontend.
6. Run `npm test` and `npx wrangler deploy --dry-run`, then deploy with `npm run deploy`. Visit the resulting workers.dev URL over HTTPS and bootstrap the first administrator once. After bootstrap, the secret cannot create more administrators. Administrators can create staff accounts in the portal. To eliminate the dormant bootstrap secret, remove it after first use with `npx wrangler secret delete BOOTSTRAP_SECRET`.
7. Configure a custom domain and Cloudflare WAF/rate-limit rules as appropriate for production. Restrict access to approved users and establish a database backup and recovery process before collecting real evaluations.

Cloudflare Pages drag-and-drop is **not** sufficient for this project; deploy the Worker with Wrangler. A new GitHub clone should run `npm ci` before using the npm scripts. Do not upload `node_modules/`, `.wrangler/` (which may hold local D1 data), `.dev.vars`, or `.env` files. They are ignored by Git, but not automatically omitted from manually created ZIP files. The `public/` directory is served as Worker static assets using the `assets` configuration in `wrangler.jsonc`. The `_headers` file sets browser-side security headers on those assets.

## Security and operational notes

- HTTPS is mandatory in production; the cookie Secure attribute is enabled on HTTPS. Never expose the local development server to the public network.
- The first bootstrap is atomic using a unique database settings record; it cannot be repeated through the UI.
- The audit table records write actions but is not an immutable, external audit system. Forward logs to a durable audit system for stronger guarantees.
- D1 login throttling limits attempts per connecting IP; configure Cloudflare WAF for broader abuse protection. This code is not a substitute for penetration testing or a production load test.
- In this version, there is no password reset or account recovery UI. Plan recovery and secret management before production.

## License

The portal software and documentation are licensed under the [MIT License](LICENSE). The GITAM logo in `public/gitam-logo.png` is a third-party brand asset, **not** granted under the MIT License; obtain permission from the rights holder before redistributing or using that logo. The license does not grant trademark rights.
