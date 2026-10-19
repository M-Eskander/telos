# Owner-managed access control

Run database migrations before using the access-control endpoints. Set a unique,
strong `OWNER_SETUP_SECRET` in the backend environment before creating the first
account.

Production startup requires a `SESSION_SECRET` of at least 32 characters and a
reachable Redis server for shared sessions. The server exits instead of
switching to process-local sessions if Redis is unavailable. Development and
test environments use an in-memory session store.
`docker-compose.yml` requires `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, and
`REDIS_PASSWORD` from the environment and keeps database/cache ports on the
internal Compose network.

Create the one-time owner with `POST /api/auth/bootstrap-owner`:

```json
{
  "name": "Studio Owner",
  "email": "owner@example.com",
  "phone_number": "555-0100",
  "password": "a-strong-password",
  "setup_secret": "the-configured-one-time-secret"
}
```

The endpoint succeeds only once. After it succeeds, remove
`OWNER_SETUP_SECRET` from the deployment environment and sign in through
`POST /api/auth/login`. Public registration is disabled; the owner creates
people through the authenticated `/api/admin/people` endpoint. Creating a
person requires a contract PDF upload and its contract dates in the same
multipart request, so the account and its first contract are created together.

Send `POST /api/admin/people` as `multipart/form-data` with the regular person
fields, `contract_start_date`, `contract_end_date`, optional `contract_terms`,
optional JSON-encoded `roles`, and one `contract` PDF (maximum 10 MB). The
contract start date is the person's start date. Dates must be valid
`YYYY-MM-DD` values and the end date cannot precede the start date.

Contract PDFs are stored outside the public web root in
`CONTRACT_STORAGE_DIR` (default: `BE/storage/contracts`). Configure this path
to a durable, access-controlled volume and back it up; the database stores
contract metadata and an opaque file key. The owner can retrieve a file through
the `file_url` returned with each contract. `GET /api/admin/people/:userId`
returns the person's contract history, and
`POST /api/admin/people/:userId/contracts` uploads an additional contract or
supplies a missing one for an archived person. That upload uses multipart
fields `contract_start_date`, `contract_end_date`, optional `contract_terms`,
and `contract`.

Existing non-owner people without a valid uploaded contract are archived by
the contract migration. They cannot sign in or be reactivated until a contract
with both dates is uploaded. Archiving an account disables its existing
sessions on their next request; its contract and project/task history remain
intact. The owner account is exempt from the contract requirement and cannot be
archived.

All `/api/admin` endpoints require the bootstrapped owner account. The owner
can create people, roles, attributes, and permissions, then assign role
attributes, person-specific attributes, and permission grants. Attribute
assignments may be scoped to a project by supplying its `resourceId`.

Project departments and project membership are managed on the project routes.
Use `GET/POST /api/projects/:projectId/departments` to list or create a
project-specific department. Use
`DELETE /api/projects/:projectId/departments/:departmentId` to remove one.
Department names may be reused in different projects.

Use `GET /api/projects/:projectId/members` to list active members and
`PUT /api/projects/:projectId/members/:userId` with
`{ "departmentId": 4 }` to assign or move an active person. Set
`departmentId` to `null` (or omit it) for a project member with no department.
`DELETE /api/projects/:projectId/members/:userId` removes the project
membership. A department can only be assigned within its own project, and
task assignees must be active members of that project.

`GET /api/projects/:projectId/timeline` returns the project's tasks and
subtasks that have either a start date or an end date, ordered by the first
available date. Each task includes its `parent_task_id` and active assignees;
undated tasks and tasks from other projects are excluded.

Task authorization is inherited from the containing project: task routes
evaluate task permissions against that project, not an independent task policy.
Task updates and deletions also scope the task ID to the requested project.
Task writes require a non-empty title; status `todo`, `in_progress`, or `done`;
priority `low`, `medium`, `high`, or `critical`; integer progress from 0 to 100;
positive finite weight; valid `YYYY-MM-DD` dates; and an end date no earlier
than the start date. These domain constraints are enforced by the task service
before database writes.

The owner API includes:

- `GET/POST /api/admin/people`, `GET/PATCH /api/admin/people/:userId`
- `POST /api/admin/people/:userId/contracts` and
  `GET /api/admin/contracts/:contractId/file`
- `PUT /api/admin/people/:userId/roles` with `{ "roles": ["studio-admin"] }`
  for a global role, or a project-specific assignment:

  ```json
  {
    "roles": [
      {
        "name": "project-manager",
        "resourceType": "project",
        "resourceId": 12
      }
    ]
  }
  ```
- `PUT /api/admin/people/:userId/attributes` with
  `{ "attributes": [{ "attributeId": 4, "resourceId": 12, "mode": "add" }] }`
- `GET/POST /api/admin/roles`, `GET /api/admin/roles/:roleId`, and
  `PUT /api/admin/roles/:roleId/attributes`
- `GET/POST /api/admin/attributes`
- `GET/POST /api/admin/permissions` and
  `PUT /api/admin/permissions/:permissionId/grants`

New people receive no roles unless existing role names are specified in the
create request; roles and attributes can also be assigned afterward. Archived
people cannot sign in and are excluded from task assignees.
Global role assignments apply wherever the role's attributes match. A
project-scoped role assignment applies only to that project, and only to
project attributes defined on the role. Login and profile responses keep
`roles` as role names and include `roleAssignments` with scope details.

Permission grants use an array of alternative rules. Attributes within one
rule are ANDed; separate rules are ORed. For example:

```json
{
  "alternatives": [
    [3, 8],
    [11]
  ]
}
```

This grants access when attributes 3 **and** 8 are both present, or when
attribute 11 is present. An empty alternative list (`[]`) denies access. An empty grant rule (`[[]]`)
is accepted only for permissions whose resource is explicitly `public`; for
all other resources it is rejected to prevent accidental allow-all access. A person-level attribute in `remove` mode
overrides the matching role attribute, including for the matching project
scope.

The API rate limit is 150 requests per 15 minutes per client IP. Its in-memory
bucket map is capped at 10,000 entries and is process-local. Multi-instance
deployments should use a shared rate-limiting service in front of the app or a
shared limiter implementation.
