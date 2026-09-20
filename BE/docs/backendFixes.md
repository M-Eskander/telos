# Backend Fix Plan

This document is the implementation plan for the issues identified in the backend review. It is based on the actual code in this repository and is written as a practical remediation guide rather than an abstract audit.

## Scope

This document only describes how to fix the problems found in the application. It does not change the working code.

The code evidence used here is taken from the live backend code in:

- `BE/src/app.js`
- `BE/src/middleware/auth.middleware.js`
- `BE/src/services/pdp.service.js`
- `BE/src/services/auth.service.js`
- `BE/src/controllers/auth.controller.js`
- `BE/src/repositories/role.repo.js`
- `BE/src/repositories/project.repo.js`
- `BE/src/repositories/permissionAttributes.repo.js`
- `BE/src/repositories/userAttributes.repo.js`
- `BE/src/repositories/roleAttributes.repos.js`
- `BE/src/middleware/rateLimit.middleware.js`
- `BE/src/redis/client.js`
- `BE/src/utils/startServer.js`
- `BE/knexfile.js`
- `BE/src/config/knex.js`
- `docker-compose.yml`
- `BE/tests/integration/authFlow.test.js`

---

## 1) Fix: permission contract mismatch between router and PDP

### Problem in repo

The route in `BE/src/routes/projectRouter.js` calls:

- `checkPerm('read', 'project')`
- `checkPerm('create', 'project')`
- `checkPerm('update', 'project')`
- `checkPerm('delete', 'project')`

But in `BE/src/middleware/auth.middleware.js` this permission is compared against `pdpService.getEffectivePermissions(...)`, and the PDP in `BE/src/services/pdp.service.js` produces values shaped like `read:project`, not bare verbs.

The code currently does:

```js
if (!effectivePermissions.includes(requiredPermission)) {
  return res.status(403).json({ ok: false, message: 'Insufficient permissions' });
}
```

This fails because `['read:project'].includes('read')` is false.

### Exact fix

Use one canonical permission format everywhere.

Recommended format:

```js
const requiredPermission = 'read:project';
```

Then update all route checks in `BE/src/routes/projectRouter.js` to pass the same format.

Example:

```js
router.get('/', checkPerm('read:project'), projectController.listProjects);
router.post('/', checkPerm('create:project'), projectController.createProject);
router.get('/:id', checkPerm('read:project'), projectController.getProjectById);
router.patch('/:id', checkPerm('update:project'), projectController.updateProject);
router.delete('/:id', checkPerm('delete:project'), projectController.deleteProject);
```

Also normalize inputs in `checkPerm` so both legacy bare verbs and canonical strings are accepted during migration:

```js
function normalizePermission(permission) {
  if (!permission) return permission;
  return permission.includes(':') ? permission : `${permission}:${resourceType}`;
}
```

Then:

```js
const normalizedPermission = normalizePermission(requiredPermission, resourceType);
if (!effectivePermissions.includes(normalizedPermission)) {
  return res.status(403).json({ ok: false, message: 'Insufficient permissions' });
}
```

### Why this fixes it

- Makes routes and PDP use the same permission vocabulary.
- Removes silent auth failure due to format mismatch.
- Keeps permission evaluation consistent across all resource types.

### Validation

- Route-level tests should assert `read:project` is used by the real auth flow.
- The mocked test in `BE/tests/integration/authFlow.test.js` should be rewritten to avoid mocking the PDP with bare verbs.

---

## 2) Fix: registration privilege escalation through role injection

### Problem in repo

In `BE/src/controllers/auth.controller.js`:

```js
const { name, phone_number, email, password, roles } = body;
const user = await authService.createUser({ name, phone_number, email, password, roles: roles || ['user'] });
```

In `BE/src/services/auth.service.js`:

```js
for (const roleName of roles) {
  const role = await roleRepo.findOrCreate(roleName, trx);
  await userRoleRepo.linkUserRole(uid, role.id, trx);
}
```

