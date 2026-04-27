const pool = require('../db');

exports.getCurrentUser = async (req, res) => {
  const userId = req.user.id;

  try {
    const userResult = await pool.query(
      'SELECT id, email, role, created_at, updated_at FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    let profileResult;

    if (user.role === 'PATIENT') {
      profileResult = await pool.query(
        'SELECT full_name, phone, date_of_birth FROM patients WHERE user_id = $1',
        [userId]
      );
    } else {
      profileResult = await pool.query(
        'SELECT full_name, npi_license, specialty, practice_name, phone, address, years_of_experience, education, latitude, longitude, image_url, bio FROM dentists WHERE user_id = $1',
        [userId]
      );

      const scheduleResult = await pool.query(
        'SELECT day_of_week, start_time, end_time FROM dentist_schedules WHERE dentist_id = $1 ORDER BY day_of_week',
        [userId]
      );

      return res.json({
        ...user,
        profile: {
          ...profileResult.rows[0],
          schedule: scheduleResult.rows,
        },
      });
    }

    return res.json({
      ...user,
      profile: profileResult.rows[0] || null,
    });
  } catch (err) {
    console.error('User fetch error:', err);
    return res.status(500).json({ error: 'Unable to fetch user profile' });
  }
};
