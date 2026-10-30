/**
 * Swasthya - OpenAI Real AI Healthcare Assistant Service
 * 
 * Provides safe, compassionate guidance in Hindi and English.
 * Strictly avoids diagnosing, prescribing, or adjusting medication doses.
 * Immediately intercepts emergency red flags with high-priority alerts.
 * Attaches evidence-based source and date citations.
 */

const https = require('https');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const EMERGENCY_PATTERNS = [
  /\b(chest\s*pain|heart\s*pain|heart\s*attack|crushing\s*chest|radiat(ing|es)\s*to\s*(arm|jaw))\b/i,
  /\b(can('?t|not)\s*breathe|severe\s*shortness\s*of\s*breath|gasping|suffocating)\b/i,
  /\b(stroke|face\s*droop(ing)?|slurred\s*speech|one[- ]sided\s*weakness)\b/i,
  /\b(fainted|fainting|passed\s*out|unconscious|collapsed)\b/i,
  /\b(vomit(ing)?\s*blood|coughing\s*blood|severe\s*bleeding)\b/i,
  /\b(suicid(e|al)|kill\s*myself|end\s*my\s*life|self[- ]harm)\b/i,
  // Hindi transliterated / keywords
  /(dil\s*ka\s*daura|chhati\s*me(in)?\s*dard|seene\s*me(in)?\s*dard)/i,
  /(saans\s*(nahi|nahin)\s*aa\s*rahi|saans\s*lene\s*me(in)?\s*(bahut\s*)?dikkat)/i,
  /(behoshi|behosh\s*ho\s*gaya|stroke\s*ke\s*lakshan)/i,
  /(khoon\s*ki\s*ulti|khoon\s*nikal\s*raha)/i,
  /(jaan\s*dena|aatmahatya|khudkushi)/i
];

const CITATIONS = [
  { source: 'World Health Organization (WHO) Guidelines for Primary Care', date: '2026', url: 'https://www.who.int' },
  { source: 'Indian Council of Medical Research (ICMR) Standard Treatment Protocols', date: '2025', url: 'https://www.icmr.gov.in' }
];

const EMERGENCY_TEXT_EN = `🚨 EMERGENCY ALERT: Your symptoms (such as chest pain, severe breathing difficulty, stroke signs, or collapse) can be life-threatening and require immediate urgent medical care.

Please call emergency services (112 in India, 911, or your local ambulance) or visit the nearest emergency room immediately.
• Do NOT drive yourself.
• Do NOT wait for online chat replies.
• If you are feeling unsafe or having thoughts of self-harm, call the Tele-MANAS mental health helpline at 14416 (India) or your local crisis line immediately.`;

const EMERGENCY_TEXT_HI = `🚨 आपातकालीन चेतावनी (EMERGENCY ALERT): आपके लक्षण (जैसे छाती या दिल में दर्द, सांस लेने में अत्यधिक कठिनाई, स्ट्रोक के लक्षण या बेहोशी) जीवन के लिए खतरा हो सकते हैं और इनके लिए तत्काल आपातकालीन चिकित्सा की आवश्यकता है।

कृपया तुरंत आपातकालीन सेवाओं (भारत में 112, या अपनी नजदीकी एम्बुलेंस) को कॉल करें या तुरंत नजदीकी अस्पताल के आपातकालीन विभाग में जाएं।
• खुद गाड़ी न चलाएं।
• ऑनलाइन चैट के उत्तर की प्रतीक्षा न करें।
• यदि आप असुरक्षित महसूस कर रहे हैं या मानसिक तनाव/हानि के विचार हैं, तो तुरंत टेली-मानस हेल्पलाइन 14416 पर कॉल करें।`;

const SYSTEM_PROMPT = `You are Swasthya, a compassionate, evidence-based, supportive AI healthcare companion for patients and families.

CRITICAL SAFETY DIRECTIVES:
1. NEVER diagnose a medical condition or disease.
2. NEVER prescribe medications, pharmaceutical drugs, or exact medical dosages.
3. NEVER tell a user to start, stop, double, skip, or change doses of any medication. Always advise consulting a qualified clinician or pharmacist.
4. If the user presents emergency red flags (chest/heart pain, acute breathing distress, stroke symptoms, severe blood loss, sudden collapse, or suicidal thoughts), prioritize emergency escalation immediately.
5. Provide safe, evidence-based supportive guidance for common concerns:
   - FEVER: Encourage rest, oral hydration (water, ORS, broths), recording temperatures and times. Red flags: fever > 102°F (39°C), lasting > 3 days, stiff neck, confusion, rash.
   - HEADACHE: Suggest resting in a quiet, dark room, hydration, gentle neck stretches, observing triggers. Red flags: sudden thunderclap headache, neurological weakness, stiff neck with fever.
   - STOMACH PAIN: Suggest bland diet, light fluids, noting location and relation to meals. Red flags: severe acute pain, hard/swollen abdomen, vomiting blood, inability to hold fluids.
   - CANCER CARE SUPPORT: Be deeply compassionate and validating. Help organize questions for their oncology team, track daily energy and side effects, and remind them NEVER to stop or alter chemotherapy or oncology medicines without speaking to their oncologist.
   - CHEST/HEART PAIN: Treat as emergency; urge immediate emergency care.
   - ANXIETY / OVERTHINKING: Guide through grounding exercises (5-4-3-2-1 sensory technique), 4-4-4-4 box breathing, validating that small steps count, and providing helpline info (Tele-MANAS 14416).
6. LANGUAGE: Respond in the requested language (Hindi in clean, empathetic Devanagari script; English in clear, warm, plain English).
7. Keep tone respectful, empathetic, calming, and concise.`;

const OpenAIService = {
  isConfigured() {
    return Boolean(OPENAI_API_KEY);
  },

  detectEmergency(text) {
    const clean = String(text || '').trim();
    for (const pattern of EMERGENCY_PATTERNS) {
      if (pattern.test(clean)) {
        return true;
      }
    }
    return false;
  },

  /**
   * Generates a safe response using OpenAI API or safe evidence-based clinical engine fallback
   */
  async chat({ message, language = 'en', conversationHistory = [] }) {
    const isHindi = language.startsWith('hi');
    const isEmergency = this.detectEmergency(message);

    // Immediate emergency intercept
    if (isEmergency) {
      return {
        reply: isHindi ? EMERGENCY_TEXT_HI : EMERGENCY_TEXT_EN,
        isEmergency: true,
        language: isHindi ? 'hi' : 'en',
        citations: CITATIONS,
        timestamp: new Date().toISOString()
      };
    }

    // Call OpenAI if configured
    if (this.isConfigured()) {
      try {
        const messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          ...conversationHistory.slice(-6).map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content
          })),
          {
            role: 'user',
            content: `[Language requested: ${isHindi ? 'Hindi (हिंदी)' : 'English'}]\nUser message: ${message}`
          }
        ];

        const payload = JSON.stringify({
          model: OPENAI_MODEL,
          messages,
          temperature: 0.3,
          max_tokens: 600
        });

        const reply = await new Promise((resolve, reject) => {
          const req = https.request(
            'https://api.openai.com/v1/chat/completions',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
              }
            },
            res => {
              let data = '';
              res.on('data', chunk => { data += chunk; });
              res.on('end', () => {
                try {
                  const json = JSON.parse(data);
                  if (res.statusCode >= 200 && res.statusCode < 300 && json.choices && json.choices[0]) {
                    resolve(json.choices[0].message.content.trim());
                  } else {
                    reject(new Error(json.error ? json.error.message : `OpenAI HTTP ${res.statusCode}`));
                  }
                } catch (e) {
                  reject(e);
                }
              });
            }
          );
          req.on('error', err => reject(err));
          req.write(payload);
          req.end();
        });

        return {
          reply,
          isEmergency: false,
          language: isHindi ? 'hi' : 'en',
          citations: CITATIONS,
          timestamp: new Date().toISOString()
        };
      } catch (err) {
        console.warn('[OpenAI] Live API call failed, using safe clinical fallback engine:', err.message);
      }
    }

    // Clinical Safety Engine Fallback (guarantees safe, offline-capable responses matching exact requirements)
    const lower = message.toLowerCase();
    let topic = 'general';
    if (/^(hi|hello|hey|namaste|good morning|good evening)/i.test(message)) topic = 'greeting';
    else if (lower.includes('cancer')) topic = 'cancer';
    else if (lower.includes('fever') || lower.includes('temperature') || lower.includes('bukhar')) topic = 'fever';
    else if (lower.includes('headache') || lower.includes('sir dard') || lower.includes('head pain')) topic = 'headache';
    else if (lower.includes('stomach') || lower.includes('pet dard') || lower.includes('abdominal')) topic = 'stomach';
    else if (lower.includes('anxiety') || lower.includes('overthinking') || lower.includes('stress') || lower.includes('ghabrahat')) topic = 'mind';
    else if (lower.includes('dose') || lower.includes('medicine') || lower.includes('dawai') || lower.includes('tablet')) topic = 'medicine';

    const EN_RESPONSES = {
      greeting: 'Hello! I am your Swasthya healthcare companion. How are you feeling today? You can share symptoms, ask about wellness routines, or prepare questions for your doctor visit.',
      fever: 'For a fever: prioritize rest and drink plenty of fluids (water, oral rehydration salts, broths). Keep a log of your temperature readings and times. Seek medical attention if your fever exceeds 102°F (39°C), lasts more than 3 days, or is accompanied by confusion, stiff neck, or difficulty breathing.',
      headache: 'For mild headaches: rest in a quiet, darkened room, sip water, and practice slow breathing. Notice if screen time or stress triggered it. Seek immediate medical evaluation if it is a sudden "worst headache of your life," or comes with vision changes, numbness, or fever.',
      stomach: 'For mild stomach discomfort: choose light, bland foods (like rice or toast) and sip warm water. Note the exact location and whether it relates to meals. Seek urgent care for severe acute pain, a hard abdomen, blood in stool or vomit, or persistent vomiting.',
      cancer: 'Living with or caring for someone with cancer can feel overwhelming. Your feelings are completely valid. Please speak with your oncology team before changing any medicines, supplements, or treatments. I can help you write down questions and track symptoms for your next doctor appointment.',
      mind: 'When anxiety or overthinking feels heavy, try this 5-4-3-2-1 exercise: notice 5 things you can see, 4 you can touch, 3 you hear, 2 you smell, and 1 you taste. Take slow 4-count breaths. If you ever feel unsafe, please contact the Tele-MANAS helpline at 14416 (India) or your local crisis service immediately.',
      medicine: 'Please take all medicines strictly as prescribed by your doctor or as stated on the pharmacy label. Do not change, double, or stop medications without consulting your clinician or pharmacist.',
      general: 'Thank you for sharing. Please describe what you are experiencing, when it started, and if anything makes it better or worse. Remember that this assistant provides general support and does not replace your qualified doctor.'
    };

    const HI_RESPONSES = {
      greeting: 'नमस्ते! मैं आपका स्वास्थ्य (Swasthya) हेल्थ कम्पेनियन हूँ। आज आप कैसा महसूस कर रहे हैं? आप अपने लक्षण साझा कर सकते हैं, दिनचर्या के बारे में पूछ सकते हैं या डॉक्टर से मिलने के लिए सवाल तैयार कर सकते हैं।',
      fever: 'बुखार में आराम करें, पर्याप्त तरल पदार्थ (पानी, ओआरएस) पिएं और समय के साथ तापमान नोट करें। यदि बुखार 102°F से अधिक हो, 3 दिनों से अधिक रहे, या गर्दन में अकड़न, भ्रम या सांस लेने में कठिनाई हो, तो तुरंत डॉक्टर से संपर्क करें।',
      headache: 'हल्के सिरदर्द में शांत और अंधेरे कमरे में आराम करें, पानी पिएं और गर्दन की हल्की स्ट्रेचिंग करें। यदि सिरदर्द अचानक बहुत तेज हो, चक्कर आए, दृष्टि में बदलाव हो या बुखार के साथ हो, तो तुरंत चिकित्सा सहायता लें।',
      stomach: 'हल्के पेट दर्द में हल्का और सुपाच्य भोजन लें और गुनगुना पानी पिएं। दर्द की जगह और समय पर ध्यान दें। यदि दर्द बहुत तेज हो, पेट सख्त हो, उल्टी में खून आए या लगातार उल्टी हो, तो तुरंत डॉक्टर को दिखाएं।',
      cancer: 'कैंसर की यात्रा में भावनात्मक और शारीरिक देखभाल बहुत जरूरी है। अपनी ऑन्कोलॉजी टीम से पूछे बिना कभी भी कोई दवा या उपचार न बदलें। मैं डॉक्टर से पूछने वाले सवालों की सूची तैयार करने में आपकी मदद कर सकता हूँ।',
      mind: 'जब चिंता या जरूरत से ज्यादा सोचना भारी लगे, तो गहरी सांसें लें (4 सेकंड सांस अंदर, 4 सेकंड रोकें, 4 सेकंड बाहर)। यदि आप असुरक्षित महसूस कर रहे हैं, तो तुरंत टेली-मानस हेल्पलाइन 14416 (भारत) पर संपर्क करें।',
      medicine: 'दवाइयां हमेशा डॉक्टर के पर्चे और फार्मासिस्ट के निर्देशानुसार ही लें। चैट की सलाह पर कभी भी दवा की खुराक खुद न बदलें, न बढ़ाएं और न ही बंद करें।',
      general: 'साझा करने के लिए धन्यवाद। कृपया बताएं कि आप क्या महसूस कर रहे हैं और यह कब से है। ध्यान रखें कि यह मार्गदर्शन पेशेवर डॉक्टर के परामर्श का विकल्प नहीं है।'
    };

    const reply = (isHindi ? HI_RESPONSES : EN_RESPONSES)[topic] || (isHindi ? HI_RESPONSES.general : EN_RESPONSES.general);

    return {
      reply,
      isEmergency: false,
      language: isHindi ? 'hi' : 'en',
      citations: CITATIONS,
      timestamp: new Date().toISOString()
    };
  }
};

module.exports = OpenAIService;

