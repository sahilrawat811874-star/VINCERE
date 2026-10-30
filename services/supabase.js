/**
 * Swasthya - Supabase PostgreSQL Database & Authentication Service
 * 
 * Manages patients, doctors, assignments, medicines, reports,
 * checkins, routines, chats, notifications, AI history, and audit logs.
 * Supports live Supabase connection with secure fallback for local offline testing.
 */

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// In-memory isolated state for offline fallback or test environments
const localStore = {
  profiles: new Map(),
  users: new Map(), // email -> { id, passwordHash, role }
  doctorAssignments: [],
  medicines: new Map(), // patientId -> []
  checkins: new Map(),  // patientId -> []
  routines: new Map(),  // patientId -> []
  reports: new Map(),   // patientId -> []
  chats: new Map(),     // chatId -> chat
  messages: new Map(),  // chatId -> []
  notificationPrefs: new Map(), // patientId -> prefs
  notificationLogs: new Set(),  // dedupeKey set
  aiConversations: new Map(), // patientId -> conv
  aiMessages: new Map(),      // convId -> []
  auditLogs: []
};

// Seed default demo doctor
const DEFAULT_DOCTOR_ID = 'DR-MEERA-SHARMA-001';
localStore.profiles.set(DEFAULT_DOCTOR_ID, {
  id: DEFAULT_DOCTOR_ID,
  patient_uid: 'DOC-001',
  full_name: 'Dr. Meera Sharma',
  role: 'doctor',
  specialty: 'General physician',
  emergency_contact: '+91 98765 43210',
  timezone: 'Asia/Kolkata',
  created_at: new Date('2026-10-01T00:00:00Z').toISOString()
});
localStore.users.set('doctor@demo.com', {
  id: DEFAULT_DOCTOR_ID,
  passwordHash: hashPassword('doctor123'),
  role: 'doctor',
  email: 'doctor@demo.com'
});

// Seed default demo patient
const DEFAULT_PATIENT_ID = 'PT-DEMO-2026-001';
localStore.profiles.set(DEFAULT_PATIENT_ID, {
  id: DEFAULT_PATIENT_ID,
  patient_uid: 'PT-2026-001',
  full_name: 'Ananya Verma',
  role: 'patient',
  specialty: null,
  emergency_contact: '+91 91234 56789',
  timezone: 'Asia/Kolkata',
  created_at: new Date('2026-10-01T00:00:00Z').toISOString()
});
localStore.users.set('patient@demo.com', {
  id: DEFAULT_PATIENT_ID,
  passwordHash: hashPassword('patient123'),
  role: 'patient',
  email: 'patient@demo.com'
});

// Seed assignment between demo doctor and demo patient
localStore.doctorAssignments.push({
  id: 'ASSIGN-001',
  doctor_id: DEFAULT_DOCTOR_ID,
  patient_id: DEFAULT_PATIENT_ID,
  status: 'active',
  assigned_at: new Date().toISOString()
});

// Seed initial medicines
localStore.medicines.set(DEFAULT_PATIENT_ID, [
  { id: 'med-vit-d3', patient_id: DEFAULT_PATIENT_ID, name: 'Vitamin D3', instruction: '1 capsule · After lunch', reminder_time: '14:00', taken: false, photo_url: '', created_at: new Date().toISOString() },
  { id: 'med-metformin', patient_id: DEFAULT_PATIENT_ID, name: 'Metformin', instruction: '1 tablet · After dinner', reminder_time: '20:00', taken: false, photo_url: '', created_at: new Date().toISOString() },
  { id: 'med-omega3', patient_id: DEFAULT_PATIENT_ID, name: 'Omega-3', instruction: '1 capsule · Morning', reminder_time: '08:00', taken: true, photo_url: '', created_at: new Date().toISOString() }
]);

// Seed initial reports
localStore.reports.set(DEFAULT_PATIENT_ID, [
  { id: 'rep-blood-test', patient_id: DEFAULT_PATIENT_ID, file_name: 'Blood test report.pdf', file_url: 'https://res.cloudinary.com/demo/image/upload/sample.pdf', public_id: 'sample-report', file_type: 'application/pdf', file_size: 245000, created_at: new Date('2026-10-21T00:00:00Z').toISOString() }
]);

