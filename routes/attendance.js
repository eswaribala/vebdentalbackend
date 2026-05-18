const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();

function getIST() {
  const ist  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const date = `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
  const time = `${String(ist.getHours()).padStart(2, '0')}:${String(ist.getMinutes()).padStart(2, '0')}`;
  return { date, time };
}

router.get('/', async (req, res) => {
  try {
    const { date, staff_id, doctor_id } = req.query;
    let query = `
      SELECT a.*, s.name as staff_name, s.role, s.department
      FROM attendance a
      LEFT JOIN staff s ON a.staff_id = s.id
      WHERE 1=1
    `;
    const params = [];
    if (date)      { query += ' AND a.date = ?';      params.push(date); }
    if (staff_id)  { query += ' AND a.staff_id = ?';  params.push(staff_id); }
    if (doctor_id) { query += ' AND a.doctor_id = ?'; params.push(doctor_id); }
    query += ' ORDER BY a.date DESC, s.name ASC';
    const records = await db.prepare(query).all(...params);
    res.json({ success: true, data: records });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/today', async (req, res) => {
  try {
    const today = getIST().date;

    const staffRecords = await db.prepare(`
      SELECT a.*, s.name as staff_name, s.role, s.department
      FROM attendance a
      LEFT JOIN staff s ON a.staff_id = s.id
      WHERE a.date = ? AND a.staff_id IS NOT NULL
    `).all(today);

    const doctorRecords = await db.prepare(`
      SELECT a.*, d.name as staff_name, 'Doctor' as role, d.specialization as department
      FROM attendance a
      LEFT JOIN doctors d ON a.doctor_id = d.id
      WHERE a.date = ? AND a.doctor_id IS NOT NULL
    `).all(today);

    res.json({ success: true, data: [...staffRecords, ...doctorRecords], date: today });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/summary', async (req, res) => {
  try {
    const { month, year } = req.query;
    const istNow              = getIST();
    const [istYear, istMonth] = istNow.date.split('-');
    const monthStr = month ? String(month).padStart(2, '0') : istMonth;
    const yearStr  = year  || istYear;
    const pattern  = `${yearStr}-${monthStr}%`;

    const staffRows = await db.prepare(`
      SELECT s.id, s.name, s.role, s.department,
             CAST(COUNT(CASE WHEN a.status = 'present'  THEN 1 END) AS INTEGER) as present_days,
             CAST(COUNT(CASE WHEN a.status = 'absent'   THEN 1 END) AS INTEGER) as absent_days,
             CAST(COUNT(CASE WHEN a.status = 'half_day' THEN 1 END) AS INTEGER) as half_days
      FROM staff s
      LEFT JOIN attendance a ON s.id = a.staff_id AND a.date LIKE ?
      WHERE s.is_active = 1
      GROUP BY s.id, s.name, s.role, s.department
    `).all(pattern);

    const doctorRows = await db.prepare(`
      SELECT d.id, d.name, 'Doctor' as role, d.specialization as department,
             CAST(COUNT(CASE WHEN a.status = 'present'  THEN 1 END) AS INTEGER) as present_days,
             CAST(COUNT(CASE WHEN a.status = 'absent'   THEN 1 END) AS INTEGER) as absent_days,
             CAST(COUNT(CASE WHEN a.status = 'half_day' THEN 1 END) AS INTEGER) as half_days
      FROM doctors d
      LEFT JOIN attendance a ON d.id = a.doctor_id AND a.date LIKE ?
      WHERE d.is_active = 1
      GROUP BY d.id, d.name, d.specialization
    `).all(pattern);

    res.json({ success: true, data: [...doctorRows, ...staffRows] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/checkin', async (req, res) => {
  try {
    const { staff_id, doctor_id } = req.body;
    const id      = doctor_id || staff_id;
    const idField = doctor_id ? 'doctor_id' : 'staff_id';
    if (!id) return res.status(400).json({ error: 'staff_id or doctor_id is required' });

    const { date: today, time: now } = getIST();
    const existing = await db.prepare(
      `SELECT * FROM attendance WHERE ${idField} = ? AND date = ?`
    ).get(id, today);

    if (existing) {
      await db.prepare('UPDATE attendance SET check_in = ?, status = ? WHERE id = ?').run(now, 'present', existing.id);
    } else {
      await db.prepare(`INSERT INTO attendance (${idField}, date, check_in, status) VALUES (?, ?, ?, ?)`).run(id, today, now, 'present');
    }
    res.json({ success: true, message: 'Check-in recorded', time: now });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/checkout', async (req, res) => {
  try {
    const { staff_id, doctor_id } = req.body;
    const id      = doctor_id || staff_id;
    const idField = doctor_id ? 'doctor_id' : 'staff_id';
    if (!id) return res.status(400).json({ error: 'staff_id or doctor_id is required' });

    const { date: today, time: now } = getIST();
    const existing = await db.prepare(
      `SELECT * FROM attendance WHERE ${idField} = ? AND date = ?`
    ).get(id, today);

    if (!existing) return res.status(404).json({ error: 'No check-in found for today' });
    await db.prepare('UPDATE attendance SET check_out = ? WHERE id = ?').run(now, existing.id);
    res.json({ success: true, message: 'Check-out recorded', time: now });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { staff_id, doctor_id, date, check_in, check_out, status, notes } = req.body;
    const id      = doctor_id || staff_id;
    const idField = doctor_id ? 'doctor_id' : 'staff_id';
    if (!id || !date) return res.status(400).json({ error: 'id and date are required' });

    const existing = await db.prepare(
      `SELECT * FROM attendance WHERE ${idField} = ? AND date = ?`
    ).get(id, date);

    let record;
    if (existing) {
      await db.prepare('UPDATE attendance SET check_in=?, check_out=?, status=?, notes=? WHERE id=?')
        .run(check_in, check_out, status, notes, existing.id);
      record = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(existing.id);
    } else {
      const result = await db.prepare(
        `INSERT INTO attendance (${idField}, date, check_in, check_out, status, notes) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, date, check_in, check_out, status, notes);
      record = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid);
    }
    res.status(201).json({ success: true, data: record });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { check_in, check_out, status, notes } = req.body;
    await db.prepare('UPDATE attendance SET check_in=?, check_out=?, status=?, notes=? WHERE id=?')
      .run(check_in, check_out, status, notes, req.params.id);
    const record = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: record });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
