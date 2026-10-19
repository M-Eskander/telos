# Telos

**Version 1.00** · Project and task management backend

Telos is a Node.js/Express API for managing projects, project teams,
departments, tasks, timelines, user contracts, and fine-grained access control.
It combines role- and attribute-based authorization with project-scoped team
and task workflows.

This repository currently contains the **backend only**. It does not contain a
frontend application. The frontend integration contract is documented in
[frontEndSpec.md](./frontEndSpec.md).

## At a glance

- Cookie-based login sessions using Passport and `express-session`.
- One-time bootstrap of a single studio owner; owner-managed people accounts.
- Required PDF contract upload when creating a person, with protected file
  downloads and contract metadata.
- Archiving/reactivation of people while retaining their history.
- Project CRUD, project-specific departments, and project memberships.
- Tasks and subtasks with project-member assignees, dates, status, priority,
  weight, and calculated progress.
- A project timeline endpoint for dated tasks and subtasks.
- Owner-managed roles, attributes, permission alternatives, and scoped
  assignments.
- Knex migrations and Jest/Supertest unit and integration tests.

Revenue sharing is not implemented in v1.00: there is no revenue-share model or
API in this repository.

## Technology

- Node.js and Express 5
- Knex for database access and migrations
- MySQL for the checked-in development configuration
- SQLite for the automated test configuration
- Redis for production sessions and permission caching
- Passport Local Strategy and bcryptjs
- Jest and Supertest

## Repository layout

```text
.
├── BE/
│   ├── src/
│   │   ├── config/        # Knex and session configuration
│   │   ├── controllers/   # HTTP request/response handling
│   │   ├── db/            # Migrations and permission seed
│   │   ├── middleware/    # Authentication, permissions, uploads, rate limits
│   │   ├── repositories/  # Database queries
│   │   ├── routes/        # Express route definitions
│   │   └── services/      # Business rules
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   ├── docs/
│   ├── knexfile.js
│   └── package.json
├── docker-compose.yml     # MySQL and Redis services only
└── frontEndSpec.md        # Frontend-facing API contract
```

## Getting started

### Prerequisites

- A supported Node.js runtime and npm.
- A MySQL instance for the backend's current development configuration.
- Redis for production. Development can start without Redis and will use
  in-memory sessions.

### Install dependencies

```powershell
cd BE
npm ci
```

### Configure the development database

The checked-in `BE/knexfile.js` selects MySQL for `development`. Its connection
reads `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`, with defaults of
`localhost`, `telos_user`, `strongpassword`, and `telos_db`. Create the database
and a least-privilege database user before starting the app; replace the
development password rather than reusing it.

The `BE/.env.example` file is a starting point, but parts of it are stale: it
claims SQLite is the development default and uses `DB_DATABASE`, while the
current development Knex configuration uses MySQL and `DB_NAME`. Follow
`BE/knexfile.js` for the effective connection settings.

The provided Compose file starts MySQL and Redis but deliberately does not
publish either service port to the host. It also does not start the Telos API
container. Therefore, a backend running directly on the host cannot connect to
those Compose services through `localhost` as currently configured. Run the
API in the same private container network, use a separately managed/local
database, or deliberately configure a secure host connection appropriate to
your environment.

### Configure the backend

Create `BE/.env` (do not commit it). Example for an API running against a
separately reachable MySQL server:

```dotenv
NODE_ENV=development
PORT=5000

DB_HOST=localhost
DB_USER=telos_user
DB_PASSWORD=replace-with-a-local-development-password
DB_NAME=telos_db

# Optional in development. If Redis is unavailable, sessions are in-memory.
REDIS_HOST=localhost
REDIS_PORT=6379

# Used for session signing in non-production environments as well.
SESSION_SECRET=replace-with-a-long-random-development-secret

# Required only when creating the first owner; use at least 32 random characters.
OWNER_SETUP_SECRET=replace-with-a-one-time-random-secret-of-at-least-32-chars

# Optional; defaults to BE/storage/contracts.
# Use a private, durable volume in production.
CONTRACT_STORAGE_DIR=
```

In production, also configure:

- `NODE_ENV=production`
- A cryptographically random `SESSION_SECRET` of at least 32 characters.
- A reachable Redis service and its credentials/URL.
- Production database connection values.
- A durable, private `CONTRACT_STORAGE_DIR`.
- HTTPS at the application or trusted reverse-proxy boundary.

Production startup fails if `SESSION_SECRET` is missing/too short or Redis is
unavailable. The production session cookie is secure, HTTP-only, and
`SameSite=Strict`. Use a same-site frontend/API deployment or configure and
verify the required browser cookie behavior at the proxy/platform layer.

