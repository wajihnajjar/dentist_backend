const pool = require('../db');

const normalizeTime = (time) => {
  if (!time) return null;
  const [hour, minute] = time.split(':');
  return `${String(Number(hour)).padStart(2, '0')}:${String(Number(minute)).padStart(2, '0')}`;
};

const parseDate = (value) => {
  if (!value || typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // Validate the date is real (e.g., not 2026-02-30)
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  // Return as plain string - PostgreSQL handles DATE type directly
  return value;
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

  const { dentist_id, appointment_date, start_time } = req.body;
  const patient_id = req.user.id;
  console.log(patient_id)
  if (!dentist_id || !appointment_date || !start_time) {
    return res.status(400).json({ error: 'dentist_id, appointment_date, and start_time are required' });
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
      'SELECT 1 FROM blocked_dates WHERE dentist_id = $1 AND blocked_date = $2::date',
      [dentist_id, appointmentDate]
    );
    if (blockedResult.rows.length > 0) {
      return res.status(400).json({ error: 'This date is blocked for the dentist' });
    }

    const dayOfWeek = new Date(appointmentDate).getDay();
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
      'SELECT 1 FROM appointments WHERE dentist_id = $1 AND appointment_date = $2::date AND start_time = $3 AND status != $4',
      [dentist_id, appointmentDate, normalizedStart, 'CANCELLED']
    );

    if (conflict.rows.length > 0) {
      return res.status(400).json({ error: 'Selected slot is already booked' });
    } 

    const insertResult = await pool.query(
      'INSERT INTO appointments (dentist_id, patient_id, appointment_date, start_time) VALUES ($1, $2, $3::date, $4) RETURNING id, dentist_id, patient_id, appointment_date::text as appointment_date, start_time, status, notes, clinical_notes, diagnosis, prescription, created_at, updated_at',
      [dentist_id, patient_id, appointmentDate, normalizedStart]
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
      `SELECT a.id, a.appointment_date::text as appointment_date, a.start_time, a.status, a.notes, a.clinical_notes, a.diagnosis, a.prescription, a.rating, a.rating_comment,
              d.user_id AS dentist_id, d.full_name AS dentist_name, d.practice_name , d.phone as phone
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
      notes: row.notes,
      clinical_notes: row.clinical_notes,
      diagnosis: row.diagnosis,
      prescription: row.prescription,
      rating: row.rating,
      rating_comment: row.rating_comment,
      dentist_id: row.dentist_id,  
      dentist_name: row.dentist_name,
      practice_name: row.practice_name,
      phone:row.phone
    }));
    console.log(appointments ,"r")
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
    `SELECT a.id, a.appointment_date::text as appointment_date, a.start_time, a.status, a.notes, a.clinical_notes, a.diagnosis, a.prescription,
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
    query += ` AND a.appointment_date = $${queryParams.length}::date`;
  }

  query += ' ORDER BY a.appointment_date, a.start_time';

  try {
    const result = await pool.query(query, queryParams);
    const appointments = result.rows.map((row) => ({
      id: row.id,
      appointment_date: row.appointment_date,
      start_time: normalizeTime(row.start_time),
      status: row.status,
      notes: row.notes || row.clinical_notes,
      clinical_notes: row.clinical_notes || "",
      diagnosis: row.diagnosis,
      prescription: row.prescription,
      rating: row.rating,
      rating_comment: row.rating_comment,
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

exports.getAppointmentById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const result = await pool.query(
      `SELECT a.id, a.dentist_id, a.patient_id, a.appointment_date::text AS appointment_date, a.start_time, a.status, a.notes, a.clinical_notes, a.diagnosis, a.prescription, a.rating, a.rating_comment, a.created_at, a.updated_at,
              p.full_name AS patient_name, p.phone AS patient_phone,
              d.full_name AS dentist_name, d.practice_name AS dentist_practice_name, d.phone AS dentist_phone, d.address AS dentist_address, d.state AS dentist_state
         FROM appointments a
         JOIN patients p ON p.user_id = a.patient_id
         JOIN dentists d ON d.user_id = a.dentist_id
        WHERE a.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const appointment = result.rows[0];

    if (userRole === 'PATIENT' && appointment.patient_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to view this appointment' });
    }

    if (userRole === 'DENTIST' && appointment.dentist_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to view this appointment' });
    }

    return res.json({
      appointment: {
        id: appointment.id,
        dentist_id: appointment.dentist_id,
        dentist_name: appointment.dentist_name,
        dentist_practice_name: appointment.dentist_practice_name,
        dentist_phone: appointment.dentist_phone,
        dentist_address: appointment.dentist_address,
        dentist_state: appointment.dentist_state,
        patient_id: appointment.patient_id,
        patient_name: appointment.patient_name,
        patient_phone: appointment.patient_phone,
        appointment_date: appointment.appointment_date,
        start_time: normalizeTime(appointment.start_time),
        status: appointment.status,
        notes: appointment.notes,
        clinical_notes: appointment.clinical_notes,
        diagnosis: appointment.diagnosis,
        prescription: appointment.prescription,
        rating: appointment.rating,
        rating_comment: appointment.rating_comment,
        created_at: appointment.created_at,
        updated_at: appointment.updated_at,
        phone:appointment.dentist_phone
      }
    });
  } catch (err) {
    console.error('Get appointment detail error:', err);
    return res.status(500).json({ error: 'Unable to fetch appointment details' });
  }
};

exports.updateAppointmentDetails = async (req, res) => {
  const { id } = req.params;
  const dentistId = req.user.id;
  const { diagnosis, prescription, clinical_notes, notes } = req.body;

  const updates = [];
  const values = [];
  let paramIndex = 1; 

  if (diagnosis !== undefined) {
    updates.push(`diagnosis = $${paramIndex++}`);
    values.push(diagnosis);
  }
  if (prescription !== undefined) {
    updates.push(`prescription = $${paramIndex++}`);
    values.push(prescription);
  }
  if (clinical_notes !== undefined) {
    updates.push(`clinical_notes = $${paramIndex++}`);
    values.push(clinical_notes);
  }
  if (notes !== undefined) {
    updates.push(`notes = $${paramIndex++}`);
    values.push(notes);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'At least one field is required to update' });
  }

  try {
    const appointmentResult = await pool.query('SELECT dentist_id FROM appointments WHERE id = $1', [id]);
    if (appointmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    if (appointmentResult.rows[0].dentist_id !== dentistId) {
      return res.status(403).json({ error: 'Not authorized to update this appointment' });
    }

    values.push(id);
    const query = `UPDATE appointments SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex} RETURNING id, dentist_id, patient_id, appointment_date::text AS appointment_date, start_time, status, notes, clinical_notes, diagnosis, prescription, created_at, updated_at`;
    const updateResult = await pool.query(query, values);

    return res.json({
      message: 'Appointment details updated successfully',
      appointment: updateResult.rows[0]
    });
  } catch (err) {
    console.error('Update appointment details error:', err);
    return res.status(500).json({ error: 'Unable to update appointment details' });
  }
};

exports.rateAppointment = async (req, res) => {
  const { id } = req.params;
  const patientId = req.user.id;
  const { rating, rating_comment } = req.body;

  if (rating === undefined || typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
  }

  try {
    const appointmentResult = await pool.query(
      'SELECT patient_id, dentist_id, status, prescription FROM appointments WHERE id = $1',
      [id]
    );

    if (appointmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const appointment = appointmentResult.rows[0];
    if (appointment.patient_id !== patientId) {
      return res.status(403).json({ error: 'Not authorized to rate this appointment' });
    }

    if (appointment.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Cancelled appointments cannot be rated' });
    }

    if (!appointment.prescription || appointment.prescription.trim() === '') {
      return res.status(400).json({ error: 'Appointment must have a prescription before it can be rated' });
    }

    const updateResult = await pool.query(
      'UPDATE appointments SET rating = $1, rating_comment = $2, rated_at = NOW(), updated_at = NOW() WHERE id = $3 RETURNING id, dentist_id, patient_id, appointment_date::text AS appointment_date, start_time, status, notes, clinical_notes, diagnosis, prescription, rating, rating_comment, rated_at, created_at, updated_at',
      [rating, rating_comment || null, id]
    );

    return res.json({
      message: 'Appointment rated successfully',
      appointment: updateResult.rows[0]
    });
  } catch (err) {
    console.error('Rate appointment error:', err);
    return res.status(500).json({ error: 'Unable to submit rating' });
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

exports.cancelAppointment = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  console.log(id)

  try {
    // Get the appointment first
    const appointmentResult = await pool.query(
      'SELECT a.id, a.dentist_id, a.patient_id, a.status, p.email as patient_email FROM appointments a JOIN patients p ON p.user_id = a.patient_id WHERE a.id = $1',
      [id]
    );

    if (appointmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const appointment = appointmentResult.rows[0];

    // Check authorization: either patient owns it or dentist owns it
    if (userRole === 'PATIENT' && appointment.patient_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to cancel this appointment' });
    }

    if (userRole === 'DENTIST' && appointment.dentist_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to cancel this appointment' });
    }

    // Check if already cancelled
    if (appointment.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Appointment is already cancelled' });
    }

    // Update status to CANCELLED
    await pool.query(
      'UPDATE appointments SET status = $1, updated_at = NOW() WHERE id = $2',
      ['CANCELLED', id]
    );

    return res.json({ success: true, message: 'Appointment cancelled successfully' });
  } catch (err) {
    console.error('Cancel appointment error:', err);
    return res.status(500).json({ error: 'Failed to cancel appointment' });
  }
};

exports.confirmAppointment = async (req, res) => {
  const { id } = req.params;
  const dentistId = req.user.id;

  try {
    // Get the appointment first
    const appointmentResult = await pool.query(
      'SELECT a.id, a.dentist_id, a.status FROM appointments a JOIN patients p ON p.user_id = a.patient_id WHERE a.id = $1',
      [id]
    );

    if (appointmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const appointment = appointmentResult.rows[0];

    // Check authorization: only the assigned dentist can confirm
    if (appointment.dentist_id !== dentistId) {
      return res.status(403).json({ error: 'Not authorized to confirm this appointment' });
    }

    // Check if already confirmed or cancelled
    if (appointment.status === 'CONFIRMED') {
      return res.status(400).json({ error: 'Appointment is already confirmed' });
    }

    if (appointment.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Cannot confirm a cancelled appointment' });
    }

    // Update status to CONFIRMED
    const updateResult = await pool.query(
      'UPDATE appointments SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, dentist_id, patient_id, appointment_date::text as appointment_date, start_time, status, notes, clinical_notes, diagnosis, prescription, created_at, updated_at',
      ['CONFIRMED', id]
    );

    return res.status(200).json({
      message: 'Appointment confirmed successfully',
      appointment: updateResult.rows[0]
    });
  } catch (err) {
    console.error('Confirm appointment error:', err);
    return res.status(500).json({ error: 'Unable to confirm appointment' });
  }
};
