const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// ── Compatibility wrapper ──────────────────────────────────────────────────────
// Converts SQLite-style ? placeholders → PostgreSQL $1,$2,... and provides
// the same prepare().get/all/run + exec API used throughout the route files.

function convertParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function makeWrapper() {
  return {
    prepare(sql) {
      const pgSql = convertParams(sql);
      const normalise = (args) =>
        (args.length === 1 && Array.isArray(args[0]) ? args[0] : args)
          .map(v => (v === undefined ? null : v));

      return {
        async get(...args) {
          const { rows } = await pool.query(pgSql, normalise(args));
          return rows[0] ?? null;
        },
        async all(...args) {
          const { rows } = await pool.query(pgSql, normalise(args));
          return rows;
        },
        async run(...args) {
          const params = normalise(args);
          // Automatically add RETURNING id on INSERT so lastInsertRowid works
          const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT');
          const finalSql = isInsert ? `${pgSql} RETURNING id` : pgSql;
          const result = await pool.query(finalSql, params);
          return {
            lastInsertRowid: result.rows[0]?.id ?? null,
            changes: result.rowCount,
          };
        },
      };
    },
    async exec(sql) {
      await pool.query(sql);
    },
  };
}

// ── Schema ─────────────────────────────────────────────────────────────────────

