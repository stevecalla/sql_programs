/**
 * nicknames.js — Nickname equivalence for first names (Bob ~ Robert).
 *
 * Thin wrapper over the `nicknames-curated` npm package (the hand-curated
 * carltonnorthern US given-name dataset). The package's relationship is
 * DIRECTIONAL — `al` is a nickname of `alexander`, but not the reverse — and two
 * nicknames of the same root (bob, bobby -> robert) are not directly linked. So
 * this module defines our own *symmetric* equivalence on top of it.
 *
 * Design notes (mirrors normalize.js / matcher.js):
 *   - Pure-style: the only side effect is lazily constructing one NickNamer the
 *     first time it is needed (the dataset is loaded once for the whole run).
 *   - The equivalence functions take the NickNamer as an injectable argument so
 *     unit tests can pass a fake and never touch the real dataset.
 *   - First-name ONLY. Nicknames never apply to surnames.
 */

'use strict';

const { NickNamer } = require('nicknames-curated');

// Lazily-built singleton (the dataset parse happens once per process).
let _namer = null;
function get_namer() {
    if (!_namer) _namer = new NickNamer();
    return _namer;
}

// Normalize a first name to a dataset lookup key: lowercase, letters only. The
// package already ignores case/whitespace; we also strip punctuation so things
// like "Jo-Ann" or "Bob." reduce to a clean token. Returns "" when empty.
function nn_key(value) {
    return (value || '').toLowerCase().replace(/[^a-z]/g, '');
}

// A name's full set of interchangeable forms in ONE direction: its nicknames
// plus its canonicals. Returns a Set of lookup keys.
function related_set(key, namer) {
    return new Set([...namer.nicknamesOf(key), ...namer.canonicalsOf(key)]);
}

// Symmetric, transitive-through-a-shared-root nickname equivalence between two
// first names. TRUE when the names are different but interchangeable per the
// dataset. FALSE for empty input or identical names (those are an exact match,
// not a nickname relationship).
function are_nickname_equivalents(a, b, namer = get_namer()) {
    const ka = nn_key(a);
    const kb = nn_key(b);

    if (!ka || !kb) return false;
    if (ka === kb) return false; // identical -> handled by exact matching

    // direction a -> b
    if (related_set(ka, namer).has(kb)) return true;
    // direction b -> a
    if (related_set(kb, namer).has(ka)) return true;

    // shared canonical root: bob ~ bobby (both -> robert)
    const canon_a = namer.canonicalsOf(ka);
    const canon_b = namer.canonicalsOf(kb);
    for (const c of canon_a) {
        if (canon_b.has(c)) return true;
    }

    return false;
}

// Short human-readable explanation of why two first names are nickname-equivalent.
// Used for the reason columns in the nickname + consolidated outputs.
function nickname_reason(a, b, namer = get_namer()) {
    const ka = nn_key(a);
    const kb = nn_key(b);

    if (!are_nickname_equivalents(a, b, namer)) {
        return `First names "${a}" and "${b}" are not nickname-equivalent.`;
    }

    if (related_set(ka, namer).has(kb) || related_set(kb, namer).has(ka)) {
        return `First names are nickname-equivalent: "${a}" <-> "${b}" (curated nickname list).`;
    }

    const canon_a = namer.canonicalsOf(ka);
    const canon_b = namer.canonicalsOf(kb);
    const shared = [...canon_a].filter((c) => canon_b.has(c));
    return `First names "${a}" and "${b}" share the canonical name "${shared[0]}" (curated nickname list).`;
}

module.exports = {
    get_namer,
    nn_key,
    are_nickname_equivalents,
    nickname_reason,
};
