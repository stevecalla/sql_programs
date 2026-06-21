'use strict';
// Deterministic, CONSERVATIVE spam heuristic for triage. Runs with NO AI call (so it works during a
// provider outage and costs nothing) and only flags CLEAR cold/bulk/marketing outreach, so it never
// hides a real member email. Uses only the EmailMessage fields we already fetch (sender / subject /
// body / links) — raw bulk-mail headers (List-Unsubscribe, Precedence) aren't queried.
//
// Tune the patterns/thresholds here. A hit returns { spam:true, reason }; anything ambiguous returns
// null so the AI classifier decides.

// Cold B2B / SEO / agency outreach — decisive on its own (these are never legitimate member email).
const COLD_OUTREACH = /\b(link[\s-]?building|guest post(ing)?|back ?links?|increase your (sales|traffic|ranking|revenue|conversions)|boost your (sales|traffic|ranking|seo|business|revenue)|search engine optimi[sz]ation|seo services|improve your (google )?ranking|drive (more )?traffic|grow your business|business proposal|partnership opportunit|collaboration opportunit|influencer marketing|press release distribution|web ?design services|mobile app development|app development services|lead generation|cold email|we can help you rank|rank (higher|on google)|outsourcing|virtual assistant services)\b/i;

// Generic marketing/promo keywords — only count when PAIRED with a bulk signal (opt-out or many links),
// so a single word in a normal email never trips it. (Deliberately excludes "unsubscribe"/"opt-out".)
const MARKETING = /\b(newsletter|% ?off|\$\d+ ?off|discount|promo(tion|tional)?|sale ends|limited[\s-]time|act now|free trial|webinar|special offer|exclusive offer|crypto|bitcoin|forex|casino|viagra|cialis|loan offer|wire transfer|investment opportunit)\b/i;

// Bulk-mail opt-out language (a strong "this is a mailing list" signal).
const OPT_OUT = /\b(unsubscribe|opt[\s-]?out|update your preferences|manage your subscription|email preferences|view (this )?(email )?in (your )?browser)\b/i;

// Count links (anchors in HTML, else bare URLs in text) — high counts suggest a promo blast.
function count_links(text, html) {
  let n = 0;
  if (html) { const m = String(html).match(/<a\s[^>]*href=/gi); if (m) n = m.length; }
  const urls = String(text || '').match(/https?:\/\//gi); if (urls) n = Math.max(n, urls.length);
  return n;
}

// message: { from_address, from_name, subject, text_new|text_raw, html_body }
// Returns { spam:true, reason } only for a CLEAR cold/bulk/marketing hit, else null.
function looks_like_spam(message) {
  const m = message || {};
  const hay = (String(m.subject || '') + '\n' + String(m.text_new || m.text_raw || '')).slice(0, 4000);
  const links = count_links(m.text_new || m.text_raw, m.html_body);
  const has_optout = OPT_OUT.test(hay);
  const has_marketing = MARKETING.test(hay);
  if (COLD_OUTREACH.test(hay)) return { spam: true, reason: 'Cold marketing / SEO outreach language.' };
  if (has_optout && has_marketing) return { spam: true, reason: 'Bulk marketing email (unsubscribe + promotional content).' };
  if (links >= 8 && has_marketing) return { spam: true, reason: 'Link-heavy promotional email (' + links + ' links).' };
  return null;
}

// Compact signal summary for grounding the AI prompt (sender is added by the caller).
function signal_summary(message) {
  const m = message || {};
  const links = count_links(m.text_new || m.text_raw, m.html_body);
  const opt = OPT_OUT.test(String(m.subject || '') + '\n' + String(m.text_new || m.text_raw || ''));
  return 'links=' + links + (opt ? ', has-unsubscribe=yes' : '');
}

module.exports = { looks_like_spam, signal_summary, count_links, COLD_OUTREACH, MARKETING, OPT_OUT };
