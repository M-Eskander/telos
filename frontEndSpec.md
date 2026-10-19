# Telos Frontend Integration Specification

This document describes how a browser frontend should integrate with the current
Telos backend. It is based on the implemented routes, controllers, services, and
database behavior. It is an API integration guide, not a promise of features
that are not present in the backend.

## 1. Application capabilities and roles

Telos currently provides:

- Cookie-session authentication.
- Owner-managed people, role, attribute, and permission administration.
- Project creation and editing.
- Project-specific departments and active project memberships.
- Project tasks and subtasks, including dates, weighted progress, and assignees.
- A project timeline endpoint containing dated tasks and subtasks.
- PDF contract uploads, contract metadata, and protected contract downloads.

There is no revenue-share model or revenue-share API in this backend.

### Account types

- **Owner:** The single account created through the one-time bootstrap endpoint.
  It can use every project/task endpoint and all `/api/admin` endpoints.
- **Non-owner:** Authenticated through the same login endpoint. Project and task
  access is decided by the configured permission attributes and role grants.
  Non-owners cannot use `/api/admin`; a person with no matching permission
  receives `403`.
- **Archived person:** Has `is_active: false`; cannot log in and cannot be
  assigned to projects or tasks. Archiving retains their record and history.

The backend does not expose a separate public registration workflow.

## 2. Runtime and browser transport

### API origin and credentials

All application routes below are relative to the backend origin. The routes are
mounted under `/api`.

Authentication uses an HTTP-only session cookie, not a bearer token. Browser
requests must retain cookies:

```js
const response = await fetch(`${API_ORIGIN}/api/auth/me`, {
  credentials: 'include'
});
```

Use `credentials: 'include'` consistently for login, API calls, and logout. For
same-origin deployments, `credentials: 'same-origin'` also sends cookies. The
backend does not configure CORS in the application code. The simplest production
deployment is to serve the frontend and proxy `/api` through the same site. If
the UI and API are on different origins, configure CORS and cookie behavior at
the deployment layer and verify it in a real browser; do not assume cross-origin
cookie sessions will work by default.

The session cookie is HTTP-only, `SameSite=Strict`, and secure in production.
There is no CSRF-token endpoint or bearer-token alternative. Keep state-changing
requests on the same site and do not place state-changing actions behind GET
requests.

### Request formats

- Send JSON with `Content-Type: application/json` for normal API requests.
- For person creation and contract uploads, send `FormData`/`multipart/form-data`.
  Do **not** manually set the multipart `Content-Type`; the browser must add the
  boundary.
- IDs are positive integer identifiers represented as JSON numbers in
  responses. Route parameters are URL strings.
- Dates use `YYYY-MM-DD` calendar-date strings, not timestamps.
- There is no documented pagination, search, or filtering contract on list
  endpoints. Lists currently return the whole matching collection.

### Rate limit and errors

All `/api/` routes share a process-local limit of 150 requests per 15 minutes
per client IP. A `429` response may include `Retry-After` and rate-limit headers.
Because it is process-local, multi-instance deployments need a shared limiter or
an upstream rate-limiting service.

Most JSON API failures use:

```json
{ "ok": false, "message": "Human-readable explanation" }
```

Task endpoints use the different envelope:

```json
{ "success": false, "message": "Human-readable explanation" }
```

The generic Express error handler returns `500` with
`{ "error": "Internal Server Error" }`. Do not assume every endpoint uses one
uniform envelope.

Common statuses:

| Status | Frontend handling |
|---|---|
| `200` | Request succeeded. Read the route-specific response shape below. |
| `201` | Resource created or uploaded. |
| `400` | Invalid fields, invalid dates, invalid relationship, or invalid upload. Show the returned `message` where present. |
| `401` | No valid session, expired/archived account, or invalid login. Clear private UI state and navigate to sign-in. |
| `403` | Authenticated but not authorized. Show an access-denied state; do not retry as though it were a network error. |
| `404` | The resource is missing or outside the addressed project. |
| `409` | Duplicate email, role, department, or other unique resource. |
| `429` | Rate limited. Respect `Retry-After` before retrying. |
| `500` | Unexpected server failure. Show a generic error and allow safe retry. |

For `401`/`403`, don’t infer a user’s complete permissions from role names or
frontend state. The server is authoritative and may reject an operation even if
the UI still has stale data.

## 3. Authentication and owner bootstrap

