const pool = require('../db');

const normalizeTime = (time) => {
  if (!time) return null;
  const [hour, minute] = time.split(':');
  return `${String(Number(hour)).padStart(2, '0')}:${String(Number(minute)).padStart(2, '0')}`;
};

const parseDate = (value) => {
  if (!value || typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : value;
};

const generateSlots = (startTime, endTime, durationMinutes) => {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  const slots = [];

  for (let minutes = startTotal; minutes + durationMinutes <= endTotal; minutes += durationMinutes) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    slots.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }

  return slots;
};

exports.bookAppointment = async (req, res) => {
  const { dentist_id, appointment_date, start_time, treatment_type } = req.body;
  const patient_id = req.user.id;

  if (!dentist_id || !appointment_date || !start_time || !treatment_type) {
    return res.status(400).json({ error: 'dentist_id, appointment_date, start_time, and treatment_type are required' });
  }

  const appointmentDate = parseDate(appointment_date);
  if (!appointmentDate) {
    return res.status(400).json({ error: 'appointment_date must be in YYYY-MM-DD format' });
  }

  const normalizedStart = normalizeTime(start_time);
  if (!normalizedStart) {
    return res.status(400).json({ error: 'start_time must be in HH:mm or HH:mm:ss format' });
  }

  try {
    const dentistResult = await pool.query('SELECT user_id FROM dentists WHERE user_id = $1', [dentist_id]);
    if (dentistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dentist not found' });
    }

    const patientResult = await pool.query('SELECT user_id FROM patients WHERE user_id = $1', [patient_id]);
    if (patientResult.rows.length === 0) {
      return res.status(403).json({ error: 'Only patients can create appointments' });
    }

    const blockedResult = await pool.query(
      'SELECT 1 FROM blocked_dates WHERE dentist_id = $1 AND blocked_date = $2',
      [dentist_id, appointmentDate]
    );
    if (blockedResult.rows.length > 0) {
      return res.status(400).json({ error: 'This date is blocked for the dentist' });
    }

    const dayOfWeek = new Date(`${appointmentDate}T00:00:00Z`).getUTCDay();
    const scheduleResult = await pool.query(
      'SELECT start_time, end_time, slot_duration_minutes FROM dentist_schedules WHERE dentist_id = $1 AND day_of_week = $2',
      [dentist_id, dayOfWeek]
    );

    if (scheduleResult.rows.length === 0) {
      return res.status(400).json({ error: 'Dentist is not available on that day' });
    }

    const { start_time: scheduleStart, end_time: scheduleEnd, slot_duration_minutes } = scheduleResult.rows[0];
    const validSlots = generateSlots(normalizeTime(scheduleStart), normalizeTime(scheduleEnd), slot_duration_minutes);
    if (!validSlots.includes(normalizedStart)) {
      return res.status(400).json({ error: 'Requested time is outside of the dentist schedule' });
    }

    const conflict = await pool.query(
      'SELECT 1 FROM appointments WHERE dentist_id = $1 AND appointment_date = $2 AND start_time = $3 AND status != $4',
      [dentist_id, appointmentDate, normalizedStart, 'CANCELLED']
    );

    if (conflict.rows.length > 0) {
      return res.status(400).json({ error: 'Selected slot is already booked' });
    }

    const insertResult = await pool.query(
      'INSERT INTO appointments (dentist_id, patient_id, appointment_date, start_time, treatment_type) VALUES ($1, $2, $3, $4, $5) RETURNING id, dentist_id, patient_id, appointment_date, start_time, status, treatment_type, created_at, updated_at',
      [dentist_id, patient_id, appointmentDate, normalizedStart, treatment_type]
    );

    return res.status(201).json({
      success: true,
      appointment: insertResult.rows[0],
    });
  } catch (err) {
    console.error('Booking error:', err);
    return res.status(500).json({ error: 'Unable to create appointment' });
  }
};

exports.getPatientAppointments = async (req, res) => {
  const patientId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT a.id, a.appointment_date, a.start_time, a.status, a.treatment_type, a.notes,
              d.user_id AS dentist_id, d.full_name AS dentist_name, d.practice_name
         FROM appointments a
         JOIN dentists d ON d.user_id = a.dentist_id
        WHERE a.patient_id = $1
        ORDER BY a.appointment_date DESC, a.start_time`,
      [patientId]
    );

    const appointments = result.rows.map((row) => ({
      id: row.id,
      appointment_date: row.appointment_date,
      start_time: normalizeTime(row.start_time),
      status: row.status,
      treatment_type: row.treatment_type,
      notes: row.notes,
      dentist_id: row.dentist_id,
      dentist_name: row.dentist_name,
      practice_name: row.practice_name,
    }));

    return res.json(appointments);
  } catch (err) {
    console.error('Patient appointment fetch error:', err);
    return res.status(500).json({ error: 'Unable to fetch patient appointments' });
  }
};

exports.getDentistAppointments = async (req, res) => {
  const dentistId = req.user.id;
  const { date } = req.query;
  const queryParams = [dentistId];
  let query = 
    `SELECT a.id, a.appointment_date, a.start_time, a.status, a.treatment_type, a.notes,
            p.user_id AS patient_id, p.full_name AS patient_name, p.phone
       FROM appointments a
       JOIN patients p ON p.user_id = a.patient_id
      WHERE a.dentist_id = $1`;

  if (date) {
    const validDate = parseDate(date);
    if (!validDate) {
      return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
    }
    queryParams.push(validDate);
    query += ` AND a.appointment_date = $${queryParams.length}`;
  }

  query += ' ORDER BY a.appointment_date, a.start_time';

  try {
    const result = await pool.query(query, queryParams);
    const appointments = result.rows.map((row) => ({
      id: row.id,
      appointment_date: row.appointment_date,
      start_time: normalizeTime(row.start_time),
      status: row.status,
      treatment_type: row.treatment_type,
      notes: row.notes,
      patient_id: row.patient_id,
      patient_name: row.patient_name,
      phone: row.phone,
    }));

    return res.json(appointments);
  } catch (err) {
    console.error('Dentist appointment fetch error:', err);
    return res.status(500).json({ error: 'Unable to fetch dentist appointments' });
  }
};

exports.blockDate = async (req, res) => {
  const dentistId = req.user.id;
  const { blocked_date } = req.body;

  const validDate = parseDate(blocked_date);
  if (!validDate) {
    return res.status(400).json({ error: 'blocked_date must be in YYYY-MM-DD format' });
  }

  try {
    await pool.query(
      'INSERT INTO blocked_dates (dentist_id, blocked_date) VALUES ($1, $2) ON CONFLICT (dentist_id, blocked_date) DO NOTHING',
      [dentistId, validDate]
    );

    return res.json({ message: 'Date blocked successfully' });
  } catch (err) {
    console.error('Block date error:', err);
    return res.status(500).json({ error: 'Unable to block date' });
  }
};

exports.unblockDate = async (req, res) => {
  const dentistId = req.user.id;
  const { date } = req.params;

  const validDate = parseDate(date);
  if (!validDate) {
    return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM blocked_dates WHERE dentist_id = $1 AND blocked_date = $2',
      [dentistId, validDate]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Blocked date not found' });
    }

    return res.json({ message: 'Date is now available' });
  } catch (err) {
    console.error('Unblock date error:', err);
    return res.status(500).json({ error: 'Unable to remove blocked date' });
  }
};
