const pool = require('../db');

const normalizeTime = (time) => {
  if (!time) return null;
  const [hour, minute] = time.split(':');
  return `${String(Number(hour)).padStart(2, '0')}:${String(Number(minute)).padStart(2, '0')}`;
};

const isValidDateString = (value) => {
  if (!value || typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Validate the date is real (e.g., not 2026-02-30)
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return false;
  }
  return true;
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

exports.registerDentist = async (req, res) => {
  const dentistId = req.user.id;
  const { full_name, npi_license, specialty, practice_name, phone, address, latitude, longitude, state, bio, years_of_experience, education, consultation_fee } = req.body;
    console.log(consultation_fee)
  if (!full_name || !npi_license || !practice_name || !phone || !address || latitude === undefined || longitude === undefined || !state || consultation_fee==undefined) {
    return res.status(400).json({ error: 'full_name, npi_license, practice_name, phone, address, latitude, longitude, and state are required' });
  }

  try {
    const existingDentist = await pool.query('SELECT user_id FROM dentists WHERE user_id = $1', [dentistId]);
    if (existingDentist.rows.length > 0) {
      return res.status(400).json({ error: 'Dentist profile already exists' });
    }

    const result = await pool.query(
      'INSERT INTO dentists (user_id, full_name, npi_license, specialty, practice_name, phone, address, latitude, longitude, state, bio, years_of_experience, education, consultation_fee) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING user_id, full_name, npi_license, specialty, practice_name, phone, address, latitude, longitude, state, bio, years_of_experience, education, consultation_fee',
      [dentistId, full_name, npi_license, specialty || null, practice_name, phone, address, latitude, longitude, state, bio || null, years_of_experience || null, education || null, consultation_fee || 0]
    );

    return res.status(201).json({
      message: 'Dentist profile created successfully',
      profile: result.rows[0]
    });
  } catch (err) {
    console.error('Dentist registration error:', err);
    return res.status(500).json({ error: 'Unable to create dentist profile' });
  }
};

exports.listDentists = async (req, res) => {
  const { lat, lng, radius } = req.query;
  let query = 'SELECT * FROM dentists';
  const queryParams = []; 

  if (lat && lng && radius) {
    const latitude = Number(lat);
    const longitude = Number(lng);
    const distanceKm = Number(radius);

    if ([latitude, longitude, distanceKm].some((value) => Number.isNaN(value))) {
      return res.status(400).json({ error: 'Invalid lat, lng, or radius' });
    }

    const latDelta = distanceKm / 111;
    const lngDelta = distanceKm / (111 * Math.cos((latitude * Math.PI) / 180));

    query += ' WHERE latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4';
    queryParams.push(latitude - latDelta, latitude + latDelta, longitude - lngDelta, longitude + lngDelta);
  }

  try {
    if (queryParams.length === 0) {
      query = `SELECT d.*, AVG(a.rating) AS average_rating, COUNT(a.rating) AS total_ratings,
                       COALESCE(JSON_AGG(JSON_BUILD_OBJECT(
                         'rating', a.rating,
                         'comment', a.rating_comment,
                         'rated_at', a.rated_at,
                         'appointment_id', a.id
                       ) ORDER BY a.rated_at) FILTER (WHERE a.rating IS NOT NULL), '[]') AS ratings
                  FROM dentists d
                  LEFT JOIN appointments a ON a.dentist_id = d.user_id
                 GROUP BY d.user_id`;
    } else {
      query = `SELECT d.*, AVG(a.rating) AS average_rating, COUNT(a.rating) AS total_ratings,
                       COALESCE(JSON_AGG(JSON_BUILD_OBJECT(
                         'rating', a.rating,
                         'comment', a.rating_comment,
                         'rated_at', a.rated_at,
                         'appointment_id', a.id
                       ) ORDER BY a.rated_at) FILTER (WHERE a.rating IS NOT NULL), '[]') AS ratings
                  FROM dentists d
                  LEFT JOIN appointments a ON a.dentist_id = d.user_id
                 WHERE d.latitude BETWEEN $1 AND $2 AND d.longitude BETWEEN $3 AND $4
                 GROUP BY d.user_id`;
    }

    const result = await pool.query(query, queryParams);
    const dentists = result.rows.map((row) => ({
      id: row.user_id,
      name: row.full_name,
      specialty: row.practice_name,
      rating: row.average_rating !== null ? Number(Number(row.average_rating).toFixed(2)) : null,
      rating_count: Number(row.total_ratings || 0),
      ratings: row.ratings || [],
      latitude: row.latitude,
      longitude: row.longitude,
      image_url: row.image_url,
      practice_name: row.practice_name,
      address: row.address,
      state: row.state,
      phone: row.phone,
      bio: row.bio,
      years_of_experience: row.years_of_experience,
      education: row.education,
      consultation_fee: Number(row.consultation_fee || 0)
    }));
    return res.json(dentists);
  } catch (err) {
    console.error('Dentist list error:', err);
    return res.status(500).json({ error: 'Unable to fetch dentists' });
  }
};

exports.dentistSlots = async (req, res) => {
  const { id } = req.params;
  const { date } = req.query;

  if (!date || !isValidDateString(date)) {
    return res.status(400).json({ error: 'A valid date is required in YYYY-MM-DD format' });
  }

  try {
    const dentist = await pool.query('SELECT user_id FROM dentists WHERE user_id = $1', [id]);
    if (dentist.rows.length === 0) {
      return res.status(404).json({ error: 'Dentist not found' });
    }

    const blocked = await pool.query(
      'SELECT 1 FROM blocked_dates WHERE dentist_id = $1 AND blocked_date = $2::date',
      [id, date]
    );

    if (blocked.rows.length > 0) {
      return res.json([]);
    }

    const dayOfWeek = new Date(date).getDay();
    const schedule = await pool.query(
      'SELECT start_time, end_time, slot_duration_minutes FROM dentist_schedules WHERE dentist_id = $1 AND day_of_week = $2',
      [id, dayOfWeek]
    );  

    if (schedule.rows.length === 0) {
      return res.json([]);
    }

    const { start_time, end_time, slot_duration_minutes } = schedule.rows[0];
    const slots = generateSlots(normalizeTime(start_time), normalizeTime(end_time), slot_duration_minutes);

    const booked = await pool.query(
      'SELECT start_time FROM appointments WHERE dentist_id = $1 AND appointment_date = $2::date AND status != $3',
      [id, date, 'CANCELLED']
    );

    const bookedTimes = new Set(booked.rows.map((row) => normalizeTime(row.start_time)));
    const available = slots.filter((slot) => !bookedTimes.has(slot));
    console.log(available)
    return res.json(available);
  } catch (err) {
    console.error('Dentist slots error:', err);
    return res.status(500).json({ error: 'Unable to fetch available slots' });
  }
};

exports.updateSchedules = async (req, res) => {
  const dentistId = req.user.id;
  const { schedules } = req.body;

  if (!Array.isArray(schedules) || schedules.length === 0) {
    return res.status(400).json({ error: 'schedules must be a non-empty array' });
  }

  // Validate each schedule object
  for (const schedule of schedules) {
    if (typeof schedule.day_of_week !== 'number' || schedule.day_of_week < 0 || schedule.day_of_week > 6) {
      return res.status(400).json({ error: 'day_of_week must be a number between 0 (Sunday) and 6 (Saturday)' });
    }
    if (!schedule.start_time || !schedule.end_time) {
      return res.status(400).json({ error: 'start_time and end_time are required for each schedule' });
    }
    if (typeof schedule.slot_duration_minutes !== 'number' || schedule.slot_duration_minutes <= 0) {
      return res.status(400).json({ error: 'slot_duration_minutes must be a positive number' });
    }
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete all existing schedules for this dentist
    await client.query('DELETE FROM dentist_schedules WHERE dentist_id = $1', [dentistId]);

    // Insert new schedules
    for (const schedule of schedules) {
      const normalizedStart = normalizeTime(schedule.start_time);
      const normalizedEnd = normalizeTime(schedule.end_time);

      if (!normalizedStart || !normalizedEnd) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'start_time and end_time must be in HH:mm format' });
      }

      await client.query(
        'INSERT INTO dentist_schedules (dentist_id, day_of_week, start_time, end_time, slot_duration_minutes) VALUES ($1, $2, $3, $4, $5)',
        [dentistId, schedule.day_of_week, normalizedStart, normalizedEnd, schedule.slot_duration_minutes]
      );
    }

    await client.query('COMMIT');

    // Fetch and return the updated schedules
    const result = await pool.query(
      'SELECT day_of_week, start_time, end_time, slot_duration_minutes FROM dentist_schedules WHERE dentist_id = $1 ORDER BY day_of_week',
      [dentistId]
    );

    return res.json({
      message: 'Schedules updated successfully',
      schedules: result.rows
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update schedules error:', err);
    return res.status(500).json({ error: 'Unable to update schedules' });
  } finally {
    client.release();
  }
};

