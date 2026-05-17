const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();

function getISTDate(offsetDays = 0) {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  ist.setDate(ist.getDate() + offsetDays);
  return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
}

// Payment summary across all consultants (for dashboard)
router.get('/payments/summary', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT s.id as consultant_id, s.name, s.department, s.mobile,
             COUNT(DISTINCT cp.id)   as payment_count,
             COALESCE(SUM(cp.amount), 0) as total_paid,
             COUNT(DISTINCT a.id)    as appointment_count
      FROM staff s
      LEFT JOIN consultant_payments cp ON cp.consultant_id = s.id
      LEFT JOIN appointments a ON a.consultant_id = s.id
      WHERE s.role = 'Consultant' AND s.is_active = 1
      GROUP BY s.id
      ORDER BY total_paid DESC
    `).all();
    const grand_total = rows.reduce((sum, r) => sum + (r.total_paid || 0), 0);
    res.json({ success: true, data: rows, grand_total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upcoming reminders (appointments tomorrow that have a consultant)
// Must be declared before /:id routes to avoid 'reminders' matching as :id
router.get('/reminders/upcoming', (req, res) => {
  try {
    const tomorrow = getISTDate(1);
    const appointments = db.prepare(`
      SELECT a.*,
             p.first_name, p.last_name,
             s.name as consultant_name, s.mobile as consultant_mobile, s.staff_id as consultant_staff_id
      FROM appointments a
      LEFT JOIN patients p ON a.patient_id = p.id
      LEFT JOIN staff s ON a.consultant_id = s.id
      WHERE a.consultant_id IS NOT NULL AND a.appointment_date = ? AND a.status != 'cancelled'
      ORDER BY a.appointment_time ASC
    `).all(tomorrow);
    res.json({ success: true, data: appointments, date: tomorrow });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Appointments for a specific consultant
router.get('/:id/appointments', (req, res) => {
  try {
    const appointments = db.prepare(`
      SELECT a.*,
             p.first_name, p.last_name, p.mobile as patient_mobile
      FROM appointments a
      LEFT JOIN patients p ON a.patient_id = p.id
      WHERE a.consultant_id = ?
      ORDER BY a.appointment_date DESC, a.appointment_time ASC
    `).all(req.params.id);
    res.json({ success: true, data: appointments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Payments for a specific consultant
router.get('/:id/payments', (req, res) => {
  try {
    const payments = db.prepare(`
      SELECT cp.*,
             a.appointment_date, a.appointment_time, a.purpose, a.clinic_branch,
             p.first_name, p.last_name
      FROM consultant_payments cp
      LEFT JOIN appointments a ON cp.appointment_id = a.id
      LEFT JOIN patients p ON a.patient_id = p.id
      WHERE cp.consultant_id = ?
      ORDER BY cp.payment_date DESC
    `).all(req.params.id);
    const total = payments.reduce((sum, r) => sum + (r.amount || 0), 0);
    res.json({ success: true, data: payments, total_paid: total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record a payment for a consultant
router.post('/:id/payments', (req, res) => {
  try {
    const { appointment_id, amount, payment_date, payment_mode, notes } = req.body;
    const result = db.prepare(`
      INSERT INTO consultant_payments (consultant_id, appointment_id, amount, payment_date, payment_mode, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.id, appointment_id, amount, payment_date, payment_mode || 'cash', notes);
    const payment = db.prepare('SELECT * FROM consultant_payments WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: payment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a payment
router.delete('/payments/:paymentId', (req, res) => {
  try {
    db.prepare('DELETE FROM consultant_payments WHERE id = ?').run(req.params.paymentId);
    res.json({ success: true, message: 'Payment deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
