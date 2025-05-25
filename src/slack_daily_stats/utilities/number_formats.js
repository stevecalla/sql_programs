// Format helpers with null/undefined/NaN safety
const fmtCurrency = val => {
  const num = parseFloat(val);
  return isFinite(num) ? `$${Math.round(num / 1000).toLocaleString()}K` : "";
};

const fmtNumber = val =>
  isFinite(parseInt(val)) ? parseInt(val).toLocaleString() : "";

const fmtRPU = val =>
  isFinite(parseFloat(val)) ? `$${parseFloat(val).toFixed(2)}` : "";

const fmtPct = val =>
  isFinite(parseFloat(val)) ? `${parseFloat(val).toFixed(1)}%` : "";

module.exports = {
    fmtCurrency,
    fmtNumber,
    fmtRPU,
    fmtPct
}

