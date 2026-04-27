-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. ENUMS
-- ==========================================
CREATE TYPE user_role AS ENUM ('PATIENT', 'DENTIST');
CREATE TYPE appointment_status AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- ==========================================
-- 2. USERS TABLE (Authentication Base)
-- ==========================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 3. PATIENTS TABLE (Profile)
-- ==========================================
CREATE TABLE patients (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    date_of_birth DATE
);

-- ==========================================
-- 4. DENTISTS TABLE (Profile & Clinic Info)
-- ==========================================
CREATE TABLE dentists (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    npi_license VARCHAR(100) UNIQUE NOT NULL,
    specialty VARCHAR(100),
    practice_name VARCHAR(255),
    phone VARCHAR(50),
    address VARCHAR(255),
    years_of_experience INT,
    education VARCHAR(255),
    latitude DECIMAL(10, 8),   -- Sourced from the interactive map during registration
    longitude DECIMAL(11, 8),  -- Sourced from the interactive map during registration
    image_url TEXT,
    bio TEXT
);

-- ==========================================
-- 5. SCHEDULES & AVAILABILITY
-- ==========================================
-- Defines standard working hours for a dentist (e.g., Mondays 09:00 - 17:00)
CREATE TABLE dentist_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dentist_id UUID REFERENCES dentists(user_id) ON DELETE CASCADE,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday, 1 = Monday
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_duration_minutes INT DEFAULT 30, -- Used to generate the '09:00', '09:30' UI blocks
    UNIQUE(dentist_id, day_of_week)
);

-- Vacation days / Manually closed dates from the Dentist Calendar Screen
CREATE TABLE blocked_dates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dentist_id UUID REFERENCES dentists(user_id) ON DELETE CASCADE,
    blocked_date DATE NOT NULL,
    reason VARCHAR(255) DEFAULT 'Closed',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(dentist_id, blocked_date)
);

-- ==========================================
-- 6. APPOINTMENTS (Booking System)
-- ==========================================
CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dentist_id UUID REFERENCES dentists(user_id) ON DELETE RESTRICT,
    patient_id UUID REFERENCES patients(user_id) ON DELETE RESTRICT,
    appointment_date DATE NOT NULL,
    start_time TIME NOT NULL,
    status appointment_status DEFAULT 'PENDING',
    treatment_type VARCHAR(255),
    room VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 7. INDEXES (For Performance & Map Queries)
-- ==========================================
-- Speeds up the map screen query when fetching dentists by location
CREATE INDEX idx_dentists_location ON dentists(latitude, longitude);

-- Speeds up finding a patient's upcoming visits
CREATE INDEX idx_appointments_patient ON appointments(patient_id, appointment_date);

-- Speeds up generating the dentist's daily schedule
CREATE INDEX idx_appointments_dentist_date ON appointments(dentist_id, appointment_date);