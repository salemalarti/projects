(function () {
  const { getJson, track, compact, formatUtc, escapeHtml } = window.RA;
  const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

  track('landing_view', { referrer: document.referrer ? new URL(document.referrer).hostname : '' });

  // FAQ toggle
  document.querySelectorAll('.faq-item').forEach((item) => {
    item.classList.add('closed');
    item.addEventListener('click', () => item.classList.toggle('closed'));
  });

  // Live stats from our database (section stays hidden if unavailable).
  Promise.all([getJson('/games?sort=playing&limit=1'), getJson('/genres')])
    .then(([games, genres]) => {
      if (!games.data.length) return;
      const top = games.data[0];
      document.getElementById('stat-games').textContent = compact(games.meta.total);
      document.getElementById('stat-top-players').textContent = compact(top.concurrentPlayers);
      document.getElementById('stat-top-label').textContent = 'Players in ' + top.name + ' when last measured';
      document.getElementById('stat-genres').textContent = genres.data.length;
      if (games.meta.dataUpdatedAt) {
        document.getElementById('stat-updated').textContent = 'Data updated: ' + formatUtc(games.meta.dataUpdatedAt) + ' · Source: Roblox public endpoints';
      }
      document.getElementById('live-stats').hidden = false;
    })
    .catch(() => {});

  const form = document.getElementById('beta-form');
  const button = document.getElementById('submit-btn');
  const message = document.getElementById('form-message');
  let started = false;

  form.addEventListener('input', () => {
    if (!started) { started = true; track('signup_started'); }
  });

  function showMessage(kind, html) {
    message.className = 'form-message show ' + kind;
    message.innerHTML = html;
  }

  function setFieldError(field, text) {
    document.getElementById(field + '-error').textContent = text || '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      robloxUsername: form.roblox.value.trim(),
      gameExperience: form.games.value.trim(),
      interest: form.interest.value.trim(),
      website: form.website.value,
      source: new URLSearchParams(location.search).get('ref') || 'landing',
    };

    // Frontend validation (the server validates again).
    let ok = true;
    setFieldError('name'); setFieldError('email');
    if (!data.name) { setFieldError('name', 'Please enter your name'); ok = false; }
    if (!EMAIL_RE.test(data.email)) { setFieldError('email', 'Please enter a valid email address'); ok = false; }
    if (!ok) { showMessage('error', 'Please fix the highlighted fields.'); return; }

    button.disabled = true;
    button.textContent = 'Joining...';
    message.className = 'form-message';
    track('signup_submitted');

    try {
      const res = await getJson('/beta-signups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      let html = '<strong>✅ ' + escapeHtml(res.message) + '</strong>';
      if (res.emailSent) {
        html += '<br><br>Check your inbox for a confirmation email from us. Click the link inside to open your dashboard. (Check spam if you don\'t see it within a few minutes.)';
      }
      if (res.accessUrl) {
        html += '<br><br><a href="' + escapeHtml(res.accessUrl) + '">Open my beta dashboard →</a>';
      }
      html += '<br><br>We\'ll reach out in a few days to ask what you\'d need from this tool.';
      showMessage('success', html);
      form.reset();
    } catch (err) {
      const fields = (err.body && err.body.details) || {};
      Object.keys(fields).forEach((f) => { if (document.getElementById(f + '-error')) setFieldError(f, fields[f]); });
      showMessage('error', '❌ ' + escapeHtml(err.message || 'Something went wrong. Please try again.'));
      track('signup_failed', { status: err.status || 0 });
    } finally {
      button.disabled = false;
      button.textContent = 'Join the Free Beta';
    }
  });
})();
