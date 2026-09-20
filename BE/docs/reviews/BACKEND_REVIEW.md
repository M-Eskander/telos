# Backend Review Report

## 1. Review Scope and Conventions

This report is a review of the backend architecture, authorization model, caching behavior, reliability posture, and test strategy in the current codebase. It is intentionally written as a teaching review: each important issue is framed as a finding, with the problem, why it matters, and the likely failure mode explained without prescribing implementation changes.

This ticket is limited to analysis and documentation only. No source code is modified.

### Severity scale

- 🔴 CRITICAL
- 🟠 HIGH
- 🟡 MEDIUM
- 🔵 LOW

### Finding label set

- definite bug
- security vulnerability
- likely bug
- architectural concern
- maintainability concern
- subjective design preference

### Teaching-mode template for each important finding

Each important finding is written using the same teaching template:

1. What is wrong
2. Why it is a problem
3. What failure it can cause
4. Short scenario
5. Solution hint
6. Concept to research

This template is used to explain how the system behaves, why the issue matters, and what kind of design or defense should be studied later. It is not a prescriptive rewrite list.

### Full request-flow trace requirement

Each important finding is traced across the full request flow in the codebase:

- request
- middleware
- authentication
- authorization
- controller
- service
- database / Redis
- response

This ensures the review stays grounded in how a request actually moves through the system, rather than focusing only on one layer in isolation.

---

## 2. Executive Summary

The codebase has a generally understandable layering pattern: routes, controllers, services, repositories, and configuration are organized in a way that makes the system legible and modular. The password hashing path is aligned with a strong password hashing standard, and the Knex query layer is parameterized rather than string-concatenated. Redis is also treated defensively: when Redis is unavailable, the PDP falls back to direct database-based permission computation instead of silently allowing access.

The main weakness is not a lack of structure but a broken authorization story. The route-level permission middleware and the PDP contract are not aligned, and the ABAC retrofit is incomplete. The resource-scoping model is partially implemented, but the ownership metadata and permission wiring are inconsistent, leaving the system vulnerable to weak object-level authorization and fragile cache behavior.

The systemic themes that repeatedly appear are:

- route-level-only authorization
- inconsistent cache invalidation
- weak secret defaults
- a test suite that hides the authorization defect

Those themes are visible across the stack: the auth middleware checks rights at the request entry point, while lower layers trust the caller; the cache invalidation logic covers some keys but misses resource-scoped variants; secret defaults are permissive and make insecure deployments easier; and tests mock away the contract mismatch instead of exercising the real router-to-PDP integration.

Taken together, the codebase is promising in structure but incomplete in security semantics. The authorization system is the most important theme because it determines whether the application enforces object-level access correctly and whether any future ABAC extension can be trusted.

---

## 3. Critical Findings

### Finding 1: Permission-string contract mismatch in the router/PDP contract

- Severity: 🔴 CRITICAL
- Label: definite bug

#### What is wrong

The permission contract is inconsistent across the app. In `BE/src/routes/projectRouter.js`, the route checks `checkPerm('read', 'project')`, while the PDP service in `BE/src/services/pdp.service.js` expects permission keys shaped like `read:project` and compares them using `effectivePermissions.includes(requiredPermission)`. That means the middleware and PDP are not speaking the same permission language.

#### Why it is a problem

The route is effectively asking for a bare verb, while the PDP is evaluating composite action/resource keys. The consumer and provider disagree on the contract, and the result is that the authorization check never matches in the current runtime path.

#### What failure it can cause

This failure can deny all otherwise valid permissions, or lead the app to fail closed in an inconsistent and surprising way. Because the contract mismatch is built into the permission system, the authorization layer can block legitimate access even when the user has the correct role or attribute grants.

#### Short scenario

A user with the role or attribute grants needed to read a project reaches the route, but `checkPerm` passes the string `read` while `pdp.service.getEffectivePermissions()` produces `['read:project']`. The check fails because `['read:project'].includes('read')` is false.

#### Solution hint

Normalize the contract so every layer uses the same representation. The safest review target is the permission string format used by the router, middleware, PDP, and all attribute seeds.

#### Concept to research

Permission contract design, action-resource keys, and contract validation between middleware and policy engines.

Evidence: `BE/src/routes/projectRouter.js`, `BE/src/middleware/auth.middleware.js`, `BE/src/services/pdp.service.js`, `BE/tests/integration/authFlow.test.js`.

---

### Finding 2: Registration privilege escalation through role injection

- Severity: 🔴 CRITICAL
- Label: security vulnerability

#### What is wrong

The registration controller forwards client-supplied roles straight into the user-creation path. In `BE/src/controllers/auth.controller.js`, the registration handler accepts request content that includes role names, and `BE/src/services/auth.service.js` passes those values into `createUser` and role lookups. The repository layer then uses `role.repo.findOrCreate`, which auto-creates and links roles by name without any authorization check.

