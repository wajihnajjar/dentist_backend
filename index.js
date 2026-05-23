require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authController = require('./authController');
const dentistController = require('./controllers/dentistController');
const appointmentController = require('./controllers/appointmentController');
const userController = require('./controllers/userController');
const { authenticate, requireRole, requireAnyRole } = require('./middleware/authMiddleware');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/auth/register', authController.register);
app.post('/api/auth/login', authController.login);

// Dentist routes - only dentists can access
app.post('/api/dentists/register', authenticate, requireRole('DENTIST'), dentistController.registerDentist);
app.get('/api/dentists', dentistController.listDentists);
app.get('/api/dentists/:id/slots', dentistController.dentistSlots);

// Appointment routes - patients can book
app.post('/api/appointments', authenticate, requireRole('PATIENT'), appointmentController.bookAppointment);

// Patient appointment history - only patient
app.get('/api/patients/me/appointments', authenticate, requireRole('PATIENT'), appointmentController.getPatientAppointments);

// Appointment details - both patient and dentist can view if involved
app.get('/api/appointments/:id', authenticate, appointmentController.getAppointmentById);

// Patient appointment actions - cancel allowed by both patient and dentist (role check in controller)
app.post('/api/appointments/:id/cancel', authenticate, appointmentController.cancelAppointment);
app.post('/api/appointments/:id/rate', authenticate, requireRole('PATIENT'), appointmentController.rateAppointment);

// Dentist appointment confirmation
app.post('/api/appointments/:id/confirm', authenticate, requireRole('DENTIST'), appointmentController.confirmAppointment);

// Dentist-only appointment actions
app.put('/api/appointments/:id/details', authenticate, requireRole('DENTIST'), appointmentController.updateAppointmentDetails);

// Dentist appointment history - only dentists
app.get('/api/dentists/me/appointments', authenticate, requireRole('DENTIST'), appointmentController.getDentistAppointments);

// Dentist profile update - only dentists
app.put('/api/dentists/me', authenticate, requireRole('DENTIST'), dentistController.updateProfile);
app.put('/api/dentists/me/schedules', authenticate, requireRole('DENTIST'), dentistController.updateSchedules);

// Dentist schedule blocking - only dentists
app.post('/api/dentists/me/blocked-dates', authenticate, requireRole('DENTIST'), appointmentController.blockDate);
app.delete('/api/dentists/me/blocked-dates/:date', authenticate, requireRole('DENTIST'), appointmentController.unblockDate);

// User profile - accessible to both, but returns role-specific data
app.get('/api/users/me', authenticate, userController.getCurrentUser);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));