// Seed initial chat
const DEFAULT_CHAT_ID = 'CHAT-DEMO-001';
localStore.chats.set(DEFAULT_CHAT_ID, {
  id: DEFAULT_CHAT_ID,
  patient_id: DEFAULT_PATIENT_ID,
  doctor_id: DEFAULT_DOCTOR_ID,
  blocked_by: [],
  created_at: new Date('2026-10-30T09:00:00Z').toISOString(),
  updated_at: new Date('2026-10-30T09:00:00Z').toISOString()
});
localStore.messages.set(DEFAULT_CHAT_ID, [
  {
    id: 'msg-welcome',
    chat_id: DEFAULT_CHAT_ID,
    sender_id: DEFAULT_DOCTOR_ID,
    sender_role: 'doctor',
    sender_name: 'Dr. Meera Sharma',
    body: 'Hello! I am here to help you understand your symptoms and next steps. Please share what you are experiencing.',
    created_at: new Date('2026-10-30T09:00:00Z').toISOString()
  }
]);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const bufA = Buffer.from(actual, 'hex');
  const bufB = Buffer.from(hash || '', 'hex');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function generatePatientUID() {
  const hex = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `PT-${hex}`;
}

let supabaseClient = null;
function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (SUPABASE_URL && (SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY)) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      // Use service-role key on the backend for administrative operations and RLS enforcement verification
      supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      return supabaseClient;
    } catch (err) {
      console.warn('[Supabase] Warning: @supabase/supabase-js not loaded, using robust internal database repository:', err.message);
    }
  }
  return null;
}