#### Why it is a problem

This turns a user registration flow into a role-assignment primitive. If a client submits `{"roles":["admin"]}` and the system accepts the role without validating whether the requester is allowed to assign that role, the request can grant admin privilege to a brand-new account.

#### What failure it can cause

This is a direct privilege-escalation path. A malicious user can create a new account with privileged roles and immediately use those roles to bypass intended access boundaries.

#### Short scenario

A public registration endpoint receives a payload like `{"email":"attacker@example.com","password":"Password123!","roles":["admin"]}`. The role repository creates the `admin` role if missing, links the user to it, and the client now has elevated access that should have been server-controlled.

#### Solution hint

Restrict role assignment to trusted administrative flows and remove user-controlled roles from the public registration path. At minimum, the server should enforce a fixed allowlist and reject any attempt to assign privileged roles.

#### Concept to research

Privilege escalation, role assignment boundaries, least privilege, and server-side authorization of administrative mutations.

Evidence: `BE/src/controllers/auth.controller.js`, `BE/src/services/auth.service.js`, `BE/src/repositories/role.repo.js`, `BE/src/repositories/userRole.repo.js`.

---

### Finding 3: IDOR/BOLA exposure from missing ownership enforcement in the data layer

- Severity: 🔴 CRITICAL
- Label: security vulnerability

#### What is wrong

The project authorization flow does not enforce ownership at the repository level. `BE/src/repositories/project.repo.js` filters by a bare `id` and does not include `created_by` or `owner` conditions, while the seed model and policy expectations do not wire `is_owner` cleanly into the permission set. The code path is therefore relying on route-level middleware without a downstream defense-in-depth check.

#### Why it is a problem

If a valid user passes an object id that is not theirs, the repository will happily fetch or mutate the target resource if the route-level check is bypassed or misconfigured. The policy is incomplete by design, and the lower layers do not add a second barrier.

#### What failure it can cause

This pattern enables insecure direct object reference or broken object-level authorization. A user with a valid login can access or modify another user’s project if the route-level guard is missing, miswired, or bypassed.

#### Short scenario

A user authenticates and calls a project update or delete route for project 5. The controller is reached, the route-level permission passes in a misconfigured context, and the repository updates the row by `id = 5` without checking whether the request user owns that project.

#### Solution hint

Verify ownership at the repository layer and keep the ownership check aligned with the resource type and resource id used by the route. Do not rely exclusively on middleware.

#### Concept to research

Object-level authorization, broken object-level authorization (BOLA), defense in depth, and ownership checks at data boundaries.

Evidence: `BE/src/repositories/project.repo.js`, `BE/src/controllers/project.controller.js`, `BE/src/services/project.service.js`, `BE/src/db/seeds/permissions_seed.js`, `BE/src/db/migrations/20260803_*.js`.

---

## 4. Security Review

### Registration privilege-escalation vector

The registration flow is a significant security concern because the client can influence role assignment. Evidence shows that the registration handler accepts user data, including `roles`, and passes it into the service and repository layers without a server-side authorization gate. That path is especially dangerous because the repository creates roles by name when they do not exist.

Attacker scenario: a malicious user creates an account with a payload containing `{"roles":["admin"]}` or `{"roles":["editor"]}` and receives a new authenticated account with elevated rights. The failure is not accidental; it is a direct consequence of user-controlled roles being accepted by a trusted server-side user creation path.

Evidence: `BE/src/controllers/auth.controller.js`, `BE/src/services/auth.service.js`, `BE/src/repositories/role.repo.js`, `BE/src/repositories/userRole.repo.js`.

### Authorization-format mismatch remains a security issue

The permission string mismatch between the router and PDP means that the check can fail in ways that are both inconsistent and difficult to audit. If the middleware passes a bare verb while the PDP expects an action/resource composite, the authorization policy effectively becomes non-functional or fail-closed in unexpected places.

Attacker scenario: an attacker triggers a route that should be allowed to a valid user and observes that the route denies access because the permission contract is mismatched. This is not just a usability issue; it can be turned into a resource-denial condition and can obscure whether the route is blocked by policy or by a contract bug.

Evidence: `BE/src/routes/projectRouter.js`, `BE/src/middleware/auth.middleware.js`, `BE/src/services/pdp.service.js`.

### Weak session secret

`BE/src/app.js` contains a fallback to `SESSION_SECRET || 'change_this_secret'`. That means a deployment that forgets to set environment secrets can still start with a known, weak secret. In production, this is a serious operational risk because the session signing key is one of the foundation blocks of login security.

A weak session secret allows session forgery or tampering if the application is deployed without proper configuration. The risk is not abstract; it is a real configuration mistake that makes the app fail open in the worst possible way.

Evidence: `BE/src/app.js`.

### Secret defaults in container and database config

