# Swasthya Security Architecture & Verification Checklist

This document details the security principles, boundaries, policies, and verification steps implemented across all five services in Swasthya.

---

## 1. Security Architecture Principles

```
                    +------------------------------------------+
                    |          CLIENT BROWSER (HTTPS)          |
                    |   Only holds: Token, Anon Key, App ID    |
                    +------------------------------------------+
                                         |
                                         | Authenticated REST / Form-data
                                         v
                    +------------------------------------------+
                    |          SWASTHYA NODE.JS SERVER         |
                    |   • Strict MIME, magic byte, size checks |
                    |   • Emergency red flag detection         |
                    |   • Deterministic notification dedupe    |
                    |   • Audit logging & session validation   |
                    |   • 0.0.0.0 host binding on Render       |
                    +------------------------------------------+
                     /             |            \             \
                    /              |             \             \
                   v               v              v             v
            +------------+  +-------------+  +------------+  +--------+
            |  SUPABASE  |  | CLOUDINARY  |  | ONESIGNAL  |  | OPENAI |
            | PostgreSQL |  | Signed API  |  | REST API   |  | API    |
            |    RLS     |  | Backend Only|  | Secret Key |  | Secret |
            +------------+  +-------------+  +------------+  +--------+
```

---

## 2. Service-by-Service Security Controls

### 1. Supabase (Database & Authentication)
- **Zero Service-Role Exposure**: The `SUPABASE_SERVICE_ROLE_KEY` is restricted strictly to backend environment variables. The browser only ever receives a secure HMAC session token or the safe public `SUPABASE_ANON_KEY`.
- **Row Level Security (RLS)**:
  - Enabled on `profiles`, `medicines`, `checkins`, `routines`, `reports`, `chats`, `messages`, `ai_conversations`, `ai_messages`, and `audit_logs`.
  - Patients can only read/write their own records (`patient_id = auth.uid()`).
  - Doctors can only view patient profiles, medicines, and reports of patients *explicitly assigned to them* via `public.doctor_assignments`.
- **Audit Logs**:
  - Doctor access to patient records, chat blocks, and AI conversation deletions are recorded with actor ID, timestamp, resource type, and action.
- **Unique Patient Identifier**:
  - Automatically generated via cryptographically secure randomness: `PT-` + 6 uppercase hex characters (e.g. `PT-9B2F1A`).

### 2. Cloudinary (Medical Photo & Report Storage)
- **Backend-Only Uploads**:
  - Uploads route strictly through `POST /api/upload/medicine-photo` and `POST /api/upload/report`.
  - Cloudinary API Secret (`CLOUDINARY_API_SECRET`) and API Key (`CLOUDINARY_API_KEY`) are NEVER exposed to the frontend.
- **Strict File Validation**:
  - **MIME whitelist**:
    - Medicine photos: `image/jpeg`, `image/png`, `image/webp`.
    - Reports: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`.
  - **Extension whitelist**:
    - Medicine photos: `.jpg`, `.jpeg`, `.png`, `.webp`.
    - Reports: `.pdf`, `.jpg`, `.jpeg`, `.png`, `.webp`.
  - **Binary Magic Byte Inspection**:
    - Validates file headers (`%PDF-`, `FF D8 FF`, `89 50 4E 47`, `RIFF....WEBP`) to stop disguised executable scripts or malicious files.
  - **Size Limits**:
    - Medicine photos: 5MB maximum.
    - Reports: 10MB maximum.

### 3. OneSignal (Background Notifications)
- **Secret Isolation**:
  - `ONESIGNAL_REST_API_KEY` remains strictly on the server.
  - Frontend only receives `ONESIGNAL_APP_ID`.
- **Deterministic Deduplication**:
  - Uses composite keys `rem-med-${patientUid}-${medId}-${date}-${time}` stored in `notification_logs`.
  - Prevents spam or duplicate push notifications.
- **Timezone Awareness**:
  - Evaluates schedules against each patient's specific IANA timezone (e.g. `Asia/Kolkata`).
- **Offline Fallback**:
  - Browser-local notification reminders trigger safely if the device is offline or without internet access.

### 4. OpenAI (Real AI Assistant)
- **Secret Isolation**:
  - `OPENAI_API_KEY` is kept exclusively on the server.
- **Pre-Prompt Emergency Red Flag Shield**:
  - Regular expressions scan every inquiry in English and Hindi for cardiac distress, stroke symptoms, respiratory failure, severe trauma, or acute self-harm.
  - Returns immediate emergency medical alert and local hotline numbers (112, 911, Tele-MANAS 14416).
- **Non-Diagnostic & Non-Prescription Guardrails**:
  - System prompt strictly prohibits diagnosing diseases, prescribing pharmaceutical products, or suggesting dose alterations.
  - Standard evidence-based advice for fever, headache, stomach pain, cancer support, chest pain, and anxiety.
  - Citations to WHO and ICMR clinical standards are attached to responses.
- **Explicit Consent & Right to Erasure**:
  - Conversations are NOT stored unless the user explicitly checks the consent switch.
  - `DELETE /api/assistant/history` allows complete, permanent erasure of stored AI conversations.

### 5. Render Hosting & Operational Security
- **No Local Data in Deployments**:
  - `swasthya-data.json`, `.env`, `*.log`, and temporary uploads are explicitly excluded in `.gitignore`.
- **Network Binding**:
  - Binds strictly to `0.0.0.0` with `PORT` provided by the cloud provider.
- **Structured JSON Logging**:
  - Request logger strips credentials, authorization headers, passwords, and sensitive PII from logs.
- **Production Error Handling**:
  - In production (`NODE_ENV=production`), internal stack traces and server internals are suppressed from user responses.
- **Security Headers**:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`

---

## 3. Security Verification Checklist

| Security Requirement | Status | Verification Mechanism |
| :--- | :---: | :--- |
| Supabase Service-Role Key isolated from client | Verified | Verified in server.js and index.html |
| Row Level Security (RLS) active on all tables | Verified | Tested via supabase-schema.sql policies |
| Unique patient UID generation (`PT-XXXXXX`) | Verified | Tested in test/api.test.js suite |
| Doctor restricted to assigned patients | Verified | Tested in test/api.test.js (403 on unassigned) |
| Mutual doctor-patient chat blocking | Verified | Tested in test/api.test.js (423 Locked) |
| Cloudinary API secret isolated from client | Verified | Server-only upload endpoints |
| MIME, size, extension & magic-byte validation | Verified | Tested in test/api.test.js |
| OneSignal push deduplication across timezones | Verified | Tested in test/api.test.js |
| OpenAI emergency red flag interception | Verified | Tested in test/api.test.js (EN and HI) |
| Non-diagnostic medical safety guardrails | Verified | Tested in test/api.test.js |
| Explicit consent for AI conversation storage | Verified | Tested in test/api.test.js |
| Complete conversation deletion control | Verified | Tested in test/api.test.js |
| Render `0.0.0.0` binding & dynamic port | Verified | Configured in server.js & render.yaml |
| Health check endpoint `/api/health` | Verified | Tested in test/api.test.js |
| Local database files ignored from git | Verified | Configured in .gitignore |