exports.updateProfile = async (req, res) => {
  const dentistId = req.user.id;
  const { address, state, practice_name, phone, bio, image_url, years_of_experience, education, specialty, latitude, longitude, consultation_fee } = req.body;

  // Build dynamic update query
  const updates = [];
  const values = [];
  let paramIndex = 1;

  if (address !== undefined) {
    updates.push(`address = $${paramIndex++}`);
    values.push(address);
  }
  if (state !== undefined) {
    updates.push(`state = $${paramIndex++}`);
    values.push(state);
  }
  if (practice_name !== undefined) {
    updates.push(`practice_name = $${paramIndex++}`);
    values.push(practice_name);
  }
  if (phone !== undefined) {
    updates.push(`phone = $${paramIndex++}`);
    values.push(phone);
  }
  if (bio !== undefined) {
    updates.push(`bio = $${paramIndex++}`);
    values.push(bio);
  }
  if (image_url !== undefined) {
    updates.push(`image_url = $${paramIndex++}`);
    values.push(image_url);
  }
  if (years_of_experience !== undefined) {
    updates.push(`years_of_experience = $${paramIndex++}`);
    values.push(years_of_experience);
  }
  if (education !== undefined) {
    updates.push(`education = $${paramIndex++}`);
    values.push(education);
  }
  if (specialty !== undefined) {
    updates.push(`specialty = $${paramIndex++}`);
    values.push(specialty);
  }
  if (latitude !== undefined) {
    updates.push(`latitude = $${paramIndex++}`);
    values.push(latitude);
  }
  if (longitude !== undefined) {
    updates.push(`longitude = $${paramIndex++}`);
    values.push(longitude);
  }
  if (consultation_fee !== undefined) {
    updates.push(`consultation_fee = $${paramIndex++}`);
    values.push(consultation_fee);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  values.push(dentistId);

  try {
    const query = `UPDATE dentists SET ${updates.join(', ')} WHERE user_id = $${paramIndex} RETURNING user_id, full_name, practice_name, phone, address, state, bio, image_url, years_of_experience, education, specialty, latitude, longitude`;
    
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dentist profile not found' });
    }

    return res.json({
      message: 'Profile updated successfully',
      profile: result.rows[0]
    });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ error: 'Unable to update profile' });
  }
};