In `BE/src/repositories/role.repo.js`:

```js
async function findOrCreate(name, trx) {
  let r = await (trx || knex)('roles').where({ name }).first();
  if (!r) r = await insertRole(name, trx);
  return r;
}
```

This means a client can submit a payload like:

```json
{ "roles": ["admin"] }
```

and the application will create and link the role automatically.

### Exact fix

Remove role assignment from the public registration contract.

Update `BE/src/controllers/auth.controller.js`:

```js
exports.register = async (req, res, next) => {
  try {
    const body = req.body || {};
    const { name, phone_number, email, password } = body;

    if (!name || !phone_number || !email || !password) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }

    const existing = await authService.findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ ok: false, message: 'Email already registered' });
    }

    const user = await authService.createUser({
      name,
      phone_number,
      email,
      password,
      roles: ['user']
    });

    res.status(201).json({ ok: true, user: { ... } });
  } catch (err) {
    next(err);
  }
};
```

Then create a separate admin-only endpoint for role assignment, not a public registration path.

Add a guard in `BE/src/services/auth.service.js`:

```js
const ALLOWED_DEFAULT_ROLES = ['user'];

async function createUser({ name, phone_number, email, password, roles = ['user'] }) {
  const safeRoles = roles.filter((role) => ALLOWED_DEFAULT_ROLES.includes(role));
  // never trust client-supplied privileged roles
}
```

If admin roles are needed, assign them only in a verified admin flow.

### Why this fixes it

- Prevents privilege escalation during self-registration.
- Limits role creation to trusted administrative actions.
- Aligns the registration path with the principle of least privilege.

### Validation

- Test that registration with `roles: ['admin']` is rejected.
- Test that only an authorized admin endpoint can assign admin roles.

---

## 3) Fix: IDOR/BOLA exposure from project ownership not enforced in repo

### Problem in repo

`BE/src/repositories/project.repo.js` contains:

```js
async function getProjectById(id) {
    return knex('projects').where({id}).first();
}

async function deleteProject(id) {
    return knex('projects').where({id}).del();
}

async function updateProject(id, data) {
  const cleanData = clean(data);
  return knex('projects').where({ id }).update(cleanData);
}
```

There is no `created_by` or `owner_id` check in the data path. This means access control depends entirely on middleware.

### Exact fix

Add owner enforcement to repository queries.

Example:

```js
async function getProjectById(id, userId = null) {
  const query = knex('projects').where({ id });
  if (userId) query.andWhere({ created_by: userId });
  return query.first();
}

async function updateProject(id, userId, data) {
  const cleanData = clean(data);
  return knex('projects')
    .where({ id, created_by: userId })
    .update(cleanData);
}

async function deleteProject(id, userId) {
  return knex('projects')
    .where({ id, created_by: userId })
    .del();
}
```

Then update the controller/service usage accordingly:

```js
await projectRepo.updateProject(id, req.user.id, payload);
await projectRepo.deleteProject(id, req.user.id);
```

This is a defense-in-depth rule: route-level authorization is still useful, but repository-level ownership checks add a second barrier.

### Why this fixes it

- Prevents cross-user access by raw object ID.
- Enforces ownership at the place where the resource is actually read or changed.
- Avoids future bypasses from misconfigured middleware or incomplete route definitions.

### Validation

- Write a test where user A tries to update or delete project owned by user B.
- Assert the action is denied even when the ID is known.

---

## 4) Fix: weak session secret and dangerous defaults

### Problem in repo

`BE/src/app.js` contains:

```js
secret: process.env.SESSION_SECRET || 'change_this_secret',
```

This makes startup succeed with a known weak secret if the environment is misconfigured.

`docker-compose.yml` also contains hardcoded secrets like:

```yaml
POSTGRES_PASSWORD: strongpassword
REDIS_PASSWORD: strongpassword
```

`BE/knexfile.js` has:

