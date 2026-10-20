const express = require('express');
const controller = require('../controllers/accessControl.controller');
const { requireOwner } = require('../middleware/auth.middleware');
const contractUpload = require('../middleware/contractUpload.middleware');

const router = express.Router();
router.use(requireOwner);

router.route('/people')
  .get(controller.listPeople)
  .post(contractUpload, controller.createPerson);
router.get('/people/:userId', controller.getPerson);
router.patch('/people/:userId', controller.updatePerson);
router.post('/people/:userId/contracts', contractUpload, controller.addPersonContract);
router.post('/people/:userId/send-verification', controller.sendPersonVerification);
router.post('/people/:userId/verify-email', controller.verifyPersonEmail);
router.put('/people/:userId/roles', controller.setPersonRoles);
router.put('/people/:userId/attributes', controller.setPersonAttributes);
router.get('/contracts/:contractId/file', controller.getContractFile);

router.route('/roles')
  .get(controller.listRoles)
  .post(controller.createRole);
router.get('/roles/:roleId', controller.getRole);
router.put('/roles/:roleId/attributes', controller.setRoleAttributes);

router.route('/attributes')
  .get(controller.listAttributes)
  .post(controller.createAttribute);

router.route('/permissions')
  .get(controller.listPermissions)
  .post(controller.createPermission);
router.put('/permissions/:permissionId/grants', controller.setPermissionGrantGroups);

module.exports = router;
