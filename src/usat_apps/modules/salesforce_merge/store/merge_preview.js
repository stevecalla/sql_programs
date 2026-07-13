'use strict';
// Pure, read-only "dry-run" merge preview. Given a cluster's account records and a chosen survivor,
// it shows what a merge WOULD do, field by field — WITHOUT changing anything (the real merge is
// Phase 3). Models Salesforce merge semantics: the survivor keeps its value for a field unless that
// value is blank, in which case it is filled from a losing record. Differing non-blank values are
// flagged as "conflict" for human review.

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

// records: [{ account, ...fields }]; survivorId matches one record's `idKey`.
function build_preview(records, survivorId, { idKey = 'account', fields } = {}) {
  const list = Array.isArray(records) ? records : [];
  const survivor = list.find((r) => String(r[idKey]) === String(survivorId)) || null;
  const losers = list.filter((r) => r !== survivor);
  const keys = (fields || [...new Set(list.flatMap((r) => Object.keys(r)))]).filter((k) => k !== idKey);

  const rows = keys.map((field) => {
    const sv = survivor ? survivor[field] : undefined;
    const others = losers.map((l) => (l ? l[field] : undefined));
    const fill = others.find((v) => !isBlank(v));
    let status;
    if (!isBlank(sv)) {
      status = others.some((v) => !isBlank(v) && String(v).trim() !== String(sv).trim()) ? 'conflict' : 'kept';
    } else {
      status = isBlank(fill) ? 'empty' : 'filled';
    }
    const chosen = !isBlank(sv) ? sv : (isBlank(fill) ? '' : fill);
    return { field, survivor: isBlank(sv) ? '' : sv, chosen, status, others };
  });

  return {
    survivor: survivor ? survivor[idKey] : null,
    losers: losers.map((l) => l[idKey]),
    fields: rows,
    counts: {
      kept: rows.filter((r) => r.status === 'kept').length,
      filled: rows.filter((r) => r.status === 'filled').length,
      conflict: rows.filter((r) => r.status === 'conflict').length,
    },
  };
}

module.exports = { build_preview, isBlank };
