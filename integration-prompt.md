# Swasthya — production integration prompt

Use the attached Swasthya source code and integrate these five services properly:

## 1. Supabase — database and authentication

- Replace the local `swasthya-data.json` storage with Supabase PostgreSQL.
- Use Supabase Auth for patient and doctor sign-up/login.
- Generate a unique patient UID for every patient.
- Keep separate data per patient: profile, medicines, photos, reports, routines, check-ins and chats.
- Add doctor roles, assigned-patient access, Row Level Security policies and audit logs.
- Use the included `supabase-schema.sql` as the starting migration.
- Never expose the Supabase service-role key in frontend code.

## 2. Cloudinary — medicine and report photos

- Replace Base64 image storage with Cloudinary uploads.
- Upload medicine photos and report files through the backend only.
- Store only the secure Cloudinary URL, public ID and metadata in Supabase.
- Validate MIME type, file size and file extension.
- Do not expose Cloudinary API secrets in the browser.

## 3. OneSignal — background notifications

- Add OneSignal web push notifications.
- Send medicine reminders even when the browser tab is closed.
- Send daily health quotes and routine reminders.
- Use the patient timezone and prevent duplicate notifications.
- Ask for browser permission clearly and provide notification settings.
- Keep local notifications as an offline fallback.

## 4. OpenAI — real assistant

- Move the current rule-based assistant to a secure backend API.
- Keep the OpenAI API key only in server environment variables.
- Support Hindi and English responses and voice input/output.
- Add safe guidance for fever, headache, stomach pain, cancer support, chest/heart pain and anxiety/overthinking.
- Never diagnose, prescribe, or tell users to change medication doses.
- Detect emergency red flags and advise local emergency care immediately.
- Add source/date metadata for medical information where applicable.
- Store conversations only with explicit consent and provide deletion controls.

## 5. Render — hosting

- Deploy the Node.js backend and frontend on Render.
- Use `npm install` as the build command and `npm start` as the start command.
- Configure all secrets through Render environment variables.
- Required variables should include Supabase URL/key, Cloudinary credentials, OneSignal settings, OpenAI API key and a strong session secret.
- Set the server host to `0.0.0.0` and use Render's `PORT` variable.
- Add health checks, structured logs and a production error handler.
- Do not deploy `swasthya-data.json`, API keys, passwords or real patient data.

## Acceptance requirements

- Patient and doctor accounts are separate and permission-protected.
- A patient can create a unique UID, upload a medicine photo, receive a reminder and chat with an assigned doctor.
- A doctor can only view assigned patients and can block/unblock conversations.
- The assistant works in Hindi and English and gives emergency-safe responses.
- Photos are stored in Cloudinary, records in Supabase, notifications in OneSignal, AI calls on the backend, and the app is deployed on Render.
- Include tests, `.env.example`, migration instructions, deployment instructions and a security checklist.
- Do not call the system production-ready until authentication, RLS, storage permissions, notification delivery and tests are verified.