`docker-compose.yml` hardcodes `strongpassword` and passes a Redis password directly in the environment. In addition, `BE/knexfile.js` falls back to `DB_PASSWORD || ''` for production, which creates a fail-open blank-password condition if the environment variable is unset or misconfigured.

This is a configuration hygiene issue, but it directly affects the security posture of the platform because the application becomes easier to bring up with insecure secrets. In production, blank or default credentials are not defensible.

Evidence: `docker-compose.yml`, `BE/knexfile.js`, `BE/src/config/knex.js`, `BE/.env.example`.

### Missing security middleware

The application lacks common HTTP and session hardening middleware such as `helmet`, a configurable `cors` policy, and CSRF protection beyond `sameSite: 'strict'` on session cookies. This is a medium-level risk because the app is not fully hardened against browser-side attacks and cross-origin abuse.

The absence of these protections is not a direct vulnerability by itself, but it reduces defense-in-depth and makes the application more exposed when combined with insecure defaults or misconfigured routes.

Evidence: `BE/src/app.js`, `BE/src/middleware/auth.middleware.js`.

### Missing input validation

The registration flow checks only for presence and does not validate email format or password strength. That means untrusted input is accepted too early, and the application fails to enforce a baseline quality gate before creating new identities.

This does not in itself create a critical vulnerability, but it is part of the weak security posture around user creation and account management. It leaves room for malformed or low-quality credentials and weakens the application’s trust boundary.

Evidence: `BE/src/controllers/auth.controller.js`, `BE/src/services/auth.service.js`.

### Information disclosure

The registration flow returns `409 Email already registered`, which leaks account existence to an unauthenticated or low-privileged caller. The permission middleware also distinguishes between a missing resource and a forbidden state through a `404` vs `403` response pattern, which can leak resource existence and internals.

This is a classic enumeration issue. Attackers can learn whether a user exists or whether a resource is present by measuring the server’s response pattern.

Evidence: `BE/src/controllers/auth.controller.js`, `BE/src/middleware/auth.middleware.js`.

### Confirmed negatives: no SQL injection, no command injection, no path traversal, no SSRF, no XSS

The application uses Knex query builders parameterized by the DB layer, which substantially reduces the risk of SQL injection. There is no evidence of command execution, path traversal, SSRF, or direct XSS in the reviewed authentication and authorization paths. The current codebase is not dominated by those classic web-app issues.

Evidence: `BE/src/config/knex.js`, `BE/src/repositories/*.js`, `BE/src/app.js`.

---

## 5. Authentication and Authorization Review

### Flow trace: login, session, middleware, policy, and response

The auth flow begins with login through Passport local strategy and session establishment. The session stores only the user id, and on each request `deserializeUser` re-fetches the user and role information before the authorization check. The request then passes through the permission middleware, which calls `checkPerm` and then `pdp.service.getEffectivePermissions()`; the PDP computes permissions from role attributes and user attributes, and the request ultimately either proceeds or returns a denial.

This flow is logically clean, but its enforcement is incomplete because the permission guard is not fully aligned with the actual resource-scoping model. The route-level checks are the primary enforcement boundary, and the lower layers do not provide a strong second layer.

Evidence: `BE/src/app.js`, `BE/src/middleware/auth.middleware.js`, `BE/src/services/pdp.service.js`, `BE/src/controllers/auth.controller.js`, `BE/src/services/auth.service.js`.

### ABAC computation and the owner token model

The PDP performs role-attribute and user-attribute overlay logic. The model includes role attributes, user-attribute add/remove overrides, and a dynamic `is_owner:<resourceType>` token derived from a request context check comparing `context.ownerId === userId`.

This is the intended ABAC shape, and it is a sensible direction: access decisions are derived from more than just role membership. The problem is that the ownership metadata is not consistently present in the data layer, so the rule depends too heavily on the middleware recomputing the owner relationship on each request.

Evidence: `BE/src/services/pdp.service.js`, `BE/src/repositories/roleAttributes.repos.js`, `BE/src/repositories/userAttributes.repo.js`, `BE/src/repositories/permissionAttributes.repo.js`.

### Ownership matching is type-level only

The mismatch is significant: the system tries to derive ownership by resource type, but the repository code does not consistently populate `resource_id` and the ownership metadata is often undefined. This means the authorization model depends on middleware reconstructing a per-request owner identity and passing it into the PDP, which is fragile and easy to misconfigure.

The issue is not only about correctness; it is about where the source-of-truth lives. If ownership is reconstructed on the fly and not preserved consistently in the database layer, authorization becomes easier to bypass in future routes or edge cases.

Evidence: `BE/src/repositories/project.repo.js`, `BE/src/repositories/userAttributes.repo.js`, `BE/src/repositories/roleAttributes.repos.js`, `BE/src/middleware/auth.middleware.js`.

### Permission-attribute mismatch in composite keys

