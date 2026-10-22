const express = require('express');
const router = express.Router();
const onlyofficeController = require('../controllers/onlyoffice.controller');

// These two endpoints are called by the Document Server, not by the browser.
// They carry short-lived signed tokens instead of a session cookie: the
// document URL can only read one project, and the callback URL can only save
// one project. The callback additionally requires ONLYOFFICE's own JWT.
router.get('/document/:token', onlyofficeController.document);
router.post('/callback/:token', onlyofficeController.callback);

module.exports = router;
