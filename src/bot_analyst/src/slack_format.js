function to_slack_table(rows, max_rows = 10) {
  if (!rows?.length) return "_(no rows returned)_";

  const cols = Object.keys(rows[0]);
  const sliced = rows.slice(0, max_rows);

  const header = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;

  const body = sliced
    .map(r => `| ${cols.map(c => format_cell(r[c])).join(" | ")} |`)
    .join("\n");

  const more =
    rows.length > max_rows
      ? `\n_(showing ${max_rows} of ${rows.length})_`
      : "";

  return "```" + [header, sep, body].join("\n") + "```" + more;
}

// function format_cell(v) {
//   if (v === null || v === undefined) return "";
//   if (typeof v === "number") return v.toLocaleString();
//   return String(v).replace(/\|/g, "\\|");
// }

function format_cell(v) {
  if (v === null || v === undefined) return "";

  // Handle JS Date
  if (v instanceof Date) {
    return v.toISOString().slice(0, 10);
  }

  // Handle BigQuery DATE / STRUCT-like objects
  if (typeof v === "object") {
    // { value: '2026-01-30' } or similar
    if (typeof v.value === "string" || typeof v.value === "number") {
      return String(v.value);
    }

    // { year, month, day }
    if (
      typeof v.year === "number" &&
      typeof v.month === "number" &&
      typeof v.day === "number"
    ) {
      const mm = String(v.month).padStart(2, "0");
      const dd = String(v.day).padStart(2, "0");
      return `${v.year}-${mm}-${dd}`;
    }

    // Fallback: stringify instead of [object Object]
    return JSON.stringify(v);
  }

  if (typeof v === "number") return v.toLocaleString();

  return String(v).replace(/\|/g, "\\|");
}


module.exports = { to_slack_table };
