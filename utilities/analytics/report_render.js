'use strict';
// Generic analytics core — render a "report contract" to plain text (CLI) or
// Slack blocks (digest) or pass-through JSON (dashboard). Contract shape:
//   { title, range, sections: [ { heading, lines: [string, ...] } ] }
function to_text(report) {
  const out = [report.title];
  if (report.range) out.push(report.range);
  (report.sections || []).forEach(function (s) {
    out.push('');
    out.push(s.heading);
    (s.lines || []).forEach(function (l) { out.push('  ' + l); });
  });
  return out.join('\n');
}
function to_slack_blocks(report) {
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: report.title, emoji: true } }];
  if (report.range) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: report.range }] });
  (report.sections || []).forEach(function (s) {
    const body = (s.lines || []).map(function (l) { return '• ' + l; }).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*' + s.heading + '*\n' + body } });
  });
  return blocks;
}
module.exports = { to_text, to_slack_blocks };
