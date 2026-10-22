const express = require('express');
const router = express.Router();
const studioController = require('../controllers/studio.controller');
const sheetUpload = require('../middleware/sheetUpload.middleware');
const contractUpload = require('../middleware/contractUpload.middleware');
const { checkPerm, requireAuthenticated } = require('../middleware/auth.middleware');

// --- the spreadsheet of a project ----------------------------------------
// Reading the sheet is for everyone who can read the project; changing it is
// for the people who run the project.
router.get('/:id/sheets', checkPerm('read:project', 'project'), studioController.listSheets);
router.post('/:id/sheets/import', checkPerm('manage_team', 'project'), sheetUpload, studioController.importSheet);
router.put('/:id/sheets/:sheetId', checkPerm('manage_team', 'project'), studioController.saveSheet);
router.delete('/:id/sheets/:sheetId', checkPerm('manage_team', 'project'), studioController.deleteSheet);
router.get('/:id/sheets/export', checkPerm('read:project', 'project'), studioController.exportSheets);

// --- the contract layout and the contracts made from it ------------------
router.get('/:id/contract-template', checkPerm('read:project', 'project'), studioController.getTemplate);
router.put('/:id/contract-template', checkPerm('manage_team', 'project'), contractUpload, studioController.saveTemplate);
router.get('/:id/contracts', checkPerm('read:project', 'project'), studioController.listContracts);
router.post('/:id/contracts/generate', checkPerm('manage_team', 'project'), studioController.generateContracts);
router.patch('/:id/contracts/:contractId', checkPerm('manage_team', 'project'), studioController.updateContract);
router.delete('/:id/contracts/:contractId', checkPerm('manage_team', 'project'), studioController.deleteContract);

// --- meetings ------------------------------------------------------------
router.get('/:id/meetings', checkPerm('read:project', 'project'), studioController.listMeetings);
router.post('/:id/meetings', checkPerm('manage_team', 'project'), studioController.createMeeting);
router.patch('/:id/meetings/:meetingId', checkPerm('manage_team', 'project'), studioController.updateMeeting);
router.delete('/:id/meetings/:meetingId', checkPerm('manage_team', 'project'), studioController.deleteMeeting);

// --- who is working on what ----------------------------------------------
router.get('/:id/work', checkPerm('read:team', 'project'), studioController.projectWork);

module.exports = router;