```js
password: process.env.DB_PASSWORD || ''
```

### Exact fix

In `BE/src/app.js`:

```js
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production');
}

const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'development-secret',
  ...
};
```

For production, require a non-empty secret and fail startup if it is missing.

In `BE/knexfile.js`:

```js
if (process.env.NODE_ENV === 'production' && !process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD is required in production');
}
```

In `docker-compose.yml`, replace plaintext defaults with environment-file values and avoid shipping weak passwords in the repository.

### Why this fixes it

- Stops insecure default secret usage.
- Makes deployment fail clearly instead of silently using insecure values.
- Ensures environment values are required for production.

### Validation

- Run the app in production mode without `SESSION_SECRET` and confirm startup fails.
- Run with blank `DB_PASSWORD` in production and confirm it fails.

---

## 5) Fix: missing security middleware

### Problem in repo

`BE/src/app.js` includes `helmet`, but the app still lacks a strict CORS policy and explicit CSRF protection beyond the session cookie settings.

### Exact fix

Add explicit middleware:

```js
const cors = require('cors');
const csrf = require('csurf');

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : false,
  credentials: true,
}));

app.use(csrf({ cookie: true }));
```

Use a safe cookie strategy and make sure the front end reads the CSRF token from a cookie header or metadata.

### Why this fixes it

- Adds browser security protections.
- Prevents cross-origin misuse.
- Prevents CSRF-based session abuse on cookie-auth flows.

### Validation

- Confirm CSRF tokens are required on state-changing endpoints.
- Confirm unknown origins are blocked by CORS rules.

---

## 6) Fix: missing input validation for registration

### Problem in repo

`BE/src/controllers/auth.controller.js` does only presence checks.

```js
if (!name || !phone_number || !email || !password) 
  return res.status(400).json({ ok: false, message: 'Missing required fields' });
```

There is no email validation or password-strength check.

### Exact fix

Use an explicit validator layer or server-side checks:

```js
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  return res.status(400).json({ ok: false, message: 'Invalid email format' });
}

if (password.length < 12) {
  return res.status(400).json({ ok: false, message: 'Password must be at least 12 characters' });
}
```

Also perform password strength rules such as uppercase, lowercase, number, and special-character checks if required.

### Why this fixes it

- Enforces a minimum quality for credentials.
- Reduces malformed input entering the auth system.
- Makes validation rules explicit and testable.

### Validation

- Check invalid email addresses are rejected.
- Check weak passwords are rejected.

---

## 7) Fix: information disclosure from duplicate-user and permission responses

### Problem in repo

`BE/src/controllers/auth.controller.js`:

```js
if (existing)
  return res.status(409).json({ ok: false, message: 'Email already registered' });
```

`BE/src/middleware/auth.middleware.js`:

```js
if (!realResource) {
  return res.status(404).json({ ok: false, message: `${resourceType} not found` });
}
```

This leaks whether an email or resource exists.

### Exact fix

Return generic errors for account existence and resource existence where appropriate.

Example:

```js
if (existing) {
  return res.status(409).json({ ok: false, message: 'Registration failed' });
}
```

And for resource access:

```js
if (!realResource) {
  return res.status(404).json({ ok: false, message: 'Resource not found' });
}
```

Keep the public API consistent and avoid exposing a distinction between “not found” and “forbidden” unless the caller is already authorized.

### Why this fixes it

- Prevents account and resource enumeration.
- Makes API responses less helpful to attackers.
- Preserves a cleaner security posture.

### Validation

- Confirm identical result shapes are returned for duplicate-email and unknown-email attempts.

---

## 8) Fix: route-level-only authorization

### Problem in repo

`BE/src/middleware/auth.middleware.js` enforces access at the route boundary, but repository/service layers do not independently enforce ownership and authorization.

### Exact fix

Add a reusable authorization service and call it from both middleware and business logic.

Example:

