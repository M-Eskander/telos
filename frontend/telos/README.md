# Telos frontend

React single-page app for the Telos API. See the repository's
[`frontEndSpec.md`](../../frontEndSpec.md) for the API contract.

## Run locally

Start the backend on its default port (`5000`), then run:

```sh
npm ci
npm run dev
```

Vite serves the app at `http://localhost:5173` and proxies `/api` to the
backend on port `5000`. Set `API_TARGET=http://host:port` when the API runs
elsewhere. The browser session cookie is HTTP-only and same-site, so production
should serve the frontend and API from the same site. Set `VITE_API_ORIGIN`
only when cross-origin cookies and CORS are configured.

## Build and publish

```sh
npm run build
mkdir -p ../../dist
cp -a dist/. ../../dist/
```

This places the static app in the root `dist/` directory used by the Caddy
deployment. Build output is ignored by Git.

## Pages

- `/login`, `/setup`, `/forgot-password`, and `/reset-password`
- `/` home dashboard; `/projects` portfolio
- `/projects/:id` with Tasks, Attention, Timeline, Team, Work, Sheet,
  Contracts, Meetings, and Settings tabs as access allows
- `/meetings`, `/account`
- Owner only: `/people`, `/people/:id`, and `/access`

## Notes

- 401 clears the session and returns to sign-in; 403 shows "You don't have access".
- Permission alternatives are read as `{ name, resource }` and resolved to
  catalog IDs before saving; `is_active` accepts booleans or `1`/`0`.
