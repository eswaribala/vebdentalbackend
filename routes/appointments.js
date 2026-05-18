const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();

router.get('/', async (req, res) => {
  try {
    const { date, doctor_id, patient_id, status, consultant_id } = req.query;
    let query = `
      SELECT a.*, p.first_name, p.last_name, p.mobile, p.patient_id as p_id,
             d.name as doctor_name, d.mobile as doctor_mobile,
             s.name as consultant_name, s.mobile as consultant_mobile
      FROM appointments a
      LEFT JOIN patients p ON a.patient_id = p.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      LEFT JOIN staff s ON a.consultant_id = s.id
      WHERE 1=1
    `;
    const params = [];
    if (date)          { query += ' AND a.appointment_date = ?';  params.push(date); }
    if (doctor_id)     { query += ' AND a.doctor_id = ?';         params.push(doctor_id); }
    if (patient_id)    { query += ' AND a.patient_id = ?';        params.push(patient_id); }
    if (status)        { query += ' AND a.status = ?';            params.push(status); }
    if (consultant_id) { query += ' AND a.consultant_id = ?';     params.push(consultant_id); }
    query += ' ORDER BY a.appointment_date DESC, a.appointment_time ASC';
    const appointments = await db.prepare(query).all(...params);
    res.json({ success: true, data: appointments });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reminders/tomorrow', async (req, res) => {
  try {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    ist.setDate(ist.getDate() + 1);
    const tomorrow = `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
    const appointments = await db.prepare(`
      SELECT a.*, p.first_name, p.last_name, p.mobile, p.patient_id as p_id,
             d.name as doctor_name, d.mobile as doctor_mobile,
             s.name as consultant_name, s.mobile as consultant_mobile
      FROM appointments a
      LEFT JOIN patients p ON a.patient_id = p.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      LEFT JOIN staff s ON a.consultant_id = s.id
      WHERE a.appointment_date = ? AND a.status != 'cancelled' AND p.mobile IS NOT NULL
      ORDER BY a.appointment_time ASC
    `).all(tomorrow);
    res.json({ success: true, data: appointments, date: tomorrow });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/today', async (req, res) => {
  try {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const today = `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
    const appointments = await db.prepare(`
      SELECT a.*, p.first_name, p.last_name, p.mobile, p.patient_id as p_id,
             d.name as doctor_name, d.mobile as doctor_mobile,
             s.name as consultant_name, s.mobile as consultant_mobile
      FROM appointments a
      LEFT JOIN patients p ON a.patient_id = p.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      LEFT JOIN staff s ON a.consultant_id = s.id
      WHERE a.appointment_date = ?
      ORDER BY a.appointment_time ASC
    `).all(today);
    res.json({ success: true, data: appointments });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const appt = await db.prepare(`
      SELECT a.*, p.first_name, p.last_name, p.mobile, d.name as doctor_name, s.name as consultant_name
      FROM appointments a
      LEFT JOIN patients p ON a.patient_id = p.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      LEFT JOIN staff s ON a.consultant_id = s.id
      WHERE a.id = ?
    `).get(req.params.id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });
    res.json({ success: true, data: appt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { patient_id, doctor_id, appointment_date, appointment_time, purpose, notes, consultant_id, clinic_branch } = req.body;
    const result = await db.prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, purpose, notes, consultant_id, clinic_branch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(patient_id, doctor_id, appointment_date, appointment_time, purpose, notes, consultant_id, clinic_branch || 'Avadi');
    const appt = await db.prepare('SELECT * FROM appointments WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: appt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { patient_id, doctor_id, appointment_date, appointment_time, purpose, notes, status, consultant_id, clinic_branch } = req.body;
    await db.prepare(`
      UPDATE appointments SET patient_id=?, doctor_id=?, appointment_date=?, appointment_time=?,
        purpose=?, notes=?, status=?, consultant_id=?, clinic_branch=?
      WHERE id=?
    `).run(patient_id, doctor_id, appointment_date, appointment_time, purpose, notes, status, consultant_id, clinic_branch, req.params.id);
    const appt = await db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: appt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.prepare('DELETE FROM appointments WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Appointment deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