async function createTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id               SERIAL PRIMARY KEY,
      patient_id       TEXT   UNIQUE NOT NULL,
      first_name       TEXT   NOT NULL,
      last_name        TEXT   NOT NULL DEFAULT '',
      mobile           TEXT   NOT NULL DEFAULT '',
      dob              TEXT   NOT NULL DEFAULT '',
      age              INTEGER,
      gender           TEXT,
      address          TEXT,
      blood_group      TEXT,
      medical_history  TEXT,
      allergies        TEXT,
      emergency_contact TEXT,
      clinic_branch    TEXT   DEFAULT 'Avadi',
      created_at       TIMESTAMP DEFAULT NOW(),
      updated_at       TIMESTAMP DEFAULT NOW()
    )`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS doctors (
      id               SERIAL PRIMARY KEY,
      name             TEXT   NOT NULL,
      specialization   TEXT,
      qualification    TEXT,
      experience       INTEGER,
      mobile           TEXT,
      email            TEXT,
      schedule         TEXT,
      registration_no  TEXT,
      is_active        INTEGER DEFAULT 1,
      is_owner         INTEGER DEFAULT 0,
      created_at       TIMESTAMP DEFAULT NOW()
    )`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS staff (
      id           SERIAL PRIMARY KEY,
      staff_id     TEXT   UNIQUE NOT NULL,
      name         TEXT   NOT NULL,
      role         TEXT   NOT NULL,
      mobile       TEXT,
      email        TEXT,
      department   TEXT,
      joining_date TEXT,
      salary       REAL,
      is_active    INTEGER DEFAULT 1,
      created_at   TIMESTAMP DEFAULT NOW()
    )`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS appointments (
      id               SERIAL PRIMARY KEY,
      patient_id       INTEGER,
      doctor_id        INTEGER,
      consultant_id    INTEGER,
      appointment_date TEXT   NOT NULL,
      appointment_time TEXT   NOT NULL,
      purpose          TEXT,
      status           TEXT   DEFAULT 'scheduled',
      notes            TEXT,
      clinic_branch    TEXT   DEFAULT 'Avadi',
      created_at       TIMESTAMP DEFAULT NOW()
    )`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS attendance (
      id        SERIAL PRIMARY KEY,
      staff_id  INTEGER,
      doctor_id INTEGER,
      date      TEXT    NOT NULL,
      check_in  TEXT,
      check_out TEXT,
      status    TEXT    DEFAULT 'present',
      notes     TEXT
    )`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS diagnosis (
      id              SERIAL PRIMARY KEY,
      patient_id      INTEGER,
      doctor_id       INTEGER,
      consultant_id   INTEGER,
      appointment_id  INTEGER,
      visit_date      TEXT   NOT NULL,
      chief_complaint TEXT,
      clinical_notes  TEXT,
      tooth_chart     TEXT,
      created_at      TIMESTAMP DEFAULT NOW()
    )`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS treatment_plans (
      id             SERIAL PRIMARY KEY,
      diagnosis_id   INTEGER,
      patient_id     INTEGER,
      doctor_id      INTEGER,
      tooth_number   TEXT,
      treatment_type TEXT,
      description    TEXT,
      cost           REAL,
      status         TEXT   DEFAULT 'planned',
      completed_date TEXT,
      created_at     TIMESTAMP DEFAULT NOW()
    )`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS prescriptions (
      id              SERIAL PRIMARY KEY,
      patient_id      INTEGER,
      doctor_id       INTEGER,
      diagnosis_id    INTEGER,
      rx_date         TEXT   NOT NULL,
      medications     TEXT,
      instructions    TEXT,
      follow_up_date  TEXT,
      created_at      TIMESTAMP DEFAULT NOW()
    )`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS bills (
      id             SERIAL PRIMARY KEY,
      bill_number    TEXT   UNIQUE NOT NULL,
      patient_id     INTEGER,
      treatment_ids  TEXT,
      items          TEXT,
      subtotal       REAL,
      discount       REAL    DEFAULT 0,
      tax            REAL    DEFAULT 0,
      total_amount   REAL,
      payment_mode   TEXT,
      payment_status TEXT    DEFAULT 'pending',
      emi_months     INTEGER,
      emi_amount     REAL,
      emi_paid       INTEGER DEFAULT 0,
      bill_date      TEXT    NOT NULL,
      notes          TEXT,
      created_at     TIMESTAMP DEFAULT NOW()
    )`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS consultant_payments (
      id             SERIAL PRIMARY KEY,
      consultant_id  INTEGER NOT NULL,
      appointment_id INTEGER,
      amount         REAL    NOT NULL,
      payment_date   TEXT    NOT NULL,
      payment_mode   TEXT    DEFAULT 'cash',
      notes          TEXT,
      created_at     TIMESTAMP DEFAULT NOW()
    )`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      name       TEXT   NOT NULL,
      email      TEXT   UNIQUE NOT NULL,
      password   TEXT   NOT NULL,
      role       TEXT   NOT NULL,
      is_active  INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS owner_appointments (
      id               SERIAL PRIMARY KEY,
      clinic_name      TEXT   NOT NULL,
      clinic_address   TEXT,
      appointment_date TEXT   NOT NULL,
      appointment_time TEXT,
      patient_name     TEXT,
      procedure        TEXT,
      income           REAL   DEFAULT 0,
      payment_mode     TEXT   DEFAULT 'cash',
      notes            TEXT,
      created_at       TIMESTAMP DEFAULT NOW()
    )`);

  // Safe additive migrations (PostgreSQL supports ADD COLUMN IF NOT EXISTS)
  const migrations = [
    `ALTER TABLE appointments  ADD COLUMN IF NOT EXISTS consultant_id  INTEGER`,
    `ALTER TABLE appointments  ADD COLUMN IF NOT EXISTS clinic_branch  TEXT DEFAULT 'Avadi'`,
    `ALTER TABLE patients      ADD COLUMN IF NOT EXISTS clinic_branch  TEXT DEFAULT 'Avadi'`,
    `ALTER TABLE diagnosis     ADD COLUMN IF NOT EXISTS consultant_id  INTEGER`,
    `ALTER TABLE attendance    ADD COLUMN IF NOT EXISTS doctor_id      INTEGER`,
    `ALTER TABLE doctors       ADD COLUMN IF NOT EXISTS is_owner       INTEGER DEFAULT 0`,
  ];
  for (const m of migrations) {
    try { await pool.query(m); } catch { /* column already exists — safe to ignore */ }
  }

  // Mark Dr. Vignesh as the owner-doctor
  await pool.query(`UPDATE doctors SET is_owner = 1 WHERE name ILIKE '%Vignesh%'`);
  await pool.query(`
    UPDATE doctors SET is_owner = 1
    WHERE is_owner = 0
      AND id = (SELECT id FROM doctors ORDER BY id ASC LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM doctors WHERE is_owner = 1)
  `);
}

// ── Seeding ────────────────────────────────────────────────────────────────────

async function seed(db) {
  const existingOwner = await db.prepare("SELECT id FROM users WHERE email = 'admin'").get();
  if (!existingOwner) {
    const hash = await bcrypt.hash('admin', 10);
    await db.prepare(
      'INSERT INTO users (name, email, password, role, is_active) VALUES (?, ?, ?, ?, ?)'
    ).run('Admin', 'admin', hash, 'owner', 1);
    console.log('Default owner created  →  email: admin  password: admin');
  }

  const existingDoc = await db.prepare("SELECT id FROM doctors WHERE name = 'Dr. Vignesh'").get();
  if (!existingDoc) {
    await db.prepare(
      'INSERT INTO doctors (name, specialization, qualification, experience, mobile, registration_no, is_owner) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('Dr. Vignesh', 'Dental Surgeon & Implantologist', 'BDS, MDS', 10, '9999999999', 'TN-DEN-001', 1);
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────

let _db = null;

async function initializeDatabase() {
  // Test connection
  await pool.query('SELECT 1');
  _db = makeWrapper();
  await createTables(_db);
  await seed(_db);
  console.log('VEB Dental PostgreSQL DB ready');
  return _db;
}

function getDb() {
  if (!_db) throw new Error('Database not initialized. Call initializeDatabase() first.');
  return _db;
}

module.exports = { initializeDatabase, getDb };
