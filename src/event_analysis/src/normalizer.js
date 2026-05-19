/**
 * normalizer.js — event name normalisation + token extraction for fuzzy matching.
 *
 * Mirrors the Python norm() / tokens() functions exactly.
 */

'use strict';

const SPORT_WORDS = new Set([
  'triathlon','duathlon','aquathlon','aquabike','multisport',
  'triathlete','race','run','swim','bike','cycling',
]);

const STOP_WORDS = new Set([
  'the','a','an','of','and','or','in','at','by','for','to','from','with','de',
]);

const WORD_ORDINALS =
  /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\b/gi;

/**
 * Normalise an event name for comparison:
 *  - lowercase + trim
 *  - strip apostrophes / backticks
 *  - strip sponsor phrases ("presented by …")
 *  - strip 4-digit years (20xx / 19xx)
 *  - strip ordinal + Annual/Edition  ("12th Annual" → "")
 *  - strip word-based ordinals + Annual/Edition ("Eighth Annual" → "")
 *  - strip bare "Annual" / "Edition" / "Anniversary"
 *  - strip standalone ordinals at word boundaries  ("14th" → "")
 *  - collapse non-alphanumeric to spaces
 */
function norm(name) {
  let s = name.toLowerCase().trim();

  // Remove apostrophes / backtick variants
  s = s.replace(/[`'''']/g, '');

  // Remove sponsor phrases and everything after them
  s = s.replace(/\b(presented by|sponsored by|powered by|hosted by|benefiting)\b.*/gi, '');

  // Strip 4-digit years
  s = s.replace(/\b(19|20)\d{2}\b/g, '');

  // Strip  digit-ordinal + Annual/Edition/Anniversary  ("12th Annual", "3rd Edition")
  s = s.replace(/\b\d+\s*(st|nd|rd|th)\s+(annual|edition|anniversary)\b/gi, '');

  // Strip word-based ordinal + Annual/Edition  ("Eighth Annual")
  s = s.replace(new RegExp(WORD_ORDINALS.source + '\\s+(annual|edition|anniversary)\\b', 'gi'), '');

  // Strip bare "Annual" / "Edition" / "Anniversary"
  s = s.replace(/\bannual\b|\bedition\b|\banniversary\b/gi, '');

  // Strip standalone digit-ordinals at word boundaries
  // but NOT when followed by place/overall/division/age/century
  s = s.replace(
    /(?:^|(?<=[\s,\-]))\d+\s*(?:st|nd|rd|th)\b(?!\s*(?:place|overall|division|age|century))/gi,
    '',
  );

  // Collapse non-alphanumeric to spaces
  s = s.replace(/[^a-z0-9]/g, ' ');

  // Collapse whitespace
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Extract a Set of meaningful tokens from a (already-normalised) name.
 * Removes sport words, stop words, and single-character tokens.
 */
function tokens(name) {
  const raw = norm(name).split(' ').filter(Boolean);
  return new Set(
    raw.filter(t => t.length > 1 && !SPORT_WORDS.has(t) && !STOP_WORDS.has(t)),
  );
}

/**
 * Jaccard similarity between two Sets.
 */
function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let intersect = 0;
  for (const x of setA) { if (setB.has(x)) intersect++; }
  return intersect / (setA.size + setB.size - intersect);
}

/**
 * Date-proximity factor: 1.0 = same month, decays to 0 at 5+ months apart.
 */
function dateFactor(m1, m2) {
  const diff = Math.min(Math.abs(m1 - m2), 12 - Math.abs(m1 - m2));
  return Math.max(0, 1.0 - diff * 0.22);
}

/**
 * Combined matching score (name-weighted, date-secondary).
 * Returns { score, nameScore, dateScore }.
 */
function matchScore(name25, month25, name26, month26) {
  const ns = jaccard(tokens(name25), tokens(name26));
  const ds = dateFactor(month25, month26);
  return { score: 0.82 * ns + 0.18 * ds, nameScore: ns, dateScore: ds };
}

/**
 * Returns true if the two names have conflicting sport types
 * (e.g. one is "triathlon" and other is "duathlon").
 */
function sportConflict(name1, name2) {
  const n1 = norm(name1).split(' ');
  const n2 = norm(name2).split(' ');
  const pairs = [
    ['triathlon', 'duathlon'],
    ['triathlon', 'aquathlon'],
    ['duathlon',  'aquathlon'],
  ];
  for (const [a, b] of pairs) {
    if ((n1.includes(a) && n2.includes(b)) || (n1.includes(b) && n2.includes(a))) {
      return true;
    }
  }
  return false;
}

/**
 * Confidence tier for a fuzzy match.
 */
function confidence(nameScore, dateScore, isExact, isExactShifted = false) {
  if (isExact)         return 'Exact';
  if (isExactShifted)  return 'Exact-Shifted';
  if (nameScore >= 0.85 && dateScore >= 0.78) return 'High';
  if (nameScore >= 0.65 && dateScore >= 0.56) return 'Medium';
  if (nameScore >= 0.55)                       return 'Low';
  return 'None';
}

module.exports = { norm, tokens, jaccard, dateFactor, matchScore, sportConflict, confidence };