`permissionAttributes.repo.getAllPermissionRequirements()` selects `permissions.resource` instead of `attributes.resource`, which means composite keys such as `is_admin:global` do not line up with the actual attribute model. The result is a subtle but important permission inconsistency: the code tries to evaluate resource-scoped composite permissions, but the repository reads the wrong field.

This is exactly the kind of bug that makes the authorization system look correct while silently narrowing or misfiring the attribute matching logic. It is a data-contract defect and is therefore a high-impact issue in the PDP.

Evidence: `BE/src/repositories/permissionAttributes.repo.js`.

### Task resource resolution is non-functional and fails closed

`BE/src/repositories/task.repo.js` is empty, and `resourceResolvers.task` calls `taskRepo.findById`, which throws and produces a 500. That means task authorization is not merely missing; it is wired to a path that fails when invoked. The system fails closed rather than creating a safe behavior, but the task resource is effectively non-functional from an authorization standpoint.

This is a medium-level functional problem because it blocks task-based policy checks even when the general auth layer is otherwise working.

Evidence: `BE/src/repositories/task.repo.js`, `BE/src/middleware/auth.middleware.js`.

### Missing resource type or mismatched id parameter silently degrades authorization

If a `resourceType` is absent from the resolver map, or the `idParamName` does not match the route contract, the code sets `context = null` and silently skips the ownership check. This is a latent IDOR vector because the enforcement step is effectively bypassed when the metadata does not line up.

The risk is especially dangerous because the system does not loudly fail; it quietly degrades. That is the most concerning type of authorization bug because it can go unnoticed while the app still appears to work.

Evidence: `BE/src/middleware/auth.middleware.js`.

### Password verification fallback is too permissive

`verifyPassword` has a plaintext fallback: `if (!hash) return plain === hash;`. This is a dangerous logic branch because it treats “no hash provided” as an acceptable equality check. It should deny when no hash exists rather than comparing plaintext to an undefined or empty hash.

This is a trust-boundary defect in the authentication layer. A missing hash should be treated as invalid credentials, not as a valid password match.

Evidence: `BE/src/services/auth.service.js`.

### Authorization is enforced only at route level

The system’s access control is primarily at the route level, and the controller/service/repository layers do not enforce independent trust boundaries. This is a classic defense-in-depth problem.

The consequence is that any future route bypass, any controller misuse, or any service invoked outside the expected route path can lead to unauthorized behavior. The app is only as strong as its entry-point authorization, not as strong as a layered model with internal guards.

Evidence: `BE/src/routes/projectRouter.js`, `BE/src/controllers/project.controller.js`, `BE/src/services/project.service.js`, `BE/src/repositories/project.repo.js`.

---

## 6. Redis/Caching Review

### Cache design and TTL

The permission caching design uses keys such as `user_permissions:<userId>` and `user_permissions:<userId>:<type>:<id>`, with a five-minute TTL. This is a reasonable cache-aside design, provided the invalidation logic stays aligned with each cache key pattern and each permission mutation path.

Because the model is keyed by user and resource type/id, the app is trying to avoid repeated permission queries while still supporting resource-level scoping. The limitation is that invalidation has not been implemented consistently across all mutation paths.

Evidence: `BE/src/services/pdp.service.js`, `BE/src/repositories/userAttributes.repo.js`, `BE/src/repositories/roleAttributes.repos.js`, `BE/src/redis/client.js`.

### Cache invalidation misses resource-scoped keys

`invalidateUserPermissionCache` uses a wildcard `keys()` sweep, but the mutation paths in user attribute and role attribute repos are calling flat-key `del` variants that do not remove the resource-scoped keys. This means a permission change affecting a resource-scoped grant may leave the stale value cached for the entire TTL.

Short scenario: a project owner permission is revoked for project 5, but the key `user_permissions:<userId>:project:5` remains warm in Redis for the full TTL. The user continues to read or modify the resource despite a revoked grant because the stale permission record is replayed from cache.

This is a direct cache consistency problem, and it is particularly dangerous because the stale data is permission data rather than metadata.

Evidence: `BE/src/services/pdp.service.js`, `BE/src/repositories/userAttributes.repo.js`, `BE/src/repositories/roleAttributes.repos.js`.

### Cache-aside write-invalidate race and TOCTOU window

The cache design has a classic time-of-check/time-of-use window: a mutation clears the cache, but a concurrent reader may repopulate stale permission data from the database before the write fully settles or before the next invalidation completes. There is no versioning, no lock, and no strong mechanism to guarantee that readers observe a fully consistent permission state.

This is not a simple optimization bug; it is a concurrency bug in a security-sensitive system. Permission data is sensitive and must remain consistent under load and concurrent updates.

Evidence: `BE/src/services/pdp.service.js`, `BE/src/redis/client.js`.

### Cross-instance cache inconsistency

The in-process `permissionRequirementsCache` is not shared across processes, so different app instances can serve different permission decisions for the same resource for up to five minutes. That creates an eventual consistency problem across nodes and can be observed as different authorization outcomes depending on which instance served the request.