| Method | Route | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/bootstrap-owner` | Public, one time | Create the first and only owner. |
| `POST` | `/api/auth/login` | Public | Start a session. |
| `GET` | `/api/auth/me` | Authenticated | Restore the current session on app load. |
| `POST` | `/api/auth/logout` | Session | End the session. |
| `GET` | `/api` | Public | Basic health response. |

### Bootstrap owner

`POST /api/auth/bootstrap-owner`

JSON body:

```json
{
  "name": "Studio Owner",
  "email": "owner@example.com",
  "phone_number": "555-0100",
  "password": "a-strong-password",
  "setup_secret": "the-deployment-configured-secret"
}
```

Success is `201`:

```json
{
  "ok": true,
  "user": {
    "id": 1,
    "name": "Studio Owner",
    "email": "owner@example.com",
    "phone_number": "555-0100",
    "created_at": "...",
    "roles": ["owner"],
    "isOwner": true
  }
}
```

The deployment must configure `OWNER_SETUP_SECRET` with at least 32 characters.
The value is a server provisioning secret; it should not be embedded in a
general-purpose public frontend. Bootstrap should be a controlled setup action,
normally run by an operator. It returns `503` if the server secret is
misconfigured, `403` for a wrong secret, and `409` if an owner already exists.
After successful setup, remove the deployment secret if it is no longer needed.

### Login, session restore, and logout

`POST /api/auth/login` JSON body:

```json
{ "email": "person@example.com", "password": "user-entered-password" }
```

Successful response:

```json
{
  "ok": true,
  "user": {
    "id": 12,
    "name": "Person Name",
    "email": "person@example.com",
    "roles": ["project-manager"],
    "roleAssignments": [
      {
        "name": "project-manager",
        "resourceType": "project",
        "resourceId": 42
      }
    ],
    "isOwner": false
  }
}
```

`roles` is the convenience list of role names. `roleAssignments` carries the
scope. For global roles, `resourceType` and `resourceId` are `null`. Login
failure is `401`; archived people also receive a login failure.

`GET /api/auth/me` returns the same `user` structure within `{ "ok": true }`.
Use it at application startup to determine whether a session exists; `401`
means there is no current authenticated session. `POST /api/auth/logout` returns
`{ "ok": true }` and destroys the session.

Recommended authentication lifecycle:

1. On app startup, call `/api/auth/me` with cookies enabled.
2. Render the public sign-in route while the session is absent; render the
   private app only after session restoration succeeds.
3. On successful login, store the returned user in client state and navigate
   into the application.
4. On a later `401`, invalidate cached private data and return to sign-in.
5. On logout, call the API and clear all client-side user and project state.

## 4. Projects

All project routes are under `/api/projects`.

| Method | Route | Required access | Response data |
|---|---|---|---|
| `GET` | `/api/projects` | Authenticated | `{ ok, projects }`; non-owner results are filtered by `read:project`. |
| `POST` | `/api/projects` | `create:project` | `201 { ok, project }`. |
| `GET` | `/api/projects/:id` | `read:project` on project | `{ ok, project }`. |
| `PATCH` | `/api/projects/:id` | `update:project` on project | `{ ok, project }`. |
| `DELETE` | `/api/projects/:id` | `delete:project` on project | `{ ok, message }`. |

Project create JSON:

```json
{ "name": "Game Alpha", "description": "Production project" }
```

`name` is required. Project update accepts `name` and/or `description`; other
fields are ignored. A project response includes its database fields, typically
`id`, `name`, `description`, `created_by`, `created_at`, and calculated
`progress`. Treat `created_by` and progress as server-owned/read-only.

`GET /api/projects` requires authentication but is not itself permission-gated
for a non-owner; it filters the list to projects for which the user has
`read:project`. A project detail request checks the permission again. Owners see
all projects.

Deleting a project is destructive to its project-owned data through database
cascades. Confirm before sending the delete request.

## 5. Project departments and members

Departments and memberships belong to one project; department names can be
reused in another project. Project reads require `read:project`; mutations
require `update:project`.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/projects/:projectId/departments` | `{ ok, departments }`, each `{ id, projectId, name }`. |
| `POST` | `/api/projects/:projectId/departments` | Add a department; `{ ok, department: { id, projectId, name } }`. |
| `DELETE` | `/api/projects/:projectId/departments/:departmentId` | Remove it; `{ ok: true }`. |
| `GET` | `/api/projects/:projectId/members` | `{ ok, members }`, active members only. |
| `PUT` | `/api/projects/:projectId/members/:userId` | Add or move a member to a department. |
| `DELETE` | `/api/projects/:projectId/members/:userId` | Remove membership and their task assignments in that project. |

