const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { initializeDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', clinic: 'VEB Dental Care & Implant Centre', timestamp: new Date() });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Initialize DB first, then start server
initializeDatabase().then(() => {
  const patientsRouter = require('./routes/patients');
  const doctorsRouter = require('./routes/doctors');
  const staffRouter = require('./routes/staff');
  const appointmentsRouter = require('./routes/appointments');
  const attendanceRouter = require('./routes/attendance');
  const diagnosisRouter = require('./routes/diagnosis');
  const billingRouter = require('./routes/billing');

  app.use('/api/patients', patientsRouter);
  app.use('/api/doctors', doctorsRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api/appointments', appointmentsRouter);
  app.use('/api/attendance', attendanceRouter);
  app.use('/api/diagnosis', diagnosisRouter);
  app.use('/api/billing', billingRouter);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nVEB Dental API running on http://0.0.0.0:${PORT}/api`);
    console.log(`For mobile: replace localhost with your computer IP`);
    console.log(`Health: http://localhost:${PORT}/api/health\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
