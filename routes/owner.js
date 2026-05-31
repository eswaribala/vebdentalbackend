const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getDb } = require('../database');
const db = getDb();

function requireOwner(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { JWT_SECRET } = require('./auth');
    const user = jwt.verify(token, JWT_SECRET);
    if (user.role !== 'owner') return res.status(403).json({ error: 'Owner access only' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Blocked slots (owner-as-doctor) ───────────────────────────────────────────

router.get('/blocked-slots', requireOwner, async (req, res) => {
  try {
    const ownerDoc = await db.prepare('SELECT id FROM doctors WHERE is_owner = 1 LIMIT 1').get()
      || await db.prepare('SELECT id FROM doctors ORDER BY id ASC LIMIT 1').get();
    const owner_doctor_id = ownerDoc ? ownerDoc.id : null;

    const { date } = req.query;
    if (!date) return res.json({ success: true, data: [], owner_doctor_id });

    const ownerSlots = await db.prepare(`
      SELECT appointment_time FROM owner_appointments
      WHERE appointment_date = ? AND appointment_time IS NOT NULL AND appointment_time != ''
    `).all(date);

    const clinicSlots = owner_doctor_id
      ? await db.prepare(`
          SELECT appointment_time FROM appointments
          WHERE appointment_date = ? AND status != 'cancelled' AND doctor_id = ?
        `).all(date, owner_doctor_id)
      : [];

    const blocked = [...new Set([
      ...ownerSlots.flatMap(r => (r.appointment_time || '').split(',').map(t => t.trim()).filter(Boolean)),
      ...clinicSlots.flatMap(r => (r.appointment_time || '').split(',').map(t => t.trim()).filter(Boolean)),
    ])];
    res.json({ success: true, data: blocked, owner_doctor_id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Owner's clinic slots (for conflict detection in external consulting) ──────
// Returns both own-clinic appointments AND existing owner_appointments so that
// the "Add Consulting" form can highlight ALL occupied slots in red.

router.get('/clinic-slots', requireOwner, async (req, res) => {
  try {
    const ownerDoc = await db.prepare('SELECT id FROM doctors WHERE is_owner = 1 LIMIT 1').get()
      || await db.prepare('SELECT id FROM doctors ORDER BY id ASC LIMIT 1').get();
    const owner_doctor_id = ownerDoc ? ownerDoc.id : null;

    const { date, month, year, exclude_id } = req.query;
    const rows = [];

    // 1. Clinic appointments (own clinics – Avadi / Thiruninravur)
    if (owner_doctor_id) {
      let q = `SELECT appointment_date, appointment_time, clinic_branch FROM appointments WHERE doctor_id = ? AND status != 'cancelled'`;
      const p = [owner_doctor_id];
      if (date) { q += ' AND appointment_date = ?'; p.push(date); }
      else if (month && year) { q += ' AND appointment_date LIKE ?'; p.push(`${year}-${String(month).padStart(2, '0')}%`); }
      else if (year) { q += ' AND appointment_date LIKE ?'; p.push(`${year}%`); }
      q += ' ORDER BY appointment_date ASC, appointment_time ASC';
      rows.push(...await db.prepare(q).all(...p));
    }

    // 2. External consulting appointments – owner_appointments (e.g. Yuva Dental)
    {
      let q = `SELECT appointment_date, appointment_time, clinic_name AS clinic_branch FROM owner_appointments WHERE appointment_time IS NOT NULL AND appointment_time != ''`;
      const p = [];
      if (date) { q += ' AND appointment_date = ?'; p.push(date); }
      else if (month && year) { q += ' AND appointment_date LIKE ?'; p.push(`${year}-${String(month).padStart(2, '0')}%`); }
      else if (year) { q += ' AND appointment_date LIKE ?'; p.push(`${year}%`); }
      if (exclude_id) { q += ' AND id != ?'; p.push(exclude_id); }
      q += ' ORDER BY appointment_date ASC, appointment_time ASC';
      rows.push(...await db.prepare(q).all(...p));
    }

    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Consulting appointments ────────────────────────────────────────────────────

router.get('/appointments', requireOwner, async (req, res) => {
  try {
    const { month, year, date } = req.query;
    let query  = 'SELECT * FROM owner_appointments';
    const params = [];
    if (date) {
      query += ' WHERE appointment_date = ?';
      params.push(date);
    } else if (month && year) {
      query += ' WHERE appointment_date LIKE ?';
      params.push(`${year}-${String(month).padStart(2, '0')}%`);
    } else if (year) {
      query += ' WHERE appointment_date LIKE ?';
      params.push(`${year}%`);
    }
    query += ' ORDER BY appointment_date DESC, appointment_time ASC';
    const rows = await db.prepare(query).all(...params);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/appointments', requireOwner, async (req, res) => {
  try {
    const { clinic_name, clinic_address, appointment_date, appointment_time, patient_name, procedure, income, payment_mode, notes } = req.body;
    if (!clinic_name || !appointment_date) return res.status(400).json({ error: 'Clinic name and date are required' });
    const result = await db.prepare(`
      INSERT INTO owner_appointments (clinic_name, clinic_address, appointment_date, appointment_time, patient_name, procedure, income, payment_mode, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clinic_name, clinic_address, appointment_date, appointment_time, patient_name, procedure, parseFloat(income) || 0, payment_mode || 'cash', notes);
    const row = await db.prepare('SELECT * FROM owner_appointments WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: row });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/appointments/:id', requireOwner, async (req, res) => {
  try {
    const { clinic_name, clinic_address, appointment_date, appointment_time, patient_name, procedure, income, payment_mode, notes } = req.body;
    await db.prepare(`
      UPDATE owner_appointments SET clinic_name=?, clinic_address=?, appointment_date=?,
        appointment_time=?, patient_name=?, procedure=?, income=?, payment_mode=?, notes=?
      WHERE id=?
    `).run(clinic_name, clinic_address, appointment_date, appointment_time, patient_name, procedure, parseFloat(income) || 0, payment_mode || 'cash', notes, req.params.id);
    const row = await db.prepare('SELECT * FROM owner_appointments WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: row });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/appointments/:id', requireOwner, async (req, res) => {
  try {
    await db.prepare('DELETE FROM owner_appointments WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Appointment deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Earnings report ────────────────────────────────────────────────────────────

router.get('/earnings', requireOwner, async (req, res) => {
  try {
    const yearFilter = req.query.year || new Date().getFullYear().toString();

    const summary  = await db.prepare(`
      SELECT CAST(COUNT(*) AS INTEGER) as total_appointments, COALESCE(SUM(income), 0) as total_income
      FROM owner_appointments WHERE appointment_date LIKE ?
    `).get(`${yearFilter}%`);

    const byClinic = await db.prepare(`
      SELECT clinic_name, clinic_address,
             CAST(COUNT(*) AS INTEGER) as appointment_count,
             COALESCE(SUM(income), 0)  as total_income
      FROM owner_appointments WHERE appointment_date LIKE ?
      GROUP BY clinic_name, clinic_address ORDER BY total_income DESC
    `).all(`${yearFilter}%`);

    const byMonth = await db.prepare(`
      SELECT SUBSTR(appointment_date, 1, 7) as month,
             CAST(COUNT(*) AS INTEGER)      as appointment_count,
             COALESCE(SUM(income), 0)       as total_income
      FROM owner_appointments WHERE appointment_date LIKE ?
      GROUP BY SUBSTR(appointment_date, 1, 7) ORDER BY month ASC
    `).all(`${yearFilter}%`);

    res.json({ success: true, summary, by_clinic: byClinic, by_month: byMonth, year: yearFilter });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
