# Owner-managed access control

Run database migrations before using the access-control endpoints. Set a unique,
strong `OWNER_SETUP_SECRET` in the backend environment before creating the first
account.

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
people through the authenticated `/api/admin/people` endpoint.

All `/api/admin` endpoints require the bootstrapped owner account. The owner
can create people, roles, attributes, and permissions, then assign role
attributes, person-specific attributes, and permission grants. Attribute
assignments may be scoped to a project by supplying its `resourceId`.

The owner API includes:

- `GET/POST /api/admin/people`, `GET/PATCH /api/admin/people/:userId`
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
attribute 11 is present. An empty alternative list (`[]`) denies access;
`[[]]` is public access and should only be configured intentionally. A person-level attribute in `remove` mode
overrides the matching role attribute, including for the matching project
scope.
