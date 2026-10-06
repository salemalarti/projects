const express = require('express');
const { getDb } = require('../db');
const { recordEvent, ALLOWED_EVENTS } = require('../repositories/events');
const { asyncHandler, HttpError } = require('../middleware/errors');

const router = express.Router();

router.post('/events', asyncHandler(async (req, res) => {
  const { name, path, sessionId, props } = req.body || {};
  if (!ALLOWED_EVENTS.has(name)) throw new HttpError(400, 'Unknown event name');
  const cleanProps = {};
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const [k, v] of Object.entries(props).slice(0, 10)) {
      if (['string', 'number', 'boolean'].includes(typeof v)) cleanProps[String(k).slice(0, 40)] = typeof v === 'string' ? v.slice(0, 200) : v;
    }
  }
  await recordEvent(await getDb(), {
    name,
    path: typeof path === 'string' ? path.slice(0, 200) : null,
    sessionId: typeof sessionId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(sessionId) ? sessionId : null,
    props: cleanProps,
  });
  res.status(204).end();
}));

module.exports = router;
