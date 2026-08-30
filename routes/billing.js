const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const db = getDb();

async function generateBillNumber() {
  const year   = new Date().getFullYear().toString().slice(-2);
  const month  = String(new Date().getMonth() + 1).padStart(2, '0');
  const prefix = `VEB-B${year}${month}`;
  // prefix is always 9 chars (VEB-B + 2-digit year + 2-digit month)
  // Use MAX on the numeric suffix so deletions never cause a collision
  const row = await db.prepare(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(bill_number FROM 10) AS INTEGER)), 0) AS max_seq
     FROM bills WHERE bill_number LIKE ?`
  ).get(`${prefix}%`);
  const seq = (row?.max_seq ?? 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
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

// income-report — before /:id to avoid route conflict
router.get('/income-report', async (req, res) => {
  try {
    const { period = 'monthly', year, branch } = req.query;
    const yr = parseInt(year) || new Date().getFullYear();

    let branchWhere = '';
    const branchParams = [];
    if (branch) {
      branchWhere = " AND COALESCE(p.clinic_branch, 'Avadi') = ?";
      branchParams.push(branch);
    }

    // Current month stats — always included regardless of selected period.
    // Matched against bill_date the same way the monthly trend below groups it
    // (SUBSTR(bill_date, 1, 7) = 'YYYY-MM'), so the two can never disagree.
    const bounds = await db.prepare(`
      SELECT
        to_char((NOW() AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM')      AS current_ym,
        to_char((NOW() AT TIME ZONE 'Asia/Kolkata'), 'FMMonth YYYY') AS month_label
    `).get();
    const { current_ym: curYm, month_label: curMonthLabel } = bounds;
    const currentMonth = await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN b.payment_status = 'paid' THEN b.total_amount ELSE 0 END), 0)                        AS received,
        COALESCE(SUM(CASE WHEN b.payment_status IN ('pending','partial') THEN b.total_amount ELSE 0 END), 0)         AS pending,
        CAST(COUNT(*) AS INTEGER)                                                                                      AS count
      FROM bills b
      LEFT JOIN patients p ON b.patient_id = p.id
      WHERE SUBSTR(b.bill_date, 1, 7) = ? AND b.payment_status != 'voided'${branchWhere}
    `).get(curYm, ...branchParams);

    // Summary scope: yearly = all-time, monthly/weekly = selected year
    const summaryPattern = period === 'yearly' ? '%' : `${yr}%`;
    const summary = await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN b.payment_status = 'paid' THEN b.total_amount ELSE 0 END), 0) AS total_paid,
        COALESCE(SUM(CASE WHEN b.payment_status IN ('pending','partial') THEN b.total_amount ELSE 0 END), 0) AS total_pending,
        CAST(SUM(CASE WHEN b.payment_status IN ('pending','partial') THEN 1 ELSE 0 END) AS INTEGER) AS pending_count,
        CAST(SUM(CASE WHEN b.payment_mode = 'emi' AND (b.emi_months - COALESCE(b.emi_paid,0)) > 0 THEN 1 ELSE 0 END) AS INTEGER) AS emi_count,
        COALESCE(SUM(CASE WHEN b.payment_mode = 'emi'
          THEN (b.emi_months - COALESCE(b.emi_paid,0)) * COALESCE(b.emi_amount,0)
          ELSE 0 END), 0) AS emi_remaining
      FROM bills b
      LEFT JOIN patients p ON b.patient_id = p.id
      WHERE b.bill_date LIKE ? AND b.payment_status != 'voided'${branchWhere}
    `).get(summaryPattern, ...branchParams);

    let trend;
    if (period === 'yearly') {
      trend = await db.prepare(`
        SELECT
          SUBSTR(b.bill_date, 1, 4) AS period_key,
          COALESCE(SUM(CASE WHEN b.payment_status = 'paid' THEN b.total_amount ELSE 0 END), 0) AS paid,
          COALESCE(SUM(CASE WHEN b.payment_status IN ('pending','partial') THEN b.total_amount ELSE 0 END), 0) AS pending,
          CAST(COUNT(*) AS INTEGER) AS count
        FROM bills b
        LEFT JOIN patients p ON b.patient_id = p.id
        WHERE b.payment_status != 'voided'${branchWhere}
        GROUP BY SUBSTR(b.bill_date, 1, 4)
        ORDER BY period_key ASC
      `).all(...branchParams);
    } else if (period === 'weekly') {
      // Always current month — group days 1-7 → Wk1, 8-14 → Wk2, 15-21 → Wk3, 22+ → Wk4
      trend = await db.prepare(`
        SELECT
          CAST(CEIL(EXTRACT(DAY FROM b.bill_date::date) / 7.0) AS INTEGER) AS period_key,
          COALESCE(SUM(CASE WHEN b.payment_status = 'paid' THEN b.total_amount ELSE 0 END), 0) AS paid,
          COALESCE(SUM(CASE WHEN b.payment_status IN ('pending','partial') THEN b.total_amount ELSE 0 END), 0) AS pending,
          CAST(COUNT(*) AS INTEGER) AS count
        FROM bills b
        LEFT JOIN patients p ON b.patient_id = p.id
        WHERE SUBSTR(b.bill_date, 1, 7) = ? AND b.payment_status != 'voided'${branchWhere}
        GROUP BY CAST(CEIL(EXTRACT(DAY FROM b.bill_date::date) / 7.0) AS INTEGER)
        ORDER BY period_key ASC
      `).all(curYm, ...branchParams);
    } else {
      trend = await db.prepare(`
        SELECT
          SUBSTR(b.bill_date, 1, 7) AS period_key,
          COALESCE(SUM(CASE WHEN b.payment_status = 'paid' THEN b.total_amount ELSE 0 END), 0) AS paid,
          COALESCE(SUM(CASE WHEN b.payment_status IN ('pending','partial') THEN b.total_amount ELSE 0 END), 0) AS pending,
          CAST(COUNT(*) AS INTEGER) AS count
        FROM bills b
        LEFT JOIN patients p ON b.patient_id = p.id
        WHERE b.bill_date LIKE ? AND b.payment_status != 'voided'${branchWhere}
        GROUP BY SUBSTR(b.bill_date, 1, 7)
        ORDER BY period_key ASC
      `).all(`${yr}%`, ...branchParams);
    }

    const pendingBills = await db.prepare(`
      SELECT b.id, b.bill_number, b.total_amount, b.payment_status, b.payment_mode,
             b.bill_date, b.emi_months, b.emi_amount, b.emi_paid,
             p.first_name, p.last_name, p.patient_id AS p_id
      FROM bills b
      LEFT JOIN patients p ON b.patient_id = p.id
      WHERE b.payment_status IN ('pending','partial') AND b.payment_status != 'voided'${branchWhere}
      ORDER BY b.bill_date DESC
      LIMIT 30
    `).all(...branchParams);

    const emiBills = await db.prepare(`
      SELECT b.id, b.bill_number, b.total_amount, b.payment_status,
             b.emi_months, b.emi_amount, b.emi_paid, b.bill_date,
             p.first_name, p.last_name, p.patient_id AS p_id,
             (b.emi_months - COALESCE(b.emi_paid,0)) AS emi_remaining_count,
             (b.emi_months - COALESCE(b.emi_paid,0)) * COALESCE(b.emi_amount,0) AS emi_remaining_amount
      FROM bills b
      LEFT JOIN patients p ON b.patient_id = p.id
      WHERE b.payment_mode = 'emi'
        AND (b.emi_months - COALESCE(b.emi_paid,0)) > 0
        AND b.payment_status != 'voided'${branchWhere}
      ORDER BY b.bill_date DESC
    `).all(...branchParams);

    res.json({ success: true, data: {
      summary, trend,
      current_month: { ...currentMonth, label: curMonthLabel },
      pending_bills: pendingBills, emi_bills: emiBills, year: yr, period,
    }});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// stats must be declared before /:id to avoid matching 'stats'
router.get('/stats/summary', async (req, res) => {
  try {
    // "today" and "current month" computed in Postgres (IST) and matched against
    // bill_date as plain text — SUBSTR(bill_date,1,7) = 'YYYY-MM' — the exact same
    // comparison the income-report trend uses, so this can never disagree with it.
    const bounds = await db.prepare(`
      SELECT
        to_char((NOW() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS today,
        to_char((NOW() AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM')          AS current_ym
    `).get();
    const { today, current_ym: curYm } = bounds;

    const todayRevenue = await db.prepare(
      "SELECT COALESCE(SUM(total_amount),0) as total FROM bills WHERE bill_date = ? AND payment_status='paid'"
    ).get(today);
    const monthRevenue = await db.prepare(
      "SELECT COALESCE(SUM(total_amount),0) as total FROM bills WHERE SUBSTR(bill_date,1,7) = ? AND payment_status='paid'"
    ).get(curYm);
    const pending = await db.prepare(
      "SELECT CAST(COUNT(*) AS INTEGER) as c, COALESCE(SUM(total_amount),0) as total FROM bills WHERE payment_status='pending' AND payment_status != 'voided'"
    ).get();

    const todayByBranch = await db.prepare(`
      SELECT COALESCE(p.clinic_branch, 'Avadi') AS branch, COALESCE(SUM(b.total_amount),0) AS total
      FROM bills b LEFT JOIN patients p ON b.patient_id = p.id
      WHERE b.bill_date = ? AND b.payment_status = 'paid'
      GROUP BY COALESCE(p.clinic_branch, 'Avadi')
    `).all(today);
    const monthByBranch = await db.prepare(`
      SELECT COALESCE(p.clinic_branch, 'Avadi') AS branch, COALESCE(SUM(b.total_amount),0) AS total
      FROM bills b LEFT JOIN patients p ON b.patient_id = p.id
      WHERE SUBSTR(b.bill_date,1,7) = ? AND b.payment_status = 'paid'
      GROUP BY COALESCE(p.clinic_branch, 'Avadi')
    `).all(curYm);

    const toBranchMap = (rows) => {
      const map = { Avadi: 0, Thiruninravur: 0 };
      for (const row of rows) map[row.branch] = parseFloat(row.total || 0);
      return map;
    };

    res.json({
      success: true,
      data: {
        today_revenue:  parseFloat(todayRevenue?.total  || 0),
        month_revenue:  parseFloat(monthRevenue?.total  || 0),
        pending_count:  parseInt(pending?.c             || 0, 10),
        pending_amount: parseFloat(pending?.total       || 0),
        today_revenue_by_branch: toBranchMap(todayByBranch),
        month_revenue_by_branch: toBranchMap(monthByBranch),
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

router.patch('/:id/void', async (req, res) => {
  try {
    const bill = await db.prepare('SELECT id, payment_status FROM bills WHERE id = ?').get(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    if (bill.payment_status === 'voided') return res.status(400).json({ error: 'Bill is already voided' });
    await db.prepare("UPDATE bills SET payment_status = 'voided' WHERE id = ?").run(req.params.id);
    res.json({ success: true, message: 'Bill voided' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.prepare('DELETE FROM bills WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Bill deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
