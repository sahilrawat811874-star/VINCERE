# Supabase PostgreSQL Migration Guide — Swasthya

This guide explains how to migrate Swasthya from the local prototype store to production Supabase PostgreSQL with full Row Level Security (RLS), role-based permissions, and automated profile triggers.

---

## 1. Prerequisites

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Note down your credentials from **Project Settings -> API**:
   - `Project URL` (`SUPABASE_URL`)
   - `anon public` key (`SUPABASE_ANON_KEY`)
   - `service_role secret` key (`SUPABASE_SERVICE_ROLE_KEY`)

> [!IMPORTANT]
> Keep `service_role` secret strictly on your backend server (Render environment variables or `.env`). Never expose it to the browser or commit it to GitHub.

---

## 2. Execute the Migration Schema

Open your Supabase dashboard:
1. Navigate to **SQL Editor** in the left sidebar.
2. Click **+ New query**.
3. Copy the entire contents of [`supabase-schema.sql`](file:///c:/Users/HP/Downloads/VINCERE/supabase-schema.sql) into the editor.
4. Click **Run** (or `Ctrl + Enter`).

---

## 3. What the Schema Sets Up

### Tables Created
- `public.profiles`: Stores patient and doctor accounts, roles (`patient`, `doctor`, `admin`), unique `patient_uid` (e.g. `PT-XXXXXX`), and timezone.
- `public.doctor_assignments`: Maps patients to assigned doctors. Enforces clinical assignment boundaries.
- `public.medicines`: Stores patient medicines, instruction, reminder time, and Cloudinary photo metadata (`photo_url`, `photo_public_id`).
- `public.reports`: Stores lab reports, prescriptions, file sizes, MIME types, and Cloudinary metadata.
- `public.checkins`: Daily mood records and symptom notes.
- `public.routines`: Daily routine reminders (walk, water, breathing exercises).
- `public.chats` & `public.messages`: Real-time and persistent patient-doctor communication with mutual `blocked_by` array.
- `public.notification_preferences`: OneSignal player IDs, timezone, and reminder switches.
- `public.notification_logs`: Stores deterministic deduplication keys (`dedupe_key`) preventing duplicate notifications.
- `public.ai_conversations` & `public.ai_messages`: Stores AI care assistant dialogue **only when explicit consent is given**.
- `public.caregiver_access`: Granular sharing settings for family and caregivers.
- `public.audit_logs`: Records audit events when doctors view patient profiles or medical reports.

### Automated Triggers
- `on_auth_user_created`: When a new user registers via Supabase Auth, trigger `handle_new_user()` creates their row in `public.profiles` automatically, generating a unique `patient_uid` and assigning an initial online doctor.

---

## 4. Row Level Security (RLS) Verification

Execute these verification queries in the SQL Editor to ensure RLS is active:

```sql
-- Verify RLS is enabled on all core tables
select relname, relrowsecurity
from pg_class
where relname in (
  'profiles', 'doctor_assignments', 'medicines', 'checkins',
  'routines', 'reports', 'chats', 'messages', 'notification_preferences',
  'ai_conversations', 'ai_messages', 'audit_logs'
);
```
All rows must return `relrowsecurity = true`.

---

## 5. Seed Initial Doctor Account (Optional)

To test the doctor portal immediately with verified clinician credentials:

```sql
-- 1. Create doctor in auth.users (or sign up via /api/auth/register with role 'doctor')
-- 2. Verify role in public.profiles:
select id, patient_uid, full_name, role, specialty from public.profiles where role = 'doctor';
```

---

## 6. Migration Rollback (If needed)

To reset the database tables if you need to rerun the migration cleanly:

```sql
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

drop table if exists public.audit_logs cascade;
drop table if exists public.caregiver_access cascade;
drop table if exists public.ai_messages cascade;
drop table if exists public.ai_conversations cascade;
drop table if exists public.notification_logs cascade;
drop table if exists public.notification_preferences cascade;
drop table if exists public.messages cascade;
drop table if exists public.chats cascade;
drop table if exists public.reports cascade;
drop table if exists public.routines cascade;
drop table if exists public.checkins cascade;
drop table if exists public.medicines cascade;
drop table if exists public.doctor_assignments cascade;
drop table if exists public.profiles cascade;
```

