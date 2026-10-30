/**
 * Swasthya - Production Backend Server
 * 
 * Integrated Services:
 * 1. Supabase: PostgreSQL Database, RLS, Doctor-Patient Assignments & Audit Logs
 * 2. Cloudinary: Secure Server-side Photo & Report Uploads (MIME/size/extension validation)
 * 3. OneSignal: Background Push Notifications, Deduplication & Timezone Reminders
 * 4. OpenAI: Medical Safety Guardrails, Red Flag Interception, Bilingual (EN/HI) AI Assistant
 * 5. Render: 0.0.0.0 Binding, Health Checks, Structured JSON Logging & Error Handler
 */

try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const SupabaseService = require('./services/supabase');
const CloudinaryService = require('./services/cloudinary');
const OneSignalService = require('./services/onesignal');
const OpenAIService = require('./services/openai');
const { issueToken, verifyToken } = require('./middleware/auth');
const { requestLogger, formatLog } = require('./middleware/logger');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const START_TIME = Date.now();

// Utility: JSON responder with security headers
function sendJSON(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
  });
  res.end(payload);
}

// Utility: Read request body (JSON or raw buffer)
function getRequestBody(req, maxBytes = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on('data', chunk => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error(`Payload too large. Exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit.`));
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const contentType = req.headers['content-type'] || '';

      if (contentType.includes('application/json')) {
        try {
          resolve(buffer.length ? JSON.parse(buffer.toString('utf8')) : {});
        } catch {
          reject(new Error('Invalid JSON format in request body.'));
        }
      } else {
        resolve({ rawBuffer: buffer, contentType });
      }
    });

    req.on('error', err => reject(err));
  });
}

// Simple multipart parser for file uploads
function parseMultipartFormData(buffer, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = 0;

  while (true) {
    const boundaryIndex = buffer.indexOf(boundaryBuffer, start);
    if (boundaryIndex === -1) break;

    if (start !== 0) {
      const partBuffer = buffer.slice(start, boundaryIndex - 2); // subtract \r\n
      const headerEnd = partBuffer.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEnd !== -1) {
        const headerString = partBuffer.slice(0, headerEnd).toString('utf8');
        const bodyBuffer = partBuffer.slice(headerEnd + 4);

        const nameMatch = headerString.match(/name="([^"]+)"/);
        const filenameMatch = headerString.match(/filename="([^"]+)"/);
        const typeMatch = headerString.match(/Content-Type:\s*([^\r\n]+)/i);

        if (nameMatch) {
          parts.push({
            name: nameMatch[1],
            filename: filenameMatch ? filenameMatch[1] : null,
            contentType: typeMatch ? typeMatch[1].trim() : 'text/plain',
            data: bodyBuffer
          });
        }
      }
    }
    start = boundaryIndex + boundaryBuffer.length + 2; // move past boundary and \r\n
  }
  return parts;
}

// Authentication extraction
function extractUser(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return verifyToken(token);
}

