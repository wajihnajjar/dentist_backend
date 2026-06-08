const pool = require('../db');
const bcrypt = require('bcryptjs');

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
        'SELECT full_name, phone, date_of_birth::text as date_of_birth FROM patients WHERE user_id = $1',
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

exports.updateProfile = async (req, res) => {
  const userId = req.user.id;
  const { full_name, phone, date_of_birth, email, current_password, new_password } = req.body;
  const profileFieldsProvided = full_name !== undefined || phone !== undefined || date_of_birth !== undefined || email !== undefined;
  const passwordChangeProvided = new_password !== undefined;

  if (!profileFieldsProvided && !passwordChangeProvided) {
    return res.status(400).json({ error: 'At least one profile field or password must be provided to update' });
  }

  if (passwordChangeProvided ) {
    return res.status(400).json({ error: 'Current password is required to change password' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let profileResult;
    let updatedEmail;

    if (profileFieldsProvided) {
      const updates = [];
      const values = [];

      if (full_name !== undefined) {
        updates.push(`full_name = $${values.length + 1}`);
        values.push(full_name);
      }
      if (phone !== undefined) {
        updates.push(`phone = $${values.length + 1}`);
        values.push(phone);
      }
      if (date_of_birth !== undefined) {
        updates.push(`date_of_birth = $${values.length + 1}::date`);
        values.push(date_of_birth);
      }

      values.push(userId);
      const query = `UPDATE patients SET ${updates.join(', ')} WHERE user_id = $${values.length} RETURNING full_name, phone, date_of_birth::text as date_of_birth`;
      const result = await client.query(query, values);

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Patient profile not found' });
      }

      profileResult = result.rows[0];
    }

    if (email !== undefined) {
      const existingEmail = await client.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, userId]);
      if (existingEmail.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Email already in use' });
      }

      const emailUpdate = await client.query('UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2 RETURNING email', [email, userId]);
      updatedEmail = emailUpdate.rows[0].email;
    }

    if (passwordChangeProvided) {
      const userResult = await client.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found' });
      }

      const isMatch = await bcrypt.compare(current_password, userResult.rows[0].password_hash);
      if (!isMatch) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      const hashedPassword = await bcrypt.hash(new_password, 10);
      await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hashedPassword, userId]);
    }

    await client.query('COMMIT');

    const response = { profile: profileResult || null };
    if (updatedEmail) {
      response.email = updatedEmail;
    }
    response.message = 'Profile updated successfully';

    return res.json(response);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Patient profile update error:', err);
    return res.status(500).json({ error: 'Unable to update patient profile' });
  } finally {
    client.release();
  }
};
