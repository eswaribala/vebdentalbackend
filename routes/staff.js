const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();

function generateStaffId() {
  const year = new Date().getFullYear().toString().slice(-2);
  const count = db.prepare('SELECT COUNT(*) as c FROM staff').get().c + 1;
  return `VEB-S${year}${String(count).padStart(3, '0')}`;
}

router.get('/', (req, res) => {
  try {
    const staff = db.prepare('SELECT * FROM staff WHERE is_active = 1 ORDER BY name').all();
    res.json({ success: true, data: staff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/all', (req, res) => {
  try {
    const staff = db.prepare('SELECT * FROM staff ORDER BY name').all();
    res.json({ success: true, data: staff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const member = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
    if (!member) return res.status(404).json({ error: 'Staff not found' });
    res.json({ success: true, data: member });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { name, role, mobile, email, department, joining_date, salary } = req.body;
    const staff_id = generateStaffId();
    const result = db.prepare(`
      INSERT INTO staff (staff_id, name, role, mobile, email, department, joining_date, salary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(staff_id, name, role, mobile, email, department, joining_date, salary);
    const member = db.prepare('SELECT * FROM staff WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: member });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const { name, role, mobile, email, department, joining_date, salary, is_active } = req.body;
    db.prepare(`
      UPDATE staff SET name=?, role=?, mobile=?, email=?, department=?, joining_date=?, salary=?, is_active=?
      WHERE id=?
    `).run(name, role, mobile, email, department, joining_date, salary, is_active ?? 1, req.params.id);
    const member = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: member });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    db.prepare('UPDATE staff SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Staff deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
