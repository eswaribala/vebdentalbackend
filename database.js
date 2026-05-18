const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'veb_dental.db');

let _db = null;
let _wrapper = null;

function saveDb() {
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function createWrapper(sqlDb) {
  const wrap = {
    prepare: (sql) => ({
      run: (...args) => {
        const raw = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const params = Array.from(raw).map(v => v === undefined ? null : v);
        sqlDb.run(sql, params);
        const res = sqlDb.exec('SELECT last_insert_rowid() as id');
        saveDb();
        return { lastInsertRowid: res[0]?.values[0][0] ?? 0, changes: 1 };
      },
      get: (...args) => {
        const raw = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const params = Array.from(raw).map(v => v === undefined ? null : v);
        const stmt = sqlDb.prepare(sql);
        if (params.length) stmt.bind(params);
        let row = null;
        if (stmt.step()) row = stmt.getAsObject();
        stmt.free();
        return row;
      },
      all: (...args) => {
        const raw = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const params = Array.from(raw).map(v => v === undefined ? null : v);
        const stmt = sqlDb.prepare(sql);
        if (params.length) stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
    }),
    exec: (sql) => {
      sqlDb.run(sql);
      saveDb();
    },
    pragma: () => {},
  };
  return wrap;
}

function createTables(wrapper) {
  wrapper.exec(`CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL, last_name TEXT NOT NULL, mobile TEXT NOT NULL,
    dob TEXT NOT NULL, age INTEGER, gender TEXT, address TEXT, blood_group TEXT,
    medical_history TEXT, allergies TEXT, emergency_contact TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);

  wrapper.exec(`CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, specialization TEXT,
    qualification TEXT, experience INTEGER, mobile TEXT, email TEXT, schedule TEXT,
    registration_no TEXT, is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')))`);

  wrapper.exec(`CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL, role TEXT NOT NULL, mobile TEXT, email TEXT,
    department TEXT, joining_date TEXT, salary REAL, is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')))`);

  wrapper.exec(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, doctor_id INTEGER,
    appointment_date TEXT NOT NULL, appointment_time TEXT NOT NULL, purpose TEXT,
    status TEXT DEFAULT 'scheduled', notes TEXT,
    created_at TEXT DEFAULT (datetime('now')))`);

  wrapper.exec(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, date TEXT NOT NULL,
    check_in TEXT, check_out TEXT, status TEXT DEFAULT 'present', notes TEXT)`);

  wrapper.exec(`CREATE TABLE IF NOT EXISTS diagnosis (
    id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, doctor_id INTEGER,
    appointment_id INTEGER, visit_date TEXT NOT NULL, chief_complaint TEXT,
    clinical_notes TEXT, tooth_chart TEXT,
    created_at TEXT DEFAULT (datetime('now')))`);

  wrapper.exec(`CREATE TABLE IF NOT EXISTS treatment_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, diagnosis_id INTEGER, patient_id INTEGER,
    doctor_id INTEGER, tooth_number TEXT, treatment_type TEXT, description TEXT,
    cost REAL, status TEXT DEFAULT 'planned', completed_date TEXT,
    created_at TEXT DEFAULT (datetime('now')))`);

  wrapper.exec(`CREATE TABLE IF NOT EXISTS prescriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, doctor_id INTEGER,
    diagnosis_id INTEGER, rx_date TEXT NOT NULL, medications TEXT, instructions TEXT,
    follow_up_date TEXT, created_at TEXT DEFAULT (datetime('now')))`);

  wrapper.exec(`CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT, bill_number TEXT UNIQUE NOT NULL,
    patient_id INTEGER, treatment_ids TEXT, items TEXT, subtotal REAL,
    discount REAL DEFAULT 0, tax REAL DEFAULT 0, total_amount REAL, payment_mode TEXT,
    payment_status TEXT DEFAULT 'pending', emi_months INTEGER, emi_amount REAL,
    emi_paid INTEGER DEFAULT 0, bill_date TEXT NOT NULL, notes TEXT,
    created_at TEXT DEFAULT (datetime('now')))`);

  wrapper.exec(`CREATE TABLE IF NOT EXISTS consultant_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    consultant_id INTEGER NOT NULL,
    appointment_id INTEGER,
    amount REAL NOT NULL,
    payment_date TEXT NOT NULL,
    payment_mode TEXT DEFAULT 'cash',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')))`);

  wrapper.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')))`);

  wrapper.exec(`CREATE TABLE IF NOT EXISTS owner_appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_name TEXT NOT NULL,
    clinic_address TEXT,
    appointment_date TEXT NOT NULL,
    appointment_time TEXT,
    patient_name TEXT,
    procedure TEXT,
    income REAL DEFAULT 0,
    payment_mode TEXT DEFAULT 'cash',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')))`);

  // Migrations — additive only, never drops data
  try { wrapper.exec('ALTER TABLE appointments ADD COLUMN consultant_id INTEGER'); } catch (e) {}
  try { wrapper.exec("ALTER TABLE appointments ADD COLUMN clinic_branch TEXT DEFAULT 'Avadi'"); } catch (e) {}
  try { wrapper.exec("ALTER TABLE patients ADD COLUMN clinic_branch TEXT DEFAULT 'Avadi'"); } catch (e) {}
  try { wrapper.exec('ALTER TABLE diagnosis ADD COLUMN consultant_id INTEGER'); } catch (e) {}
  // Doctor attendance support
  try { wrapper.exec('ALTER TABLE attendance ADD COLUMN doctor_id INTEGER'); } catch (e) {}
  // Owner-doctor identification
  try { wrapper.exec('ALTER TABLE doctors ADD COLUMN is_owner INTEGER DEFAULT 0'); } catch (e) {}
  // Mark Dr. Vignesh (or first doctor) as the owner-doctor
  try { wrapper.exec("UPDATE doctors SET is_owner = 1 WHERE name LIKE '%Vignesh%'"); } catch (e) {}
  try { wrapper.exec("UPDATE doctors SET is_owner = 1 WHERE is_owner = 0 AND id = (SELECT id FROM doctors ORDER BY id ASC LIMIT 1) AND NOT EXISTS (SELECT 1 FROM doctors WHERE is_owner = 1)"); } catch (e) {}
}

async function initializeDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    _db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    _db = new SQL.Database();
  }

  _wrapper = createWrapper(_db);
  createTables(_wrapper);

  // Seed default owner account (admin / admin)
  const existingOwner = _wrapper.prepare("SELECT id FROM users WHERE email = 'admin'").get();
  if (!existingOwner) {
    const hash = await bcrypt.hash('admin', 10);
    _wrapper.prepare("INSERT INTO users (name, email, password, role, is_active) VALUES (?, ?, ?, ?, ?)").run('Admin', 'admin', hash, 'owner', 1);
    console.log('Default owner created  →  email: admin  password: admin');
  }

  // Seed Dr. Vignesh
  const existing = _wrapper.prepare('SELECT id FROM doctors WHERE name = ?').get('Dr. Vignesh');
  if (!existing) {
    _wrapper.prepare(
      'INSERT INTO doctors (name, specialization, qualification, experience, mobile, registration_no) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('Dr. Vignesh', 'Dental Surgeon & Implantologist', 'BDS, MDS', 10, '9999999999', 'TN-DEN-001');
  }

  console.log('VEB Dental DB ready');
  return _wrapper;
}

function getDb() {
  if (!_wrapper) throw new Error('Database not initialized. Call initializeDatabase() first.');
  return _wrapper;
}

module.exports = { initializeDatabase, getDb };
