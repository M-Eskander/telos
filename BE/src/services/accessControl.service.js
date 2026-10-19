const knex = require('../config/knex');
const bcrypt = require('bcryptjs');
const pdpService = require('./pdp.service');

async function listPeople() {
  const people = await knex('users')
    .select('id', 'name', 'email', 'phone_number', 'location', 'age', 'is_active', 'created_at')
    .orderBy('name');
  const assignments = await knex('user_roles')
    .join('roles', 'user_roles.role_id', 'roles.id')
    .select(
      'user_roles.user_id',
      'roles.name',
      'user_roles.resource_type as resourceType',
      'user_roles.resource_id as resourceId'
    );
  const ownerAccount = await knex('owner_account').where({ id: 1 }).first();
  const rolesByUser = new Map();
  const assignmentsByUser = new Map();
  for (const assignment of assignments) {
    if (!rolesByUser.has(assignment.user_id)) rolesByUser.set(assignment.user_id, []);
    rolesByUser.get(assignment.user_id).push(assignment.name);
    if (!assignmentsByUser.has(assignment.user_id)) assignmentsByUser.set(assignment.user_id, []);
    assignmentsByUser.get(assignment.user_id).push({
      name: assignment.name,
      resourceType: assignment.resourceType,
      resourceId: assignment.resourceId
    });
  }
  return people.map(person => ({
    ...person,
    roles: rolesByUser.get(person.id) || [],
    roleAssignments: assignmentsByUser.get(person.id) || [],
    isOwner: !!ownerAccount && ownerAccount.user_id === person.id
  }));
}

async function normalizeRoleAssignments(trx, input) {
  if (!Array.isArray(input)) {
    throw new TypeError('Roles must be an array');
  }
  const assignments = input.map(role => {
    if (typeof role === 'string') {
      return { name: role, resourceType: null, resourceId: null };
    }
    if (!role || typeof role !== 'object' || Array.isArray(role) ||
        typeof role.name !== 'string') {
      throw new TypeError('Each role assignment must be a role name or an object with a name');
    }
    const hasResourceType = role.resourceType !== undefined && role.resourceType !== null;
    const hasResourceId = role.resourceId !== undefined && role.resourceId !== null;
    if (hasResourceType !== hasResourceId ||
        (hasResourceType && role.resourceType !== 'project') ||
        (hasResourceId && (!Number.isInteger(Number(role.resourceId)) || Number(role.resourceId) < 1))) {
      throw new TypeError('Scoped role assignments require a valid project resourceType and resourceId');
    }
    return {
      name: role.name,
      resourceType: hasResourceType ? role.resourceType : null,
      resourceId: hasResourceId ? Number(role.resourceId) : null
    };
  });
  if (assignments.some(role => role.name.toLowerCase() === 'owner')) {
    throw new TypeError('The owner role is reserved');
  }
  const assignmentKeys = new Set(assignments.map(role =>
    `${role.name}:${role.resourceType || ''}:${role.resourceId || ''}`
  ));
  if (assignmentKeys.size !== assignments.length) {
    throw new TypeError('Duplicate role assignments are not allowed');
  }
  const roleNames = [...new Set(assignments.map(role => role.name))];
  const roles = roleNames.length
    ? await trx('roles').whereIn('name', roleNames).select('id', 'name')
    : [];
  if (roles.length !== roleNames.length) {
    throw new TypeError('One or more roles do not exist');
  }
  const rolesByName = new Map(roles.map(role => [role.name, role]));
  const projectIds = [...new Set(assignments
    .filter(role => role.resourceType === 'project')
    .map(role => role.resourceId))];
  if (projectIds.length) {
    const projects = await trx('projects').whereIn('id', projectIds).select('id');
    if (projects.length !== projectIds.length) {
      throw new TypeError('One or more scoped projects do not exist');
    }
  }
  return assignments.map(assignment => ({
    ...rolesByName.get(assignment.name),
    resourceType: assignment.resourceType,
    resourceId: assignment.resourceId
  }));
}

async function getPersonAccessDetails(userId) {
  const person = await knex('users').where({ id: userId })
    .select('id', 'name', 'email', 'phone_number', 'location', 'age', 'is_active', 'created_at')
    .first();
  if (!person) return null;
  const [roles, attributes] = await Promise.all([
    knex('user_roles')
      .join('roles', 'user_roles.role_id', 'roles.id')
      .where({ 'user_roles.user_id': userId })
      .select(
        'roles.id',
        'roles.name',
        'user_roles.resource_type as resourceType',
        'user_roles.resource_id as resourceId'
      ),
    knex('user_attributes')
      .join('attributes', 'user_attributes.attribute_id', 'attributes.id')
      .where({ 'user_attributes.user_id': userId })
      .select('attributes.id as attributeId', 'attributes.name', 'attributes.resource', 'user_attributes.resource_id as resourceId', 'user_attributes.mode')
  ]);
  const ownerAccount = await knex('owner_account').where({ id: 1, user_id: userId }).first();
  return { ...person, roles, attributes, isOwner: !!ownerAccount };
}

