const express = require('express');
const router = express.Router();

const { insert_recognition_history_controller, } = require('../../controllers/recognition_history/insert_recognition_history.controller');

router.post('/insert-recognition-history', insert_recognition_history_controller);

module.exports = router;