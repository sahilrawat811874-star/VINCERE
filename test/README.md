# Swasthya Test Suite

Run automated integration tests using Node.js built-in test runner:

```bash
npm test
```

or directly:

```bash
node --test test/api.test.js
```

### Coverage
- **1. Health Check & Service Registry**: `/api/health` 200 OK, uptime, connected service flags.
- **2. Supabase Auth & Isolation**: Unique patient UID (`PT-XXXXXX`), separate records per patient, token verification.
- **3. Doctor Access Control & RLS**: Assigned patient access only, unassigned access rejection (403), audit logging.
- **4. Chat Mutual Blocking**: Mutual blocking controls, 423 Locked enforcement on blocked conversation.
- **5. Cloudinary Upload Validation**: MIME type whitelist, file extension whitelist, 5MB / 10MB limits, magic byte header verification.
- **6. OpenAI Assistant & Safety**: Interception of emergency red flags (chest pain, stroke, breathing failure, self-harm), evidence-based non-diagnostic safe guidance, bilingual Hindi/English support, explicit consent controls and conversation history deletion.
- **7. OneSignal Notifications**: Timezone-aware scheduling, push subscription syncing, deterministic deduplication.

