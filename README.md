# Swasthya — Connected & Offline-First Healthcare Companion

Swasthya is an intelligent, privacy-preserving healthcare assistant integrating:
1. **Supabase**: PostgreSQL database, Supabase Auth, Row Level Security (RLS), unique patient UIDs (`PT-XXXXXX`), and doctor audit logging.
2. **Cloudinary**: Backend-only verified uploads for medicine photos and lab reports with MIME type, file extension, and binary magic byte validation.
3. **OneSignal**: Background web push notifications for medicine reminders, daily health quotes, and routine alerts across patient timezones with deterministic deduplication.
4. **OpenAI**: Real AI health assistant in English and Hindi with emergency red flag detection (chest pain, stroke, breathing failure, self-harm), evidence-based supportive guidance (fever, headache, stomach pain, cancer care, anxiety), medical citations, explicit consent controls, and complete data deletion.
5. **Render**: Fully configured for production deployment with `0.0.0.0` binding, dynamic port assignment, health checks (`/api/health`), structured JSON logging, and a production error handler.

---

## Quick Start (Local Development)

### 1. Requirements
- Node.js 18 or newer
- npm 9 or newer

### 2. Setup Environment
Copy the example environment configuration:
```bash
cp .env.example .env
```
Populate `.env` with your Supabase, Cloudinary, OneSignal, and OpenAI API credentials. (If left unpopulated, Swasthya runs in secure local fallback mode with offline simulation).

### 3. Install Dependencies & Start Server
```bash
npm install
npm start
```

Open your browser to:
```
http://localhost:4173/
```

### 4. Run Automated Test Suite
Run the full integration test suite covering auth, RLS, Cloudinary validation, OneSignal deduplication, and OpenAI safety:
```bash
npm test
```

---

## Five Core Service Integrations

### 1. Supabase (Database & Authentication)
- Replaces `swasthya-data.json` with PostgreSQL tables and Row Level Security.
- Generates a unique patient UID (`PT-XXXXXX`) for each patient upon registration.
- Enforces role separation (`patient` vs `doctor`). Doctors can only access patients assigned to them.
- Service role key is strictly backend-only.
- Migration script provided in [`supabase-schema.sql`](file:///c:/Users/HP/Downloads/VINCERE/supabase-schema.sql). Full instructions in [`MIGRATION.md`](file:///c:/Users/HP/Downloads/VINCERE/MIGRATION.md).

### 2. Cloudinary (Media & Document Storage)
- Uploads happen strictly through backend endpoints `/api/upload/medicine-photo` and `/api/upload/report`.
- Validates MIME type, file extension, max file size (5MB for medicine photos, 10MB for reports), and magic bytes.
- Stores only secure Cloudinary URLs and public IDs in the database.
- Zero Cloudinary API secrets are exposed to the browser.

### 3. OneSignal (Background Notifications)
- Delivers web push notifications even when the browser tab is closed.
- Automatically calculates schedules in the patient's local timezone.
- Enforces deterministic deduplication keys in `notification_logs` to eliminate duplicate alerts.
- Retains local offline notifications via Service Worker as an offline fallback.

### 4. OpenAI (Real AI Assistant)
- Endpoint: `POST /api/assistant/chat` (OpenAI API key kept strictly on the server).
- Instant red flag detection: Intercepts cardiac distress, breathing failure, stroke symptoms, acute trauma, or suicidal ideation and immediately returns an emergency alert directing to 112 / 911 / emergency care.
- Safe clinical guidance for fever, headache, stomach pain, cancer support, chest pain, and anxiety.
- Never diagnoses, prescribes, or tells patients to change medication dosages.
- Attaches WHO and ICMR evidence-based source and date metadata.
- Stores conversation history only with explicit patient consent, and provides complete deletion controls via `DELETE /api/assistant/history`.

### 5. Render (Production Hosting)
- Configured via [`render.yaml`](file:///c:/Users/HP/Downloads/VINCERE/render.yaml) with build command `npm install` and start command `npm start`.
- Binds to `0.0.0.0` and uses Render's dynamic `PORT`.
- Health check available at `/api/health`.
- Structured JSON logging and production error handler.
- Detailed deployment instructions in [`DEPLOYMENT.md`](file:///c:/Users/HP/Downloads/VINCERE/DEPLOYMENT.md).

---

## Documentation Index

- [`supabase-schema.sql`](file:///c:/Users/HP/Downloads/VINCERE/supabase-schema.sql): Complete PostgreSQL schema, tables, indexes, RLS policies, and triggers.
- [`MIGRATION.md`](file:///c:/Users/HP/Downloads/VINCERE/MIGRATION.md): Step-by-step Supabase migration guide and SQL verification queries.
- [`DEPLOYMENT.md`](file:///c:/Users/HP/Downloads/VINCERE/DEPLOYMENT.md): Render Blueprint deployment guide and environment variable reference.
- [`SECURITY.md`](file:///c:/Users/HP/Downloads/VINCERE/SECURITY.md): Comprehensive security checklist and verification protocols.
- [`.env.example`](file:///c:/Users/HP/Downloads/VINCERE/.env.example): Complete template of all required production environment variables.
- [`test/api.test.js`](file:///c:/Users/HP/Downloads/VINCERE/test/api.test.js): Automated integration test suite.

---

## Acceptance Verification

| Requirement | Implementation Details |
| :--- | :--- |
| **Separated Accounts** | Patient & Doctor accounts segregated with permission-protected endpoints. |
| **Unique Patient UID** | Crypto-random `PT-XXXXXX` generated per patient and displayed on UI. |
| **Cloudinary Media** | Medicine photos and PDF reports validated and uploaded via server-side API only. |
| **OneSignal Web Push** | Background push for reminders & quotes with timezone deduplication. |
| **Emergency-Safe AI** | OpenAI assistant with red flag shield, bilingual Hindi/English, and WHO/ICMR citations. |
| **Doctor-Assigned Access** | Doctors restricted strictly to assigned patients with audit logs and mutual block controls. |
| **Production Ready** | Render `0.0.0.0` host, health checks, structured logs, and automated tests. |
