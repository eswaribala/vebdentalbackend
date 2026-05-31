const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database');
const db = getDb();

const JWT_SECRET = process.env.JWT_SECRET || 'VEB_DENTAL_JWT_SECRET_2024';
const JWT_EXPIRY = '30d';

const AUTO_APPROVED_ROLES = ['owner', 'manager'];
const MANAGER_APPROVABLE  = ['receptionist', 'nurse', 'lab_technician', 'hygienist', 'assistant', 'other'];

// If a doctor's name matches the clinic's is_owner doctor, elevate role to 'owner'
async function getEffectiveRole(user) {
  if (user.role !== 'doctor') return user.role;
  const userName = user.name.replace(/^Dr\.?\s*/i, '').trim().toLowerCase();
  const ownerDoc = await db.prepare(
    "SELECT id FROM doctors WHERE is_owner = 1 AND LOWER(name) LIKE ?"
  ).get(`%${userName}%`);
  return ownerDoc ? 'owner' : user.role;
}

function signToken(user, effectiveRole) {
  const role = effectiveRole || user.role;
  return jwt.sign(
    { id: user.id, email: user.email, role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}
function safeUser(u, effectiveRole) {
  return { id: u.id, name: u.name, email: u.email, role: effectiveRole || u.role };
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role)
      return res.status(400).json({ error: 'All fields are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) return res.status(400).json({ error: 'Email is already registered' });

    const isActive = AUTO_APPROVED_ROLES.includes(role) ? 1 : 0;
    const hash   = await bcrypt.hash(password, 10);
    const result = await db.prepare(
      'INSERT INTO users (name, email, password, role, is_active) VALUES (?, ?, ?, ?, ?)'
    ).run(name.trim(), email.toLowerCase().trim(), hash, role, isActive);

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

    if (isActive) {
      const token = signToken(user);
      return res.status(201).json({ success: true, token, user: safeUser(user) });
    }
    res.status(201).json({ success: true, pending: true, message: 'Account created. Awaiting approval by clinic owner.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.is_active)
      return res.status(403).json({ error: 'Your account is pending approval by the clinic owner.', pending: true });

    const role = await getEffectiveRole(user);
    const token = signToken(user, role);
    res.json({ success: true, token, user: safeUser(user, role) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found or account deactivated' });
    const role = await getEffectiveRole(user);
    res.json({ success: true, user: safeUser(user, role) });
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
});

router.get('/pending', requireAuth, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['owner', 'manager'].includes(role))
      return res.status(403).json({ error: 'Not authorised' });

    let rows;
    if (role === 'owner') {
      rows = await db.prepare(
        'SELECT id, name, email, role, created_at FROM users WHERE is_active = 0 ORDER BY created_at DESC'
      ).all();
    } else {
      const placeholders = MANAGER_APPROVABLE.map(() => '?').join(',');
      rows = await db.prepare(
        `SELECT id, name, email, role, created_at FROM users WHERE is_active = 0 AND role IN (${placeholders}) ORDER BY created_at DESC`
      ).all(...MANAGER_APPROVABLE);
    }
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/approve/:id', requireAuth, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['owner', 'manager'].includes(role))
      return res.status(403).json({ error: 'Not authorised' });

    const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (role === 'manager' && !MANAGER_APPROVABLE.includes(target.role))
      return res.status(403).json({ error: 'Managers cannot approve this role' });

    await db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: `${target.name} approved successfully` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password)
      return res.status(400).json({ error: 'Both current and new password are required' });
    if (new_password.length < 4)
      return res.status(400).json({ error: 'New password must be at least 4 characters' });

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const valid = await bcrypt.compare(current_password, user.password);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 10);
    await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user.id);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/reject/:id', requireAuth, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['owner', 'manager'].includes(role))
      return res.status(403).json({ error: 'Not authorised' });

    const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (role === 'manager' && !MANAGER_APPROVABLE.includes(target.role))
      return res.status(403).json({ error: 'Managers cannot reject this role' });

    await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: `${target.name} rejected and removed` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, JWT_SECRET };
