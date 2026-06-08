/**
 * USA Stream 4K — WhatsApp AI Support Bot
 * Stack: Node.js + Express + Twilio + Anthropic Claude
 *
 * SETUP:
 * 1. npm install express twilio @anthropic-ai/sdk dotenv
 * 2. Create .env file with your keys (see bottom)
 * 3. Deploy to Railway / Render / VPS
 * 4. Set Twilio WhatsApp webhook URL to: https://your-domain.com/whatsapp
 */

require('dotenv').config();
const express = require('express');
const twilio  = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');

const app    = express();
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const ai     = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── In-memory conversation history (swap for Redis/DB in production) ───────
const sessions = new Map(); // phone → [{ role, content }]

// ─── AI System Prompt ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the AI support agent for USA Stream 4K (usastream4k.com), an IPTV streaming service. Your personality is friendly, casual, and helpful — like a knowledgeable friend, not a corporate robot. Use occasional emojis. Keep replies concise (max 5-6 lines — this is WhatsApp).

BUSINESS INFO:
- Service: USA Stream 4K IPTV (18,000+ live channels, 4K quality, USA focused)
- Website: usastream4k.com
- Supported devices: Firestick, Android TV, Smart TV (Samsung/LG), MAG box, Formuler, iPhone/Android, Windows/Mac
- Plans: 1 Month $15 | 3 Months $35 | 6 Months $60 | 12 Months $90
- Trial: 24-hour FREE trial available — they need to request it and we'll send credentials
- Payment: PayPal, Credit Card, Crypto
- Channels: 18,000+ live channels, 60,000+ VOD, PPV events, all USA sports (NFL, NBA, MLB, NHL)

INSTALLATION GUIDES:
🔥 Firestick: Settings > My Fire TV > Developer Options > turn ON "Apps from Unknown Sources" > open Downloader app > enter troypoint.com/iptv > install IPTV Smarters or TiviMate > enter your M3U URL from email
📺 Smart TV (Samsung/LG): Download Smart IPTV or IPTV Smarters from the app store > enter your M3U URL
📱 Android/Android TV: IPTV Smarters Pro from Play Store > enter M3U + EPG URL from your order email
🍎 iPhone/iPad: GSE Smart IPTV from App Store > add M3U URL from your order email
📦 MAG Box: System Settings > Servers > Portals > enter your portal URL
💻 Windows/Mac: VLC or IPTV Smarters for desktop > load M3U file

INTENT CLASSIFICATION — always start your reply with one of:
INTENT:installation | INTENT:pricing | INTENT:trial | INTENT:url-update | INTENT:freezing | INTENT:renewal | INTENT:escalate

ESCALATE (flag for human takeover) if: payment dispute, suspended account, complaint, or complex issue you cannot resolve.

NEVER invent M3U URLs or credentials — those are sent by email after purchase or trial approval.
Use line breaks for readability. Be warm, helpful, and conversational.`;

// ─── Classify & extract intent from AI reply ─────────────────────────────────
function parseReply(raw) {
  const lines = raw.trim().split('\n');
  let intent = 'unknown';
  let reply   = raw.trim();

  if (lines[0].startsWith('INTENT:')) {
    intent = lines[0].replace('INTENT:', '').trim();
    reply  = lines.slice(1).join('\n').trim();
  }
  return { intent, reply };
}

// ─── Log every conversation (extend to DB as needed) ─────────────────────────
function logEvent(phone, intent, inbound, outbound) {
  console.log(JSON.stringify({
    ts:       new Date().toISOString(),
    phone:    phone.replace('whatsapp:', ''),
    intent,
    inbound,
    outbound: outbound.slice(0, 80) + (outbound.length > 80 ? '…' : '')
  }));
}

// ─── Main webhook ─────────────────────────────────────────────────────────────
app.post('/whatsapp', async (req, res) => {
  const from    = req.body.From;   // e.g. whatsapp:+12025551234
  const msgBody = (req.body.Body || '').trim();

  if (!from || !msgBody) {
    return res.status(200).send('<Response></Response>');
  }

  // Build/extend conversation history (last 10 turns for context)
  if (!sessions.has(from)) sessions.set(from, []);
  const history = sessions.get(from);
  history.push({ role: 'user', content: msgBody });
  if (history.length > 20) history.splice(0, 2); // keep last 10 pairs

  let replyText = "Hey! Something went wrong on my end. Try again in a sec 🙏";
  let intent    = 'error';

  try {
    const aiRes = await ai.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 600,
      system:     SYSTEM_PROMPT,
      messages:   history
    });

    const raw = aiRes.content?.[0]?.text || '';
    ({ intent, reply: replyText } = parseReply(raw));

    // Save assistant reply to history
    history.push({ role: 'assistant', content: raw });

    // If escalation needed — notify YOU via WhatsApp
    if (intent === 'escalate') {
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to:   process.env.OWNER_WHATSAPP_NUMBER,
        body: `⚡ *ESCALATION NEEDED*\n📱 Client: ${from.replace('whatsapp:','')}\n💬 Message: "${msgBody}"\n\nReply directly to the client or log in to handle.`
      });
    }

  } catch (err) {
    console.error('AI error:', err.message);
  }

  logEvent(from, intent, msgBody, replyText);

  // Send reply via Twilio
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to:   from,
    body: replyText
  });

  res.status(200).send('<Response></Response>');
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'USA Stream 4K bot running ✅' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));

/**
 * .env file — create this in the same folder:
 * ─────────────────────────────────────────────
 * TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 * TWILIO_AUTH_TOKEN=your_auth_token
 * TWILIO_WHATSAPP_NUMBER=whatsapp:+1415xxxxxxx   ← your Twilio WA number
 * OWNER_WHATSAPP_NUMBER=whatsapp:+212xxxxxxxxx   ← YOUR personal number for escalations
 * ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxx
 * PORT=3000
 *
 * DEPLOY TO RAILWAY (free tier works):
 * 1. Push this file + package.json to a GitHub repo
 * 2. Go to railway.app > New Project > Deploy from GitHub
 * 3. Add the .env variables in Railway's settings panel
 * 4. Copy the Railway URL → paste in Twilio WhatsApp sandbox webhook
 * 5. Done ✅
 */