```js
async function canUserAccessProject(userId, projectId) {
  const project = await projectRepo.getProjectById(projectId);
  if (!project) return false;
  return project.created_by === userId;
}
```

Then call this in both the middleware and the project service before mutation.

### Why this fixes it

- Prevents bypasses when routes are skipped or future routes are added incorrectly.
- Creates defense-in-depth across layers.

### Validation

- Direct service calls without middleware should still be denied if user does not own the project.

---

## 9) Fix: Redis cache invalidation misses resource-scoped keys

### Problem in repo

`BE/src/services/pdp.service.js` invalidates cache with wildcard keys:

```js
const keys = await redisClient.keys(`user_permissions:${userId}*`);
```

But `BE/src/repositories/userAttributes.repo.js` invalidates only:

```js
const cacheKey = `user_permissions:${userId}`;
await redisClient.del(cacheKey);
```

This misses resource-scoped keys like:

```js
user_permissions:15:project:5
```

### Exact fix

Create one centralized invalidation method:

```js
async function invalidateUserPermissionCache(userId, resourceType = null, resourceId = null) {
  const keys = [];
  keys.push(`user_permissions:${userId}`);

  if (resourceType && resourceId) {
    keys.push(`user_permissions:${userId}:${resourceType}:${resourceId}`);
  }

  await Promise.all(keys.map((key) => redisClient.del(key)));
}
```

Then call the same helper in every mutation path:

- `BE/src/repositories/userAttributes.repo.js`
- `BE/src/repositories/roleAttributes.repos.js`
- any future permission mutation paths

### Why this fixes it

- Prevents stale cache entries from remaining active after grants or revocations.
- Makes cache invalidation match the key shapes actually used in the PDP.

### Validation

- Revoke a project ownership attribute and verify the resource-scoped key is removed.

---

## 10) Fix: cache-aside race and TOCTOU window

### Problem in repo

The PDP caches permission results in Redis with a 5-minute TTL.

```js
await redisClient.setEx(cacheKey, 300, JSON.stringify(effectivePermissions));
```

No versioning or lock prevents stale reads during concurrent update operations.

### Exact fix

Add a permission version to the cache key:

```js
const version = await getPermissionVersion(userId);
const cacheKey = `user_permissions:${userId}:${version}`;
```

When a permission changes, increment the version and invalidate old entries.

Another approach is to keep a short TTL and recompute aggressively on updates.

### Why this fixes it

- Reduces the chance that a stale permission set gets served after a permission mutation.
- Shrinks the window where concurrent readers see inconsistent authorization state.

### Validation

- Run two concurrent permission-update tests and confirm every read sees consistent state.

---

## 11) Fix: weak dynamic attribute matching and permission requirement resolution

### Problem in repo

`BE/src/repositories/permissionAttributes.repo.js` does:

```js
const results = await knex('permissions')
  .join('permission_attributes', 'permissions.id', 'permission_attributes.permission_id')
  .join('attributes', 'permission_attributes.attribute_id', 'attributes.id')
  .select('permissions.action', 'permissions.resource', 'attributes.name');
```

It selects `permissions.resource` instead of `attributes.resource`, and the PDP expects composite keys such as `is_admin:global` or `is_owner:project`.

### Exact fix

Change the join to select the attribute resource and align the key format.

```js
.select(
  'permissions.action',
  'permissions.resource as permission_resource',
  'attributes.name',
  'attributes.resource'
)
```

Then build the requirement key consistently:

```js
const key = `${row.action}:${row.resource || row.permission_resource}`;
```

Also ensure the actual attributes table holds the intended metadata.

### Why this fixes it

- Makes permission requirements line up with the actual attribute records.
- Prevents composite keys from being mismatched at the DB boundary.

### Validation

- Verify `is_admin:global` and `is_owner:project` are both resolved correctly.

---

## 12) Fix: role creation race and check-then-act pattern

### Problem in repo

`BE/src/repositories/role.repo.js`:

