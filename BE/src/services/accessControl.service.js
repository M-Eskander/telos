const knex = require('../config/knex');
const bcrypt = require('bcryptjs');
const pdpService = require('./pdp.service');
const contractService = require('./contract.service');
const emailVerificationService = require('./emailVerification.service');
const {
  getPreset,
  presetByAttribute,
  PRESET_ATTRIBUTE_NAMES
} = require('../config/accessPresets');

async function listPeople() {
  const people = await knex('users')
    .select('id', 'name', 'email', 'phone_number', 'location', 'age', 'is_active', 'created_at', 'email_verified_at')
    .orderBy('name');
  const assignments = await knex('user_roles')
    .join('roles', 'user_roles.role_id', 'roles.id')
    .select(
      'user_roles.user_id',
      'roles.id as roleId',
      'roles.name',
      'user_roles.resource_type as resourceType',
      'user_roles.resource_id as resourceId'
    );
  // Which built-in access level a role carries, so a person list can show it.
  const presetRows = await knex('role_attributes')
    .join('attributes', 'role_attributes.attribute_id', 'attributes.id')
    .whereIn('attributes.name', PRESET_ATTRIBUTE_NAMES)
    .select('role_attributes.role_id as roleId', 'attributes.name as attributeName');
  const presetByRole = new Map();
  for (const row of presetRows) {
    const preset = presetByAttribute(row.attributeName);
    if (preset) presetByRole.set(Number(row.roleId), preset.key);
  }
  const contracts = await knex('contracts').orderBy('start_date', 'desc').orderBy('id', 'desc');
  const ownerAccount = await knex('owner_account').where({ id: 1 }).first();
  const rolesByUser = new Map();
  const assignmentsByUser = new Map();
  const contractsByUser = new Map();
  for (const assignment of assignments) {
    if (!rolesByUser.has(assignment.user_id)) rolesByUser.set(assignment.user_id, []);
    rolesByUser.get(assignment.user_id).push(assignment.name);
    if (!assignmentsByUser.has(assignment.user_id)) assignmentsByUser.set(assignment.user_id, []);
    assignmentsByUser.get(assignment.user_id).push({
      name: assignment.name,
      resourceType: assignment.resourceType,
      resourceId: assignment.resourceId,
      accessPreset: presetByRole.get(Number(assignment.roleId)) || null
    });
  }
  for (const contract of contracts) {
    if (!contractsByUser.has(contract.user_id)) contractsByUser.set(contract.user_id, []);
    contractsByUser.get(contract.user_id).push(contractService.publicContract(contract));
  }
  return people.map(person => {
    const { email_verified_at, ...fields } = person;
    return {
      ...fields,
      emailVerified: !!email_verified_at,
      roles: rolesByUser.get(person.id) || [],
      roleAssignments: assignmentsByUser.get(person.id) || [],
      contracts: contractsByUser.get(person.id) || [],
      hasContract: (contractsByUser.get(person.id) || [])
        .some(contract => contract.uploaded && contract.start_date && contract.end_date),
      isOwner: !!ownerAccount && ownerAccount.user_id === person.id
    };
  });
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
  const presetRoleIds = new Set();
  if (roles.length) {
    const presetRows = await trx('role_attributes')
      .join('attributes', 'role_attributes.attribute_id', 'attributes.id')
      .whereIn('role_attributes.role_id', roles.map(role => role.id))
      .whereIn('attributes.name', PRESET_ATTRIBUTE_NAMES)
      .select('role_attributes.role_id as roleId');
    for (const row of presetRows) presetRoleIds.add(Number(row.roleId));
  }
  if (assignments.some(role =>
    presetRoleIds.has(Number(rolesByName.get(role.name).id)) && role.resourceType !== 'project'
  )) {
    throw new TypeError('Project access presets must be assigned within a project');
  }
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
    .select('id', 'name', 'email', 'phone_number', 'location', 'age', 'is_active', 'created_at', 'email_verified_at')
    .first();
  if (!person) return null;
  const { email_verified_at, ...personFields } = person;
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
  const contracts = await contractService.listContractsForUser(userId);
  return {
    ...personFields,
    emailVerified: !!email_verified_at,
    roles,
    attributes,
    contracts,
    isOwner: !!ownerAccount
  };
}

async function createPerson(data, contractFile) {
  const password = await bcrypt.hash(data.password, 10);
  const created = await contractService.createPersonWithContract(
    contractFile,
    {
      start_date: data.contract_start_date,
      end_date: data.contract_end_date,
      terms: data.contract_terms
    },
    async trx => {
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
      return user;
    }
  );
  created.user.contracts = [created.contract];
  created.user.hasContract = true;
  let verificationEmail = { sent: false, skipped: false };
  try {
    const delivery = await emailVerificationService.sendVerificationEmail(created.user);
    verificationEmail = { sent: !!delivery.sent, skipped: !!delivery.skipped };
  } catch (error) {
    console.error(`Failed to send verification email to ${created.user.email}:`, error.message);
  }
  created.user.verificationEmail = verificationEmail;
  return safePerson(created.user);
}