const SupabaseService = {
  isConfigured() {
    return Boolean(SUPABASE_URL && (SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY));
  },

  async createUser({ email, password, fullName, role = 'patient', specialty = null }) {
    const normEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(fullName || '').trim() || (role === 'doctor' ? 'Doctor' : 'Patient');
    const validRole = role === 'doctor' ? 'doctor' : 'patient';

    const client = getSupabaseClient();
    if (client) {
      try {
        const { data: authData, error: authErr } = await client.auth.admin.createUser({
          email: normEmail,
          password: password,
          email_confirm: true,
          user_metadata: { full_name: cleanName, role: validRole, specialty }
        });
        if (authErr) throw authErr;

        const uid = validRole === 'patient' ? generatePatientUID() : `DOC-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
        const { data: profileData, error: profErr } = await client
          .from('profiles')
          .insert({
            id: authData.user.id,
            patient_uid: uid,
            full_name: cleanName,
            role: validRole,
            specialty: specialty || (validRole === 'doctor' ? 'General physician' : null)
          })
          .select()
          .single();
        if (profErr) throw profErr;

        // Auto-assign doctor if patient
        if (validRole === 'patient') {
          const { data: docs } = await client.from('profiles').select('id').eq('role', 'doctor').limit(1);
          if (docs && docs[0]) {
            await client.from('doctor_assignments').insert({ doctor_id: docs[0].id, patient_id: authData.user.id });
            await client.from('chats').insert({ patient_id: authData.user.id, doctor_id: docs[0].id });
          }
        }

        return { id: authData.user.id, email: normEmail, patientUid: uid, fullName: cleanName, role: validRole };
      } catch (err) {
        console.warn('[Supabase] Cloud user creation failed, falling back to local store:', err.message);
      }
    }

    // Local / offline repository logic
    if (localStore.users.has(normEmail)) {
      throw new Error('An account with this email already exists.');
    }

    const userId = crypto.randomUUID();
    const patientUid = validRole === 'patient' ? generatePatientUID() : `DOC-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const profile = {
      id: userId,
      patient_uid: patientUid,
      full_name: cleanName,
      role: validRole,
      specialty: specialty || (validRole === 'doctor' ? 'General physician' : null),
      emergency_contact: '',
      timezone: 'Asia/Kolkata',
      created_at: new Date().toISOString()
    };

    localStore.users.set(normEmail, {
      id: userId,
      passwordHash: hashPassword(password),
      role: validRole,
      email: normEmail
    });
    localStore.profiles.set(userId, profile);

    // Auto-assign to default doctor if patient
    if (validRole === 'patient') {
      localStore.doctorAssignments.push({
        id: crypto.randomUUID(),
        doctor_id: DEFAULT_DOCTOR_ID,
        patient_id: userId,
        status: 'active',
        assigned_at: new Date().toISOString()
      });
      const newChatId = crypto.randomUUID();
      localStore.chats.set(newChatId, {
        id: newChatId,
        patient_id: userId,
        doctor_id: DEFAULT_DOCTOR_ID,
        blocked_by: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      localStore.messages.set(newChatId, []);
    }

    return { id: userId, email: normEmail, patientUid, fullName: cleanName, role: validRole };
  },

  async authenticateUser({ email, password, role }) {
    const normEmail = String(email || '').trim().toLowerCase();
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data: authData, error: authErr } = await client.auth.signInWithPassword({
          email: normEmail,
          password: password
        });
        if (!authErr && authData && authData.user) {
          const { data: prof } = await client
            .from('profiles')
            .select('*')
            .eq('id', authData.user.id)
            .single();
          if (prof) {
            if (role && prof.role !== role) {
              throw new Error(`Access denied. Role mismatch for this account.`);
            }
            return {
              id: prof.id,
              email: normEmail,
              patientUid: prof.patient_uid,
              fullName: prof.full_name,
              role: prof.role,
              specialty: prof.specialty
            };
          }
        }
      } catch (err) {
        console.warn('[Supabase] Cloud auth check failed, verifying local repository:', err.message);
      }
    }

    // Local / offline verification
    const account = localStore.users.get(normEmail);
    if (!account || !verifyPassword(password, account.passwordHash)) {
      throw new Error('Invalid email or password.');
    }
    if (role && account.role !== role) {
      throw new Error(`Access denied: expected role '${role}'.`);
    }

    const profile = localStore.profiles.get(account.id);
    return {
      id: account.id,
      email: normEmail,
      patientUid: profile ? profile.patient_uid : 'PT-UNKNOWN',
      fullName: profile ? profile.full_name : 'User',
      role: account.role,
      specialty: profile ? profile.specialty : null
    };
  },

  async getProfile(userId) {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client.from('profiles').select('*').eq('id', userId).single();
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    return localStore.profiles.get(userId) || null;
  },

  async getProfileByUid(uid) {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client.from('profiles').select('*').eq('patient_uid', uid).single();
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    for (const p of localStore.profiles.values()) {
      if (p.patient_uid === uid) return p;
    }
    return null;
  },

  async updateProfile(userId, { fullName, emergencyContact, timezone }) {
    const client = getSupabaseClient();
    if (client) {
      try {
        const updates = {};
        if (fullName !== undefined) updates.full_name = fullName;
        if (emergencyContact !== undefined) updates.emergency_contact = emergencyContact;
        if (timezone !== undefined) updates.timezone = timezone;
        updates.updated_at = new Date().toISOString();
        const { data } = await client.from('profiles').update(updates).eq('id', userId).select().single();
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    const prof = localStore.profiles.get(userId);
    if (prof) {
      if (fullName !== undefined) prof.full_name = fullName;
      if (emergencyContact !== undefined) prof.emergency_contact = emergencyContact;
      if (timezone !== undefined) prof.timezone = timezone;
      prof.updated_at = new Date().toISOString();
      return prof;
    }
    return null;
  },

  async getPatientData(patientId) {
    const profile = await this.getProfile(patientId);
    let medicines = localStore.medicines.get(patientId) || [];
    let checkins = localStore.checkins.get(patientId) || [];
    let routines = localStore.routines.get(patientId) || [];
    let reports = localStore.reports.get(patientId) || [];

    const client = getSupabaseClient();
    if (client) {
      try {
        const [mRes, cRes, rRes, repRes] = await Promise.all([
          client.from('medicines').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
          client.from('checkins').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
          client.from('routines').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
          client.from('reports').select('*').eq('patient_id', patientId).order('created_at', { ascending: false })
        ]);
        if (mRes.data) medicines = mRes.data;
        if (cRes.data) checkins = cRes.data;
        if (rRes.data) routines = rRes.data;
        if (repRes.data) reports = repRes.data;
      } catch (e) { /* fallback */ }
    }

    const doctors = Array.from(localStore.profiles.values()).filter(p => p.role === 'doctor');
    return {
      patientId: profile ? profile.patient_uid : patientId,
      profile: {
        name: profile ? profile.full_name : '',
        emergencyContact: profile ? profile.emergency_contact : '',
        timezone: profile ? profile.timezone : 'Asia/Kolkata'
      },
      medicines,
      checkins,
      routines,
      reports,
      doctors
    };
  },

  async addMedicine(patientId, { name, instruction, reminder_time, photo_url, photo_public_id, photo_metadata }) {
    const id = crypto.randomUUID();
    const item = {
      id,
      patient_id: patientId,
      name,
      instruction: instruction || 'As prescribed',
      reminder_time: reminder_time || '09:00',
      photo_url: photo_url || '',
      photo_public_id: photo_public_id || null,
      photo_metadata: photo_metadata || {},
      taken: false,
      created_at: new Date().toISOString()
    };

    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client.from('medicines').insert(item).select().single();
        if (data) return data;
      } catch (e) { /* fallback */ }
    }

    const list = localStore.medicines.get(patientId) || [];
    list.unshift(item);
    localStore.medicines.set(patientId, list);
    return item;
  },

  async updateMedicine(patientId, medicineId, updates) {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client.from('medicines').update(updates).eq('id', medicineId).eq('patient_id', patientId).select().single();
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    const list = localStore.medicines.get(patientId) || [];
    const item = list.find(m => m.id === medicineId);
    if (!item) return null;
    Object.assign(item, updates, { updated_at: new Date().toISOString() });
    return item;
  },

  async deleteMedicine(patientId, medicineId) {
    const client = getSupabaseClient();
    if (client) {
      try {
        await client.from('medicines').delete().eq('id', medicineId).eq('patient_id', patientId);
      } catch (e) { /* fallback */ }
    }
    const list = localStore.medicines.get(patientId) || [];
    const filtered = list.filter(m => m.id !== medicineId);
    localStore.medicines.set(patientId, filtered);
    return true;
  },

  async addCheckin(patientId, { mood, note }) {
    const item = {
      id: crypto.randomUUID(),
      patient_id: patientId,
      mood: mood || '',
      note: note || '',
      created_at: new Date().toISOString()
    };
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client.from('checkins').insert(item).select().single();
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    const list = localStore.checkins.get(patientId) || [];
    list.unshift(item);
    localStore.checkins.set(patientId, list);
    return item;
  },

  async addRoutine(patientId, { title, reminder_time }) {
    const item = {
      id: crypto.randomUUID(),
      patient_id: patientId,
      title: title || 'Daily routine',
      reminder_time: reminder_time || '08:00',
      created_at: new Date().toISOString()
    };
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client.from('routines').insert(item).select().single();
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    const list = localStore.routines.get(patientId) || [];
    list.unshift(item);
    localStore.routines.set(patientId, list);
    return item;
  },

  async addReport(patientId, { file_name, file_url, public_id, file_type, file_size, metadata }) {
    const item = {
      id: crypto.randomUUID(),
      patient_id: patientId,
      file_name,
      file_url,
      public_id: public_id || `rep-${Date.now()}`,
      file_type: file_type || 'application/pdf',
      file_size: file_size || 0,
      metadata: metadata || {},
      created_at: new Date().toISOString()
    };
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client.from('reports').insert(item).select().single();
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    const list = localStore.reports.get(patientId) || [];
    list.unshift(item);
    localStore.reports.set(patientId, list);
    return item;
  },

  async getAssignedPatients(doctorId) {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client
          .from('doctor_assignments')
          .select('patient_id, profiles!doctor_assignments_patient_id_fkey(*)')
          .eq('doctor_id', doctorId)
          .eq('status', 'active');
        if (data && data.length) return data.map(d => d.profiles);
      } catch (e) { /* fallback */ }
    }
    const patientIds = localStore.doctorAssignments
      .filter(a => a.doctor_id === doctorId && a.status === 'active')
      .map(a => a.patient_id);
    return patientIds.map(pid => localStore.profiles.get(pid)).filter(Boolean);
  },

  async isDoctorAssignedToPatient(doctorId, patientId) {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client
          .from('doctor_assignments')
          .select('id')
          .eq('doctor_id', doctorId)
          .eq('patient_id', patientId)
          .eq('status', 'active')
          .limit(1);
        if (data && data.length > 0) return true;
      } catch (e) { /* fallback */ }
    }
    return localStore.doctorAssignments.some(
      a => a.doctor_id === doctorId && a.patient_id === patientId && a.status === 'active'
    );
  },

  async getChats(userId, role) {
    const client = getSupabaseClient();
    if (client) {
      try {
        const col = role === 'doctor' ? 'doctor_id' : 'patient_id';
        const { data } = await client.from('chats').select('*, messages(*)').eq(col, userId);
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    const results = [];
    for (const chat of localStore.chats.values()) {
      if ((role === 'doctor' && chat.doctor_id === userId) || (role === 'patient' && chat.patient_id === userId)) {
        const msgs = localStore.messages.get(chat.id) || [];
        results.push({ ...chat, messages: msgs, lastMessage: msgs[msgs.length - 1] || null });
      }
    }
    return results;
  },

  async getChat(chatId) {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client.from('chats').select('*, messages(*)').eq('id', chatId).single();
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    const chat = localStore.chats.get(chatId);
    if (!chat) return null;
    return { ...chat, messages: localStore.messages.get(chatId) || [] };
  },

  async createChat(patientId, doctorId) {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data: existing } = await client.from('chats').select('*').eq('patient_id', patientId).eq('doctor_id', doctorId).single();
        if (existing) return existing;
        const { data: created } = await client.from('chats').insert({ patient_id: patientId, doctor_id: doctorId }).select().single();
        if (created) return created;
      } catch (e) { /* fallback */ }
    }
    for (const chat of localStore.chats.values()) {
      if (chat.patient_id === patientId && chat.doctor_id === doctorId) return chat;
    }
    const id = crypto.randomUUID();
    const chat = { id, patient_id: patientId, doctor_id: doctorId, blocked_by: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    localStore.chats.set(id, chat);
    localStore.messages.set(id, []);
    return chat;
  },

  async sendMessage(chatId, senderId, senderRole, senderName, body) {
    const client = getSupabaseClient();
    const msg = {
      id: crypto.randomUUID(),
      chat_id: chatId,
      sender_id: senderId,
      sender_role: senderRole,
      sender_name: senderName,
      body,
      created_at: new Date().toISOString()
    };
    if (client) {
      try {
        const { data } = await client.from('messages').insert(msg).select().single();
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    const list = localStore.messages.get(chatId) || [];
    list.push(msg);
    localStore.messages.set(chatId, list);
    return msg;
  },

  async setChatBlocked(chatId, byRole, isBlocked) {
    const client = getSupabaseClient();
    const chat = await this.getChat(chatId);
    if (!chat) return null;
    let blockedBy = Array.isArray(chat.blocked_by) ? [...chat.blocked_by] : [];
    if (isBlocked && !blockedBy.includes(byRole)) blockedBy.push(byRole);
    if (!isBlocked) blockedBy = blockedBy.filter(x => x !== byRole);

    if (client) {
      try {
        const { data } = await client.from('chats').update({ blocked_by: blockedBy, updated_at: new Date().toISOString() }).eq('id', chatId).select().single();
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    chat.blocked_by = blockedBy;
    localStore.chats.set(chatId, chat);
    return chat;
  },

  async logAudit(actorId, action, resourceType, resourceId, details = {}) {
    const entry = {
      id: crypto.randomUUID(),
      actor_id: actorId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      details,
      created_at: new Date().toISOString()
    };
    const client = getSupabaseClient();
    if (client) {
      try {
        await client.from('audit_logs').insert(entry);
      } catch (e) { /* fallback */ }
    }
    localStore.auditLogs.unshift(entry);
    return entry;
  },

  async saveNotificationPreferences(patientId, prefs) {
    const payload = {
      patient_id: patientId,
      onesignal_player_id: prefs.onesignalPlayerId || null,
      timezone: prefs.timezone || 'Asia/Kolkata',
      medicine_reminders: prefs.medicineReminders !== false,
      routine_reminders: prefs.routineReminders !== false,
      daily_quotes: prefs.dailyQuotes !== false,
      updated_at: new Date().toISOString()
    };
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client.from('notification_preferences').upsert(payload).select().single();
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    localStore.notificationPrefs.set(patientId, payload);
    return payload;
  },

  async getNotificationPreferences(patientId) {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client.from('notification_preferences').select('*').eq('patient_id', patientId).single();
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    return localStore.notificationPrefs.get(patientId) || {
      patient_id: patientId,
      timezone: 'Asia/Kolkata',
      medicine_reminders: true,
      routine_reminders: true,
      daily_quotes: true
    };
  },

  async getAllActiveNotificationPreferences() {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client.from('notification_preferences').select('*');
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    return Array.from(localStore.notificationPrefs.values());
  },

  async isNotificationLogged(dedupeKey) {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client.from('notification_logs').select('id').eq('dedupe_key', dedupeKey).single();
        if (data) return true;
      } catch (e) { /* fallback */ }
    }
    return localStore.notificationLogs.has(dedupeKey);
  },

  async logNotification(patientId, type, dedupeKey, title, body) {
    const client = getSupabaseClient();
    const entry = {
      id: crypto.randomUUID(),
      patient_id: patientId,
      type,
      dedupe_key: dedupeKey,
      title,
      body,
      sent_at: new Date().toISOString()
    };
    if (client) {
      try {
        await client.from('notification_logs').insert(entry);
      } catch (e) { /* fallback */ }
    }
    localStore.notificationLogs.add(dedupeKey);
    return entry;
  },

  async saveAiMessage(patientId, { role, content, isEmergency = false, safetyFlags = [], citations = [] }) {
    let conv = localStore.aiConversations.get(patientId);
    if (!conv) {
      conv = {
        id: crypto.randomUUID(),
        patient_id: patientId,
        consent_given: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      localStore.aiConversations.set(patientId, conv);
      localStore.aiMessages.set(conv.id, []);
    }

    const msg = {
      id: crypto.randomUUID(),
      conversation_id: conv.id,
      patient_id: patientId,
      role,
      content,
      is_emergency: isEmergency,
      safety_flags: safetyFlags,
      citations,
      created_at: new Date().toISOString()
    };

    const client = getSupabaseClient();
    if (client) {
      try {
        await client.from('ai_messages').insert(msg);
      } catch (e) { /* fallback */ }
    }

    const list = localStore.aiMessages.get(conv.id) || [];
    list.push(msg);
    localStore.aiMessages.set(conv.id, list);
    return msg;
  },

  async getAiHistory(patientId) {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client.from('ai_messages').select('*').eq('patient_id', patientId).order('created_at', { ascending: true });
        if (data) return data;
      } catch (e) { /* fallback */ }
    }
    const conv = localStore.aiConversations.get(patientId);
    if (!conv) return [];
    return localStore.aiMessages.get(conv.id) || [];
  },

  async deleteAiHistory(patientId) {
    const client = getSupabaseClient();
    if (client) {
      try {
        await client.from('ai_messages').delete().eq('patient_id', patientId);
        await client.from('ai_conversations').delete().eq('patient_id', patientId);
      } catch (e) { /* fallback */ }
    }
    const conv = localStore.aiConversations.get(patientId);
    if (conv) {
      localStore.aiMessages.delete(conv.id);
      localStore.aiConversations.delete(patientId);
    }
    return { ok: true, message: 'AI conversation history deleted completely.' };
  }
};

module.exports = SupabaseService;

