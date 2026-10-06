// Email templates. Plain HTML + text, no external assets.
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function confirmationEmail({ name, confirmUrl }) {
  const safeName = escapeHtml(name);
  return {
    subject: 'Confirm your email to get Roblox Analytics beta access',
    text: `Hi ${name},

Thanks for joining the Roblox Analytics beta!

Confirm your email and open your dashboard here:
${confirmUrl}

This link is personal - please don't share it. It expires in 72 hours.
If you didn't sign up, you can ignore this email.`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#222">
  <h2 style="color:#5a4fcf">Welcome to the Roblox Analytics beta, ${safeName}!</h2>
  <p>Click the button below to confirm your email and open your dashboard.</p>
  <p style="margin:28px 0"><a href="${escapeHtml(confirmUrl)}" style="background:#5a4fcf;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Confirm &amp; open dashboard</a></p>
  <p style="font-size:13px;color:#666">This link is personal - please don't share it. It expires in 72 hours.<br>If you didn't sign up, you can ignore this email.</p>
</div>`,
  };
}

module.exports = { confirmationEmail, escapeHtml };