This is an architectural concern because one node can be stale while another is current. The application has both permission caching and distributed state, but the invalidation model is not globally coherent.

Evidence: `BE/src/services/pdp.service.js`.

### Inconsistent Redis failure contract

`invalidateAllPermissionCaches` re-throws Redis errors while `invalidateUserPermissionCache` swallows them. This creates an inconsistent failure contract across the same category of operations. Some invalidation paths produce a hard failure, while others silently continue and leave stale cache state in place.

This inconsistency makes behavior hard to reason about during outages and can hide cache bugs that only surface under load or service interruptions.

Evidence: `BE/src/services/pdp.service.js`.

### Graceful degradation is a positive security property

`getEffectivePermissions` degrades gracefully to direct DB computation when Redis fails. This is a useful property because it does not convert an infrastructure outage into an authorization bypass. Even though the cache is imperfect, the failure path is safer than a blind fail-open route.

Evidence: `BE/src/services/pdp.service.js`.

---

## 7. Reliability and Concurrency Review

### Role creation is a check-then-act race

`role.repo.findOrCreate` is vulnerable to a classic race: two simultaneous requests can both evaluate the role as missing and then each insert a new role row or act on an unguarded path before uniqueness is enforced at the database level. This is especially likely when two users register with the same role name, such as `editor`.

The consequence is duplicate or inconsistent role state, which can lead to broken permission standardization and mismatched entitlements. The race is not necessarily catastrophic on its own, but it is a reliability issue in a system that makes trust decisions based on role membership.

Evidence: `BE/src/repositories/role.repo.js`.

### Link and attribute insertions are check-then-insert under concurrency

`linkRoleAttribute` and `addUserAttribute` operate as check-then-insert operations against uniquely constrained tables. Under race conditions, multiple threads can pass the existence check at the same time and then hit a unique constraint violation or inconsistent state.

This is a medium-risk reliability concern because it is not just about correctness; it directly shapes whether permission grants succeed under concurrent registration or permission assignment flows.

Evidence: `BE/src/repositories/roleAttributes.repos.js`, `BE/src/repositories/userAttributes.repo.js`.

### In-memory rate limiter is not cluster-safe

The rate limiter is in-memory and per-process, which means the effective limit is multiplied across instances. Because the `buckets` Map has no eviction and grows unbounded, the limiter will also memory-grow as traffic increases, especially under distributed deployment patterns.

This is a real reliability and observability issue: the application may appear to rate-limit correctly in one instance while not limiting at all across several independent processes.

Evidence: `BE/src/middleware/rateLimit.middleware.js`.

### No auth-specific rate limit or lockout on login

There is no login-specific throttling or account lockout mechanism beyond the shared `/api/` bucket. That leaves the authentication endpoint exposed to brute-force attempts, credential stuffing, and password spraying.

This is a medium-level risk because it affects one of the highest-value entry points in the system. The code has a generic limiter but not a targeted login defense.

Evidence: `BE/src/middleware/rateLimit.middleware.js`, `BE/src/controllers/auth.controller.js`.

### Redis connection is configured twice, and one path misses URL-based reconnect logic

`redis.connect()` is called twice: once on module load and once again in `startServer.js`. The `reconnectStrategy` is applied only to the host/port configuration path and not to the `REDIS_URL` path, which creates inconsistency in runtime behavior and deployment assumptions.

This is not always fatal, but it is a reliability smell because the app is creating more than one operational path for the same dependency. That increases the chance of drift and configuration mismatch.

Evidence: `BE/src/redis/client.js`, `BE/src/utils/startServer.js`.

---

## 8. Architecture Review

### Clear layering is a strength

The application has an understandable structure: routes define the public surface, controllers orchestrate requests, services contain the domain logic, repositories encapsulate database access, and configuration keeps environment concerns separate. This is a healthy baseline for a backend application and gives the review team a stable place to trace bugs and policy checks.

The architecture clarity is a positive feature and gives the team a solid foundation for future security work. The main issue is not that the system is badly organized; the issue is that important security logic is not correctly enforced at all layers.

Evidence: `BE/src/routes/*.js`, `BE/src/controllers/*.js`, `BE/src/services/*.js`, `BE/src/repositories/*.js`.

### Authorization logic is trapped in middleware

Authorization logic lives primarily in the route-level middleware, creating a coupling risk. The business logic and repository layer trust the caller and do not enforce ownership or access restrictions independently.

This means a future route, controller invocation, or internal service call can bypass the intended security policy simply by not using the same middleware path. The system is therefore only as secure as its route wiring, not as secure as a layered defense model.

Evidence: `BE/src/middleware/auth.middleware.js`, `BE/src/controllers/project.controller.js`, `BE/src/services/project.service.js`, `BE/src/repositories/project.repo.js`.

### Dead and duplicated code indicates drift from the schema