async function createPerson(data) {
  const password = await bcrypt.hash(data.password, 10);
  return knex.transaction(async trx => {
    const roles = await normalizeRoleAssignments(trx, data.roles === undefined ? [] : data.roles);
    const [id] = await trx('users').insert({
      name: data.name,
      email: data.email,
      phone_number: data.phone_number,
      password,
      location: data.location || null,
      age: data.age === undefined ? null : data.age,
      is_active: data.is_active === undefined ? true : data.is_active,
      created_at: new Date()
    });
    const user = await trx('users').where({ id }).first();
    if (roles.length) {
      await trx('user_roles').insert(roles.map(role => ({
        user_id: id,
        role_id: role.id,
        resource_type: role.resourceType,
        resource_id: role.resourceId,
        scope_key: role.resourceType ? `${role.resourceType}:${role.resourceId}` : ''
      })));
    }
    user.roles = [...new Set(roles.map(role => role.name))];
    user.roleAssignments = roles.map(({ name, resourceType, resourceId }) => ({
      name,
      resourceType,
      resourceId
    }));
    return safePerson(user);
  });
}

function safePerson(user) {
  if (!user) return user;
  delete user.password;
  return user;
}

async function updatePerson(userId, data) {
  if (data.is_active === false &&
      await knex('owner_account').where({ user_id: userId }).first()) {
    throw new TypeError('The owner account cannot be archived');
  }
  const updated = await knex('users').where({ id: userId }).update(data);
  if (!updated) return null;
  return safePerson(await knex('users').where({ id: userId }).first());
}

async function listRoles() {
  return knex('roles').select('id', 'name').orderBy('name');
}

async function getRoleAccessDetails(roleId) {
  const role = await knex('roles').where({ id: roleId }).select('id', 'name').first();
  if (!role) return null;
  role.attributes = await knex('role_attributes')
    .join('attributes', 'role_attributes.attribute_id', 'attributes.id')
    .where({ 'role_attributes.role_id': roleId })
    .select('attributes.id as attributeId', 'attributes.name', 'attributes.resource', 'role_attributes.resource_id as resourceId');
  return role;
}

async function createRole(name) {
  if (name.trim().toLowerCase() === 'owner') {
    throw new TypeError('The owner role is reserved');
  }
  const normalizedName = name.trim();
  if (await knex('roles').where({ name: normalizedName }).first()) {
    const error = new Error('Role already exists');
    error.code = 'ROLE_ALREADY_EXISTS';
    throw error;
  }
  const [id] = await knex('roles').insert({ name: normalizedName });
  return knex('roles').where({ id }).first();
}

async function setPersonRoles(userId, roleNames) {
  if (!Array.isArray(roleNames)) throw new TypeError('Roles must be an array');
  return knex.transaction(async trx => {
    if (await trx('owner_account').where({ user_id: userId }).first()) {
      throw new TypeError('The owner account role cannot be changed');
    }
    const person = await trx('users').where({ id: userId }).first();
    if (!person) return null;
    const roles = await normalizeRoleAssignments(trx, roleNames);
    await trx('user_roles').where({ user_id: userId }).del();
    if (roles.length) {
      await trx('user_roles').insert(roles.map(role => ({
        user_id: userId,
        role_id: role.id,
        resource_type: role.resourceType,
        resource_id: role.resourceId,
        scope_key: role.resourceType ? `${role.resourceType}:${role.resourceId}` : ''
      })));
    }
    await pdpService.invalidateUserPermissionCache(userId);
    return roles.map(({ name, resourceType, resourceId }) => ({
      name,
      resourceType,
      resourceId
    }));
  });
}

async function listAttributes() {
  return knex('attributes').select('id', 'name', 'resource', 'description').orderBy('name');
}

async function createAttribute({ name, resource, description }) {
  const [id] = await knex('attributes').insert({
    name: name.trim(),
    resource: resource.trim(),
    description: description || null
  });
  return knex('attributes').where({ id }).first();
}

