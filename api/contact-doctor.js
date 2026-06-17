// Vercel serverless function (Node runtime, CommonJS).
// Receives a provider "Contact the Doctor" inquiry and emails it to the office via Resend.
// The Resend API key is read from the environment and never exposed to the client.
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

  const data = {
    annual_collections: str(body.annual_collections),
    desired_service_mix: str(body.desired_service_mix),
    best_days: arr(body.best_days),
    available_operatories: str(body.available_operatories),
    participating_insurances: arr(body.participating_insurances),
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
  ];
  data.best_days = data.best_days.filter((d) => DAYS.includes(d));
  data.participating_insurances = data.participating_insurances.filter((i) => INSURANCES.includes(i));
  if (!OPERATORIES.includes(data.available_operatories)) data.available_operatories = '';

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

  const days = data.best_days.join(', ');
  const insurances = data.participating_insurances.join(', ');

  const text = `New website question submitted

Practice Information:
Practice name: ${data.practice_name}
Contact name: ${data.contact_name}
Email: ${data.email}
Phone: ${data.phone}

Opportunity:
Approximate annual collections: ${data.annual_collections}
Desired service mix: ${data.desired_service_mix}
Best days for STS to visit: ${days}
Available operatories: ${data.available_operatories}
Participating insurances: ${insurances}

Submitted:
Submitted at: ${submittedAt}
Source: www.stsurgery.com Contact the Doctor modal`;

  const labelCell = 'padding:4px 12px 4px 0;color:#5a6776;white-space:nowrap;vertical-align:top';
  const valueCell = 'padding:4px 0;color:#273349';
  const row = (label, value) =>
    `<tr><td style="${labelCell}">${esc(label)}</td><td style="${valueCell}">${esc(value)}</td></tr>`;
  const rowMl = (label, value) =>
    `<tr><td style="${labelCell}">${esc(label)}</td><td style="${valueCell}">${escMl(value)}</td></tr>`;
  const heading = 'font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#b88560;margin:20px 0 6px';

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#273349;max-width:640px;line-height:1.5">
  <h2 style="font-size:18px;margin:0 0 4px">New website question submitted</h2>

  <h3 style="${heading}">Practice Information</h3>
  <table style="border-collapse:collapse;font-size:14px">
    ${row('Practice name:', data.practice_name)}
    ${row('Contact name:', data.contact_name)}
    ${row('Email:', data.email)}
    ${row('Phone:', data.phone)}
  </table>

  <h3 style="${heading}">Opportunity</h3>
  <table style="border-collapse:collapse;font-size:14px">
    ${row('Approximate annual collections:', data.annual_collections)}
    ${rowMl('Desired service mix:', data.desired_service_mix)}
    ${row('Best days for STS to visit:', days)}
    ${row('Available operatories:', data.available_operatories)}
    ${row('Participating insurances:', insurances)}
  </table>

  <h3 style="${heading}">Submitted</h3>
  <table style="border-collapse:collapse;font-size:14px">
    ${row('Submitted at:', submittedAt)}
    ${row('Source:', 'www.stsurgery.com Contact the Doctor modal')}
  </table>
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
