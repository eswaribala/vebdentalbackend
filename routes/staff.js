const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();

async function generateStaffId() {
  const row = await db.prepare('SELECT CAST(COUNT(*) AS INTEGER) as c FROM staff').get();
  const count = (row?.c ?? 0) + 1;
  const year = new Date().getFullYear().toString().slice(-2);
  return `VEB-S${year}${String(count).padStart(3, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const staff = await db.prepare('SELECT * FROM staff WHERE is_active = 1 ORDER BY name').all();
    res.json({ success: true, data: staff });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/all', async (req, res) => {
  try {
    const staff = await db.prepare('SELECT * FROM staff ORDER BY name').all();
    res.json({ success: true, data: staff });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const member = await db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
    if (!member) return res.status(404).json({ error: 'Staff not found' });
    res.json({ success: true, data: member });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, role, mobile, email, department, joining_date, salary } = req.body;
    const staff_id = await generateStaffId();
    const result = await db.prepare(`
      INSERT INTO staff (staff_id, name, role, mobile, email, department, joining_date, salary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(staff_id, name, role, mobile, email, department, joining_date, salary);
    const member = await db.prepare('SELECT * FROM staff WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: member });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, role, mobile, email, department, joining_date, salary, is_active } = req.body;
    await db.prepare(`
      UPDATE staff SET name=?, role=?, mobile=?, email=?, department=?, joining_date=?, salary=?, is_active=?
      WHERE id=?
    `).run(name, role, mobile, email, department, joining_date, salary, is_active ?? 1, req.params.id);
    const member = await db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: member });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.prepare('UPDATE staff SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Staff deactivated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
