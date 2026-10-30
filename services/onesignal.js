/**
 * Swasthya - OneSignal Background Push Notification Service
 * 
 * Delivers background web push notifications even when browser tab is closed.
 * Manages medicine reminders, routine reminders, and daily health quotes.
 * Supports patient timezones and deterministic deduplication.
 */

const https = require('https');

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || '';
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY || '';

const HEALTH_QUOTES = [
  'Every small step toward health is worth celebrating. 🌱',
  'You are doing your best, and that is enough for today.',
  'Rest is part of healing, not a pause from it.',
  'Notice one good thing around you today. Breathe deeply.',
  'Steady, gentle care builds a resilient body and mind.',
  'Your feelings deserve care, not judgement. Take your time today.'
];

const OneSignalService = {
  isConfigured() {
    return Boolean(ONESIGNAL_APP_ID && ONESIGNAL_REST_API_KEY);
  },

  getAppId() {
    return ONESIGNAL_APP_ID;
  },

  /**
   * Send push notification via OneSignal REST API
   */
  async sendPushNotification({ targetUid, title, body, icon = null, url = '/' }) {
    if (!this.isConfigured()) {
      return {
        success: true,
        offline_mock: true,
        message: `[Mock OneSignal Push to ${targetUid}] ${title}: ${body}`
      };
    }

    const payload = JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      include_aliases: {
        external_id: [targetUid]
      },
      target_channel: 'push',
      headings: { en: title },
      contents: { en: body },
      web_url: url,
      chrome_web_icon: icon || undefined
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        'https://api.onesignal.com/notifications',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Key ${ONESIGNAL_REST_API_KEY}`
          }
        },
        res => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve({ success: true, data: parsed });
              } else {
                reject(new Error(`OneSignal error (${res.statusCode}): ${data}`));
              }
            } catch (err) {
              resolve({ success: true, raw: data });
            }
          });
        }
      );

      req.on('error', err => reject(err));
      req.write(payload);
      req.end();
    });
  },

  /**
   * Helper to format current time in a given timezone as HH:MM
   */
  getZonedTimeAndDate(timezone = 'Asia/Kolkata') {
    try {
      const now = new Date();
      const timeFmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const dateFmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return {
        time: timeFmt.format(now),
        date: dateFmt.format(now),
        dayOfMonth: now.getDate()
      };
    } catch {
      const now = new Date();
      return {
        time: now.toISOString().slice(11, 16),
        date: now.toISOString().slice(0, 10),
        dayOfMonth: now.getDate()
      };
    }
  },

  /**
   * Evaluates due medicine/routine reminders and daily quotes,
   * enforces deduplication, and sends push notifications.
   */
  async dispatchReminders(supabaseService) {
    const preferencesList = await supabaseService.getAllActiveNotificationPreferences();
    const results = [];

    for (const pref of preferencesList) {
      const patientId = pref.patient_id;
      const profile = await supabaseService.getProfile(patientId);
      if (!profile) continue;

      const patientUid = profile.patient_uid;
      const { time: currentTime, date: currentDate, dayOfMonth } = this.getZonedTimeAndDate(pref.timezone);
      const patientData = await supabaseService.getPatientData(patientId);

      // 1. Medicine Reminders
      if (pref.medicine_reminders) {
        for (const med of patientData.medicines || []) {
          // Normalize time to HH:MM
          const medTime = (med.reminder_time || '').slice(0, 5);
          if (medTime === currentTime && !med.taken) {
            const dedupeKey = `rem-med-${patientUid}-${med.id}-${currentDate}-${currentTime}`;
            const alreadyLogged = await supabaseService.isNotificationLogged(dedupeKey);
            if (!alreadyLogged) {
              const title = `Medicine reminder: ${med.name}`;
              const body = `Time to take ${med.name}. ${med.instruction || 'Follow your prescription.'}`;
              await this.sendPushNotification({
                targetUid: patientUid,
                title,
                body,
                icon: med.photo_url || null
              });
              await supabaseService.logNotification(patientId, 'medicine', dedupeKey, title, body);
              results.push({ type: 'medicine', patientUid, medName: med.name });
            }
          }
        }
      }

      // 2. Routine Reminders
      if (pref.routine_reminders) {
        for (const routine of patientData.routines || []) {
          const rtnTime = (routine.reminder_time || '').slice(0, 5);
          if (rtnTime === currentTime) {
            const dedupeKey = `rem-rtn-${patientUid}-${routine.id}-${currentDate}-${currentTime}`;
            const alreadyLogged = await supabaseService.isNotificationLogged(dedupeKey);
            if (!alreadyLogged) {
              const title = 'Routine reminder';
              const body = `${routine.title} · Your scheduled routine time is now.`;
              await this.sendPushNotification({
                targetUid: patientUid,
                title,
                body
              });
              await supabaseService.logNotification(patientId, 'routine', dedupeKey, title, body);
              results.push({ type: 'routine', patientUid, routineTitle: routine.title });
            }
          }
        }
      }

      // 3. Daily Health Quote (delivered around 08:00 AM in user's timezone)
      if (pref.daily_quotes && currentTime === '08:00') {
        const dedupeKey = `rem-quote-${patientUid}-${currentDate}`;
        const alreadyLogged = await supabaseService.isNotificationLogged(dedupeKey);
        if (!alreadyLogged) {
          const quote = HEALTH_QUOTES[dayOfMonth % HEALTH_QUOTES.length];
          const title = 'A thought for today 🌱';
          await this.sendPushNotification({
            targetUid: patientUid,
            title,
            body: quote
          });
          await supabaseService.logNotification(patientId, 'quote', dedupeKey, title, quote);
          results.push({ type: 'quote', patientUid });
        }
      }
    }

    return results;
  }
};

module.exports = OneSignalService;

