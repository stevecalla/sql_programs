'use strict';
// Pure, isomorphic text helpers for email bodies. No deps. Unit-tested.
//  - html_to_text: crude HTML -> readable text (TextBody is preferred; this is the fallback).
//  - strip_quoted_history: return only the NEW content of a reply by cutting at the earliest
//    quoted-history marker. Email-to-Case bodies accumulate the whole prior chain on each turn,
//    so this keeps the model (and exemplars) focused on what's actually new in each message.

function html_to_text(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const QUOTE_MARKERS = [
  /^\s*On .+wrote:\s*$/im,
  /^.*\bwrote:\s*$/im,
  /^\s*-{2,}\s*Original Message\s*-{2,}/im,
  /^\s*_{5,}\s*$/m,
  /^\s*From:\s.*@.*$/im,
  /^\s*>{1,}/m
];

function strip_quoted_history(text) {
  let s = String(text || '').replace(/\r\n/g, '\n');
  let cut = -1;
  for (let i = 0; i < QUOTE_MARKERS.length; i++) {
    const m = s.match(QUOTE_MARKERS[i]);
    if (m && m.index != null && (cut === -1 || m.index < cut)) cut = m.index;
  }
  if (cut > -1) s = s.slice(0, cut);
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { html_to_text, strip_quoted_history };
