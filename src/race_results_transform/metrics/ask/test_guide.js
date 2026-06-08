'use strict';
// Single source of truth for the AI-ask review playbooks. The CLI prints these
// (ask:test:corrections / ask:test:threads) so the "how to test" stays runnable
// and in sync with the docs (metrics/ASK_DESIGN.md mirrors them).

const CORRECTIONS_GUIDE = {
  id: 'corrections',
  title: 'Verify an operator correction is incorporated into answers (G2)',
  why: 'Confirms a saved correction changes how the AI interprets a term on the next ask.',
  steps: [
    'Ask a question that uses an UNDEFINED term so the effect is visible:',
    '    how many power users do we have?',
    'Note the SQL it ran (open the "SQL" disclosure on the dashboard, or it prints under the CLI answer).',
    'Add a correction — dashboard: click "Correct this" under the answer; or CLI:',
    '    node src/cli.js ask:correct "A power user is any visitor with 3 or more uploads (file_uploaded)." --q "how many power users do we have?"',
    'Ask the SAME question again.',
    'Review active corrections any time:  node src/cli.js ask:corrections',
    'Clean up when done:  node src/cli.js ask:uncorrect <id>'
  ],
  expect: 'The re-asked SQL now groups by visitor_id with a HAVING count of file_uploaded >= 3 (or equivalent), reflecting the saved note.'
};

const THREADS_GUIDE = {
  id: 'threads',
  title: 'Verify follow-up threads keep conversational context (B1)',
  why: 'Confirms a follow-up resolves against the previous turn instead of starting over.',
  steps: [
    'Ask:  how many uploads in the last 7 days?',
    'Follow up WITHOUT restating the metric:  break that down by file type',
    'Follow up again:  and the week before?',
    'Watch the "Follow-up context is on (N prior)" line; "start a new thread" resets it.',
    'Audit the conversation:  node src/cli.js ask:log   (each turn shows its thread / asker id)'
  ],
  expect: 'Turn 2 reuses the uploads metric and adds GROUP BY file_type; turn 3 shifts only the date window. Same thread_id across the turns.'
};

const GUIDES = { corrections: CORRECTIONS_GUIDE, threads: THREADS_GUIDE };

function format_guide(g) {
  const lines = [];
  lines.push('');
  lines.push('  ' + g.title);
  lines.push('  ' + '-'.repeat(g.title.length));
  if (g.why) lines.push('  ' + g.why);
  lines.push('');
  g.steps.forEach(function (s, i) {
    lines.push(/^\s{2,}/.test(s) ? '      ' + s.trim() : '  ' + (i + 1) + '. ' + s);
  });
  lines.push('');
  lines.push('  Expected: ' + g.expect);
  lines.push('');
  return lines.join('\n');
}

module.exports = { CORRECTIONS_GUIDE, THREADS_GUIDE, GUIDES, format_guide };
