const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();

router.get('/', async (req, res) => {
  try {
    const doctors = await db.prepare('SELECT * FROM doctors WHERE is_active = 1 ORDER BY name').all();
    res.json({ success: true, data: doctors });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/all', async (req, res) => {
  try {
    const doctors = await db.prepare('SELECT * FROM doctors ORDER BY name').all();
    res.json({ success: true, data: doctors });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const doctor = await db.prepare('SELECT * FROM doctors WHERE id = ?').get(req.params.id);
    if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
    res.json({ success: true, data: doctor });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, specialization, qualification, experience, mobile, email, schedule, registration_no } = req.body;
    const result = await db.prepare(`
      INSERT INTO doctors (name, specialization, qualification, experience, mobile, email, schedule, registration_no)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, specialization, qualification, experience, mobile, email, schedule, registration_no);
    const doctor = await db.prepare('SELECT * FROM doctors WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: doctor });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, specialization, qualification, experience, mobile, email, schedule, registration_no, is_active } = req.body;
    await db.prepare(`
      UPDATE doctors SET name=?, specialization=?, qualification=?, experience=?,
        mobile=?, email=?, schedule=?, registration_no=?, is_active=?
      WHERE id=?
    `).run(name, specialization, qualification, experience, mobile, email, schedule, registration_no, is_active ?? 1, req.params.id);
    const doctor = await db.prepare('SELECT * FROM doctors WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: doctor });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.prepare('UPDATE doctors SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Doctor deactivated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
