const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();

// Diagnosis CRUD
router.get('/', (req, res) => {
  try {
    const { patient_id } = req.query;
    let query = `
      SELECT dg.*, p.first_name, p.last_name, p.patient_id as p_id,
             dc.name as doctor_name, s.name as consultant_name
      FROM diagnosis dg
      LEFT JOIN patients p ON dg.patient_id = p.id
      LEFT JOIN doctors dc ON dg.doctor_id = dc.id
      LEFT JOIN staff s ON dg.consultant_id = s.id
      WHERE 1=1
    `;
    const params = [];
    if (patient_id) { query += ' AND dg.patient_id = ?'; params.push(patient_id); }
    query += ' ORDER BY dg.visit_date DESC';
    const records = db.prepare(query).all(...params);
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const diag = db.prepare(`
      SELECT dg.*, p.first_name, p.last_name, p.patient_id as p_id,
             dc.name as doctor_name, s.name as consultant_name
      FROM diagnosis dg
      LEFT JOIN patients p ON dg.patient_id = p.id
      LEFT JOIN doctors dc ON dg.doctor_id = dc.id
      LEFT JOIN staff s ON dg.consultant_id = s.id
      WHERE dg.id = ?
    `).get(req.params.id);
    if (!diag) return res.status(404).json({ error: 'Diagnosis not found' });
    const treatmentPlans = db.prepare('SELECT * FROM treatment_plans WHERE diagnosis_id = ?').all(req.params.id);
    const prescriptions = db.prepare('SELECT * FROM prescriptions WHERE diagnosis_id = ?').all(req.params.id);
    res.json({ success: true, data: { ...diag, treatmentPlans, prescriptions } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { patient_id, doctor_id, consultant_id, appointment_id, visit_date, chief_complaint, clinical_notes, tooth_chart } = req.body;
    const result = db.prepare(`
      INSERT INTO diagnosis (patient_id, doctor_id, consultant_id, appointment_id, visit_date, chief_complaint, clinical_notes, tooth_chart)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(patient_id, doctor_id, consultant_id, appointment_id, visit_date, chief_complaint, clinical_notes,
      typeof tooth_chart === 'object' ? JSON.stringify(tooth_chart) : tooth_chart);
    const diag = db.prepare('SELECT * FROM diagnosis WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: diag });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const { chief_complaint, clinical_notes, tooth_chart } = req.body;
    db.prepare('UPDATE diagnosis SET chief_complaint=?, clinical_notes=?, tooth_chart=? WHERE id=?').run(
      chief_complaint, clinical_notes,
      typeof tooth_chart === 'object' ? JSON.stringify(tooth_chart) : tooth_chart,
      req.params.id
    );
    const diag = db.prepare('SELECT * FROM diagnosis WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: diag });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Treatment Plans
router.post('/:id/treatments', (req, res) => {
  try {
    const { patient_id, doctor_id, tooth_number, treatment_type, description, cost } = req.body;
    const result = db.prepare(`
      INSERT INTO treatment_plans (diagnosis_id, patient_id, doctor_id, tooth_number, treatment_type, description, cost)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, patient_id, doctor_id, tooth_number, treatment_type, description, cost);
    const plan = db.prepare('SELECT * FROM treatment_plans WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/treatments', (req, res) => {
  try {
    const plans = db.prepare('SELECT * FROM treatment_plans WHERE diagnosis_id = ? ORDER BY created_at').all(req.params.id);
    res.json({ success: true, data: plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/treatments/:treatId', (req, res) => {
  try {
    const { tooth_number, treatment_type, description, cost, status } = req.body;
    db.prepare('UPDATE treatment_plans SET tooth_number=?, treatment_type=?, description=?, cost=?, status=? WHERE id=?').run(tooth_number, treatment_type, description, cost, status, req.params.treatId);
    const plan = db.prepare('SELECT * FROM treatment_plans WHERE id = ?').get(req.params.treatId);
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/treatments/:treatId', (req, res) => {
  try {
    db.prepare('DELETE FROM treatment_plans WHERE id = ?').run(req.params.treatId);
    res.json({ success: true, message: 'Treatment deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Prescriptions
router.post('/:id/prescriptions', (req, res) => {
  try {
    const { patient_id, doctor_id, rx_date, medications, instructions, follow_up_date } = req.body;
    const result = db.prepare(`
      INSERT INTO prescriptions (patient_id, doctor_id, diagnosis_id, rx_date, medications, instructions, follow_up_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(patient_id, doctor_id, req.params.id, rx_date,
      typeof medications === 'object' ? JSON.stringify(medications) : medications,
      instructions, follow_up_date);
    const rx = db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: rx });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/prescriptions', (req, res) => {
  try {
    const rxList = db.prepare('SELECT * FROM prescriptions WHERE diagnosis_id = ? ORDER BY rx_date DESC').all(req.params.id);
    res.json({ success: true, data: rxList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Patient treatment plans (all)
router.get('/patient/:patientId/treatments', (req, res) => {
  try {
    const plans = db.prepare('SELECT * FROM treatment_plans WHERE patient_id = ? ORDER BY created_at DESC').all(req.params.patientId);
    res.json({ success: true, data: plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