// Main HTTP Server
const server = http.createServer(async (req, res) => {
  // Structured logging
  requestLogger(req, res);

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  try {
    // ------------------------------------------------------------------------
    // 1. HEALTH CHECK & SERVICE STATUS
    // ------------------------------------------------------------------------
    if (pathname === '/api/health' && method === 'GET') {
      return sendJSON(res, 200, {
        status: 'ok',
        version: '2.0.0',
        uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
        timestamp: new Date().toISOString(),
        host: HOST,
        port: PORT,
        services: {
          supabase: SupabaseService.isConfigured(),
          cloudinary: CloudinaryService.isConfigured(),
          onesignal: OneSignalService.isConfigured(),
          openai: OpenAIService.isConfigured()
        },
        environment: process.env.NODE_ENV || 'development'
      });
    }

    // ------------------------------------------------------------------------
    // DATABASE CONNECTIVITY & MANAGEMENT (Supabase PostgreSQL)
    // ------------------------------------------------------------------------
    if (pathname === '/api/database/status' && method === 'GET') {
      const status = await SupabaseService.getStatus();
      return sendJSON(res, 200, status);
    }

    if (pathname === '/api/database/connect' && method === 'POST') {
      const body = await getRequestBody(req);
      const result = await SupabaseService.setCredentials({
        supabaseUrl: body.supabaseUrl,
        supabaseAnonKey: body.supabaseAnonKey,
        supabaseServiceRoleKey: body.supabaseServiceRoleKey,
        persistToEnv: true
      });
      return sendJSON(res, 200, { ok: true, message: 'Connected to Supabase PostgreSQL database!', ...result });
    }

    // ------------------------------------------------------------------------
    // 2. AUTHENTICATION (Patient & Doctor Sign-up / Login)
    // ------------------------------------------------------------------------
    if (pathname === '/api/auth/register' && method === 'POST') {
      const body = await getRequestBody(req);
      const email = String(body.email || '').trim();
      const password = String(body.password || '');
      const name = String(body.name || '').trim();
      const role = body.role === 'doctor' ? 'doctor' : 'patient';
      const specialty = body.specialty ? String(body.specialty).trim() : null;

      if (!email || !email.includes('@') || password.length < 8) {
        return sendJSON(res, 400, { error: 'A valid email and password of at least 8 characters are required.' });
      }

      const user = await SupabaseService.createUser({ email, password, fullName: name, role, specialty });
      const token = issueToken({ id: user.id, role: user.role, patientUid: user.patientUid, name: user.fullName });

      await SupabaseService.logAudit(user.id, 'AUTH_REGISTER', 'profiles', user.id, { role: user.role, email });
      return sendJSON(res, 201, {
        token,
        role: user.role,
        user: { id: user.id, email: user.email, name: user.fullName, patientUid: user.patientUid }
      });
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await getRequestBody(req);
      const email = String(body.email || '').trim();
      const password = String(body.password || '');
      const expectedRole = body.role ? String(body.role).trim() : null;

      if (!email || !password) {
        return sendJSON(res, 400, { error: 'Email and password are required.' });
      }

      let user;
      try {
        user = await SupabaseService.authenticateUser({ email, password, role: expectedRole });
      } catch (authErr) {
        return sendJSON(res, 400, { error: authErr.message || 'Invalid email or password.' });
      }
      const token = issueToken({ id: user.id, role: user.role, patientUid: user.patientUid, name: user.fullName });

      await SupabaseService.logAudit(user.id, 'AUTH_LOGIN', 'profiles', user.id, { role: user.role });
      return sendJSON(res, 200, {
        token,
        role: user.role,
        user: { id: user.id, email: user.email, name: user.fullName, patientUid: user.patientUid }
      });
    }

    if (pathname === '/api/auth/me' && method === 'GET') {
      const currentUser = extractUser(req);
      if (!currentUser) return sendJSON(res, 401, { error: 'Sign-in required.' });

      const profile = await SupabaseService.getProfile(currentUser.id);
      return sendJSON(res, 200, { user: currentUser, profile });
    }

    // ------------------------------------------------------------------------
    // 3. PATIENT DATA (Profile, Medicines, Check-ins, Routines, Reports)
    // ------------------------------------------------------------------------
    if (pathname === '/api/data' && method === 'GET') {
      const currentUser = extractUser(req);
      if (!currentUser || currentUser.role !== 'patient') {
        return sendJSON(res, 401, { error: 'Patient authentication required.' });
      }

      const data = await SupabaseService.getPatientData(currentUser.id);
      return sendJSON(res, 200, data);
    }

    if (pathname === '/api/profile' && method === 'PATCH') {
      const currentUser = extractUser(req);
      if (!currentUser) return sendJSON(res, 401, { error: 'Sign-in required.' });

      const body = await getRequestBody(req);
      const updated = await SupabaseService.updateProfile(currentUser.id, {
        fullName: body.name,
        emergencyContact: body.emergencyContact,
        timezone: body.timezone
      });
      return sendJSON(res, 200, updated);
    }

    if (pathname === '/api/medicines' && method === 'POST') {
      const currentUser = extractUser(req);
      if (!currentUser || currentUser.role !== 'patient') {
        return sendJSON(res, 401, { error: 'Patient sign-in required.' });
      }

      const body = await getRequestBody(req);
      const name = String(body.name || '').trim();
      if (!name) return sendJSON(res, 400, { error: 'Medicine name is required.' });

      const medicine = await SupabaseService.addMedicine(currentUser.id, {
        name,
        instruction: body.instruction,
        reminder_time: body.time || body.reminder_time,
        photo_url: body.photo || body.photo_url || '',
        photo_public_id: body.photo_public_id || null,
        photo_metadata: body.photo_metadata || {}
      });

      return sendJSON(res, 201, medicine);
    }

    const medMatch = pathname.match(/^\/api\/medicines\/([^/]+)$/);
    if (medMatch && method === 'PATCH') {
      const currentUser = extractUser(req);
      if (!currentUser || currentUser.role !== 'patient') {
        return sendJSON(res, 401, { error: 'Patient sign-in required.' });
      }

      const body = await getRequestBody(req);
      const updates = {};
      if (typeof body.taken === 'boolean') updates.taken = body.taken;
      if (body.name) updates.name = String(body.name).trim();
      if (body.instruction) updates.instruction = String(body.instruction).trim();
      if (body.time) updates.reminder_time = String(body.time).trim();
      if (body.photo || body.photo_url) updates.photo_url = body.photo || body.photo_url;

      const updated = await SupabaseService.updateMedicine(currentUser.id, medMatch[1], updates);
      if (!updated) return sendJSON(res, 404, { error: 'Medicine not found.' });
      return sendJSON(res, 200, updated);
    }

    if (medMatch && method === 'DELETE') {
      const currentUser = extractUser(req);
      if (!currentUser || currentUser.role !== 'patient') {
        return sendJSON(res, 401, { error: 'Patient sign-in required.' });
      }

      await SupabaseService.deleteMedicine(currentUser.id, medMatch[1]);
      return sendJSON(res, 200, { ok: true });
    }

    if (pathname === '/api/checkins' && method === 'POST') {
      const currentUser = extractUser(req);
      if (!currentUser || currentUser.role !== 'patient') {
        return sendJSON(res, 401, { error: 'Patient sign-in required.' });
      }

      const body = await getRequestBody(req);
      const checkin = await SupabaseService.addCheckin(currentUser.id, {
        mood: body.mood,
        note: body.note
      });
      return sendJSON(res, 201, checkin);
    }

    if (pathname === '/api/routines' && method === 'POST') {
      const currentUser = extractUser(req);
      if (!currentUser || currentUser.role !== 'patient') {
        return sendJSON(res, 401, { error: 'Patient sign-in required.' });
      }

      const body = await getRequestBody(req);
      const text = String(body.text || body.title || '').trim();
      const time = String(body.time || body.reminder_time || '').trim();

      if (!text || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        return sendJSON(res, 400, { error: 'Routine title and valid HH:MM time are required.' });
      }

      const routine = await SupabaseService.addRoutine(currentUser.id, {
        title: text,
        reminder_time: time
      });
      return sendJSON(res, 201, routine);
    }

    if (pathname === '/api/reports' && method === 'POST') {
      const currentUser = extractUser(req);
      if (!currentUser || currentUser.role !== 'patient') {
        return sendJSON(res, 401, { error: 'Patient sign-in required.' });
      }

      const body = await getRequestBody(req);
      const name = String(body.name || body.file_name || '').trim();
      if (!name) return sendJSON(res, 400, { error: 'Report name is required.' });

      const report = await SupabaseService.addReport(currentUser.id, {
        file_name: name,
        file_url: body.file_url || body.url || '',
        public_id: body.public_id || `rep-${Date.now()}`,
        file_type: body.file_type || 'application/pdf',
        file_size: body.file_size || 0
      });
      return sendJSON(res, 201, report);
    }

    // ------------------------------------------------------------------------
    // 4. CLOUDINARY FILE UPLOADS (Backend-Only, MIME & Signature Validated)
    // ------------------------------------------------------------------------
    if (pathname === '/api/upload/medicine-photo' && method === 'POST') {
      const currentUser = extractUser(req);
      if (!currentUser || currentUser.role !== 'patient') {
        return sendJSON(res, 401, { error: 'Patient sign-in required.' });
      }

      const body = await getRequestBody(req);
      let fileToUpload = null;

      // Check if sent via multipart/form-data
      if (body.contentType && body.contentType.includes('multipart/form-data')) {
        const boundary = body.contentType.split('boundary=')[1];
        const parts = parseMultipartFormData(body.rawBuffer, boundary);
        const filePart = parts.find(p => p.filename);
        if (filePart) {
          fileToUpload = {
            buffer: filePart.data,
            originalname: filePart.filename,
            mimetype: filePart.contentType,
            size: filePart.data.length
          };
        }
      } else if (body.base64 && body.filename) {
        // Direct Base64 buffer
        const cleanBase64 = body.base64.replace(/^data:[^;]+;base64,/, '');
        const buf = Buffer.from(cleanBase64, 'base64');
        fileToUpload = {
          buffer: buf,
          originalname: body.filename,
          mimetype: body.mimetype || 'image/jpeg',
          size: buf.length
        };
      }

      if (!fileToUpload) {
        return sendJSON(res, 400, { error: 'No file received for medicine photo upload.' });
      }

      const uploadResult = await CloudinaryService.upload(fileToUpload, 'medicine');
      await SupabaseService.logAudit(currentUser.id, 'UPLOAD_MEDICINE_PHOTO', 'medicines', null, {
        public_id: uploadResult.public_id,
        bytes: uploadResult.bytes
      });

      return sendJSON(res, 200, uploadResult);
    }

    if (pathname === '/api/upload/report' && method === 'POST') {
      const currentUser = extractUser(req);
      if (!currentUser || currentUser.role !== 'patient') {
        return sendJSON(res, 401, { error: 'Patient sign-in required.' });
      }

      const body = await getRequestBody(req);
      let fileToUpload = null;

      if (body.contentType && body.contentType.includes('multipart/form-data')) {
        const boundary = body.contentType.split('boundary=')[1];
        const parts = parseMultipartFormData(body.rawBuffer, boundary);
        const filePart = parts.find(p => p.filename);
        if (filePart) {
          fileToUpload = {
            buffer: filePart.data,
            originalname: filePart.filename,
            mimetype: filePart.contentType,
            size: filePart.data.length
          };
        }
      } else if (body.base64 && body.filename) {
        const cleanBase64 = body.base64.replace(/^data:[^;]+;base64,/, '');
        const buf = Buffer.from(cleanBase64, 'base64');
        fileToUpload = {
          buffer: buf,
          originalname: body.filename,
          mimetype: body.mimetype || 'application/pdf',
          size: buf.length
        };
      }

      if (!fileToUpload) {
        return sendJSON(res, 400, { error: 'No file received for report upload.' });
      }

      const uploadResult = await CloudinaryService.upload(fileToUpload, 'report');
      // Save directly to reports
      const report = await SupabaseService.addReport(currentUser.id, {
        file_name: uploadResult.original_filename,
        file_url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
        file_type: fileToUpload.mimetype,
        file_size: uploadResult.bytes
      });

      await SupabaseService.logAudit(currentUser.id, 'UPLOAD_REPORT', 'reports', report.id, {
        public_id: uploadResult.public_id
      });

      return sendJSON(res, 201, { ...uploadResult, report });
    }

    // ------------------------------------------------------------------------
    // 5. DOCTOR PORTAL & ASSIGNED PATIENTS
    // ------------------------------------------------------------------------
    if (pathname === '/api/doctor/patients' && method === 'GET') {
      const currentUser = extractUser(req);
      if (!currentUser || currentUser.role !== 'doctor') {
        return sendJSON(res, 403, { error: 'Forbidden: Doctor role required.' });
      }

      const patients = await SupabaseService.getAssignedPatients(currentUser.id);
      await SupabaseService.logAudit(currentUser.id, 'VIEW_ASSIGNED_PATIENTS', 'profiles', currentUser.id, { count: patients.length });
      return sendJSON(res, 200, patients);
    }

    const docPatientMatch = pathname.match(/^\/api\/doctor\/patient\/([^/]+)$/);
    if (docPatientMatch && method === 'GET') {
      const currentUser = extractUser(req);
      if (!currentUser || currentUser.role !== 'doctor') {
        return sendJSON(res, 403, { error: 'Forbidden: Doctor role required.' });
      }

      const targetPatientUidOrId = docPatientMatch[1];
      let targetProfile = await SupabaseService.getProfile(targetPatientUidOrId);
      if (!targetProfile) targetProfile = await SupabaseService.getProfileByUid(targetPatientUidOrId);

      if (!targetProfile) {
        return sendJSON(res, 404, { error: 'Patient not found.' });
      }

      // Enforce doctor assigned access
      const isAssigned = await SupabaseService.isDoctorAssignedToPatient(currentUser.id, targetProfile.id);
      if (!isAssigned) {
        return sendJSON(res, 403, { error: 'Access denied: You are not assigned to this patient.' });
      }

      const patientData = await SupabaseService.getPatientData(targetProfile.id);
      await SupabaseService.logAudit(currentUser.id, 'VIEW_PATIENT_RECORDS', 'profiles', targetProfile.id, {
        patient_uid: targetProfile.patient_uid
      });

      return sendJSON(res, 200, patientData);
    }

    // ------------------------------------------------------------------------
    // 6. CHATS & MESSAGING (Patient <-> Doctor, Block/Unblock Controls)
    // ------------------------------------------------------------------------
    if (pathname === '/api/chats' && method === 'GET') {
      const currentUser = extractUser(req);
      if (!currentUser) return sendJSON(res, 401, { error: 'Sign-in required.' });

      const chats = await SupabaseService.getChats(currentUser.id, currentUser.role);
      return sendJSON(res, 200, chats);
    }

    if (pathname === '/api/chats' && method === 'POST') {
      const currentUser = extractUser(req);
      if (!currentUser) return sendJSON(res, 401, { error: 'Sign-in required.' });

      const body = await getRequestBody(req);
      let patientId = currentUser.role === 'patient' ? currentUser.id : body.patientId;
      let doctorId = currentUser.role === 'doctor' ? currentUser.id : body.doctorId;

      // If doctor passed a UID, resolve it
      if (currentUser.role === 'doctor' && body.patientId) {
        const found = await SupabaseService.getProfileByUid(body.patientId) || await SupabaseService.getProfile(body.patientId);
        if (found) {
          patientId = found.id;
          // Verify doctor is assigned
          const isAssigned = await SupabaseService.isDoctorAssignedToPatient(currentUser.id, found.id);
          if (!isAssigned) {
            return sendJSON(res, 403, { error: 'Access denied: You are not assigned to this patient.' });
          }
        }
      }

      if (!doctorId) {
        const docs = await SupabaseService.getAssignedPatients(currentUser.id);
        doctorId = 'DR-MEERA-SHARMA-001';
      }

      const chat = await SupabaseService.createChat(patientId, doctorId);
      return sendJSON(res, 201, chat);
    }

    const chatMatch = pathname.match(/^\/api\/chats\/([^/]+)(?:\/(messages|block|unblock))?$/);
    if (chatMatch) {
      const chatId = chatMatch[1];
      const action = chatMatch[2];
      const currentUser = extractUser(req);

      if (!currentUser) return sendJSON(res, 401, { error: 'Sign-in required.' });

      const chat = await SupabaseService.getChat(chatId);
      if (!chat) return sendJSON(res, 404, { error: 'Chat not found.' });

      // Verify participant
      const isParticipant = (chat.patient_id === currentUser.id || chat.doctor_id === currentUser.id);
      if (!isParticipant) return sendJSON(res, 403, { error: 'Access denied to this conversation.' });

      if (!action && method === 'GET') {
        return sendJSON(res, 200, chat);
      }

      if (action === 'block' && method === 'POST') {
        const updated = await SupabaseService.setChatBlocked(chatId, currentUser.role, true);
        await SupabaseService.logAudit(currentUser.id, 'BLOCK_CHAT', 'chats', chatId, { blocked_by: currentUser.role });
        return sendJSON(res, 200, updated);
      }

      if (action === 'unblock' && method === 'POST') {
        const updated = await SupabaseService.setChatBlocked(chatId, currentUser.role, false);
        await SupabaseService.logAudit(currentUser.id, 'UNBLOCK_CHAT', 'chats', chatId, { unblocked_by: currentUser.role });
        return sendJSON(res, 200, updated);
      }

      if (action === 'messages' && method === 'POST') {
        if (Array.isArray(chat.blocked_by) && chat.blocked_by.length > 0) {
          return sendJSON(res, 423, { error: 'This conversation is currently blocked. Unblock the chat before sending messages.' });
        }

        const body = await getRequestBody(req);
        const text = String(body.text || '').trim();
        if (!text) return sendJSON(res, 400, { error: 'Message cannot be empty.' });

        const senderName = currentUser.name || (currentUser.role === 'doctor' ? 'Doctor' : 'Patient');
        const message = await SupabaseService.sendMessage(chatId, currentUser.id, currentUser.role, senderName, text);

        return sendJSON(res, 201, message);
      }
    }

    // ------------------------------------------------------------------------
    // 7. ONESIGNAL NOTIFICATIONS & SETTINGS
    // ------------------------------------------------------------------------
    if (pathname === '/api/notifications/config' && method === 'GET') {
      return sendJSON(res, 200, {
        onesignalAppId: OneSignalService.getAppId() || null
      });
    }

    if (pathname === '/api/notifications/preferences' && method === 'POST') {
      const currentUser = extractUser(req);
      if (!currentUser || currentUser.role !== 'patient') {
        return sendJSON(res, 401, { error: 'Patient sign-in required.' });
      }

      const body = await getRequestBody(req);
      const saved = await SupabaseService.saveNotificationPreferences(currentUser.id, {
        onesignalPlayerId: body.onesignalPlayerId,
        timezone: body.timezone,
        medicineReminders: body.medicineReminders,
        routineReminders: body.routineReminders,
        dailyQuotes: body.dailyQuotes
      });

      return sendJSON(res, 200, saved);
    }

    if (pathname === '/api/notifications/dispatch-reminders' && method === 'POST') {
      const dispatched = await OneSignalService.dispatchReminders(SupabaseService);
      return sendJSON(res, 200, { ok: true, count: dispatched.length, dispatched });
    }

    // ------------------------------------------------------------------------
    // 8. OPENAI REAL AI ASSISTANT (Red Flag Shield, Safe Guidance, EN/HI)
    // ------------------------------------------------------------------------
    if (pathname === '/api/assistant/chat' && method === 'POST') {
      const currentUser = extractUser(req);
      if (!currentUser) return sendJSON(res, 401, { error: 'Sign-in required.' });

      const body = await getRequestBody(req);
      const message = String(body.message || '').trim();
      const language = body.language || 'en';
      const consentToStore = Boolean(body.consentToStore);

      if (!message) return sendJSON(res, 400, { error: 'Message is required.' });

      // Fetch recent history if consent previously given
      let history = [];
      if (consentToStore) {
        history = await SupabaseService.getAiHistory(currentUser.id);
      }

      const response = await OpenAIService.chat({ message, language, conversationHistory: history });

      // Persist only with explicit consent
      if (consentToStore) {
        await SupabaseService.saveAiMessage(currentUser.id, {
          role: 'user',
          content: message
        });
        await SupabaseService.saveAiMessage(currentUser.id, {
          role: 'assistant',
          content: response.reply,
          isEmergency: response.isEmergency,
          safetyFlags: response.isEmergency ? ['EMERGENCY_RED_FLAG'] : [],
          citations: response.citations
        });
      }

      return sendJSON(res, 200, {
        ...response,
        consentToStore
      });
    }

    if (pathname === '/api/assistant/history' && method === 'GET') {
      const currentUser = extractUser(req);
      if (!currentUser) return sendJSON(res, 401, { error: 'Sign-in required.' });

      const history = await SupabaseService.getAiHistory(currentUser.id);
      return sendJSON(res, 200, history);
    }

    if (pathname === '/api/assistant/history' && method === 'DELETE') {
      const currentUser = extractUser(req);
      if (!currentUser) return sendJSON(res, 401, { error: 'Sign-in required.' });

      const result = await SupabaseService.deleteAiHistory(currentUser.id);
      await SupabaseService.logAudit(currentUser.id, 'DELETE_AI_HISTORY', 'ai_conversations', currentUser.id);
      return sendJSON(res, 200, result);
    }

    // ------------------------------------------------------------------------
    // 9. STATIC WEB APPLICATION SERVING
    // ------------------------------------------------------------------------
    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const filePath = path.join(ROOT, 'index.html');
      const html = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(html);
    }

    if (method === 'GET' && pathname === '/manifest.json') {
      const filePath = path.join(ROOT, 'manifest.json');
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
      return res.end(content);
    }

    if (method === 'GET' && pathname === '/service-worker.js') {
      const filePath = path.join(ROOT, 'service-worker.js');
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(content);
    }

    if (method === 'GET' && pathname === '/OneSignalSDKWorker.js') {
      const filePath = path.join(ROOT, 'OneSignalSDKWorker.js');
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(content);
    }

    // Not found
    return sendJSON(res, 404, { error: `Endpoint not found: ${pathname}` });
  } catch (err) {
    // Production Error Handler: Never leak stack traces or secrets to users
    console.error(formatLog('error', {
      url: pathname,
      method,
      error_message: err.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
    }));

    return sendJSON(res, err.statusCode || 500, {
      error: err.message || 'An internal server error occurred. Please try again later.'
    });
  }
});

