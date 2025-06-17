// add padding to evenly space markdown columns

async function pad_markdown_table(raw_markdown_message) {
  // Pad helper
  const pad = (str, width) => (str?.toString?.() ?? "").padEnd(width, " ");
  
  // Column widths
  const COL_WIDTHS = [30, 9, 9, 9];

  const final_formatted_message = raw_markdown_message
    .map(cols => cols.length
      ? "| " + cols.map((col, i) => pad(col, COL_WIDTHS[i])).join(" | ") + " |"
      : "")
    .join("\n");

  return final_formatted_message;
}


module.exports = {
    pad_markdown_table
}

