const express = require('express');
const router = express.Router();

const { insert_recognition_history_controller } = require('../../controllers/recognition_history/insert_recognition_history.controller');

const { delete_recognition_history_controller } = require('../../controllers/recognition_history/delete_recognition_history.controller');

const { backup_recognition_history_controller } = require('../../controllers/recognition_history/backup_recognition_history.controller');

// INSERT
router.post('/insert-recognition-history', insert_recognition_history_controller);

// DELETE
router.post('/delete-recognition-history', delete_recognition_history_controller);

// BACKUP
router.post('/backup-recognition-history', backup_recognition_history_controller);

module.exports = router;