const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const { initializeDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const email = req.body?.email ? ` [${req.body.email}]` : '';
    console.log(`${req.method} ${req.path}${email} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', clinic: 'VEB DENTAL CARE', timestamp: new Date() });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { JWT_SECRET } = require('./routes/auth');
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Initialize DB first, then start server
initializeDatabase().then(() => {
  const { router: authRouter } = require('./routes/auth');
  const patientsRouter = require('./routes/patients');
  const doctorsRouter = require('./routes/doctors');
  const staffRouter = require('./routes/staff');
  const appointmentsRouter = require('./routes/appointments');
  const attendanceRouter = require('./routes/attendance');
  const diagnosisRouter = require('./routes/diagnosis');
  const billingRouter = require('./routes/billing');
  const consultantsRouter = require('./routes/consultants');
  const ownerRouter = require('./routes/owner');

  app.use('/api/auth', authRouter);                                    // public
  app.use('/api/patients', requireAuth, patientsRouter);
  app.use('/api/doctors', requireAuth, doctorsRouter);
  app.use('/api/staff', requireAuth, staffRouter);
  app.use('/api/appointments', requireAuth, appointmentsRouter);
  app.use('/api/attendance', requireAuth, attendanceRouter);
  app.use('/api/diagnosis', requireAuth, diagnosisRouter);
  app.use('/api/billing', requireAuth, billingRouter);
  app.use('/api/consultants', requireAuth, consultantsRouter);
  app.use('/api/owner', ownerRouter);                                  // owner-only, self-authenticated in route

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nVEB Dental API running on http://0.0.0.0:${PORT}/api`);
    console.log(`For mobile: replace localhost with your computer IP`);
    console.log(`Health: http://localhost:${PORT}/api/health\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