Department create:

```json
{ "name": "Engineering" }
```

Department list success is exactly:

```json
{
  "ok": true,
  "departments": [
    { "id": 3, "projectId": 42, "name": "Engineering" }
  ]
}
```

Department creation returns
`{ "ok": true, "department": { "id": 3, "projectId": 42, "name": "Engineering" } }`.
Duplicate name in the same project returns `409`.

Assign a person:

```json
{ "departmentId": 3 }
```

Set `departmentId` to `null` (or omit it) for membership with no department.
This is an upsert: assigning a current member again moves them or clears their
department. Only active people can be members, and a supplied department must
belong to this project. Success is `{ "ok": true, "member": ... }`. The returned
member is the matching row from the project member list and has `userId`,
`name`, `email`, `phoneNumber`, `projectId`, `departmentId`, and
`departmentName`.

The exact list response is:

```json
{
  "ok": true,
  "members": [
    {
      "userId": 17,
      "name": "Taylor Example",
      "email": "taylor@example.com",
      "phoneNumber": "555-0101",
      "projectId": 42,
      "departmentId": 3,
      "departmentName": "Engineering"
    }
  ]
}
```

When no department is assigned, `departmentId` and `departmentName` are
typically `null`. An empty membership list is `{ "ok": true, "members": [] }`.

Deleting a department sets its members' `departmentId` to `null`; it does not
remove their project membership. Removing a member also removes their
assignments from tasks in that project. The member's person record remains.

### People picker data

The frontend needs a list of active people for project membership and task
assignment. There is no standalone non-owner people-search endpoint. The owner
can use `GET /api/admin/people`; a non-owner frontend should use the authorized
project-members endpoint to populate project-scoped assignment pickers. Do not
expose owner-admin data to ordinary users.

## 6. Tasks, subtasks, and timeline

Task routes are scoped beneath the project:

| Method | Route | Required access | Success response |
|---|---|---|---|
| `GET` | `/api/projects/:projectId/tasks` | `read:task` on project | `{ success: true, data: [...] }`. |
| `POST` | `/api/projects/:projectId/tasks` | `create:task` on project | `201 { success: true, data: task }`. |
| `PATCH` | `/api/projects/:projectId/tasks/:id` | `update:task` on project | `{ success: true, data: task }`. |
| `DELETE` | `/api/projects/:projectId/tasks/:id` | `delete:task` on project | `{ success: true, message }`. |

Task access inherits from the containing project. Task IDs are checked against
the URL's `projectId` on update and delete; an ID from another project is not
updated or deleted and returns `404`.

### Task fields and validation

Create accepts:

```json
{
  "title": "Build inventory screen",
  "description": "Implement list and detail states",
  "status": "in_progress",
  "priority": "high",
  "progress": 25,
  "weight": 2,
  "parent_task_id": null,
  "start_date": "2026-10-20",
  "end_date": "2026-11-10",
  "assignee_ids": [17, 24]
}
```

Fields:

| Field | Rules/default |
|---|---|
| `title` | Required non-empty string. |
| `description` | Optional string or `null`; defaults to `null`. |
| `status` | `todo`, `in_progress`, or `done`; defaults to `todo`. |
| `priority` | `low`, `medium`, `high`, or `critical`; defaults to `medium`. |
| `progress` | Integer from 0 through 100; defaults to `0`. |
| `weight` | Positive finite number; defaults to `1`. Used in parent/project progress. |
| `parent_task_id` | Optional positive task ID or `null`; parent must exist in this project. |
| `start_date`, `end_date` | Optional valid `YYYY-MM-DD` or `null`; end cannot precede start. |
| `assignee_ids` | Optional array of unique positive IDs; every person must be active and a project member. |

`PATCH` accepts the editable task fields, including `assignee_ids`. Omitted
fields remain unchanged. To clear task dates, send `null`; to clear assignees,
send `[]`. Do not send `project_id` or `created_by`; the server determines
those. Invalid input returns `400` with the task envelope and a `message`.

The backend service validates the task domain before writing, but does not
guarantee every database installation has matching SQL check constraints. The
frontend should validate before submission and still handle a `400`.

