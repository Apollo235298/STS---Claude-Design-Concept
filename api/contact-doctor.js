// Vercel serverless function (Node runtime, CommonJS).
// Receives a provider "Contact the Doctor" inquiry and emails it to the office via Resend.
// The Resend API key is read from the environment and never exposed to the client.
// The email body is built DYNAMICALLY from the submitted payload (label/value pairs),
// so any future field added to the form's payload appears in the email automatically.
const { Resend } = require('resend');

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const escMl = (s) => esc(s).replace(/\r?\n/g, '<br>');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { RESEND_API_KEY, STS_INQUIRY_TO_EMAIL: TO, STS_INQUIRY_FROM_EMAIL: FROM } = process.env;
  if (!RESEND_API_KEY || !TO || !FROM) {
    console.error('Missing env: RESEND_API_KEY / STS_INQUIRY_TO_EMAIL / STS_INQUIRY_FROM_EMAIL');
    return res.status(500).json({ ok: false, error: 'Server not configured' });
  }

  // Vercel parses JSON request bodies automatically. Reading req.body can throw on a
  // malformed JSON payload, so guard it and return a clean 400 rather than a 500.
  let body;
  try {
    body = req.body || {};
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid request body' });
  }
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  // Honeypot: a filled "company" field means a bot — pretend success, send nothing.
  if (body.company) return res.status(200).json({ ok: true });

  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);

  // Known fields, in the form's visual order (this order drives the email body).
  const data = {
    desired_service_mix: str(body.desired_service_mix),
    best_days: arr(body.best_days),
    available_operatories: str(body.available_operatories),
    participating_insurances: arr(body.participating_insurances),
    insurance_other: str(body.insurance_other),
    annual_collections: str(body.annual_collections),
    practice_name: str(body.practice_name),
    contact_name: str(body.contact_name),
    email: str(body.email),
    phone: str(body.phone),
  };

  // Constrain the button-group fields to their known options (the client only renders these).
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const OPERATORIES = ['1', '2', '3'];
  const INSURANCES = [
    'Medicaid / Skygen / Aetna',
    'Medicaid / United Healthcare',
    'Medicaid / Avesis / WellCare',
    'Delta Dental',
    'Other',
  ];
  data.best_days = data.best_days.filter((d) => DAYS.includes(d));
  data.participating_insurances = data.participating_insurances.filter((i) => INSURANCES.includes(i));
  if (!OPERATORIES.includes(data.available_operatories)) data.available_operatories = '';
  // The free-text plan name only applies while "Other" is selected.
  if (!data.participating_insurances.includes('Other')) data.insurance_other = '';

  // Server-side validation (don't trust the client).
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email);
  const invalid =
    !data.annual_collections ||
    !data.desired_service_mix ||
    data.best_days.length === 0 ||
    !data.available_operatories ||
    data.participating_insurances.length === 0 ||
    !data.practice_name ||
    !data.contact_name ||
    !data.phone ||
    !emailOk;

  if (invalid) return res.status(400).json({ ok: false, error: 'Missing or invalid fields' });

  // Single-line, control-character-free value for the email subject header.
  const who = (data.practice_name || data.contact_name).replace(/[\r\n]+/g, ' ').trim();
  const subject = `New website question submitted: ${who}`;

  let submittedAt;
  try {
    submittedAt =
      new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
        dateStyle: 'full',
        timeStyle: 'short',
      }) + ' ET';
  } catch {
    submittedAt = new Date().toISOString();
  }

  // ── Dynamic email body ──────────────────────────────────────────────────
  // Render EVERY submitted field as a "Label: value" pair by iterating the
  // payload — never by referencing fields one at a time — so a future form
  // field shows up in the email with no change here. Known keys use the
  // form's question text; unknown keys fall back to a humanized key name.
  const OMIT = new Set(['company']); // honeypot — never rendered
  const LABELS = {
    desired_service_mix: 'What service mix are you hoping to have?',
    best_days: 'What days work best for us to come operate in your office?',
    available_operatories: 'How many operatories can you make available?',
    participating_insurances: 'What insurances do you currently participate with?',
    insurance_other: 'Other insurance (plan name)',
    annual_collections: 'Approximately what is your office collecting per year?',
    practice_name: 'Practice name',
    contact_name: 'Contact name',
    email: 'Email',
    phone: 'Phone',
  };
  const humanize = (key) => {
    const s = String(key).replace(/[_-]+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(key);
  };

  // Start from the sanitized known fields (form order), then append any extra
  // payload keys (future form fields) with generic string/array sanitizing.
  const rendered = { ...data };
  for (const [key, raw] of Object.entries(body)) {
    if (key in rendered || OMIT.has(key)) continue;
    if (Array.isArray(raw)) rendered[key] = arr(raw);
    else if (typeof raw === 'string') rendered[key] = raw.trim();
    else if (typeof raw === 'number' || typeof raw === 'boolean') rendered[key] = String(raw);
  }

  const fields = Object.entries(rendered)
    .map(([key, v]) => ({
      key,
      label: LABELS[key] || humanize(key),
      value: Array.isArray(v) ? v.join(', ') : v,
    }))
    .filter((f) => f.value); // optional fields (e.g. insurance_other) drop out when empty

  const text = `New website question submitted

${fields.map((f) => `${f.label}: ${f.value}`).join('\n')}

Submitted at: ${submittedAt}
Source: www.stsurgery.com Contact the Doctor modal`;

  const labelStyle = 'font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#5a6776';
  const valueStyle = 'font-size:14px;color:#273349';
  const block = (f) =>
    `<p style="margin:0 0 14px"><span style="${labelStyle}">${esc(f.label)}</span><br><span style="${valueStyle}">${escMl(f.value)}</span></p>`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#273349;max-width:640px;line-height:1.5">
  <h2 style="font-size:18px;margin:0 0 16px">New website question submitted</h2>
  ${fields.map(block).join('\n  ')}
  <hr style="border:none;border-top:1px solid #e3e6ea;margin:18px 0 12px">
  <p style="margin:0;font-size:12px;color:#5a6776">Submitted at: ${esc(submittedAt)}<br>Source: www.stsurgery.com Contact the Doctor modal</p>
</div>`;

  try {
    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM,
      to: TO,
      replyTo: data.email,
      subject,
      text,
      html,
    });
    if (error) {
      console.error('Resend error:', error);
      return res.status(502).json({ ok: false, error: 'Send failed' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Resend exception:', err);
    return res.status(502).json({ ok: false, error: 'Send failed' });
  }
};
