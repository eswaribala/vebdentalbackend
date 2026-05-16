const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();

router.get('/', (req, res) => {
  try {
    const { date, staff_id } = req.query;
    let query = `
      SELECT a.*, s.name as staff_name, s.role, s.department
      FROM attendance a
      LEFT JOIN staff s ON a.staff_id = s.id
      WHERE 1=1
    `;
    const params = [];
    if (date) { query += ' AND a.date = ?'; params.push(date); }
    if (staff_id) { query += ' AND a.staff_id = ?'; params.push(staff_id); }
    query += ' ORDER BY a.date DESC, s.name ASC';
    const records = db.prepare(query).all(...params);
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/today', (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const allStaff = db.prepare('SELECT * FROM staff WHERE is_active = 1').all();
    const records = db.prepare(`
      SELECT a.*, s.name as staff_name, s.role, s.department
      FROM attendance a
      LEFT JOIN staff s ON a.staff_id = s.id
      WHERE a.date = ?
    `).all(today);
    res.json({ success: true, data: records, total_staff: allStaff.length, date: today });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/summary', (req, res) => {
  try {
    const { month, year } = req.query;
    const monthStr = month ? String(month).padStart(2, '0') : String(new Date().getMonth() + 1).padStart(2, '0');
    const yearStr = year || new Date().getFullYear().toString();
    const records = db.prepare(`
      SELECT s.id, s.name, s.role, s.department,
             COUNT(CASE WHEN a.status = 'present' THEN 1 END) as present_days,
             COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent_days,
             COUNT(CASE WHEN a.status = 'half_day' THEN 1 END) as half_days
      FROM staff s
      LEFT JOIN attendance a ON s.id = a.staff_id AND a.date LIKE ?
      WHERE s.is_active = 1
      GROUP BY s.id
    `).all(`${yearStr}-${monthStr}%`);
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/checkin', (req, res) => {
  try {
    const { staff_id } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toTimeString().slice(0, 5);
    const existing = db.prepare('SELECT * FROM attendance WHERE staff_id = ? AND date = ?').get(staff_id, today);
    if (existing) {
      db.prepare('UPDATE attendance SET check_in = ?, status = ? WHERE id = ?').run(now, 'present', existing.id);
    } else {
      db.prepare('INSERT INTO attendance (staff_id, date, check_in, status) VALUES (?, ?, ?, ?)').run(staff_id, today, now, 'present');
    }
    res.json({ success: true, message: 'Check-in recorded', time: now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/checkout', (req, res) => {
  try {
    const { staff_id } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toTimeString().slice(0, 5);
    const existing = db.prepare('SELECT * FROM attendance WHERE staff_id = ? AND date = ?').get(staff_id, today);
    if (!existing) return res.status(404).json({ error: 'No check-in found for today' });
    db.prepare('UPDATE attendance SET check_out = ? WHERE id = ?').run(now, existing.id);
    res.json({ success: true, message: 'Check-out recorded', time: now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { staff_id, date, check_in, check_out, status, notes } = req.body;
    const existing = db.prepare('SELECT * FROM attendance WHERE staff_id = ? AND date = ?').get(staff_id, date);
    let record;
    if (existing) {
      db.prepare('UPDATE attendance SET check_in=?, check_out=?, status=?, notes=? WHERE id=?').run(check_in, check_out, status, notes, existing.id);
      record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(existing.id);
    } else {
      const result = db.prepare('INSERT INTO attendance (staff_id, date, check_in, check_out, status, notes) VALUES (?, ?, ?, ?, ?, ?)').run(staff_id, date, check_in, check_out, status, notes);
      record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid);
    }
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const { check_in, check_out, status, notes } = req.body;
    db.prepare('UPDATE attendance SET check_in=?, check_out=?, status=?, notes=? WHERE id=?').run(check_in, check_out, status, notes, req.params.id);
    const record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