```js
async function findOrCreate(name, trx) {
  let r = await (trx || knex)('roles').where({ name }).first();
  if (!r) r = await insertRole(name, trx);
  return r;
}
```

This is a race condition because two requests can both decide the role is missing and then both insert it.

### Exact fix

Add unique constraint on `roles.name` in the migration and then handle duplicate-key errors safely.

```js
async function findOrCreate(name, trx) {
  const db = trx || knex;
  try {
    const existing = await db('roles').where({ name }).first();
    if (existing) return existing;
    return await db('roles').insert({ name }).returning('*');
  } catch (err) {
    if (err.code === '23505' || err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return db('roles').where({ name }).first();
    }
    throw err;
  }
}
```

### Why this fixes it

- Converts a check-then-act race into a safe database-driven pattern.
- Makes duplicate role creation deterministic under concurrency.

### Validation

- Simulate two simultaneous role creations for the same name.
- Confirm only one row exists and both requests succeed with consistent results.

---

## 13) Fix: `verifyPassword` plaintext fallback bug

### Problem in repo

`BE/src/services/auth.service.js` has:

```js
async function verifyPassword(plain, hash) {
  if (!hash) return plain === hash;
  return bcrypt.compare(plain, hash);
}
```

This allows `plain === undefined` or a bad comparison to masquerade as a valid result when no hash exists.

### Exact fix

```js
async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}
```

### Why this fixes it

- Prevents invalid or missing hash values from authenticating users.
- Enforces a strict password verification contract.

### Validation

- Test a login request with a missing hash value and ensure it fails.

---

## 14) Fix: `taskRepo` is empty and task resource authorization fails

### Problem in repo

`BE/src/middleware/auth.middleware.js` contains:

```js
const taskRepo = require('../repositories/task.repo');
```

But `BE/src/repositories/task.repo.js` is empty, so `taskRepo.findById` throws.

### Exact fix

Create a real task repository implementation with `findById` or remove task resource support from `resourceResolvers` until implemented.

```js
async function findById(id) {
  return knex('tasks').where({ id }).first();
}
```

Then in `resourceResolvers`:

```js
task: async (id) => await taskRepo.findById(id)
```

### Why this fixes it

- Prevents unexpected 500s during task authorization checks.
- Enables task-based authorization to work when the feature is used.

### Validation

- Call a task-protected route and confirm it resolves or denies correctly instead of throwing a 500.

---

## 15) Fix: silent resource context failure when `resourceType` or `idParamName` is wrong

### Problem in repo

`BE/src/middleware/auth.middleware.js` does:

```js
if (resourceType && req.params[idParamName]) {
  const resourceId = req.params[idParamName];
  const resolver = resourceResolvers[resourceType];

  if (resolver) {
    const realResource = await resolver(resourceId);
    ...
  }
}
```

If `resolver` is missing or the route param name does not match, then `context` remains null and ownership checks are silently skipped.

### Exact fix

Fail loudly when a route declares a resource type but no resolver exists.

```js
if (resourceType && !resourceResolvers[resourceType]) {
  throw new Error(`No resource resolver configured for ${resourceType}`);
}
```

Also validate the route param name:

```js
if (resourceType && !(idParamName in req.params)) {
  return res.status(400).json({ ok: false, message: `Missing ${idParamName} param` });
}
```

### Why this fixes it

- Prevents silent authorization bypass.
- Makes configuration errors visible and actionable.

### Validation

- Use a route with a missing resolver and assert it fails clearly.

---

## 16) Fix: `project.repo.js` stale code paths and undefined `createdBy` reference

### Problem in repo

`BE/src/repositories/project.repo.js` contains both a table typo and a real runtime bug:

```js
async function getProjectByName(name) {
    return knex('rojects').where({name}).first();
}
```

and:

```js
if (!p) p = await insertProject(name, description, createdBy, trx);
```

This is not just a naming mismatch. `createdBy` is undefined in this scope, even though the function already received a `created_by` parameter. The moment this branch executes, it throws a `ReferenceError`.

