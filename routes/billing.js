const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();

function generateBillNumber() {
  const year = new Date().getFullYear().toString().slice(-2);
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const count = db.prepare('SELECT COUNT(*) as c FROM bills').get().c + 1;
  return `VEB-B${year}${month}${String(count).padStart(4, '0')}`;
}

router.get('/', (req, res) => {
  try {
    const { patient_id, status } = req.query;
    let query = `
      SELECT b.*, p.first_name, p.last_name, p.patient_id as p_id, p.mobile
      FROM bills b
      LEFT JOIN patients p ON b.patient_id = p.id
      WHERE 1=1
    `;
    const params = [];
    if (patient_id) { query += ' AND b.patient_id = ?'; params.push(patient_id); }
    if (status) { query += ' AND b.payment_status = ?'; params.push(status); }
    query += ' ORDER BY b.created_at DESC';
    const bills = db.prepare(query).all(...params);
    res.json({ success: true, data: bills });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const bill = db.prepare(`
      SELECT b.*, p.first_name, p.last_name, p.patient_id as p_id, p.mobile, p.address
      FROM bills b
      LEFT JOIN patients p ON b.patient_id = p.id
      WHERE b.id = ?
    `).get(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    if (bill.items) bill.items = JSON.parse(bill.items);
    res.json({ success: true, data: bill });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const {
      patient_id, treatment_ids, items, subtotal, discount, tax,
      total_amount, payment_mode, payment_status, emi_months, emi_amount, bill_date, notes
    } = req.body;
    const bill_number = generateBillNumber();
    const final_total = total_amount || (subtotal - (discount || 0) + (tax || 0));
    const result = db.prepare(`
      INSERT INTO bills (bill_number, patient_id, treatment_ids, items, subtotal, discount, tax, total_amount, payment_mode, payment_status, emi_months, emi_amount, bill_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bill_number, patient_id,
      Array.isArray(treatment_ids) ? treatment_ids.join(',') : treatment_ids,
      typeof items === 'object' ? JSON.stringify(items) : items,
      subtotal, discount || 0, tax || 0, final_total,
      payment_mode, payment_status || 'paid', emi_months, emi_amount,
      bill_date || new Date().toISOString().split('T')[0], notes
    );
    // Mark treatment plans as completed
    if (treatment_ids && treatment_ids.length) {
      const ids = Array.isArray(treatment_ids) ? treatment_ids : treatment_ids.split(',');
      ids.forEach(id => {
        if (id) db.prepare("UPDATE treatment_plans SET status = 'completed' WHERE id = ?").run(id);
      });
    }
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: bill, bill_number });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const { payment_mode, payment_status, emi_paid, notes } = req.body;
    db.prepare('UPDATE bills SET payment_mode=?, payment_status=?, emi_paid=?, notes=? WHERE id=?').run(payment_mode, payment_status, emi_paid, notes, req.params.id);
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: bill });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/summary', (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const todayRevenue = db.prepare("SELECT COALESCE(SUM(total_amount),0) as total FROM bills WHERE bill_date = ? AND payment_status='paid'").get(today);
    const monthRevenue = db.prepare(`SELECT COALESCE(SUM(total_amount),0) as total FROM bills WHERE bill_date LIKE ? AND payment_status='paid'`).get(`${today.slice(0,7)}%`);
    const pending = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(total_amount),0) as total FROM bills WHERE payment_status='pending'").get();
    res.json({ success: true, data: { today_revenue: todayRevenue.total, month_revenue: monthRevenue.total, pending_count: pending.c, pending_amount: pending.total } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
