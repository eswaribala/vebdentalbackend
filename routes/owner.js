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

// ── Blocked Slots (owner-as-doctor) ──────────────────────────────────────────

router.get('/blocked-slots', requireOwner, (req, res) => {
  try {
    // Identify the owner-doctor (Dr. Vignesh): prefer is_owner flag, fall back to first doctor
    const ownerDoc = db.prepare('SELECT id FROM doctors WHERE is_owner = 1 LIMIT 1').get()
      || db.prepare('SELECT id FROM doctors ORDER BY id ASC LIMIT 1').get();
    const owner_doctor_id = ownerDoc ? ownerDoc.id : null;

    const { date } = req.query;
    if (!date) return res.json({ success: true, data: [], owner_doctor_id });

    // Times blocked by owner's external consulting on this date
    const ownerSlots = db.prepare(`
      SELECT appointment_time FROM owner_appointments
      WHERE appointment_date = ? AND appointment_time IS NOT NULL AND appointment_time != ''
    `).all(date).map(r => r.appointment_time);

    // Times blocked by main-clinic appointments for the owner-doctor
    const clinicSlots = owner_doctor_id ? db.prepare(`
      SELECT appointment_time FROM appointments
      WHERE appointment_date = ? AND status != 'cancelled' AND doctor_id = ?
    `).all(date, owner_doctor_id).map(r => r.appointment_time) : [];

    const blocked = [...new Set([...ownerSlots, ...clinicSlots])];
    res.json({ success: true, data: blocked, owner_doctor_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Consulting Appointments ───────────────────────────────────────────────────

router.get('/appointments', requireOwner, (req, res) => {
  try {
    const { month, year } = req.query;
    let query = 'SELECT * FROM owner_appointments';
    const params = [];
    if (month && year) {
      const mm = String(month).padStart(2, '0');
      query += ' WHERE appointment_date LIKE ?';
      params.push(`${year}-${mm}%`);
    } else if (year) {
      query += ' WHERE appointment_date LIKE ?';
      params.push(`${year}%`);
    }
    query += ' ORDER BY appointment_date DESC, appointment_time ASC';
    const rows = db.prepare(query).all(...params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/appointments', requireOwner, (req, res) => {
  try {
    const { clinic_name, clinic_address, appointment_date, appointment_time, patient_name, procedure, income, payment_mode, notes } = req.body;
    if (!clinic_name || !appointment_date) return res.status(400).json({ error: 'Clinic name and date are required' });
    const result = db.prepare(`
      INSERT INTO owner_appointments (clinic_name, clinic_address, appointment_date, appointment_time, patient_name, procedure, income, payment_mode, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clinic_name, clinic_address, appointment_date, appointment_time, patient_name, procedure, parseFloat(income) || 0, payment_mode || 'cash', notes);
    const row = db.prepare('SELECT * FROM owner_appointments WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/appointments/:id', requireOwner, (req, res) => {
  try {
    const { clinic_name, clinic_address, appointment_date, appointment_time, patient_name, procedure, income, payment_mode, notes } = req.body;
    db.prepare(`
      UPDATE owner_appointments SET clinic_name=?, clinic_address=?, appointment_date=?, appointment_time=?, patient_name=?, procedure=?, income=?, payment_mode=?, notes=?
      WHERE id=?
    `).run(clinic_name, clinic_address, appointment_date, appointment_time, patient_name, procedure, parseFloat(income) || 0, payment_mode || 'cash', notes, req.params.id);
    const row = db.prepare('SELECT * FROM owner_appointments WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/appointments/:id', requireOwner, (req, res) => {
  try {
    db.prepare('DELETE FROM owner_appointments WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Appointment deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Earnings Report ───────────────────────────────────────────────────────────

router.get('/earnings', requireOwner, (req, res) => {
  try {
    const { year } = req.query;
    const yearFilter = year || new Date().getFullYear().toString();

    // Total and count
    const summary = db.prepare(`
      SELECT COUNT(*) as total_appointments, COALESCE(SUM(income), 0) as total_income
      FROM owner_appointments WHERE appointment_date LIKE ?
    `).get(`${yearFilter}%`);

    // By clinic
    const byClinic = db.prepare(`
      SELECT clinic_name, clinic_address,
             COUNT(*) as appointment_count,
             COALESCE(SUM(income), 0) as total_income
      FROM owner_appointments WHERE appointment_date LIKE ?
      GROUP BY clinic_name ORDER BY total_income DESC
    `).all(`${yearFilter}%`);

    // By month
    const byMonth = db.prepare(`
      SELECT SUBSTR(appointment_date, 1, 7) as month,
             COUNT(*) as appointment_count,
             COALESCE(SUM(income), 0) as total_income
      FROM owner_appointments WHERE appointment_date LIKE ?
      GROUP BY month ORDER BY month ASC
    `).all(`${yearFilter}%`);

    res.json({ success: true, summary, by_clinic: byClinic, by_month: byMonth, year: yearFilter });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