async function replaceLinks(tableName, ownerColumn, ownerId, links) {
  if (!Array.isArray(links)) throw new TypeError('Attributes must be an array');
  const normalizedLinks = links.map(link => {
    if (!link || typeof link !== 'object' || Array.isArray(link)) {
      throw new TypeError('Each attribute assignment must be an object');
    }
    if (!Number.isInteger(Number(link.attributeId)) ||
        (link.resourceId !== undefined && link.resourceId !== null &&
          (!Number.isInteger(Number(link.resourceId)) || Number(link.resourceId) < 1))) {
      throw new TypeError('Attribute IDs and resource IDs must be positive integers');
    }
    return {
      ...link,
      attributeId: Number(link.attributeId),
      resourceId: link.resourceId === undefined || link.resourceId === null
        ? null
        : Number(link.resourceId)
    };
  });
  const uniqueLinks = new Set(normalizedLinks.map(link => `${link.attributeId}:${link.resourceId}`));
  if (uniqueLinks.size !== normalizedLinks.length) {
    throw new TypeError('Duplicate attribute assignments are not allowed');
  }
  const ids = [...new Set(normalizedLinks.map(link => link.attributeId))];
  const attributes = ids.length
    ? await knex('attributes').whereIn('id', ids).select('id', 'resource')
    : [];
  if (attributes.length !== ids.length) throw new TypeError('One or more attributes do not exist');
  const attributesById = new Map(attributes.map(attribute => [attribute.id, attribute]));
  for (const link of normalizedLinks) {
    const attribute = attributesById.get(link.attributeId);
    if (link.mode !== undefined && link.mode !== 'add' && link.mode !== 'remove') {
      throw new TypeError('Attribute mode must be add or remove');
    }
    if (link.resourceId !== undefined && link.resourceId !== null) {
      if (attribute.resource === 'global') {
        throw new TypeError('Global attributes cannot be scoped to a resource');
      }
      const scopedTables = {
        project: 'projects',
        task: 'tasks',
        user: 'users',
        department: 'departments',
        contract: 'contracts'
      };
      const tableNameForResource = scopedTables[attribute.resource];
      if (!tableNameForResource) {
        throw new TypeError(`Resource-scoped attributes are not supported for ${attribute.resource}`);
      }
      if (!(await knex(tableNameForResource).where({ id: link.resourceId }).first())) {
        throw new TypeError(`The scoped ${attribute.resource} does not exist`);
      }
    }
  }

  const ownerExists = tableName === 'role_attributes'
    ? await knex('roles').where({ id: ownerId }).first()
    : await knex('users').where({ id: ownerId }).first();
  if (!ownerExists) return null;

  await knex.transaction(async trx => {
    await trx(tableName).where({ [ownerColumn]: ownerId }).del();
    if (normalizedLinks.length) {
      await trx(tableName).insert(normalizedLinks.map(link => ({
        [ownerColumn]: ownerId,
        attribute_id: link.attributeId,
        resource_id: link.resourceId,
        ...(tableName === 'role_attributes' ? { value: 'true' } : {
          value: 'true',
          mode: link.mode === 'remove' ? 'remove' : 'add'
        })
      })));
    }
  });

  if (tableName === 'role_attributes') {
    const users = await knex('user_roles').where({ role_id: ownerId }).select('user_id');
    await Promise.all(users.map(user => pdpService.invalidateUserPermissionCache(user.user_id)));
  } else {
    await pdpService.invalidateUserPermissionCache(ownerId);
  }
  return normalizedLinks;
}

async function setRoleAttributes(roleId, links) {
  return replaceLinks('role_attributes', 'role_id', roleId, links);
}

async function setPersonAttributes(userId, links) {
  return replaceLinks('user_attributes', 'user_id', userId, links);
}

async function listPermissions() {
  const permissions = await knex('permissions')
    .select('id', 'action', 'resource', 'description')
    .orderBy('resource')
    .orderBy('action');
  const requirements = await require('../repositories/permissionAttributes.repo')
    .getAllPermissionRequirements();
  return permissions.map(permission => ({
    ...permission,
    alternatives: requirements[`${permission.action}:${permission.resource}`] || []
  }));
}

async function createPermission({ action, resource, description }) {
  const [id] = await knex('permissions').insert({
    action: action.trim(),
    resource: resource.trim(),
    description: description || null
  });
  await pdpService.invalidateAllPermissionCaches();
  pdpService._clearCache();
  return knex('permissions').where({ id }).first();
}

async function setPermissionGrantGroups(permissionId, groups) {
  const permission = await knex('permissions').where({ id: permissionId }).first();
  if (!permission) return null;
  const permissionAttributesRepo = require('../repositories/permissionAttributes.repo');
  await permissionAttributesRepo.replaceGrantGroups(permissionId, groups);
  await pdpService.invalidateAllPermissionCaches();
  pdpService._clearCache();
  return { id: permission.id, grants: groups };
}

module.exports = {
  listPeople,
  getPersonAccessDetails,
  createPerson,
  updatePerson,
  listRoles,
  getRoleAccessDetails,
  createRole,
  setPersonRoles,
  listAttributes,
  createAttribute,
  setRoleAttributes,
  setPersonAttributes,
  listPermissions,
  createPermission,
  setPermissionGrantGroups
};