There are multiple stale code paths: `BE/src/repositories/attribute.repo.js` and `BE/src/repositories/permission.repo.js` query the removed `permissions.name` column, while `project.repo.js` contains a `findOrCreate` method that references `createdBy` and a `getProjectByName` method that queries `'rojects'` instead of `'projects'`.

These are maintainability concerns in the normal sense, but the `'rojects'` typo is a latent bug because it will break a real call or silently miss data when a lookup reaches that path. The review should treat it as a probable defect waiting for a route to touch it.

Evidence: `BE/src/repositories/attribute.repo.js`, `BE/src/repositories/permission.repo.js`, `BE/src/repositories/project.repo.js`.

### Unused transaction plumbing indicates stale patterns

`linkRoleAttribute` and `addUserAttribute` accept a `trx` object parameter, but no caller supplies it. This indicates transaction plumbing that has been left behind as the code evolved.

This is a maintainability concern rather than a direct user-visible bug, but it shows the repository layer is still carrying an older transaction pattern that is no longer used. That can confuse future maintenance and increases the risk of inconsistent transaction boundaries.

Evidence: `BE/src/repositories/roleAttributes.repos.js`, `BE/src/repositories/userAttributes.repo.js`.

---

## 9. Database Review

### Knex parameterization is a positive

All major queries are built with Knex, so there is no evidence of string-concatenated SQL injection. That is a real positive finding. The application is using a query builder rather than allowing raw SQL from untrusted input.

Evidence: `BE/src/repositories/*.js`, `BE/src/config/knex.js`.

### Resource-scoped grants are undermined by unique-constraint design

The migration added `resource_id` to role-attribute and user-attribute tables, but the unique constraints still cover only `(role_id/user_id, attribute_id)`. That means instance-level grants cannot coexist cleanly with type-level grants, which defeats the migration’s own goal of resource-scoped permissions.

This is a design bug with a direct effect on the ABAC model. The app is trying to support `is_owner:<resourceType>` and instance-specific grants, but the database identity model is still too coarse to represent them correctly.

Evidence: `BE/src/db/migrations/20260803_*.js`, `BE/src/repositories/roleAttributes.repos.js`, `BE/src/repositories/userAttributes.repo.js`.

### `attributes.name` is unique, but `resource` is not treated as a stable identity dimension

The model adds a `resource` field but does not revisit uniqueness around `name` and `resource` together. That creates an identity mismatch with the PDP composite key logic, which expects a richer identity to distinguish global versus local attributes.

This is a schema-level maintainability and correctness issue. The app is trying to model fine-grained attributes but the database uniqueness model does not fully reflect the policy semantics.

Evidence: `BE/src/db/migrations/20260803_*.js`, `BE/src/services/pdp.service.js`, `BE/src/repositories/permissionAttributes.repo.js`.

### `userRole.repo.getRolesForUser` uses a costly lookup pattern

The query filters by `user_id`, which is the trailing column in the composite PK `(role_id, user_id)`. This is not the most efficient lookup pattern and can lead to larger scans than necessary for a common operation.

The data model is currently shaped around a composite primary key, but the access path is filtering on the non-leading column. This is a classic schema access pattern issue and may be a source of performance drift under scale.

Evidence: `BE/src/repositories/userRole.repo.js`.

### N+1 attribute loading on cache misses

`getAttributesByRole` makes two queries per role on every cache miss, which creates an N+1 pattern when many roles are involved. The design hints at a better pattern using `WHERE name IN (...)` to fetch all relevant attributes at once.

This is a performance issue, but it also affects the auth latency and can add up under concurrency or when the permission cache has recently expired.

Evidence: `BE/src/repositories/roleAttributes.repos.js`, `BE/src/repositories/userAttributes.repo.js`, `BE/src/services/pdp.service.js`.

### Connection handling is thin and production defaults are weak

Development uses no pool block and no `acquireConnectionTimeout`, `idleTimeoutMillis`, or retry configuration. Production password fallback is also `''`, which creates a blank-password fail-open risk. The pool settings are missing the operational safeguards that a multi-service backend typically needs in production.

This reduces resilience during DB outages and makes the database layer more brittle under load or misconfiguration.

Evidence: `BE/src/config/knex.js`, `BE/knexfile.js`, `BE/src/db/migrations/*.js`.

### SQLite tests do not enforce foreign keys

The SQLite test setup does not set `PRAGMA foreign_keys = ON`, so declared foreign keys are not enforced in tests even though MySQL enforces them in production. This means the test suite can miss broken referential integrity and database-level constraints.

That is a particularly dangerous gap in an authorization system because role, attribute, and ownership data depend on correctness in relation to each other.

Evidence: `BE/tests/setup.js`, `BE/tests/envSetup.js`, `BE/tests/teardown.js`, `BE/src/db/migrations/*.js`.

---

## 10. Express Design and Error Handling Review

### Generic error handling is centralized but boilerplate-heavy

