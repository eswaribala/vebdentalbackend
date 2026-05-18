const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();

function getIST() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const date = `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
  const time = `${String(ist.getHours()).padStart(2, '0')}:${String(ist.getMinutes()).padStart(2, '0')}`;
  return { date, time };
}

// GET / — query attendance records
router.get('/', (req, res) => {
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
    const records = db.prepare(query).all(...params);
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /today — staff + doctor attendance records for today
router.get('/today', (req, res) => {
  try {
    const today = getIST().date;

    // Staff attendance records (with staff info)
    const staffRecords = db.prepare(`
      SELECT a.*, s.name as staff_name, s.role, s.department
      FROM attendance a
      LEFT JOIN staff s ON a.staff_id = s.id
      WHERE a.date = ? AND a.staff_id IS NOT NULL
    `).all(today);

    // Doctor attendance records (with doctor info)
    const doctorRecords = db.prepare(`
      SELECT a.*, d.name as staff_name, 'Doctor' as role, d.specialization as department
      FROM attendance a
      LEFT JOIN doctors d ON a.doctor_id = d.id
      WHERE a.date = ? AND a.doctor_id IS NOT NULL
    `).all(today);

    const records = [...staffRecords, ...doctorRecords];
    res.json({ success: true, data: records, date: today });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /summary — monthly summary for staff + doctors
router.get('/summary', (req, res) => {
  try {
    const { month, year } = req.query;
    const istNow = getIST();
    const [istYear, istMonth] = istNow.date.split('-');
    const monthStr = month ? String(month).padStart(2, '0') : istMonth;
    const yearStr  = year  || istYear;
    const pattern  = `${yearStr}-${monthStr}%`;

    const staffRecords = db.prepare(`
      SELECT s.id, s.name, s.role, s.department,
             COUNT(CASE WHEN a.status = 'present'  THEN 1 END) as present_days,
             COUNT(CASE WHEN a.status = 'absent'   THEN 1 END) as absent_days,
             COUNT(CASE WHEN a.status = 'half_day' THEN 1 END) as half_days
      FROM staff s
      LEFT JOIN attendance a ON s.id = a.staff_id AND a.date LIKE ?
      WHERE s.is_active = 1
      GROUP BY s.id
    `).all(pattern);

    const doctorRecords = db.prepare(`
      SELECT d.id, d.name, 'Doctor' as role, d.specialization as department,
             COUNT(CASE WHEN a.status = 'present'  THEN 1 END) as present_days,
             COUNT(CASE WHEN a.status = 'absent'   THEN 1 END) as absent_days,
             COUNT(CASE WHEN a.status = 'half_day' THEN 1 END) as half_days
      FROM doctors d
      LEFT JOIN attendance a ON d.id = a.doctor_id AND a.date LIKE ?
      WHERE d.is_active = 1
      GROUP BY d.id
    `).all(pattern);

    res.json({ success: true, data: [...doctorRecords, ...staffRecords] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /checkin — supports both staff_id and doctor_id
router.post('/checkin', (req, res) => {
  try {
    const { staff_id, doctor_id } = req.body;
    const id      = doctor_id || staff_id;
    const idField = doctor_id ? 'doctor_id' : 'staff_id';
    if (!id) return res.status(400).json({ error: 'staff_id or doctor_id is required' });

    const { date: today, time: now } = getIST();
    const existing = db.prepare(
      `SELECT * FROM attendance WHERE ${idField} = ? AND date = ?`
    ).get(id, today);

    if (existing) {
      db.prepare('UPDATE attendance SET check_in = ?, status = ? WHERE id = ?').run(now, 'present', existing.id);
    } else {
      db.prepare(`INSERT INTO attendance (${idField}, date, check_in, status) VALUES (?, ?, ?, ?)`).run(id, today, now, 'present');
    }
    res.json({ success: true, message: 'Check-in recorded', time: now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /checkout — supports both staff_id and doctor_id
router.post('/checkout', (req, res) => {
  try {
    const { staff_id, doctor_id } = req.body;
    const id      = doctor_id || staff_id;
    const idField = doctor_id ? 'doctor_id' : 'staff_id';
    if (!id) return res.status(400).json({ error: 'staff_id or doctor_id is required' });

    const { date: today, time: now } = getIST();
    const existing = db.prepare(
      `SELECT * FROM attendance WHERE ${idField} = ? AND date = ?`
    ).get(id, today);

    if (!existing) return res.status(404).json({ error: 'No check-in found for today' });
    db.prepare('UPDATE attendance SET check_out = ? WHERE id = ?').run(now, existing.id);
    res.json({ success: true, message: 'Check-out recorded', time: now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — save / upsert an attendance record (staff or doctor)
router.post('/', (req, res) => {
  try {
    const { staff_id, doctor_id, date, check_in, check_out, status, notes } = req.body;
    const id      = doctor_id || staff_id;
    const idField = doctor_id ? 'doctor_id' : 'staff_id';
    if (!id || !date) return res.status(400).json({ error: 'id and date are required' });

    const existing = db.prepare(
      `SELECT * FROM attendance WHERE ${idField} = ? AND date = ?`
    ).get(id, date);

    let record;
    if (existing) {
      db.prepare('UPDATE attendance SET check_in=?, check_out=?, status=?, notes=? WHERE id=?')
        .run(check_in, check_out, status, notes, existing.id);
      record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(existing.id);
    } else {
      const result = db.prepare(
        `INSERT INTO attendance (${idField}, date, check_in, check_out, status, notes) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, date, check_in, check_out, status, notes);
      record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid);
    }
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — update existing record
router.put('/:id', (req, res) => {
  try {
    const { check_in, check_out, status, notes } = req.body;
    db.prepare('UPDATE attendance SET check_in=?, check_out=?, status=?, notes=? WHERE id=?')
      .run(check_in, check_out, status, notes, req.params.id);
    const record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
