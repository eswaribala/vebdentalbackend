const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();
const { v4: uuidv4 } = require('uuid');

function calcAge(dob) {
  const today = new Date();
  const birth = new Date(dob);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function generatePatientId() {
  const year = new Date().getFullYear().toString().slice(-2);
  const count = db.prepare('SELECT COUNT(*) as c FROM patients').get().c + 1;
  return `VEB${year}${String(count).padStart(4, '0')}`;
}

// GET all patients
router.get('/', (req, res) => {
  try {
    const { search } = req.query;
    let patients;
    if (search) {
      patients = db.prepare(`
        SELECT * FROM patients
        WHERE first_name LIKE ? OR last_name LIKE ? OR mobile LIKE ? OR patient_id LIKE ?
        ORDER BY created_at DESC
      `).all(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    } else {
      patients = db.prepare('SELECT * FROM patients ORDER BY created_at DESC').all();
    }
    res.json({ success: true, data: patients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single patient
router.get('/:id', (req, res) => {
  try {
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json({ success: true, data: patient });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create patient
router.post('/', (req, res) => {
  try {
    const {
      first_name, last_name, mobile, dob, gender, address,
      blood_group, medical_history, allergies, emergency_contact
    } = req.body;
    const patient_id = generatePatientId();
    const age = calcAge(dob);
    const result = db.prepare(`
      INSERT INTO patients (patient_id, first_name, last_name, mobile, dob, age, gender, address, blood_group, medical_history, allergies, emergency_contact)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(patient_id, first_name, last_name, mobile, dob, age, gender, address, blood_group, medical_history, allergies, emergency_contact);
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: patient });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update patient
router.put('/:id', (req, res) => {
  try {
    const {
      first_name, last_name, mobile, dob, gender, address,
      blood_group, medical_history, allergies, emergency_contact
    } = req.body;
    const age = calcAge(dob);
    db.prepare(`
      UPDATE patients SET first_name=?, last_name=?, mobile=?, dob=?, age=?, gender=?,
      address=?, blood_group=?, medical_history=?, allergies=?, emergency_contact=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(first_name, last_name, mobile, dob, age, gender, address, blood_group, medical_history, allergies, emergency_contact, req.params.id);
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: patient });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE patient
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM patients WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Patient deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET patient history (appointments + diagnosis + bills)
router.get('/:id/history', (req, res) => {
  try {
    const appointments = db.prepare(`
      SELECT a.*, d.name as doctor_name FROM appointments a
      LEFT JOIN doctors d ON a.doctor_id = d.id
      WHERE a.patient_id = ? ORDER BY a.appointment_date DESC
    `).all(req.params.id);
    const diagnoses = db.prepare(`
      SELECT dg.*, dc.name as doctor_name FROM diagnosis dg
      LEFT JOIN doctors dc ON dg.doctor_id = dc.id
      WHERE dg.patient_id = ? ORDER BY dg.visit_date DESC
    `).all(req.params.id);
    const bills = db.prepare('SELECT * FROM bills WHERE patient_id = ? ORDER BY bill_date DESC').all(req.params.id);
    res.json({ success: true, data: { appointments, diagnoses, bills } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