This is a direct runtime failure in the project repository, not a hypothetical issue.

### Exact fix

```js
async function getProjectByName(name) {
  return knex('projects').where({ name }).first();
}

async function findOrCreate(name, description, created_by, trx) {
  const db = trx || knex;
  let p = await db('projects').where({ name }).first();
  if (!p) p = await insertProject(name, description, created_by, trx);
  return p;
}
```

Update all callers accordingly so the parameter name is consistent with the schema and the repository contract:

```js
projectRepo.findOrCreate(name, description, created_by, trx);
```

### Why this fixes it

- Removes the undefined variable access that causes the runtime crash.
- Corrects the table name to `projects`.
- Keeps the repository contract consistent with the schema field `created_by`.

### Validation

- Call `findOrCreate` with a valid `created_by` value and confirm it does not throw `ReferenceError`.
- Confirm project creation inserts the proper `created_by` field into the row.

---

## 17) Fix: role-attribute and user-attribute cache invalidation mismatch

### Problem in repo

`BE/src/repositories/userAttributes.repo.js` invalidates only `user_permissions:${userId}` and not resource-scoped keys. `BE/src/services/pdp.service.js` also writes keys like `user_permissions:${userId}:${resourceType}:${resourceId}`.

### Exact fix

Use the same helper for all resource and non-resource cache invalidations:

```js
async function invalidateUserPermissionCache(userId, resourceType = null, resourceId = null) {
  const keys = [`user_permissions:${userId}`];
  if (resourceType && resourceId) {
    keys.push(`user_permissions:${userId}:${resourceType}:${resourceId}`);
  }

  await Promise.all(keys.map((key) => redisClient.del(key)));
}
```

Then call it from both user-attribute and role-attribute mutation sites.

### Why this fixes it

- Prevents stale resource-scoped authorization decisions.
- Keeps Redis cache consistent with current DB state after attribute changes.

### Validation

- Change user attributes and assert the resource-scoped cache entries are removed.

---

## 18) Fix: insecure Redis connection setup and duplicate connect calls

### Problem in repo

`BE/src/redis/client.js` and `BE/src/utils/startServer.js` both establish a Redis connection path, and reconnect logic is only partially applied depending on config style.

### Exact fix

Create one central connection builder and invoke it once from startup.

Example:

```js
const redis = createRedisClient(process.env.REDIS_URL || {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
});
```

Then call `redis.connect()` only once in a single initialization path.

### Why this fixes it

- Prevents duplicate connections from the same app.
- Makes reconnect logic consistent for `REDIS_URL` and host/port configuration.

### Validation

- Start the app and verify only one Redis connection is created.

---

## 19) Fix: rate limiter is in-memory and not cluster-safe

### Problem in repo

`BE/src/middleware/rateLimit.middleware.js` stores buckets in a local `Map`.

```js
const buckets = new Map();
```

This does not work across multiple app instances and will grow without eviction.

### Exact fix

Move the limiter state to a shared store such as Redis or a proper distributed token bucket service. If a local fallback is kept, add expiration and eviction.

Example:

```js
const bucketKey = `rate_limit:${matchedPrefix}:${keyGenerator(req)}`;
// store token counts in Redis with TTL
```

### Why this fixes it

- Makes rate limiting consistent across multiple app instances.
- Prevents unbounded memory growth.

### Validation

- Start two app instances and verify the same limit applies across them.

---

## 20) Fix: no login-specific rate limit or lockout

### Problem in repo

The app has only a generic API rate-limiter in `BE/src/middleware/rateLimit.middleware.js`.

### Exact fix

Add a separate login limiter specifically for `/api/auth/login`.

```js
const loginLimiter = createTokenBucketRateLimiter(['/api/auth/login'], {
  capacity: 10,
  refillRate: 1,
  keyGenerator: (req) => `${req.ip}:${req.body?.email || 'unknown'}`
});
```

