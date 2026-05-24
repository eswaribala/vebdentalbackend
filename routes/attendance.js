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

// Detect morning (9–13h) or evening (16–22h) from IST time string "HH:MM"
function detectSession(time) {
  const h = parseInt(time.split(':')[0], 10);
  if (h >= 9 && h < 13) return 'morning';
  if (h >= 16 && h < 22) return 'evening';
  return h < 16 ? 'morning' : 'evening';
}

// both sessions present → present; one → half_day; neither → absent
function recalcStatus(morning_in, evening_in) {
  const m = !!morning_in;
  const e = !!evening_in;
  if (m && e) return 'present';
  if (m || e) return 'half_day';
  return 'absent';
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
        AND (d.is_owner IS NULL OR d.is_owner = 0)
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

    // Single JOIN per group — rows already belong to the right person,
    // no JavaScript ID matching needed (eliminates the type-mismatch bug).
    const doctorRaw = await db.prepare(`
      SELECT d.id, d.name, 'Doctor' AS role, d.specialization AS department,
             a.date, a.morning_in, a.morning_out, a.evening_in, a.evening_out, a.status
      FROM doctors d
      LEFT JOIN attendance a ON d.id = a.doctor_id AND a.date LIKE ?
      WHERE d.is_active = 1
        AND (d.is_owner IS NULL OR d.is_owner = 0)
      ORDER BY d.name ASC, a.date ASC
    `).all(pattern);

    const staffRaw = await db.prepare(`
      SELECT s.id, s.name, s.role, s.department,
             a.date, a.morning_in, a.morning_out, a.evening_in, a.evening_out, a.status
      FROM staff s
      LEFT JOIN attendance a ON s.id = a.staff_id AND a.date LIKE ?
      WHERE s.is_active = 1
        AND LOWER(s.role) != 'consultant'
      ORDER BY s.name ASC, a.date ASC
    `).all(pattern);

    // Group rows by person — LEFT JOIN produces one row per attendance record;
    // doctors/staff with no records appear once with NULL date fields.
    function groupByPerson(rows, type) {
      const map = new Map();
      rows.forEach(row => {
        const key = String(row.id);
        if (!map.has(key)) {
          map.set(key, {
            id: row.id, name: row.name, role: row.role,
            department: row.department, type,
            present_days: 0, absent_days: 0, half_days: 0,
            records: [],
          });
        }
        const person = map.get(key);
        if (row.date) {                          // skip NULL rows (no records for this month)
          person.records.push({
            date:        row.date,
            morning_in:  row.morning_in,
            morning_out: row.morning_out,
            evening_in:  row.evening_in,
            evening_out: row.evening_out,
            status:      row.status,
          });
          if      (row.status === 'present')  person.present_days++;
          else if (row.status === 'absent')   person.absent_days++;
          else if (row.status === 'half_day') person.half_days++;
        }
      });
      return Array.from(map.values());
    }

    const doctorData = groupByPerson(doctorRaw, 'doctor');
    const staffData  = groupByPerson(staffRaw,  'staff');

    res.json({ success: true, data: [...doctorData, ...staffData], month: monthStr, year: yearStr });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/checkin', async (req, res) => {
  try {
    const { staff_id, doctor_id, session } = req.body;
    const id      = doctor_id || staff_id;
    const idField = doctor_id ? 'doctor_id' : 'staff_id';
    if (!id) return res.status(400).json({ error: 'staff_id or doctor_id is required' });

    const { date: today, time: now } = getIST();
    const sess  = session || detectSession(now);
    const colIn = sess === 'morning' ? 'morning_in' : 'evening_in';

    const existing = await db.prepare(
      `SELECT * FROM attendance WHERE ${idField} = ? AND date = ?`
    ).get(id, today);

    if (existing) {
      await db.prepare(`UPDATE attendance SET ${colIn} = ? WHERE id = ?`).run(now, existing.id);
      const newMorningIn = sess === 'morning' ? now : existing.morning_in;
      const newEveningIn = sess === 'evening' ? now : existing.evening_in;
      const status = recalcStatus(newMorningIn, newEveningIn);
      await db.prepare('UPDATE attendance SET status = ? WHERE id = ?').run(status, existing.id);
    } else {
      await db.prepare(
        `INSERT INTO attendance (${idField}, date, ${colIn}, status) VALUES (?, ?, ?, ?)`
      ).run(id, today, now, 'half_day');
    }
    res.json({ success: true, message: 'Check-in recorded', time: now, session: sess });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/checkout', async (req, res) => {
  try {
    const { staff_id, doctor_id, session } = req.body;
    const id      = doctor_id || staff_id;
    const idField = doctor_id ? 'doctor_id' : 'staff_id';
    if (!id) return res.status(400).json({ error: 'staff_id or doctor_id is required' });

    const { date: today, time: now } = getIST();
    const sess   = session || detectSession(now);
    const colIn  = sess === 'morning' ? 'morning_in'  : 'evening_in';
    const colOut = sess === 'morning' ? 'morning_out' : 'evening_out';

    const existing = await db.prepare(
      `SELECT * FROM attendance WHERE ${idField} = ? AND date = ?`
    ).get(id, today);

    if (!existing) return res.status(404).json({ error: 'No attendance record found for today' });
    if (!existing[colIn]) return res.status(400).json({ error: `No ${sess} check-in found` });

    await db.prepare(`UPDATE attendance SET ${colOut} = ? WHERE id = ?`).run(now, existing.id);
    res.json({ success: true, message: 'Check-out recorded', time: now, session: sess });
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
