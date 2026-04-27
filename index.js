require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authController = require('./authController');
const dentistController = require('./controllers/dentistController');
const appointmentController = require('./controllers/appointmentController');
const userController = require('./controllers/userController');
const { authenticate, requireRole } = require('./middleware/authMiddleware');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/auth/register', authController.register);
app.post('/api/auth/login', authController.login);

app.get('/api/dentists', dentistController.listDentists);
app.get('/api/dentists/:id/slots', dentistController.dentistSlots);

app.post('/api/appointments', authenticate, requireRole('PATIENT'), appointmentController.bookAppointment);
app.get('/api/patients/me/appointments', authenticate, requireRole('PATIENT'), appointmentController.getPatientAppointments);

app.get('/api/dentists/me/appointments', authenticate, requireRole('DENTIST'), appointmentController.getDentistAppointments);
app.post('/api/dentists/me/blocked-dates', authenticate, requireRole('DENTIST'), appointmentController.blockDate);
app.delete('/api/dentists/me/blocked-dates/:date', authenticate, requireRole('DENTIST'), appointmentController.unblockDate);

app.get('/api/users/me', authenticate, userController.getCurrentUser);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));