const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();

function calcAge(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 0 ? age : null;
}

async function generatePatientId() {
  const year = new Date().getFullYear().toString().slice(-2);
  const prefix = `VEB${year}`;
  const row = await db.prepare(
    `SELECT MAX(CAST(SUBSTR(patient_id, 6) AS INTEGER)) as max_num FROM patients WHERE patient_id LIKE '${prefix}%'`
  ).get();
  const nextNum = (row?.max_num ?? 0) + 1;
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let patients;
    if (search) {
      patients = await db.prepare(`
        SELECT * FROM patients
        WHERE first_name ILIKE ? OR last_name ILIKE ? OR mobile ILIKE ? OR patient_id ILIKE ?
        ORDER BY created_at DESC
      `).all(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    } else {
      patients = await db.prepare('SELECT * FROM patients ORDER BY created_at DESC').all();
    }
    res.json({ success: true, data: patients });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const patient = await db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json({ success: true, data: patient });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const {
      first_name, last_name, mobile, dob, age: manualAge, gender, address,
      blood_group, medical_history, allergies, emergency_contact, clinic_branch,
    } = req.body;
    const patient_id = await generatePatientId();
    const age = dob ? calcAge(dob) : (manualAge != null ? parseInt(manualAge, 10) : null);
    const result = await db.prepare(`
      INSERT INTO patients
        (patient_id, first_name, last_name, mobile, dob, age, gender, address,
         blood_group, medical_history, allergies, emergency_contact, clinic_branch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      patient_id, first_name, last_name || '', mobile || '', dob || '', age,
      gender || '', address || '', blood_group || '',
      medical_history || '', allergies || '', emergency_contact || '',
      clinic_branch || 'Avadi'
    );
    const patient = await db.prepare('SELECT * FROM patients WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: patient });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const {
      first_name, last_name, mobile, dob, age: manualAge, gender, address,
      blood_group, medical_history, allergies, emergency_contact, clinic_branch,
    } = req.body;
    const age = dob ? calcAge(dob) : (manualAge != null ? parseInt(manualAge, 10) : null);
    await db.prepare(`
      UPDATE patients SET
        first_name=?, last_name=?, mobile=?, dob=?, age=?, gender=?,
        address=?, blood_group=?, medical_history=?, allergies=?,
        emergency_contact=?, clinic_branch=?, updated_at=NOW()
      WHERE id=?
    `).run(
      first_name, last_name || '', mobile || '', dob || '', age, gender || '',
      address || '', blood_group || '', medical_history || '',
      allergies || '', emergency_contact || '', clinic_branch || 'Avadi',
      req.params.id
    );
    const patient = await db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: patient });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.prepare('DELETE FROM patients WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Patient deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/history', async (req, res) => {
  try {
    const appointments = await db.prepare(`
      SELECT a.*, d.name as doctor_name FROM appointments a
      LEFT JOIN doctors d ON a.doctor_id = d.id
      WHERE a.patient_id = ? ORDER BY a.appointment_date DESC
    `).all(req.params.id);
    const diagnoses = await db.prepare(`
      SELECT dg.*, dc.name as doctor_name FROM diagnosis dg
      LEFT JOIN doctors dc ON dg.doctor_id = dc.id
      WHERE dg.patient_id = ? ORDER BY dg.visit_date DESC
    `).all(req.params.id);
    const bills = await db.prepare(
      'SELECT * FROM bills WHERE patient_id = ? ORDER BY bill_date DESC'
    ).all(req.params.id);
    res.json({ success: true, data: { appointments, diagnoses, bills } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