### Run migrations

From `BE`, apply the development migration set:

```powershell
npx knex migrate:latest --knexfile knexfile.js --env development
```

To inspect migration status:

```powershell
npx knex migrate:status --knexfile knexfile.js --env development
```

The permissions seed is for a fresh/controlled database only:

```powershell
npx knex seed:run --knexfile knexfile.js --env development
```

**Caution:** `permissions_seed.js` deletes the existing `permissions` rows
before inserting the built-in project/task permission definitions. Do not run
this seed casually against a database with configured permission grants.

The application loads `BE/.env` when it starts, but the checked-in Knex
configuration does not load dotenv itself. When running Knex CLI commands, make
sure the database environment variables are exported in the shell or supplied
by your deployment environment; having them only in `BE/.env` is not sufficient
for the CLI.

Before running production migrations, review the `staging` and `production`
migration/seed directories in `BE/knexfile.js`: they do not currently point to
the checked-in `src/db/migrations` and `src/db/seeds` directories. Configure
and verify those paths for the deployment's working directory first. The
checked-in migration commands above are for the development configuration.

### Start the API

From `BE`:

```powershell
npm run dev
```

The API listens on port `5000` by default. Override with `PORT`. Basic health
response:

```text
GET http://localhost:5000/api
```

Development mode also exposes `GET /api/routes` for a route listing. It is not
available in production.

## First-time owner setup

The owner is provisioned once; there is no public registration endpoint.
Configure a high-entropy `OWNER_SETUP_SECRET` in the backend environment, then
make this request from a controlled setup tool:

```http
POST /api/auth/bootstrap-owner
Content-Type: application/json
```

```json
{
  "name": "Studio Owner",
  "email": "owner@example.com",
  "phone_number": "555-0100",
  "password": "choose-a-unique-strong-password",
  "setup_secret": "the-configured-one-time-secret"
}
```

After bootstrap succeeds, sign in through `POST /api/auth/login` and remove or
rotate the one-time setup secret. The owner creates all other people; each new
person requires their initial contract PDF in the same multipart request.

## API overview

All API routes are mounted under `/api`. Authentication is session-cookie based;
browser clients must send credentials with API calls. The main route groups are:

| Route | Purpose |
|---|---|
| `/api/auth/*` | Owner bootstrap, login, session restore, logout |
| `/api/projects` | Project listing and CRUD |
| `/api/projects/:id/departments` | Project department management |
| `/api/projects/:id/members` | Project memberships and departments |
| `/api/projects/:id/tasks` | Project tasks and subtasks |
| `/api/projects/:id/timeline` | Flat list of dated tasks and subtasks |
| `/api/admin/people` | Owner-managed people and contract history |
| `/api/admin/contracts/:id/file` | Protected contract PDF download |
| `/api/admin/roles`, `/attributes`, `/permissions` | Owner authorization setup |

See [frontEndSpec.md](./frontEndSpec.md) for request and response structures,
authorization requirements, validation rules, and recommended frontend flows.
The focused owner and contract API behavior is also described in
[BE/docs/guides/access-control.md](./BE/docs/guides/access-control.md).

### Authorization model

- The owner bypasses permission checks and is required for all `/api/admin`
  endpoints.
- Other authenticated users are checked against action/resource permissions,
  such as `read:project` or `create:task`.
- Permission grants are alternatives: attributes within a rule are ANDed;
  separate rules are ORed.
- Task permission checks use the containing project as their resource context.
- Project memberships control task assignee eligibility; assignees must be
  active project members.
- Empty grants fail closed for non-public permissions.

The frontend must treat API authorization responses as authoritative. Role
names alone do not imply access to every project.

## Testing

From `BE`:

```powershell
npm test
npm run test:coverage
```

Tests use SQLite and mocked Redis by default; they do not require production
database credentials or a running Redis server. Test database files and test
contract storage are ignored by Git.

## Operational and product boundaries

- Contract PDFs are stored outside the public web root. Production storage must
  persist across application restarts and be backed up.
- The API rate limit is 150 requests per 15 minutes per client IP. Its bucket
  storage is process-local; multi-instance deployments should enforce a shared
  limit upstream or use a shared limiter.
- The current repository does not include a frontend, OpenAPI document,
  password-reset flow, public people directory, pagination/search contract, or
  revenue-sharing feature.
- Compose currently defines infrastructure services only; it is not a complete
  one-command Telos application deployment.

## License

Telos is distributed under the MIT License. See [LICENSE](./LICENSE).