The app relies on a single generic error handler and repeated `try/catch` plus `next(err)` patterns. This is a common Express design, but it is verbose and can be difficult to audit when each route follows the same pattern without deeper error semantics.

The solution hint is not a rewrite but a research target: explore async wrappers or route-level error handlers that reduce duplication while preserving explicit errors. The goal is not to replace the current handler, but to get consistent semantics that distinguish infrastructure issues from user mistakes.

Evidence: `BE/src/app.js`, `BE/src/controllers/*.js`, `BE/src/services/*.js`.

### `logout` can swallow callback errors and hang the response

`logout` swallows the `req.logout` callback error and can hang the response if `req.session` is undefined. This is a subtle reliability bug because the response may neither succeed nor fail clearly when session cleanup is incomplete.

This is a medium-risk issue because the logout path is an authentication boundary. It must behave consistently even when the session state is partially missing or already torn down.

Evidence: `BE/src/middleware/auth.middleware.js`, `BE/src/services/auth.service.js`, `BE/src/controllers/auth.controller.js`.

### REST consistency gaps

The application has no dedicated request-validation layer and no clear distinction between client errors, server errors, and infrastructure failures. Redis or DB failures are currently surfaced as generic 500 errors, which makes troubleshooting and monitoring harder without a more precise error taxonomy.

This is not a direct exploit, but it is a maintainability and operations issue, especially in a security-sensitive backend. The system should communicate clearly what failed and why.

Evidence: `BE/src/app.js`, `BE/src/controllers/*.js`, `BE/src/services/*.js`, `BE/src/redis/client.js`.

### Positive findings: JSON-only responses and safe error messages

The app is consistent in returning JSON responses and uses static messages rather than leaking stack traces to clients. That is a good security pattern. It is preferable to return a uniform message rather than reveal the internal workings of the cause.

Evidence: `BE/src/app.js`, `BE/src/controllers/*.js`.

---

## 11. Performance Review

### `deserializeUser` re-fetches state on every request

The application re-fetches the user and role information on every request during `deserializeUser`. This guarantees fresh state but it also adds a DB round trip to every authenticated request. The trade-off is straightforward: fresher data versus lower latency. The app currently favors freshness over optimization, which is acceptable in a small app but becomes expensive under load.

The consequence is that every request pays for database reads even if permission data could be more efficiently cached in the session or prefetched from a more durable store.

Evidence: `BE/src/app.js`, `BE/src/middleware/auth.middleware.js`.

### N+1 role-attribute loads continue to affect auth latency

The role-attribute queries and cache-miss behavior create repeated lookups when the permission graph is expanded. This is an N+1 pattern in the authorization flow and amplifies latency when users have multiple roles or attributes.

This is not purely a performance issue; it is also a reliability issue because permission checks under load become more expensive and can break the time budget for request handling.

Evidence: `BE/src/services/pdp.service.js`, `BE/src/repositories/roleAttributes.repos.js`, `BE/src/repositories/userAttributes.repo.js`.

### Unbounded rate-limit Map creates memory pressure

The in-memory rate-limiter Map grows without eviction. This adds memory pressure over time and can degrade node performance, particularly in a distributed or long-lived deployment. The issue was already noted in the reliability review and remains relevant here because it directly affects operational stability.

Evidence: `BE/src/middleware/rateLimit.middleware.js`.

### No pagination on list endpoints creates unbounded-query risk

The application has no visible pagination guard on list endpoints, which means a large dataset can become a heavy response or a resource exhaustion vector. This is a common backend risk when list resources are not bounded by page size or limit filters.

The review should treat this as a medium-level operational risk because the absence of pagination makes resource growth more dangerous than it otherwise would be.

Evidence: `BE/src/controllers/project.controller.js`, `BE/src/services/project.service.js`, `BE/src/repositories/project.repo.js`.

---

## 12. Testing Gaps

### `authFlow.test.js` hides the contract mismatch by mocking the PDP

The integration flow tests fully mock the PDP with bare-verb permissions, which masks the real contract mismatch between `checkPerm('read','project')` and the PDP’s `read:project` keys. This is a test design problem: the tests are asserting the mock behavior, not the behavior of the actual authorization contract.

Because the mock stands in for the real policy implementation, the route/PDP mismatch remains hidden even though the runtime contract is broken. That is one of the clearest examples of how the current tests conceal an important authorization defect.

Evidence: `BE/tests/integration/authFlow.test.js`, `BE/src/routes/projectRouter.js`, `BE/src/services/pdp.service.js`.

### Missing tests for critical auth and ownership behaviors

The test suite is missing direct coverage for several security-critical scenarios:

- IDOR or cross-user ownership denial
- registration privilege escalation
- resource-scoped cache invalidation after permission changes
- true concurrency races for role creation / permission assignment

This is not just a metric gap; it is a risk because the current suite will not catch the most dangerous authorization regressions.

Evidence: `BE/tests/**`.

