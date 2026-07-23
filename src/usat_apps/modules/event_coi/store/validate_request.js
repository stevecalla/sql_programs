'use strict';
// validate_request.js — server-side gate for a full COI request, mirroring the Section.jsx UI gating.
// Returns { ok, problems } where problems is a human-readable list of what's missing. Used to guard the
// submission run (Phase 4) and unit-tested directly (see ../tests/validate_request.test.js).

function s(v) { return String(v == null ? '' : v).trim(); }

function validateRequest(req) {
  req = req || {};
  const event = req.event || {};
  const requestor = req.requestor || {};
  const holders = Array.isArray(req.holders) ? req.holders : [];
  const problems = [];

  if (!/^\d{6}$/.test(s(event.sanctionId))) problems.push('Sanction ID (6 digits)');
  if (!s(event.eventName)) problems.push('Event Name');
  if (!s(event.eventStartDate)) problems.push('Event Start Date');
  if (!s(event.eventEndDate)) problems.push('Event End Date');
  if (!s(requestor.name)) problems.push('Your Name');
  if (!s(requestor.email)) problems.push('Your Email Address');
  else if (!/.+@.+\..+/.test(s(requestor.email))) problems.push('a valid requestor email');
  if (!holders.length) problems.push('at least one holder');

  const mn = holders.filter((h) => !s(h.name)).length;
  const me = holders.filter((h) => !s(h.email)).length;
  if (mn) problems.push(mn + ' holder name' + (mn === 1 ? '' : 's'));
  if (me) problems.push(me + ' holder email' + (me === 1 ? '' : 's'));

  return { ok: problems.length === 0, problems };
}

module.exports = { validateRequest };