function safePerson(user) {
  if (!user) return user;
  delete user.password;
  delete user.email_verification_token_hash;
  delete user.email_verification_expires_at;
  if (user.email_verified_at !== undefined) {
    user.emailVerified = !!user.email_verified_at;
    delete user.email_verified_at;
  }
  return user;
}

async function updatePerson(userId, data) {
  if (data.is_active === false &&
      await knex('owner_account').where({ user_id: userId }).first()) {
    throw new TypeError('The owner account cannot be archived');
  }
  if (data.is_active === true) {
    const hasUploadedContract = await knex('contracts')
      .where({ user_id: userId })
      .whereNotNull('storage_key')
      .whereNotNull('start_date')
      .whereNotNull('end_date')
      .first();
    if (!hasUploadedContract) {
      throw new TypeError('An uploaded contract with start and end dates is required before activating a person');
    }
  }
  if (typeof data.email === 'string') {
    const current = await knex('users').where({ id: userId }).select('email').first();
    if (current && current.email !== data.email) {
      // Verification is bound to the address; a changed address must be re-verified.
      data.email_verified_at = null;
      data.email_verification_token_hash = null;
      data.email_verification_expires_at = null;
    }
  }
  const updated = await knex('users').where({ id: userId }).update(data);
  if (!updated) return null;
  return safePerson(await knex('users').where({ id: userId }).first());
}

async function addPersonContract(userId, file, metadata) {
  return contractService.addContract(userId, file, metadata);
}

async function getContractFile(contractId) {
  return contractService.getContractFile(contractId);
}

async function listRoles() {
  const roles = await knex('roles').select('id', 'name').orderBy('name');
  const attributes = await knex('role_attributes')
    .join('attributes', 'role_attributes.attribute_id', 'attributes.id')
    .select(
      'role_attributes.role_id as roleId',
      'attributes.id as attributeId',
      'attributes.name',
      'attributes.resource',
      'role_attributes.resource_id as resourceId'
    );
  const byRole = new Map();
  for (const attribute of attributes) {
    if (!byRole.has(attribute.roleId)) byRole.set(attribute.roleId, []);
    byRole.get(attribute.roleId).push(attribute);
  }
  return roles.map(role => {
    const roleAttributes = byRole.get(role.id) || [];
    const preset = roleAttributes
      .map(attribute => presetByAttribute(attribute.name))
      .find(Boolean);
    return {
      ...role,
      attributes: roleAttributes,
      accessPreset: preset ? preset.key : null
    };
  });
}

async function getRoleAccessDetails(roleId) {
  const role = await knex('roles').where({ id: roleId }).select('id', 'name').first();
  if (!role) return null;
  role.attributes = await knex('role_attributes')
    .join('attributes', 'role_attributes.attribute_id', 'attributes.id')
    .where({ 'role_attributes.role_id': roleId })
    .select('attributes.id as attributeId', 'attributes.name', 'attributes.resource', 'role_attributes.resource_id as resourceId');
  const preset = role.attributes
    .map(attribute => presetByAttribute(attribute.name))
    .find(Boolean);
  role.accessPreset = preset ? preset.key : null;
  return role;
}

async function ensurePresetAttribute(trx, preset) {
  let attribute = await trx('attributes').where({ name: preset.attribute }).first();
  if (!attribute) {
    const [attributeId] = await trx('attributes').insert({
      name: preset.attribute,
      resource: 'project',
      description: preset.attributeDescription
    });
    attribute = await trx('attributes').where({ id: attributeId }).first();
  } else if (attribute.resource !== 'project') {
    throw new TypeError(`The ${preset.attribute} attribute must use the project resource`);
  }
  return attribute;
}

async function createRole(name, presetKey = null) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError('Role name is required');
  }
  if (name.trim().toLowerCase() === 'owner') {
    throw new TypeError('The owner role is reserved');
  }
  const preset = presetKey === undefined || presetKey === null || presetKey === ''
    ? null
    : getPreset(presetKey);
  if (presetKey !== undefined && presetKey !== null && presetKey !== '' && !preset) {
    throw new TypeError('Unknown access preset');
  }

  return knex.transaction(async trx => {
    const normalizedName = name.trim();
    if (await trx('roles').where({ name: normalizedName }).first()) {
      const error = new Error('Role already exists');
      error.code = 'ROLE_ALREADY_EXISTS';
      throw error;
    }
    const [id] = await trx('roles').insert({ name: normalizedName });
    if (preset) {
      const attribute = await ensurePresetAttribute(trx, preset);
      await trx('role_attributes').insert({
        role_id: id,
        attribute_id: attribute.id,
        resource_id: null,
        value: 'true'
      });
    }
    const role = await trx('roles').where({ id }).first();
    const attributes = await trx('role_attributes')
      .join('attributes', 'role_attributes.attribute_id', 'attributes.id')
      .where({ 'role_attributes.role_id': id })
      .select(
        'attributes.id as attributeId',
        'attributes.name',
        'attributes.resource',
        'role_attributes.resource_id as resourceId'
      );
    return { ...role, attributes, accessPreset: preset ? preset.key : null };
  });
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
  addPersonContract,
  getContractFile,
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
