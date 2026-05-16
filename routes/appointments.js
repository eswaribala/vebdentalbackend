const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();

router.get('/', (req, res) => {
  try {
    const { date, doctor_id, patient_id, status } = req.query;
    let query = `
      SELECT a.*, p.first_name, p.last_name, p.mobile, p.patient_id as p_id,
             d.name as doctor_name
      FROM appointments a
      LEFT JOIN patients p ON a.patient_id = p.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      WHERE 1=1
    `;
    const params = [];
    if (date) { query += ' AND a.appointment_date = ?'; params.push(date); }
    if (doctor_id) { query += ' AND a.doctor_id = ?'; params.push(doctor_id); }
    if (patient_id) { query += ' AND a.patient_id = ?'; params.push(patient_id); }
    if (status) { query += ' AND a.status = ?'; params.push(status); }
    query += ' ORDER BY a.appointment_date DESC, a.appointment_time ASC';
    const appointments = db.prepare(query).all(...params);
    res.json({ success: true, data: appointments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/today', (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const appointments = db.prepare(`
      SELECT a.*, p.first_name, p.last_name, p.mobile, p.patient_id as p_id,
             d.name as doctor_name
      FROM appointments a
      LEFT JOIN patients p ON a.patient_id = p.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      WHERE a.appointment_date = ?
      ORDER BY a.appointment_time ASC
    `).all(today);
    res.json({ success: true, data: appointments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const appt = db.prepare(`
      SELECT a.*, p.first_name, p.last_name, p.mobile, d.name as doctor_name
      FROM appointments a
      LEFT JOIN patients p ON a.patient_id = p.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      WHERE a.id = ?
    `).get(req.params.id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });
    res.json({ success: true, data: appt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { patient_id, doctor_id, appointment_date, appointment_time, purpose, notes } = req.body;
    const result = db.prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, purpose, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(patient_id, doctor_id, appointment_date, appointment_time, purpose, notes);
    const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: appt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const { patient_id, doctor_id, appointment_date, appointment_time, purpose, notes, status } = req.body;
    db.prepare(`
      UPDATE appointments SET patient_id=?, doctor_id=?, appointment_date=?, appointment_time=?, purpose=?, notes=?, status=?
      WHERE id=?
    `).run(patient_id, doctor_id, appointment_date, appointment_time, purpose, notes, status, req.params.id);
    const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: appt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM appointments WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Appointment deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
