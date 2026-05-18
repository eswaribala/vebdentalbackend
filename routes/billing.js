const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();

async function generateBillNumber() {
  const row = await db.prepare('SELECT CAST(COUNT(*) AS INTEGER) as c FROM bills').get();
  const count = (row?.c ?? 0) + 1;
  const year  = new Date().getFullYear().toString().slice(-2);
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  return `VEB-B${year}${month}${String(count).padStart(4, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const { patient_id, status } = req.query;
    let query = `
      SELECT b.*, p.first_name, p.last_name, p.patient_id as p_id, p.mobile
      FROM bills b
      LEFT JOIN patients p ON b.patient_id = p.id
      WHERE 1=1
    `;
    const params = [];
    if (patient_id) { query += ' AND b.patient_id = ?';     params.push(patient_id); }
    if (status)     { query += ' AND b.payment_status = ?'; params.push(status); }
    query += ' ORDER BY b.created_at DESC';
    const bills = await db.prepare(query).all(...params);
    res.json({ success: true, data: bills });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// stats must be declared before /:id to avoid matching 'stats'
router.get('/stats/summary', async (req, res) => {
  try {
    const ist   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const today = `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;

    const todayRevenue = await db.prepare(
      "SELECT COALESCE(SUM(total_amount),0) as total FROM bills WHERE bill_date = ? AND payment_status='paid'"
    ).get(today);
    const monthRevenue = await db.prepare(
      "SELECT COALESCE(SUM(total_amount),0) as total FROM bills WHERE bill_date LIKE ? AND payment_status='paid'"
    ).get(`${today.slice(0, 7)}%`);
    const pending = await db.prepare(
      "SELECT CAST(COUNT(*) AS INTEGER) as c, COALESCE(SUM(total_amount),0) as total FROM bills WHERE payment_status='pending'"
    ).get();

    res.json({
      success: true,
      data: {
        today_revenue:  parseFloat(todayRevenue?.total  || 0),
        month_revenue:  parseFloat(monthRevenue?.total  || 0),
        pending_count:  parseInt(pending?.c             || 0, 10),
        pending_amount: parseFloat(pending?.total       || 0),
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const bill = await db.prepare(`
      SELECT b.*, p.first_name, p.last_name, p.patient_id as p_id, p.mobile, p.address
      FROM bills b
      LEFT JOIN patients p ON b.patient_id = p.id
      WHERE b.id = ?
    `).get(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    if (bill.items) bill.items = JSON.parse(bill.items);
    res.json({ success: true, data: bill });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const {
      patient_id, treatment_ids, items, subtotal, discount, tax,
      total_amount, payment_mode, payment_status, emi_months, emi_amount, bill_date, notes,
    } = req.body;
    const bill_number = await generateBillNumber();
    const final_total = total_amount || (subtotal - (discount || 0) + (tax || 0));

    const result = await db.prepare(`
      INSERT INTO bills
        (bill_number, patient_id, treatment_ids, items, subtotal, discount, tax,
         total_amount, payment_mode, payment_status, emi_months, emi_amount, bill_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bill_number, patient_id,
      Array.isArray(treatment_ids) ? treatment_ids.join(',') : (treatment_ids || ''),
      typeof items === 'object' ? JSON.stringify(items) : items,
      subtotal, discount || 0, tax || 0, final_total,
      payment_mode, payment_status || 'paid',
      emi_months, emi_amount,
      bill_date || new Date().toISOString().split('T')[0], notes
    );

    // Mark linked treatment plans as completed
    if (treatment_ids && treatment_ids.length) {
      const ids = Array.isArray(treatment_ids) ? treatment_ids : String(treatment_ids).split(',');
      for (const id of ids) {
        if (id) await db.prepare("UPDATE treatment_plans SET status = 'completed' WHERE id = ?").run(id);
      }
    }

    const bill = await db.prepare('SELECT * FROM bills WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: bill, bill_number });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { payment_mode, payment_status, emi_paid, notes, items, subtotal, discount, total_amount, emi_months, emi_amount, bill_date } = req.body;
    await db.prepare(`
      UPDATE bills SET
        payment_mode=?, payment_status=?, emi_paid=?, notes=?,
        items=?, subtotal=?, discount=?, total_amount=?,
        emi_months=?, emi_amount=?, bill_date=?
      WHERE id=?
    `).run(
      payment_mode, payment_status, emi_paid, notes,
      typeof items === 'object' ? JSON.stringify(items) : items,
      subtotal, discount, total_amount,
      emi_months, emi_amount, bill_date,
      req.params.id
    );
    const bill = await db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
    if (bill && bill.items) bill.items = JSON.parse(bill.items);
    res.json({ success: true, data: bill });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.prepare('DELETE FROM bills WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Bill deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
