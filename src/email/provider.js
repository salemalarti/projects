// Email sending, isolated so the provider can be swapped without touching
// the rest of the app. Supported: "resend" (recommended) or "none".
// With "none" nothing is sent and callers are told so (never pretend).
const config = require('../config');
const logger = require('../logger');

async function sendWithResend({ to, subject, html, text }, { apiKey, from, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend responded HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json().catch(() => ({}));
  return { id: json.id || null };
}

function createEmailSender(emailConfig = config.email, { fetchImpl } = {}) {
  const enabled = emailConfig.provider === 'resend' && !!emailConfig.apiKey && !!emailConfig.from;
  return {
    enabled,
    async send(message) {
      if (!enabled) {
        logger.warn('Email not sent: EMAIL_PROVIDER is not configured', { subject: message.subject });
        return { sent: false, reason: 'not_configured' };
      }
      try {
        const { id } = await sendWithResend(message, { apiKey: emailConfig.apiKey, from: emailConfig.from, fetchImpl });
        logger.info('Email sent', { provider: 'resend', id });
        return { sent: true, id };
      } catch (err) {
        logger.error('Email sending failed', { reason: err.message });
        return { sent: false, reason: 'send_failed' };
      }
    },
  };
}

module.exports = { createEmailSender };