### Tree responses and progress

`GET /api/projects/:projectId/tasks` returns root tasks with a `subtasks` array.
The current repository response nests one subtask level; do not assume a
recursive hierarchy in that response. The timeline is a flat list, with
`parent_task_id` identifying a subtask's parent.

Task data includes stored fields such as `id`, `project_id`, `title`,
`description`, `status`, `priority`, `parent_task_id`, `progress`, `weight`,
`start_date`, `end_date`, `created_by`, and `created_at`. Task reads add
`assignees` with active person fields (`id`, `name`, `email`); root task reads
also include `subtasks`.

Parent progress is calculated as the weighted average of its subtasks; project
progress is the weighted average of root-task progress. A task update/create or
delete recalculates the relevant parent and project progress. Deleting the last
subtask resets its parent progress to zero. Treat calculated progress as
server-owned and refresh the task/project after a mutation.

### Timeline endpoint

`GET /api/projects/:projectId/timeline` requires `read:project` (not the
task-list permission) and returns:

```json
{
  "ok": true,
  "tasks": [
    {
      "id": 51,
      "project_id": 42,
      "parent_task_id": null,
      "title": "Milestone",
      "status": "todo",
      "priority": "medium",
      "progress": 0,
      "weight": 1,
      "start_date": "2026-10-20",
      "end_date": "2026-10-28",
      "assignees": []
    }
  ]
}
```

The list is flat, contains tasks and subtasks with at least one date, and is
ordered by `start_date` or (when absent) `end_date`, followed by end date and
ID. Undated tasks are excluded. Each row includes active assignees and the
parent ID. Build calendar bars from the dates, and use `parent_task_id` for
nesting/grouping. An empty project timeline is `{ "ok": true, "tasks": [] }`.

## 7. People and contracts (owner-only)