### Repository tests mostly assert a mock chain, not behavior

Many repository tests validate that the mocked Knex chain was called rather than verifying the actual behavior of the query result or authorization outcome. This is a classic mock-driven testing smell and it weakens confidence in the system.

When tests verify the mock rather than the behavior, the suite has a false sense of correctness. It is especially risky in a security-sensitive layer where the system must be evaluated by actual outputs and edge cases, not by the shape of method invocation alone.

Evidence: `BE/tests/unit/*.test.js`.

### SQLite tests do not test referential integrity

The SQLite configuration does not enable foreign-key enforcement, so the tests can pass while the real database semantics are different. That means referential-integrity assumptions remain untested and can break in production when MySQL enforces constraints more strictly.

Evidence: `BE/tests/setup.js`, `BE/tests/envSetup.js`, `BE/tests/teardown.js`, `BE/src/db/migrations/*.js`.

---

## 13. Positive Findings

The backend contains several positive patterns worth preserving:

- bcrypt hashing at cost 10 is correctly used for password storage.
- Knex queries are parameterized, which helps avoid SQL injection issues.
- Session storage keeps only the user id, which is a clean and minimal session model.
- Cookie flags include `httpOnly`, `sameSite: 'strict'`, and `secure` in production, which is a good baseline for session security.
- Login returns a uniform message, which helps prevent user enumeration.
- `updateProject` uses an explicit field whitelist, which avoids mass assignment risk.
- Redis graceful degradation is a positive property: if Redis fails, the PDP falls back to direct DB computation rather than fail-open authorization.
- The rate-limit tests exercise real HTTP assertions instead of only mock interaction, which is a more behavior-driven approach.

Evidence: `BE/src/services/auth.service.js`, `BE/src/controllers/project.controller.js`, `BE/src/services/pdp.service.js`, `BE/src/app.js`, `BE/src/middleware/rateLimit.middleware.js`, `BE/tests/unit/rateLimit.middleware.test.js`.

---

## 14. Learning Roadmap and Prioritized Action List

### Concepts to study

The next phase of learning should focus on the following concepts:

- object-level authorization and BOLA/IDOR defense patterns
- defense in depth for access control
- cache-aside invalidation and the TOCTOU risk in authorization caches
- session security and secret management
- database constraints and uniqueness patterns for concurrency safety
- behavior-driven testing versus mock-driven testing

These are not implementation instructions; they are topics to study when the next ticket is opened.

### Prioritized investigation order

1. The `checkPerm` permission-string contract mismatch
2. Registration role assignment and privilege escalation
3. Resource ownership enforcement and `is_owner` seeding
4. Resource-scoped cache invalidation and stale permission reads
5. Secret defaults and session secret management
6. Missing security middleware and auth-specific rate limiting
7. Schema constraints, indexing, and resource identity alignment
8. Test coverage for authorization and concurrency

These are investigation targets for teaching mode, not a prescriptive rewrite plan.

---

## 15. File-Level Evidence References

The following files were reviewed as evidence only and were not modified as part of this ticket:

- `BE/src/app.js`
- `BE/src/routes/projectRouter.js`
- `BE/src/middleware/auth.middleware.js`
- `BE/src/services/pdp.service.js`
- `BE/src/repositories/permissionAttributes.repo.js`
- `BE/src/repositories/roleAttributes.repos.js`
- `BE/src/repositories/userAttributes.repo.js`
- `BE/src/repositories/role.repo.js`
- `BE/src/repositories/userRole.repo.js`
- `BE/src/repositories/task.repo.js`
- `BE/src/repositories/project.repo.js`
- `BE/src/controllers/project.controller.js`
- `BE/src/services/project.service.js`
- `BE/src/controllers/auth.controller.js`
- `BE/src/services/auth.service.js`
- `BE/src/middleware/rateLimit.middleware.js`
- `BE/src/redis/client.js`
- `BE/src/utils/startServer.js`
- `BE/knexfile.js`
- `BE/src/config/knex.js`
- `docker-compose.yml`
- `BE/package.json`
- `BE/.env.example`
- `BE/src/db/migrations/20260803_*.js`
- `BE/src/db/seeds/permissions_seed.js`
- `BE/tests/**`

### Follow-up instruction

Do not implement fixes under this ticket. Produce only the review document. If fixes are requested later, treat each prioritized item as a separate change and use the teaching-mode hints as the design basis for those future changes.

---

## 16. Final Assessment

This backend is structured well enough to review and reason about, but the security and authorization model is not yet reliable. The most important issue is not isolated; it is systemic: the app has a route-oriented authorization layer that is misaligned with the PDP contract and a partial ABAC implementation that still lacks consistent ownership and resource-scoped enforcement.

The report above intentionally focuses on teaching and traceability rather than prescriptive fixes. The investigation targets are real, but they should be treated as a set of learning objectives for subsequent implementation work rather than a mandate to patch code under this ticket.