// Periodic Background Reminder Check (runs every 60 seconds)
const reminderInterval = setInterval(async () => {
  try {
    await OneSignalService.dispatchReminders(SupabaseService);
  } catch (err) {
    console.error('[Scheduler] Reminder check error:', err.message);
  }
}, 60 * 1000);
if (reminderInterval.unref) reminderInterval.unref();

// Graceful Shutdown
function handleShutdown(signal) {
  console.log(`[Swasthya] Received ${signal}. Shutting down gracefully...`);
  clearInterval(reminderInterval);
  server.close(() => {
    console.log('[Swasthya] Server closed cleanly.');
    process.exit(0);
  });
}
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`[Swasthya] Production server running at http://${HOST}:${PORT}`);
    console.log(`[Swasthya] Services Status: Supabase=${SupabaseService.isConfigured()}, Cloudinary=${CloudinaryService.isConfigured()}, OneSignal=${OneSignalService.isConfigured()}, OpenAI=${OpenAIService.isConfigured()}`);
  });
}

server.SupabaseService = SupabaseService;
server.CloudinaryService = CloudinaryService;
server.OneSignalService = OneSignalService;
server.OpenAIService = OpenAIService;
server.issueToken = issueToken;
server.verifyToken = verifyToken;

module.exports = server;
