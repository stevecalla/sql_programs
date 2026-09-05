// Single source of truth for the merge / duplicate review FILTER dropdowns — shared by the Select
// Merges filter bar and the Merge Ops random-sample panel so their labels, tooltips, and option text
// can never drift apart. Both pages render the SAME <FilterSelect> component off the SAME FILTER_TIP /
// FILTER_OPTS below; only the bound state + side effects (page reset, persistence) differ per page.

// Shared filter-cell layout (was duplicated in SelectMerges): uniform min-width columns that wrap evenly.
export const FCELL = { display: 'flex', flexDirection: 'column', minWidth: 148, flex: '0 0 auto' };
export const FSEL = { width: '100%' };
export const FLabel = ({ children, title }) => (<div className="muted small" style={{ marginBottom: 3 }} title={title}>{children}</div>);

// Tooltips — one canonical string per filter, used verbatim on both pages (label + select both carry it).
export const FILTER_TIP = {
  queue: 'Hide or isolate groups already in the merge queue.',
  size: 'How many accounts are in the group (2 = a pair). The size options come from duplicate clusters, which are always 2 or more — so there’s no “1” here (a single account isn’t a duplicate). Note: the “Accounts with merge ids” view can list 1-record groups (a merge ID carried by just one account); those aren’t mergeable, so this Size filter can’t select them.',
  signal: 'Why they were grouped: exact match, fuzzy (similar) name, and/or nickname. A cluster can involve more than one — this keeps any that involve the chosen signal.',
  tier: 'Confidence level — the cluster’s single strongest signal (exact > fuzzy > nickname).',
  minSim: 'Best (highest) name-similarity score among the cluster’s pairs, 0–100.',
  mergeId: 'Whether the cluster carries any Membership Platform merge ID.',
  member: 'Whether any account in the cluster has a membership number.',
  whichList: 'Which detection signal flagged the account: exact, fuzzy, or nickname. Keeps groups where any member matches.',
  bucket: 'How the account compares to Salesforce duplicates: In both = has a merge ID and was flagged; ID only = has a merge ID but was not flagged as a duplicate.',
  foundation: 'Whether any account in the group is a Foundation constituent.',
  portal: 'Whether any account in the group is a Customer-Portal account (IsCustomerPortal). Salesforce requires the portal account to be the master when merging.',
};

// Option lists as [value, label] pairs — the value strings are exactly what the backend filters expect.
export const FILTER_OPTS = {
  queue: [['', 'All'], ['unstaged', 'Not staged (hide queued/merged)'], ['staged', 'In queue / merged only']],
  signal: [['', 'Any signal'], ['exact', 'Exact'], ['fuzzy', 'Fuzzy'], ['nickname', 'Nickname']],
  tier: [['', 'Any tier'], ['exact', 'Exact'], ['fuzzy', 'Fuzzy'], ['nickname', 'Nickname']],
  minSim: [['', 'Any score'], ['95', '≥ 95'], ['90', '≥ 90'], ['85', '≥ 85'], ['80', '≥ 80']],
  mergeId: [['', 'All'], ['has', 'Has merge ID'], ['none', 'No merge ID']],
  member: [['', 'All'], ['has', 'Has member #'], ['none', 'No member #']],
  whichList: [['', 'Any list'], ['exact', 'Exact'], ['fuzzy', 'Fuzzy'], ['nickname', 'Nickname']],
  bucket: [['', 'All'], ['in_both', 'In both'], ['sf_only', 'ID only']],
  foundation: [['', 'All'], ['has', 'Is foundation'], ['none', 'Not foundation']],
  portal: [['', 'All'], ['has', 'Has portal'], ['none', 'No portal']],
};

// Size options are dynamic (from the facets endpoint), so build them from the distinct group sizes.
export const sizeOptions = (sizes) => [['', 'Any size'], ...(sizes || []).map((s) => [String(s), s + ' accounts'])];

// The shared dropdown. `label`/`tip`/`opts` come from the maps above; `value`/`onChange(value)` bind the
// page's own state. Identical markup to the original Select Merges filter cell, so its output is unchanged.
export function FilterSelect({ label, tip, opts, value, onChange, cellStyle }) {
  return (
    <div style={cellStyle ? { ...FCELL, ...cellStyle } : FCELL}>
      <FLabel title={tip}>{label}</FLabel>
      <select className="tb-select" style={FSEL} value={value} onChange={(e) => onChange(e.target.value)} title={tip}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