Every `/api/admin/*` route requires an authenticated owner. This section
describes the implemented owner interface; it is not available as an ordinary
member directory API.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/admin/people` | List people, role names/assignments, contract summaries, `hasContract`, and `isOwner`. |
| `POST` | `/api/admin/people` | Create a person and their first uploaded contract atomically. |
| `GET` | `/api/admin/people/:userId` | Person details, role objects, person attributes, contracts, and owner flag. |
| `PATCH` | `/api/admin/people/:userId` | Update profile fields and/or archive/reactivate. |
| `POST` | `/api/admin/people/:userId/contracts` | Add a contract PDF and dates. |
| `GET` | `/api/admin/contracts/:contractId/file` | Download the private PDF. |
| `PUT` | `/api/admin/people/:userId/roles` | Replace a person's full role assignment list. |
| `PUT` | `/api/admin/people/:userId/attributes` | Replace a person's full attribute override list. |

### Create person with initial contract

Send `multipart/form-data` to `POST /api/admin/people` with:

| Form field | Required | Notes |
|---|---:|---|
| `name` | Yes | String. |
| `email` | Yes | String; must be unique. |
| `phone_number` | Yes | String. |
| `password` | Yes | String; never returned by API. |
| `contract_start_date` | Yes | Valid `YYYY-MM-DD`. |
| `contract_end_date` | Yes | Valid date on/after start. |
| `contract` | Yes | One valid PDF; maximum 10 MiB. |
| `contract_terms` | No | String. |
| `location` | No | String. |
| `age` | No | Non-negative integer. |
| `is_active` | No | Boolean; multipart values `"true"` or `"false"` are parsed. |
| `roles` | No | JSON-encoded array of role names or scoped role objects. |

Example role field string:

```json
["designer"]
```

or:

```json
[
  { "name": "project-manager", "resourceType": "project", "resourceId": 42 }
]
```

Use a `FormData` object; append `roles` as `JSON.stringify(value)` and append the
binary file under the exact field name `contract`. The response is
`201 { "ok": true, "person": ... }`. Email conflict is `409`; invalid fields,
missing contract, invalid PDF, or invalid dates are `400`.

The create operation stores the PDF privately and creates the person and
contract in a database transaction. If database creation fails after file
storage, the service attempts to remove the newly stored file. The configured
`CONTRACT_STORAGE_DIR` must be durable, private, backed up, and accessible to
the backend in production.

### Person details, archive, and reactivation

`PATCH /api/admin/people/:userId` accepts `name`, `email`, `phone_number`,
`location`, `age`, and `is_active`. Password is intentionally not changed by
this endpoint. To archive, send:

```json
{ "is_active": false }
```

The person can no longer log in; their contracts and history remain. The owner
cannot be archived. Reactivation:

```json
{ "is_active": true }
```

is allowed only if the person has at least one uploaded contract with both
start and end dates. The backend does not automatically expire/archive users
when a contract end date passes; the frontend may display that date, but must
not treat it as an automatic account-state transition.

`GET /api/admin/people` has the exact top-level shape
`{ "ok": true, "people": [...] }`. Each list item includes profile fields
(`id`, `name`, `email`, `phone_number`, `location`, `age`, `is_active`,
`created_at`), `roles` as an array of role-name strings, `roleAssignments` as
an array of `{ name, resourceType, resourceId }`, `contracts` as contract
summaries, `hasContract` as a boolean, and `isOwner` as a boolean. Empty
assignments and contracts are empty arrays, not `null`.
`is_active` is serialized from a database boolean and can appear as `true` /
`false` or `1` / `0`, depending on the database driver; normalize it before
using strict boolean comparisons in the UI.

`GET /api/admin/people/:userId` has the exact top-level shape
`{ "ok": true, "person": {...} }`. Its person profile fields are the same, but
`roles` is an array of objects `{ id, name, resourceType, resourceId }`, and
`attributes` is an array of objects described in the authorization section
below. It also contains `contracts` and `isOwner`. This list/detail difference
is intentional: use the detail response when initializing role and attribute
editors. The `POST` person response returns `{ ok, person }` with the created
profile, assigned roles, initial contract, and `hasContract`; it does not return
the person-detail `attributes` collection.

### Additional contract upload and download

`POST /api/admin/people/:userId/contracts` takes multipart fields `contract`
(PDF), `contract_start_date`, `contract_end_date`, and optional
`contract_terms`. It returns `201 { "ok": true, "contract": ... }`.

Contract summary fields include `id`, `user_id`, `file_url`, `terms`,
`start_date`, `end_date`, timestamps, `original_name`, `mime_type`, `file_size`,
and `uploaded`. `storage_key` is never returned. Use the returned `file_url` or
the route `/api/admin/contracts/:contractId/file` with the session cookie to
download the document. The response is the raw PDF attachment, not JSON. Treat
the file route as a protected download, not as a public static asset. A file may
only be downloaded by the owner using the implemented API.

## 8. Roles, attributes, and permissions (owner-only)

These endpoints configure authorization; they are primarily an owner/admin
screen, not ordinary project operations.

| Method | Route | Request / response purpose |
|---|---|---|
| `GET` | `/api/admin/roles` | `{ ok, roles: [{ id, name }] }`. |
| `POST` | `/api/admin/roles` | JSON `{ name }`; returns `201 { ok, role }`. |
| `GET` | `/api/admin/roles/:roleId` | `{ ok, role: { id, name, attributes } }`; see exact shape below. |
| `PUT` | `/api/admin/roles/:roleId/attributes` | Replace role attributes; returns `{ ok, attributes }` containing submitted normalized links. |
| `GET` | `/api/admin/attributes` | `{ ok, attributes }`; catalog rows have `id`, `name`, `resource`, `description`. |
| `POST` | `/api/admin/attributes` | JSON `{ name, resource, description? }`; returns `201`. |
| `GET` | `/api/admin/permissions` | `{ ok, permissions }`, including current alternatives; see exact shape below. |
| `POST` | `/api/admin/permissions` | JSON `{ action, resource, description? }`; returns `201`. |
| `PUT` | `/api/admin/permissions/:permissionId/grants` | Replace all grant alternatives. |

Role assignment is a **replacement**, not an additive update:

```json
{
  "roles": [
    "designer",
    { "name": "project-manager", "resourceType": "project", "resourceId": 42 }
  ]
}
```

Use `[]` to remove all roles. The reserved owner role cannot be assigned or
changed through this endpoint. Scoped assignments currently support
`resourceType: "project"` and a valid existing `resourceId`.

Role attribute replacement:

```json
{
  "attributes": [
    { "attributeId": 4 },
    { "attributeId": 8, "resourceId": 42 }
  ]
}
```

Person attribute replacement has the same shape and may specify `mode` as
`"add"` or `"remove"`:

```json
{
  "attributes": [
    { "attributeId": 8, "resourceId": 42, "mode": "remove" }
  ]
}
```

Omitting the scope means global/unscoped assignment. A scoped attribute's
resource ID must refer to an existing resource of the matching type. The
endpoint replaces the full list; send every assignment that should remain.
Person `remove` overrides matching role-provided attributes.

### Exact role/person attribute response shapes

The attribute catalog from `GET /api/admin/attributes` is an array of catalog
records:

```json
{
  "ok": true,
  "attributes": [
    {
      "id": 8,
      "name": "is_project_manager",
      "resource": "project",
      "description": "Can manage assigned projects"
    }
  ]
}
```

The catalog uses `id`; assignment requests and assignment response links use
`attributeId`. Do not expect the `attributes` array nested in a person or role
detail to use catalog records verbatim:

- `GET /api/admin/roles/:roleId` returns
  `{ "ok": true, "role": { "id", "name", "attributes": [...] } }`. Each role
  attribute is `{ "attributeId", "name", "resource", "resourceId" }`.
- `GET /api/admin/people/:userId` returns the same attribute fields plus
  `mode`, whose value is `"add"` or `"remove"`.
- `PUT /api/admin/roles/:roleId/attributes` and
  `PUT /api/admin/people/:userId/attributes` return
  `{ "ok": true, "attributes": [...] }`, but these are normalized assignment
  links, not expanded catalog rows. Each includes `attributeId` and
  `resourceId` (`null` if omitted); person links also include `mode` when
  supplied. These write responses do not include `name` or `resource`.

Example role detail:

```json
{
  "ok": true,
  "role": {
    "id": 5,
    "name": "project-manager",
    "attributes": [
      {
        "attributeId": 8,
        "name": "is_project_manager",
        "resource": "project",
        "resourceId": null
      }
    ]
  }
}
```

Example role-attribute save response:

```json
{
  "ok": true,
  "attributes": [
    { "attributeId": 8, "resourceId": null },
    { "attributeId": 11, "resourceId": 42 }
  ]
}
```

Example person-attribute save response:

```json
{
  "ok": true,
  "attributes": [
    { "attributeId": 8, "resourceId": 42, "mode": "remove" }
  ]
}
```

For example, an expanded person-detail response can be:

```json
{
  "ok": true,
  "person": {
    "id": 17,
    "name": "Taylor Example",
    "attributes": [
      {
        "attributeId": 8,
        "name": "is_project_manager",
        "resource": "project",
        "resourceId": 42,
        "mode": "remove"
      }
    ]
  }
}
```

An unscoped assignment has `resourceId: null`. Role detail attribute rows also
have `resourceId`, normally `null` for an unscoped role attribute. To render an
editor, load the catalog plus the person's or role's detail; map assigned rows
by `attributeId` and scope (`resourceId`), and for person overrides retain
`mode`. After saving, the write response is not sufficient to render labels:
refetch detail or merge the submitted IDs with the catalog.

Permission grant replacement:

```json
{
  "alternatives": [
    [3, 8],
    [11]
  ]
}
```

Attributes within one alternative are ANDed; alternatives are ORed. An empty
array `[]` means no grant and therefore deny. An empty alternative `[[]]` would
match everyone and is accepted only for a permission whose resource is exactly
`public`. For ordinary resources, the API rejects empty alternatives. Permission
changes invalidate the permission requirement cache.

### Exact permission alternatives shape

`GET /api/admin/permissions` returns each permission with an `alternatives`
array. Unlike the `PUT` request, these alternatives contain expanded attribute
descriptors, not numeric IDs:

```json
{
  "ok": true,
  "permissions": [
    {
      "id": 4,
      "action": "read",
      "resource": "project",
      "description": "Read a project",
      "alternatives": [
        [
          { "name": "is_project_manager", "resource": "project" },
          { "name": "is_active", "resource": "global" }
        ],
        [
          { "name": "is_project_owner", "resource": "project" }
        ]
      ]
    }
  ]
}
```

Each alternative is an AND-group of `{ name, resource }` objects; the outer
array is OR. An unconfigured or denied permission has `alternatives: []`. A
public permission with an explicitly empty grant rule may appear as
`alternatives: [[]]`. Attribute IDs are not included in these expanded read
objects. To build the `PUT /api/admin/permissions/:permissionId/grants` editor,
resolve each descriptor to the catalog ID using the pair `(name, resource)`
from `GET /api/admin/attributes`, then submit arrays of those numeric IDs. The
PUT success response is `{ "ok": true, "id": 4, "grants": [[8, 12], [19]] }`;
`grants` echoes the numeric-ID groups and is not the expanded `alternatives`
shape. Refetch permissions after saving if the UI needs the canonical expanded
display. An empty `alternatives: []` save removes all configured grant groups.

The permission name used by project/task routes follows `action:resource`, for
example `read:project` or `create:task`. The frontend should not reproduce the
policy engine to decide whether a user is allowed. Render based on known
product role/context if desired, but always handle `403` from the API.

## 9. Recommended end-application flows

### First deployment

1. Complete database migrations and seed the documented permission set.
2. Configure `OWNER_SETUP_SECRET`, `SESSION_SECRET` (at least 32 characters),
   Redis, and private durable contract storage.
3. Provision the owner once through the controlled bootstrap flow.
4. Remove or rotate the one-time setup secret as appropriate.
5. Sign in as owner and configure people, roles, attributes, and permission
   grant alternatives.

### Create a project and staff it

1. Owner or authorized project creator calls `POST /api/projects`.
2. Load `/api/projects/:id/departments`; create project-specific departments as
   needed.
3. Load active people from the owner people API, or use the project's member
   list for a non-owner's project-scoped UI.
4. Assign each person with `PUT /api/projects/:id/members/:userId`.
5. Create tasks, selecting assignees only from active project members.

### Project detail page

On entering a project, fetch the required resources in parallel where practical:

- `GET /api/projects/:id`
- `GET /api/projects/:id/tasks`
- `GET /api/projects/:id/members`
- `GET /api/projects/:id/departments`
- `GET /api/projects/:id/timeline` if a calendar/timeline view is shown

Handle each permission failure independently. A user might have project read
access but lack task-list access, or vice versa.

After task mutations, refresh the affected task list and project summary so
server-calculated progress is reflected. After member removal, refresh both
members and tasks because the backend also removes that person's task
assignments.

### Owner people administration

1. `GET /api/admin/people` for the list.
2. `POST /api/admin/people` as multipart form for new person plus mandatory
   initial PDF contract.
3. `GET /api/admin/people/:userId` for detailed contract, role, and attribute
   management.
4. Use the contract file route for authorized downloads.
5. Use `PATCH` to update profile fields or archive/reactivate.
6. Upload replacement/renewal paperwork through the additional contract route;
   contracts are historical records and are not edited/deleted through the
   current API.

## 10. Frontend implementation checklist

- [ ] Centralize the API base URL and a fetch/client wrapper.
- [ ] Ensure cookies are sent on every request; do not store session secrets in
  local storage.
- [ ] Restore auth through `/api/auth/me` before rendering protected screens.
- [ ] On `401`, clear protected client state; on `403`, show access denied.
- [ ] Parse both `ok` and task-specific `success` response envelopes.
- [ ] Surface `message` errors and handle generic `500` responses safely.
- [ ] Validate dates, task progress, weight, and required task fields in the UI,
  while still handling server-side `400`.
- [ ] Use multipart forms for person and contract uploads, enforce PDF and
  10-MiB client-side checks, and let the browser set the multipart boundary.
- [ ] Do not expose contract files as public URLs; download through the
  authenticated endpoint.
- [ ] Treat `PUT` role/attribute endpoints as full replacement operations.
- [ ] Refresh derived project/task progress after task changes.
- [ ] Avoid building UI assumptions around unsupported pagination, search,
  recursive task trees, contract expiry automation, or revenue sharing.

## 11. Operational facts relevant to the frontend

- Production requires Redis and a `SESSION_SECRET` of at least 32 characters;
  the server is intended to fail startup if Redis is unavailable.
- The session cookie is HTTP-only, `SameSite=Strict`, and secure in production.
- Contract PDFs live outside the public web root in `CONTRACT_STORAGE_DIR`
  (default `BE/storage/contracts`). Production storage must persist across
  deployments and be backed up.
- `docker-compose.yml` expects `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, and
  `REDIS_PASSWORD` from the environment and does not publish database/cache
  ports.
- The current API does not define an OpenAPI schema, frontend assets, CORS
  middleware, a CSRF-token route, pagination, or a password-reset workflow.
  Coordinate these deployment/product needs before choosing a frontend
  architecture that depends on them.
