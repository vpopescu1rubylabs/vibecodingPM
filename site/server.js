#!/usr/bin/env node
/* Zendocs server. Serves dist/ (built by build.py) and exposes /api/* routes.
 * AI routes receive field names + validator error messages only — never raw
 * field values (TFN, name, DOB, etc.) — so user PII never leaves the browser. */
'use strict';
const express = require('express');
const path = require('path');

const DIST = path.join(__dirname, 'dist');
const PORT = process.env.PORT || 3000;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Placeholder: explains a validator error in plain English. Body: { field, message }.
// Never accepts or forwards the user's actual field value.
app.post('/api/ai/explain', async (req, res) => {
  const { field, message } = req.body || {};
  if (typeof field !== 'string' || typeof message !== 'string') {
    return res.status(400).json({ error: 'field and message (strings) are required' });
  }
  // TODO: call the AI provider here using field + message only, e.g.:
  // const reply = await explainWithAI(field, message);
  res.json({ field, message, explanation: null, note: 'not yet implemented' });
});

app.use(express.static(DIST, { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`zendocs listening on :${PORT}`);
});
