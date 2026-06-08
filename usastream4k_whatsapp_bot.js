require('dotenv').config();
const express = require('express');
const twilio  = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');

const app    = express();
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const ai     = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const sessions = new Map();

const SYSTEM_PROMPT = `You are the AI support agent for USA Stream 4K (usastream4k.com), an IPTV streaming service. Your personality is friendly, casual, and helpful — like a knowledgeable friend, not a corporate robot. Use occasional emojis. Keep replies concise (max 5-6 lines — this is WhatsApp).

BUSINESS INFO:
- Service: USA Stream 4K IPTV (18,000+ live channels, 4K quality, USA focused)
- Website: usastream4k.com
- Supported devices: Firestick, Android TV, Smart TV (Samsung/LG), MAG box, Formuler, iPhone/Android, Windows/Mac
- Plans: 1 Month $15 | 3 Months $35 | 6 Months $60 | 12 Months $90
- Trial: 24-hour FREE trial available — they need to request it and we will send credentials
- Payment: PayPal, Credit Card, Crypto
- Channels: 18,000+ live channels, 60,000+ VOD, PPV events, all USA sports (NFL, NBA, MLB, NHL)

INSTALLATION GUIDES:
Firestick: Settings > My Fire TV > Developer Options > turn ON Apps from Unknown Sources > open Downloader app > enter troypoint.com/iptv > install IPTV Smarters or TiviMate > enter your M3U URL from email
Smart TV (Samsung/LG): Download Smart IPTV or IPTV Smarters from the app store > enter your M3U URL
Android/Android TV: IPTV Smarters Pro from Play Store > enter M3U + EPG URL from your order email
iPhone/iPad: GSE Smart IPTV from App Store > add M3U URL from your order email
MAG Box: System Settings > Servers > Portals > enter your portal URL
Windows/Mac: VLC or IPTV Smarters for desktop > load M3U file

INTENT CLASSIFICATION — always start your reply with one of these on its own line:
INTENT:installation
INTENT:pricing
INTENT:trial
INTENT:url-update
INTENT:freezing
INTENT:renewal
INTENT:escalate

ESCALATE if: payment dispute, suspended account, complaint, or complex issue you cannot resolve.
NEVER invent M3U URLs or credentials — those are sent by email after purchase or trial approval.
Use line breaks for readability. Be warm, helpful, and conversational.`;

function parseReply(raw) {
  const lines = raw.trim().split('\n');
  let intent = 'unknown';
  let reply = raw.trim();
  if (lines[0].startsWith('INTENT:')) {
    intent = lines[0].replace('INTENT:', '').trim();
    reply = lines.slice(1).join('\n').trim();
  }
  return { intent, reply };
}

function logEvent(phone, intent, inbound, outbound) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    phone: phone.replace('whatsapp:', ''),
    intent,
    inbound,
    outbound: outbound.slice(0, 80) + (outbound.length > 80 ? '...' : '')
  }));
}

app.post('/whatsapp', async (req, res) => {
  const from    = req.body.From;
  const msgBody = (req.body.Body || '').trim();

  if (!from || !msgBody) {
    return res.status(200).send('<Response></Response>');
  }

  if (!sessions.has(from)) sessions.set(from, []);
  const history = sessions.get(from);
  history.push({ role: 'user', content: msgBody });
  if (history.length > 20) history.splice(0, 2);

  let replyText = "Hey! Something went wrong on my end. Try again in a sec 🙏";
  let intent = 'error';

  try {
    const aiRes = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: history
    });

    const raw = aiRes.content?.[0]?.text || '';
    ({ intent, reply: replyText } = parseReply(raw));

    history.push({ role: 'assistant', content: raw });

    if (intent === 'escalate') {
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to:   process.env.OWNER_WHATSAPP_NUMBER,
        body: `ESCALATION NEEDED\nClient: ${from.replace('whatsapp:','')}\nMessage: "${msgBody}"\n\nReply directly to the client.`
      });
    }

  } catch (err) {
    console.error('AI error:', err.message);
  }

  logEvent(from, intent, msgBody, replyText);

  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to:   from,
    body: replyText
  });

  res.status(200).send('<Response></Response>');
});

app.get('/', (req, res) => res.json({ status: 'USA Stream 4K bot running' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
