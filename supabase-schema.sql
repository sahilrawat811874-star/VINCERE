-- ============================================================================
-- Swasthya Core Production Schema for Supabase PostgreSQL
-- ============================================================================
-- Execute this migration script in:
-- Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. PROFILES
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  patient_uid text unique not null default ('PT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  full_name text not null,
  emergency_contact text,
  role text not null default 'patient' check (role in ('patient', 'doctor', 'admin')),
  specialty text,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for UID lookup and role queries
create index if not exists idx_profiles_patient_uid on public.profiles(patient_uid);
create index if not exists idx_profiles_role on public.profiles(role);

-- ----------------------------------------------------------------------------
-- 2. DOCTOR-PATIENT ASSIGNMENTS
-- ----------------------------------------------------------------------------
create table if not exists public.doctor_assignments (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'inactive', 'transferred')),
  assigned_at timestamptz not null default now(),
  unique(doctor_id, patient_id)
);

create index if not exists idx_assignments_doctor on public.doctor_assignments(doctor_id);
create index if not exists idx_assignments_patient on public.doctor_assignments(patient_id);

-- ----------------------------------------------------------------------------
-- 3. MEDICINES (Cloudinary backed)
-- ----------------------------------------------------------------------------
create table if not exists public.medicines (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  instruction text not null default 'As prescribed',
  reminder_time time not null default '09:00',
  photo_url text,               -- Cloudinary secure URL
  photo_public_id text,         -- Cloudinary public_id
  photo_metadata jsonb default '{}'::jsonb,
  taken boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_medicines_patient on public.medicines(patient_id);
create index if not exists idx_medicines_reminder on public.medicines(reminder_time);

-- ----------------------------------------------------------------------------
-- 4. CHECKINS
-- ----------------------------------------------------------------------------
create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  mood text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_checkins_patient on public.checkins(patient_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 5. ROUTINES
-- ----------------------------------------------------------------------------
create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  reminder_time time not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_routines_patient on public.routines(patient_id);

-- ----------------------------------------------------------------------------
-- 6. REPORTS (Cloudinary backed)
-- ----------------------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  file_name text not null,
  file_url text not null,       -- Cloudinary secure URL
  public_id text not null,      -- Cloudinary public ID
  file_type text not null,      -- MIME type (e.g. application/pdf, image/jpeg)
  file_size integer not null,   -- size in bytes
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_reports_patient on public.reports(patient_id);

-- ----------------------------------------------------------------------------
-- 7. CHATS & MESSAGES
-- ----------------------------------------------------------------------------
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  doctor_id uuid references public.profiles(id) on delete set null,
  blocked_by text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chats_patient on public.chats(patient_id);
create index if not exists idx_chats_doctor on public.chats(doctor_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_role text not null check (sender_role in ('patient', 'doctor')),
  sender_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_chat on public.messages(chat_id, created_at asc);

-- ----------------------------------------------------------------------------
-- 8. ONESIGNAL NOTIFICATION SETTINGS & LOGS
-- ----------------------------------------------------------------------------
create table if not exists public.notification_preferences (
  patient_id uuid primary key references public.profiles(id) on delete cascade,
  onesignal_player_id text,
  timezone text not null default 'Asia/Kolkata',
  medicine_reminders boolean not null default true,
  routine_reminders boolean not null default true,
  daily_quotes boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,                  -- 'medicine', 'routine', 'quote'
  dedupe_key text not null unique,     -- e.g. 'med-123-2026-10-31-09:00'
  title text not null,
  body text not null,
  sent_at timestamptz not null default now()
);

create index if not exists idx_notif_logs_dedupe on public.notification_logs(dedupe_key);

-- ----------------------------------------------------------------------------
-- 9. AI CARE ASSISTANT (Explicit consent & deletion controls)
-- ----------------------------------------------------------------------------
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  consent_given boolean not null default false,
  language text not null default 'en-IN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  patient_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  is_emergency boolean not null default false,
  safety_flags jsonb default '[]'::jsonb,
  citations jsonb default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_messages_patient on public.ai_messages(patient_id);
create index if not exists idx_ai_messages_conv on public.ai_messages(conversation_id);

-- ----------------------------------------------------------------------------
-- 10. CAREGIVER ACCESS & AUDIT LOGS
-- ----------------------------------------------------------------------------
create table if not exists public.caregiver_access (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  caregiver_email text not null,
  can_view_medicines boolean not null default false,
  can_view_emergency_contact boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  details jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_actor on public.audit_logs(actor_id);
create index if not exists idx_audit_created on public.audit_logs(created_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.doctor_assignments enable row level security;
alter table public.medicines enable row level security;
alter table public.checkins enable row level security;
alter table public.routines enable row level security;
alter table public.reports enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_logs enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.caregiver_access enable row level security;
alter table public.audit_logs enable row level security;

-- PROFILES RLS
drop policy if exists "profile owner can read own profile" on public.profiles;
drop policy if exists "profile owner and assigned participants can read profile" on public.profiles;
create policy "profile owner and assigned participants can read profile" on public.profiles
  for select using (
    id = auth.uid() or
    role = 'doctor' or
    exists (
      select 1 from public.doctor_assignments da
      where (da.doctor_id = auth.uid() and da.patient_id = public.profiles.id and da.status = 'active')
         or (da.patient_id = auth.uid() and da.doctor_id = public.profiles.id and da.status = 'active')
    )
  );

drop policy if exists "profile owner can update own profile" on public.profiles;
create policy "profile owner can update own profile" on public.profiles
  for update using (id = auth.uid());

drop policy if exists "user can create own profile" on public.profiles;
create policy "user can create own profile" on public.profiles
  for insert with check (id = auth.uid());

-- DOCTOR ASSIGNMENTS RLS
drop policy if exists "participants can read doctor assignments" on public.doctor_assignments;
create policy "participants can read doctor assignments" on public.doctor_assignments
  for select using (doctor_id = auth.uid() or patient_id = auth.uid());

drop policy if exists "participants can insert doctor assignments" on public.doctor_assignments;
create policy "participants can insert doctor assignments" on public.doctor_assignments
  for insert with check (doctor_id = auth.uid() or patient_id = auth.uid());

-- MEDICINES RLS (Patient owns; Assigned doctor can read)
drop policy if exists "patient owns medicines" on public.medicines;
create policy "patient owns medicines" on public.medicines
  for all using (patient_id = auth.uid()) with check (patient_id = auth.uid());

drop policy if exists "assigned doctor can view medicines" on public.medicines;
create policy "assigned doctor can view medicines" on public.medicines
  for select using (
    exists (
      select 1 from public.doctor_assignments da
      where da.doctor_id = auth.uid() and da.patient_id = public.medicines.patient_id and da.status = 'active'
    )
  );

-- CHECKINS RLS
drop policy if exists "patient owns checkins" on public.checkins;
create policy "patient owns checkins" on public.checkins
  for all using (patient_id = auth.uid()) with check (patient_id = auth.uid());

drop policy if exists "assigned doctor can view checkins" on public.checkins;
create policy "assigned doctor can view checkins" on public.checkins
  for select using (
    exists (
      select 1 from public.doctor_assignments da
      where da.doctor_id = auth.uid() and da.patient_id = public.checkins.patient_id and da.status = 'active'
    )
  );

-- ROUTINES RLS
drop policy if exists "patient owns routines" on public.routines;
create policy "patient owns routines" on public.routines
  for all using (patient_id = auth.uid()) with check (patient_id = auth.uid());

drop policy if exists "assigned doctor can view routines" on public.routines;
create policy "assigned doctor can view routines" on public.routines
  for select using (
    exists (
      select 1 from public.doctor_assignments da
      where da.doctor_id = auth.uid() and da.patient_id = public.routines.patient_id and da.status = 'active'
    )
  );

-- REPORTS RLS
drop policy if exists "patient owns reports" on public.reports;
create policy "patient owns reports" on public.reports
  for all using (patient_id = auth.uid()) with check (patient_id = auth.uid());

drop policy if exists "assigned doctor can view reports" on public.reports;
create policy "assigned doctor can view reports" on public.reports
  for select using (
    exists (
      select 1 from public.doctor_assignments da
      where da.doctor_id = auth.uid() and da.patient_id = public.reports.patient_id and da.status = 'active'
    )
  );

-- CHATS RLS
drop policy if exists "chat participant can read" on public.chats;
create policy "chat participant can read" on public.chats
  for select using (patient_id = auth.uid() or doctor_id = auth.uid());

drop policy if exists "patient can create chat" on public.chats;
drop policy if exists "chat participant can insert" on public.chats;
create policy "chat participant can insert" on public.chats
  for insert with check (patient_id = auth.uid() or doctor_id = auth.uid());

drop policy if exists "chat participant can update" on public.chats;
create policy "chat participant can update" on public.chats
  for update using (patient_id = auth.uid() or doctor_id = auth.uid());

-- MESSAGES RLS
drop policy if exists "chat participant can read messages" on public.messages;
create policy "chat participant can read messages" on public.messages
  for select using (
    exists (
      select 1 from public.chats c
      where c.id = chat_id and (c.patient_id = auth.uid() or c.doctor_id = auth.uid())
    )
  );

drop policy if exists "chat participant can send messages" on public.messages;
create policy "chat participant can send messages" on public.messages
  for insert with check (
    sender_id = auth.uid() and
    exists (
      select 1 from public.chats c
      where c.id = chat_id and (c.patient_id = auth.uid() or c.doctor_id = auth.uid())
      and coalesce(array_length(c.blocked_by, 1), 0) = 0
    )
  );

-- NOTIFICATIONS RLS
drop policy if exists "patient owns notification preferences" on public.notification_preferences;
create policy "patient owns notification preferences" on public.notification_preferences
  for all using (patient_id = auth.uid()) with check (patient_id = auth.uid());

drop policy if exists "patient owns notification logs" on public.notification_logs;
create policy "patient owns notification logs" on public.notification_logs
  for select using (patient_id = auth.uid());

-- AI CONVERSATIONS & MESSAGES RLS (Strict patient privacy)
drop policy if exists "patient owns ai conversations" on public.ai_conversations;
create policy "patient owns ai conversations" on public.ai_conversations
  for all using (patient_id = auth.uid()) with check (patient_id = auth.uid());

drop policy if exists "patient owns ai messages" on public.ai_messages;
create policy "patient owns ai messages" on public.ai_messages
  for all using (patient_id = auth.uid()) with check (patient_id = auth.uid());

-- CAREGIVER ACCESS RLS
drop policy if exists "patient owns caregiver access" on public.caregiver_access;
create policy "patient owns caregiver access" on public.caregiver_access
  for all using (patient_id = auth.uid()) with check (patient_id = auth.uid());

-- AUDIT LOGS RLS
drop policy if exists "actor can read own audit logs" on public.audit_logs;
create policy "actor can read own audit logs" on public.audit_logs
  for select using (actor_id = auth.uid());

drop policy if exists "authenticated users can insert audit logs" on public.audit_logs;
create policy "authenticated users can insert audit logs" on public.audit_logs
  for insert with check (actor_id = auth.uid());

-- ============================================================================
-- AUTH HOOK TRIGGER: Automatic Profile Creation on Sign-up
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  user_role text;
  user_name text;
  assigned_doctor_id uuid;
begin
  user_role := coalesce(new.raw_user_meta_data->>'role', 'patient');
  user_name := coalesce(new.raw_user_meta_data->>'full_name', 'Patient');
  
  insert into public.profiles (id, full_name, role)
  values (new.id, user_name, user_role)
  on conflict (id) do update
  set full_name = excluded.full_name, role = excluded.role;

  -- Custom UID prefix for doctors
  if user_role = 'doctor' then
    update public.profiles
    set patient_uid = ('DOC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)))
    where id = new.id;
  end if;

  -- Auto-assign patient to default online doctor if patient role
  if user_role = 'patient' then
    select id into assigned_doctor_id from public.profiles where role = 'doctor' limit 1;
    if assigned_doctor_id is not null then
      insert into public.doctor_assignments (doctor_id, patient_id)
      values (assigned_doctor_id, new.id)
      on conflict do nothing;

      -- Seed an initial chat
      insert into public.chats (patient_id, doctor_id)
      values (new.id, assigned_doctor_id)
      on conflict do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
