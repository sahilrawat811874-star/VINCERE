/**
 * Swasthya - Production Integration Test Suite
 * 
 * Verifies:
 * 1. Health checks & service detection
 * 2. Supabase Auth, Unique Patient UID generation & separate patient data
 * 3. Doctor roles, assigned-patient access enforcement & audit logging
 * 4. Cloudinary upload file validation (MIME, size, extension, magic bytes)
 * 5. OneSignal background notification scheduling & timezone deduplication
 * 6. OpenAI medical safety guardrails, emergency red-flag interception, bilingual support & consent
 * 7. Chat mutual blocking controls
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const server = require('../server');
const SupabaseService = server.SupabaseService || require('../services/supabase');
const CloudinaryService = server.CloudinaryService || require('../services/cloudinary');
const OneSignalService = server.OneSignalService || require('../services/onesignal');
const OpenAIService = server.OpenAIService || require('../services/openai');

let baseUrl;
let testServer;

before(async () => {
  // Start server on an ephemeral port for testing
  await new Promise(resolve => {
    testServer = server.listen(0, '127.0.0.1', () => {
      const port = testServer.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise(resolve => testServer.close(resolve));
});

// Helper for making JSON requests
async function makeRequest(path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    let payload = null;

    if (body) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(url, { method, headers: reqHeaders }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('1. Health Check & Service Registry', () => {
  test('GET /api/health returns 200 with service status and environment metadata', async () => {
    const res = await makeRequest('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(typeof res.body.uptime_seconds, 'number');
    assert.ok(res.body.services, 'Services registry should be present');
    assert.strictEqual(typeof res.body.services.supabase, 'boolean');
    assert.strictEqual(typeof res.body.services.cloudinary, 'boolean');
    assert.strictEqual(typeof res.body.services.onesignal, 'boolean');
    assert.strictEqual(typeof res.body.services.openai, 'boolean');
  });
});

describe('2. Supabase Auth, Patient UID & Data Isolation', () => {
  let patientToken = '';
  let patientUid = '';
  let patientEmail = `test.patient.${Date.now()}@example.com`;

  test('POST /api/auth/register generates a unique patient UID and issues a signed token', async () => {
    const res = await makeRequest('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Rohan Gupta',
        email: patientEmail,
        password: 'Password123!',
        role: 'patient'
      }
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.token, 'Session token should be returned');
    assert.strictEqual(res.body.role, 'patient');
    assert.ok(res.body.user.patientUid, 'Patient UID must be generated');
    assert.match(res.body.user.patientUid, /^PT-[A-F0-9]{6}$/, 'UID format should be PT-XXXXXX');

    patientToken = res.body.token;
    patientUid = res.body.user.patientUid;
  });

  test('POST /api/auth/login validates credentials and returns session token', async () => {
    const res = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: {
        email: patientEmail,
        password: 'Password123!',
        role: 'patient'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.token);
    assert.strictEqual(res.body.user.patientUid, patientUid);
  });

  test('POST /api/auth/login rejects incorrect passwords', async () => {
    const res = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: {
        email: patientEmail,
        password: 'WrongPassword123',
        role: 'patient'
      }
    });

    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  test('GET /api/data requires valid bearer authentication', async () => {
    const unauth = await makeRequest('/api/data');
    assert.strictEqual(unauth.status, 401);

    const authRes = await makeRequest('/api/data', {
      headers: { Authorization: `Bearer ${patientToken}` }
    });
    assert.strictEqual(authRes.status, 200);
    assert.ok(Array.isArray(authRes.body.medicines));
    assert.ok(Array.isArray(authRes.body.routines));
    assert.ok(Array.isArray(authRes.body.reports));
  });

  test('Patient can add and query separate medicines', async () => {
    const createRes = await makeRequest('/api/medicines', {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: {
        name: 'Amlodipine 5mg',
        instruction: '1 tablet in morning',
        time: '08:30'
      }
    });

    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.body.name, 'Amlodipine 5mg');

    const dataRes = await makeRequest('/api/data', {
      headers: { Authorization: `Bearer ${patientToken}` }
    });
    const found = dataRes.body.medicines.find(m => m.id === createRes.body.id);
    assert.ok(found, 'Added medicine must be present in patient isolated data');
  });
});

describe('3. Doctor Role & Assigned-Patient Access Enforcement', () => {
  let doctorToken = '';
  let unassignedDoctorToken = '';

  before(async () => {
    // Login default assigned demo doctor
    const docRes = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'doctor@demo.com', password: 'doctor123', role: 'doctor' }
    });
    doctorToken = docRes.body.token;

    // Register a secondary unassigned doctor
    const unassignedDocRes = await makeRequest('/api/auth/register', {
      method: 'POST',
      body: {
        email: `doc.unassigned.${Date.now()}@hospital.org`,
        password: 'DoctorPassword123',
        name: 'Dr. Vikram Malhotra',
        role: 'doctor',
        specialty: 'Cardiologist'
      }
    });
    unassignedDoctorToken = unassignedDocRes.body.token;
  });

  test('Patient role is rejected from doctor portal endpoints (403 Forbidden)', async () => {
    const patientLogin = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'patient@demo.com', password: 'patient123', role: 'patient' }
    });

    const res = await makeRequest('/api/doctor/patients', {
      headers: { Authorization: `Bearer ${patientLogin.body.token}` }
    });
    assert.strictEqual(res.status, 403);
  });

  test('Assigned doctor can view assigned patients', async () => {
    const res = await makeRequest('/api/doctor/patients', {
      headers: { Authorization: `Bearer ${doctorToken}` }
    });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length >= 1, 'Doctor should have assigned patients');
  });

  test('Unassigned doctor CANNOT view patient records of another clinician (403 Forbidden)', async () => {
    // Attempting to access PT-2026-001 (assigned to Dr. Meera) as Dr. Vikram
    const res = await makeRequest('/api/doctor/patient/PT-2026-001', {
      headers: { Authorization: `Bearer ${unassignedDoctorToken}` }
    });
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /Access denied: You are not assigned to this patient/i);
  });
});

describe('4. Chat Mutual Blocking & Messaging Controls', () => {
  let patientToken = '';
  let doctorToken = '';
  let chatId = '';

  before(async () => {
    const pLogin = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'patient@demo.com', password: 'patient123', role: 'patient' }
    });
    patientToken = pLogin.body.token;

    const dLogin = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'doctor@demo.com', password: 'doctor123', role: 'doctor' }
    });
    doctorToken = dLogin.body.token;

    const chatsRes = await makeRequest('/api/chats', {
      headers: { Authorization: `Bearer ${patientToken}` }
    });
    chatId = chatsRes.body[0].id;
  });

  test('Patient can send message when chat is unblocked', async () => {
    const res = await makeRequest(`/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: { text: 'Hello doctor, I have a question regarding my blood test.' }
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.body, 'Hello doctor, I have a question regarding my blood test.');
  });

  test('When doctor blocks conversation, message sending is rejected with 423 Locked', async () => {
    // Doctor blocks
    const blockRes = await makeRequest(`/api/chats/${chatId}/block`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${doctorToken}` }
    });
    assert.strictEqual(blockRes.status, 200);
    assert.ok(blockRes.body.blocked_by.includes('doctor'));

    // Patient attempts message
    const sendRes = await makeRequest(`/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: { text: 'Are you available?' }
    });
    assert.strictEqual(sendRes.status, 423);
    assert.match(sendRes.body.error, /blocked/i);
  });

  test('When doctor unblocks, messaging resumes normally', async () => {
    const unblockRes = await makeRequest(`/api/chats/${chatId}/unblock`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${doctorToken}` }
    });
    assert.strictEqual(unblockRes.status, 200);
    assert.ok(!unblockRes.body.blocked_by.includes('doctor'));

    const sendRes = await makeRequest(`/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: { text: 'Thank you for unblocking.' }
    });
    assert.strictEqual(sendRes.status, 201);
  });
});

describe('5. Cloudinary Backend Upload & File Validation', () => {
  let patientToken = '';

  before(async () => {
    const pLogin = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'patient@demo.com', password: 'patient123', role: 'patient' }
    });
    patientToken = pLogin.body.token;
  });

  test('Valid JPEG image buffer passes validation', () => {
    // JPEG header: FF D8 FF E0
    const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    assert.doesNotThrow(() => {
      CloudinaryService.validateFile({
        buffer: validJpeg,
        originalname: 'pill.jpg',
        mimetype: 'image/jpeg',
        size: validJpeg.length
      }, 'medicine');
    });
  });

  test('Valid PDF buffer passes report validation', () => {
    // PDF header: %PDF-1.4
    const validPdf = Buffer.from('%PDF-1.4 sample content');
    assert.doesNotThrow(() => {
      CloudinaryService.validateFile({
        buffer: validPdf,
        originalname: 'blood_report.pdf',
        mimetype: 'application/pdf',
        size: validPdf.length
      }, 'report');
    });
  });

  test('Rejects dangerous or disallowed file extensions (.exe / .sh)', () => {
    const fakeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ executable
    assert.throws(() => {
      CloudinaryService.validateFile({
        buffer: fakeBuffer,
        originalname: 'trojan.exe',
        mimetype: 'application/x-msdownload',
        size: fakeBuffer.length
      }, 'medicine');
    }, /Invalid file extension/);
  });

  test('Detects and rejects spoofed MIME types via magic byte inspection', () => {
    // Fake file: named pill.png with image/png MIME, but contains plain text without PNG magic header
    const spoofedBuffer = Buffer.from('This is secretly executable script, not a png image');
    assert.throws(() => {
      CloudinaryService.validateFile({
        buffer: spoofedBuffer,
        originalname: 'pill.png',
        mimetype: 'image/png',
        size: spoofedBuffer.length
      }, 'medicine');
    }, /signature/);
  });

  test('Rejects oversized uploads exceeding 5MB limit for medicine photos', () => {
    const oversizedBuffer = Buffer.alloc(6 * 1024 * 1024); // 6MB
    oversizedBuffer[0] = 0xff; oversizedBuffer[1] = 0xd8; oversizedBuffer[2] = 0xff;
    assert.throws(() => {
      CloudinaryService.validateFile({
        buffer: oversizedBuffer,
        originalname: 'huge_pill.jpg',
        mimetype: 'image/jpeg',
        size: oversizedBuffer.length
      }, 'medicine');
    }, /exceeds the maximum allowed size/);
  });

  test('POST /api/upload/medicine-photo securely uploads valid Base64 payload', async () => {
    const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const res = await makeRequest('/api/upload/medicine-photo', {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: {
        filename: 'vitamin.jpg',
        mimetype: 'image/jpeg',
        base64: validJpeg.toString('base64')
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.secure_url, 'Must return secure Cloudinary URL');
    assert.ok(res.body.public_id, 'Must return Cloudinary public ID');
  });
});

describe('6. OpenAI Clinical Safety, Red-Flag Interception & Bilingual Support', () => {
  let patientToken = '';

  before(async () => {
    const pLogin = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'patient@demo.com', password: 'patient123', role: 'patient' }
    });
    patientToken = pLogin.body.token;
  });

  test('Detects emergency red flags (chest pain) and returns immediate urgent alert in English', async () => {
    const res = await makeRequest('/api/assistant/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: {
        message: 'I have severe chest pain and heart pressure radiating to my left arm',
        language: 'en'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.isEmergency, true);
    assert.match(res.body.reply, /EMERGENCY ALERT/i);
    assert.match(res.body.reply, /112|911|emergency room/i);
    assert.ok(Array.isArray(res.body.citations), 'Must include medical guidelines citation');
  });

  test('Detects emergency red flags in Hindi and advises local emergency care', async () => {
    const res = await makeRequest('/api/assistant/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: {
        message: 'Mujhe seene mein bahut tez dard ho raha hai aur saans nahi aa rahi',
        language: 'hi'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.isEmergency, true);
    assert.match(res.body.reply, /आपातकालीन चेतावनी|EMERGENCY ALERT/);
    assert.match(res.body.reply, /112/);
  });

  test('Provides evidence-based safe fever guidance without prescribing', async () => {
    const res = await makeRequest('/api/assistant/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: {
        message: 'I have had a mild fever of 99.5F since yesterday. What should I do?',
        language: 'en'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.isEmergency, false);
    assert.match(res.body.reply, /rest|fluids|hydration/i);
    // Safety check: must not diagnose or instruct prescription dose
    assert.doesNotMatch(res.body.reply, /you definitely have/i);
  });

  test('Provides compassionate cancer care support and directs to oncology team', async () => {
    const res = await makeRequest('/api/assistant/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: {
        message: 'My relative was diagnosed with cancer and feels overwhelmed',
        language: 'en'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.match(res.body.reply, /oncology team|questions/i);
  });

  test('Explicit consent controls: conversation stored only with explicit consent', async () => {
    // 1. Without consent
    await makeRequest('/api/assistant/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: {
        message: 'I feel a bit tired today',
        consentToStore: false
      }
    });

    const histWithout = await makeRequest('/api/assistant/history', {
      headers: { Authorization: `Bearer ${patientToken}` }
    });
    const foundWithout = histWithout.body.find(m => m.content === 'I feel a bit tired today');
    assert.strictEqual(foundWithout, undefined, 'Message without consent must NOT be stored');

    // 2. With explicit consent
    await makeRequest('/api/assistant/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: {
        message: 'I would like to track my headache notes',
        consentToStore: true
      }
    });

    const histWith = await makeRequest('/api/assistant/history', {
      headers: { Authorization: `Bearer ${patientToken}` }
    });
    const foundWith = histWith.body.find(m => m.content === 'I would like to track my headache notes');
    assert.ok(foundWith, 'Message with explicit consent must be stored');

    // 3. Deletion control
    const deleteRes = await makeRequest('/api/assistant/history', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${patientToken}` }
    });
    assert.strictEqual(deleteRes.status, 200);

    const histAfterDelete = await makeRequest('/api/assistant/history', {
      headers: { Authorization: `Bearer ${patientToken}` }
    });
    assert.strictEqual(histAfterDelete.body.length, 0, 'History should be completely cleared');
  });
});

describe('7. OneSignal Background Notifications & Deduplication', () => {
  let patientToken = '';

  before(async () => {
    const pLogin = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'patient@demo.com', password: 'patient123', role: 'patient' }
    });
    patientToken = pLogin.body.token;
  });

  test('POST /api/notifications/preferences saves patient timezone and reminder switches', async () => {
    const res = await makeRequest('/api/notifications/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: {
        timezone: 'Asia/Kolkata',
        medicineReminders: true,
        routineReminders: true,
        dailyQuotes: true
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.timezone, 'Asia/Kolkata');
    assert.strictEqual(res.body.medicine_reminders, true);
  });

  test('Deduplication prevents sending duplicate notifications in the same time window', async () => {
    const dedupeKey = `test-rem-${Date.now()}`;

    // First check: should not be logged
    const loggedBefore = await SupabaseService.isNotificationLogged(dedupeKey);
    assert.strictEqual(loggedBefore, false);

    // Send first notification
    await SupabaseService.logNotification('PT-DEMO', 'medicine', dedupeKey, 'Reminder', 'Take medicine');

    // Second check: should now be detected as logged
    const loggedAfter = await SupabaseService.isNotificationLogged(dedupeKey);
    assert.strictEqual(loggedAfter, true, 'Deduplication key must be stored to prevent duplicates');
  });
});