Apply it to the login endpoint only.

### Why this fixes it

- Reduces brute-force and credential-stuffing risk.
- Creates a targeted protection layer for the most important auth endpoint.

### Validation

- Send repeated invalid login attempts and ensure they are rate-limited.

---

## 21) Fix: database schema and uniqueness gaps

### Problem in repo

The migration files under `BE/src/db/migrations/20260803_*.js` added `resource_id`, but the unique constraints still do not fully represent the intended resource-scoped permissions.

### Exact fix

Define composite unique constraints that match the expected resource-scoped semantics.

Example:

```js
table.unique(['role_id', 'attribute_id', 'resource_id']);
```

or, if the model is meant to allow either global or resource-scoped records, enforce the correct representation explicitly in the DB schema and application logic.

Also ensure `attributes.resource` is considered in any uniqueness constraint if it is part of the identity.

### Why this fixes it

- Aligns the database model with the authorization model.
- Makes permission grants unambiguous and consistent.

### Validation

- Attempt to create conflicting global and instance-scoped grants and confirm that the DB enforces the intended behavior.

---

## 22) Fix: `userRole.repo.getRolesForUser` inefficient lookup pattern

### Problem in repo

`BE/src/repositories/userRole.repo.js` likely queries the trailing column of a composite primary key.

### Exact fix

Add an index or reorder the data access to match the most common query pattern.

Example:

```js
return knex('user_roles')
  .where({ user_id: userId })
  .select('role_id');
```

And if the composite key is used, ensure the leading or most selective column is part of the query to minimize table scans.

### Why this fixes it

- Improves permission lookup latency.
- Reduces DB work during request auth and session rehydration.

### Validation

- Measure query time when retrieving roles for a user with multiple role links.

---

## 23) Fix: SQLite tests do not enforce foreign keys

### Problem in repo

The test setup does not enable SQLite foreign-key enforcement.

### Exact fix

Add in the test setup:

```js
beforeEach(async () => {
  await knex.raw('PRAGMA foreign_keys = ON');
});
```

or set it in the SQLite config when creating the test database.

### Why this fixes it

- Ensures the test DB behaves like the production DB more closely.
- Exposes integrity problems earlier.

### Validation

- Run a test that violates a foreign key and confirm it fails.

---

## 24) Fix: mock-heavy tests hide the real auth defect

### Problem in repo

`BE/tests/integration/authFlow.test.js` mocks the PDP and makes the route look correct even though the real contract is broken.

### Exact fix

Replace the mock-heavy test with real integration checks using the actual route and PDP flow.

Examples to add:

- A real request hitting the project route with a valid `read:project` permission.
- A denial test for a user missing the required permission.
- A registration test rejecting `roles: ['admin']`.
- A project ownership denial test for a different user.

### Why this fixes it

- Tests start validating real behavior instead of mocked assumptions.
- The contract mismatch becomes visible in the suite.

### Validation

- Run the auth flow test without mocking the PDP and confirm the actual route behavior is exercised.

---

## 25) Fix: logout and session cleanup should not swallow errors

### Problem in repo

`BE/src/controllers/auth.controller.js` has:

```js
exports.logout = (req, res) => {
  req.logout(() => {});
  req.session && req.session.destroy(() => res.json({ ok: true }));
};
```

If `req.session` is undefined, the response may never finish, and logout callback errors are ignored.

### Exact fix

```js
exports.logout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    if (req.session) {
      req.session.destroy((destroyErr) => {
        if (destroyErr) return next(destroyErr);
        return res.json({ ok: true });
      });
      return;
    }
    return res.json({ ok: true });
  });
};
```

### Why this fixes it

- Ensures logout completes consistently.
- Prevents hanging responses and silent callback failure.

### Validation

- Call logout without a session and verify response completion.

---

## 26) Fix: project attribute/resource identity mismatch

### Problem in repo

The code uses resource-oriented attribute keys, but the database schema and repo queries are not fully aligned with the attribute metadata used by the PDP.

