const pool = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const validRoles = ['PATIENT', 'DENTIST'];
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const normalizeTime = (time) => {
  if (!time || typeof time !== 'string') return null;
  return timeRegex.test(time) ? time : null;
};

exports.register = async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, password, role, schedule = [], ...profileData } = req.body;
    const dentistSchedule = Array.isArray(schedule) ? schedule : [];

    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password and role are required' });
    }

    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Role must be PATIENT or DENTIST' });
    }

    if (role === 'DENTIST') {
      const seenDays = new Set();
      for (const item of dentistSchedule) {
        if (!item || typeof item !== 'object') {
          return res.status(400).json({ error: 'Each schedule item must be an object' });
        }

        const dayOfWeek = Number(item.day_of_week);
        const startTime = normalizeTime(item.start_time);
        const endTime = normalizeTime(item.end_time);

        if (Number.isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
          return res.status(400).json({ error: 'day_of_week must be an integer between 0 and 6' });
        }
        if (!startTime || !endTime) {
          return res.status(400).json({ error: 'start_time and end_time must be in HH:mm format' });
        }
        if (startTime >= endTime) {
          return res.status(400).json({ error: 'start_time must be before end_time' });
        }
        if (seenDays.has(dayOfWeek)) {
          return res.status(400).json({ error: 'Duplicate schedule entries are not allowed for the same day_of_week' });
        }

        seenDays.add(dayOfWeek);
      }
    }

    await client.query('BEGIN');

    const hashedPassword = await bcrypt.hash(password, 10);
    const userRes = await client.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
      [email, hashedPassword, role]
    );

    const userId = userRes.rows[0].id;

    if (role === 'PATIENT') {
      await client.query(
        'INSERT INTO patients (user_id, full_name, phone, date_of_birth) VALUES ($1, $2, $3, $4)',
        [userId, profileData.name, profileData.phone || null, profileData.dob || null]
      );
    } else {
      await client.query(
        'INSERT INTO dentists (user_id, full_name, npi_license, specialty, practice_name, phone, address, years_of_experience, education, latitude, longitude, image_url, bio) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
        [
          userId,
          profileData.name,
          profileData.license,
          profileData.specialty || null,
          profileData.practiceName || null,
          profileData.phone || null,
          profileData.address || null,
          profileData.experience || null,
          profileData.education || null,
          profileData.latitude || null,
          profileData.longitude || null,
          profileData.image_url || null,
          profileData.bio || null,
        ]
      );

      if (dentistSchedule.length > 0) {
        for (const item of dentistSchedule) {
          await client.query(
            'INSERT INTO dentist_schedules (dentist_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)',
            [userId, item.day_of_week, normalizeTime(item.start_time), normalizeTime(item.end_time)]
          );
        }
      }
    }

    await client.query('COMMIT');

    const token = jwt.sign({ id: userId, role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, role });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email or license already exists' });
    }

    console.error('Registration error:', err);
    res.status(500).json({ error: 'Unable to complete registration' });
  } finally {
    client.release();
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, role: user.role });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Unable to authenticate user' });
  }
};