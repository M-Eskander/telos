const accessControlService = require('../services/accessControl.service');

function isConstraintError(error) {
  return typeof error.code === 'string' &&
    (error.code === 'ER_DUP_ENTRY' || error.code.startsWith('SQLITE_CONSTRAINT'));
}

exports.listPeople = async (req, res, next) => {
  try {
    return res.json({ ok: true, people: await accessControlService.listPeople() });
  } catch (error) {
    return next(error);
  }
};

exports.getPerson = async (req, res, next) => {
  try {
    const person = await accessControlService.getPersonAccessDetails(req.params.userId);
    if (!person) return res.status(404).json({ ok: false, message: 'Person not found' });
    return res.json({ ok: true, person });
  } catch (error) {
    return next(error);
  }
};

exports.createPerson = async (req, res, next) => {
  try {
    const { name, email, phone_number, password } = req.body || {};
    if (!name || !email || !phone_number || !password) {
      return res.status(400).json({ ok: false, message: 'Name, email, phone number, and password are required' });
    }
    if (typeof name !== 'string' || typeof email !== 'string' ||
        typeof phone_number !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ ok: false, message: 'Person fields must be strings' });
    }
    if (req.body.is_active !== undefined && typeof req.body.is_active !== 'boolean') {
      return res.status(400).json({ ok: false, message: 'is_active must be a boolean' });
    }
    if (req.body.age !== undefined && req.body.age !== null &&
        (!Number.isInteger(req.body.age) || req.body.age < 0)) {
      return res.status(400).json({ ok: false, message: 'Age must be a non-negative integer' });
    }
    const person = await accessControlService.createPerson({
      ...req.body,
      name,
      email,
      phone_number,
      password
    });
    return res.status(201).json({ ok: true, person });
  } catch (error) {
    if (error instanceof TypeError) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    if (isConstraintError(error)) {
      return res.status(409).json({ ok: false, message: 'A person with this email already exists' });
    }
    return next(error);
  }
};

exports.updatePerson = async (req, res, next) => {
  try {
    const data = {};
    for (const field of ['name', 'email', 'phone_number', 'location', 'age', 'is_active']) {
      if (req.body[field] !== undefined) data[field] = req.body[field];
    }
    for (const field of ['name', 'email', 'phone_number', 'location']) {
      if (data[field] !== undefined && typeof data[field] !== 'string') {
        return res.status(400).json({ ok: false, message: `${field} must be a string` });
      }
    }
    if (data.is_active !== undefined && typeof data.is_active !== 'boolean') {
      return res.status(400).json({ ok: false, message: 'is_active must be a boolean' });
    }
    if (data.age !== undefined && data.age !== null &&
        (!Number.isInteger(data.age) || data.age < 0)) {
      return res.status(400).json({ ok: false, message: 'Age must be a non-negative integer' });
    }
    const person = await accessControlService.updatePerson(req.params.userId, data);
    if (!person) return res.status(404).json({ ok: false, message: 'Person not found' });
    return res.json({ ok: true, person });
  } catch (error) {
    if (error instanceof TypeError) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    return next(error);
  }
};

exports.setPersonRoles = async (req, res, next) => {
  try {
    const roles = await accessControlService.setPersonRoles(
      req.params.userId,
      req.body && req.body.roles
    );
    if (!roles) return res.status(404).json({ ok: false, message: 'Person not found' });
    return res.json({ ok: true, roles });
  } catch (error) {
    if (error instanceof TypeError) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    return next(error);
  }
};

exports.listRoles = async (req, res, next) => {
  try {
    return res.json({ ok: true, roles: await accessControlService.listRoles() });
  } catch (error) {
    return next(error);
  }
};

exports.getRole = async (req, res, next) => {
  try {
    const role = await accessControlService.getRoleAccessDetails(req.params.roleId);
    if (!role) return res.status(404).json({ ok: false, message: 'Role not found' });
    return res.json({ ok: true, role });
  } catch (error) {
    return next(error);
  }
};

exports.createRole = async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ ok: false, message: 'Role name is required' });
    }
    return res.status(201).json({ ok: true, role: await accessControlService.createRole(name) });
  } catch (error) {
    if (error instanceof TypeError) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    if (error.code === 'ROLE_ALREADY_EXISTS') {
      return res.status(409).json({ ok: false, message: error.message });
    }
    if (isConstraintError(error)) {
      return res.status(409).json({ ok: false, message: 'Role already exists' });
    }
    return next(error);
  }
};

exports.setRoleAttributes = async (req, res, next) => {
  try {
    const attributes = await accessControlService.setRoleAttributes(
      req.params.roleId,
      req.body && req.body.attributes
    );
    if (!attributes) return res.status(404).json({ ok: false, message: 'Role not found' });
    return res.json({ ok: true, attributes });
  } catch (error) {
    if (error instanceof TypeError) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    return next(error);
  }
};

exports.listAttributes = async (req, res, next) => {
  try {
    return res.json({ ok: true, attributes: await accessControlService.listAttributes() });
  } catch (error) {
    return next(error);
  }
};

exports.createAttribute = async (req, res, next) => {
  try {
    const { name, resource, description } = req.body || {};
    if (typeof name !== 'string' || !name.trim() ||
        typeof resource !== 'string' || !resource.trim()) {
      return res.status(400).json({ ok: false, message: 'Attribute name and resource are required' });
    }
    return res.status(201).json({
      ok: true,
      attribute: await accessControlService.createAttribute({ name, resource, description })
    });
  } catch (error) {
    if (isConstraintError(error)) {
      return res.status(409).json({ ok: false, message: 'Attribute already exists' });
    }
    return next(error);
  }
};

exports.setPersonAttributes = async (req, res, next) => {
  try {
    const attributes = await accessControlService.setPersonAttributes(
      req.params.userId,
      req.body && req.body.attributes
    );
    if (!attributes) return res.status(404).json({ ok: false, message: 'Person not found' });
    return res.json({ ok: true, attributes });
  } catch (error) {
    if (error instanceof TypeError) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    return next(error);
  }
};

exports.listPermissions = async (req, res, next) => {
  try {
    return res.json({ ok: true, permissions: await accessControlService.listPermissions() });
  } catch (error) {
    return next(error);
  }
};

exports.createPermission = async (req, res, next) => {
  try {
    const { action, resource, description } = req.body || {};
    if (typeof action !== 'string' || !action.trim() ||
        typeof resource !== 'string' || !resource.trim()) {
      return res.status(400).json({ ok: false, message: 'Permission action and resource are required' });
    }
    return res.status(201).json({
      ok: true,
      permission: await accessControlService.createPermission({ action, resource, description })
    });
  } catch (error) {
    if (isConstraintError(error)) {
      return res.status(409).json({ ok: false, message: 'Permission already exists' });
    }
    return next(error);
  }
};

exports.setPermissionGrantGroups = async (req, res, next) => {
  try {
    const result = await accessControlService.setPermissionGrantGroups(
      req.params.permissionId,
      req.body && req.body.alternatives
    );
    if (!result) return res.status(404).json({ ok: false, message: 'Permission not found' });
    return res.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof TypeError) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    if (error.message.includes('do not exist')) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    return next(error);
  }
};
