const pool = require('../db');

const normalizeTime = (time) => {
  if (!time) return null;
  const [hour, minute] = time.split(':');
  return `${String(Number(hour)).padStart(2, '0')}:${String(Number(minute)).padStart(2, '0')}`;
};

const isValidDateString = (value) => {
  if (!value || typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
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

exports.listDentists = async (req, res) => {
  const { lat, lng, radius } = req.query;
  let query = 'SELECT user_id, full_name, specialty, practice_name, phone, address, latitude, longitude, image_url, bio FROM dentists';
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
    const result = await pool.query(query, queryParams);
    const dentists = result.rows.map((row) => ({
      id: row.user_id,
      name: row.full_name,
      specialty: row.practice_name,
      rating: null,
      latitude: row.latitude,
      longitude: row.longitude,
      image_url: row.image_url,
      practice_name: row.practice_name,
      address: row.address,
      phone: row.phone,
      bio: row.bio,
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
      'SELECT 1 FROM blocked_dates WHERE dentist_id = $1 AND blocked_date = $2',
      [id, date]
    );

    if (blocked.rows.length > 0) {
      return res.json([]);
    }

    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
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
      'SELECT start_time FROM appointments WHERE dentist_id = $1 AND appointment_date = $2 AND status != $3',
      [id, date, 'CANCELLED']
    );

    const bookedTimes = new Set(booked.rows.map((row) => normalizeTime(row.start_time)));
    const available = slots.filter((slot) => !bookedTimes.has(slot));

    return res.json(available);
  } catch (err) {
    console.error('Dentist slots error:', err);
    return res.status(500).json({ error: 'Unable to fetch available slots' });
  }
};