### Exact fix

Choose a single identity model for attributes:

- either global-only attributes
- or resource-scoped attributes with `resource_id` and `resource`

Then update all repository queries and PDP code to build composite keys from the same fields.

Example:

```js
const key = resourceId !== undefined && resourceId !== null
  ? `${name}:${resource}:${resourceId}`
  : `${name}:${resource}`;
```

### Why this fixes it

- Aligns the DB schema and the PDP logic.
- Removes mismatches between attribute identity and runtime access decisions.

### Validation

- Verify both global and project-scoped attributes compute the correct keys.

---

## 27) Fix: password hashing and bcrypt config

### Problem in repo

The code already uses bcrypt and a cost of 10 in `BE/src/services/auth.service.js`:

```js
const hashed = password ? await bcrypt.hash(password, 10) : null;
```

This is acceptable, but it should be enforced consistently and checked for password validation. The current code does not reject weak passwords before hashing.

### Exact fix

Add password validation before hashing, and keep the bcrypt cost at 12 or above if the project policy requires stronger work factor.

```js
if (password.length < 12) {
  return res.status(400).json({ ok: false, message: 'Password too weak' });
}
```

### Why this fixes it

- Keeps password hashing strong and aligned with policy.
- Prevents weak credentials from being stored even though they are hashed.

### Validation

- Submit a weak password and verify it fails before persisting.

---

## 28) Fix: missing `is_owner` seeding and ownership setup

### Problem in repo

The review noted that the migration and seed set do not clearly wire the `is_owner` permission to the correct resource type.

### Exact fix

Add or correct the seed definitions so that the ownership attribute is created for each supported resource type, for example:

```js
{ name: 'is_owner', resource: 'project' }
```

Then ensure the PDP matches that attribute to the owner context in `context.ownerId === userId` logic.

### Why this fixes it

- Makes the ownership attribute meaningful.
- Ensures permission rules and database grants line up with the ABAC model.

### Validation

- Confirm that a project owner receives `is_owner:project` in the effective permission set.

---

## 29) Fix: generic error handler and REST consistency

### Problem in repo

`BE/src/app.js` has a single generic 500 response:

```js
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});
```

This hides resource-level semantics and makes debugging harder.

### Exact fix

Add a small error mapping layer:

```js
app.use((err, req, res, next) => {
  if (err.name === 'ValidationError') {
    return res.status(400).json({ ok: false, message: err.message });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }

  if (err.code === 'ECONNREFUSED' || err.code === 'ERR_REDIS' || err.code === 'ER_BAD_DB_ERROR') {
    return res.status(503).json({ ok: false, message: 'Service unavailable' });
  }

  console.error(err.stack);
  return res.status(500).json({ ok: false, message: 'Internal Server Error' });
});
```

### Why this fixes it

- Distinguishes client, auth, and infrastructure failures.
- Makes the API easier to diagnose and monitor.

### Validation

- Trigger validation failure, auth failure, and Redis failure and confirm the correct status code is returned.

---

## 30) Implementation order

The recommended order of fixes is:

1. Permission string contract (`checkPerm` and PDP)
2. Registration role assignment and privilege escalation
3. Ownership enforcement at repository/data layer
4. Cache invalidation and stale permission keys
5. Secret defaults and session security
6. Missing security middleware and input validation
7. Schema constraints and attribute identity fixes
8. Rate limiting and login-specific protections
9. Test improvements and foreign-key enforcement
10. Performance improvements and pagination

This order minimizes the highest-risk issues first while preserving the application’s existing architecture.

---

## 31) Final note

These fixes are intended to be implemented as separate change tickets, not as a single monolithic patch. Each item should include:

- the exact code file to change
- the failing scenario or root cause
- the concrete fix
- the validation test to prove the issue is resolved

This keeps the remediation process disciplined and makes each security or reliability fix easier to review and roll back if needed.
