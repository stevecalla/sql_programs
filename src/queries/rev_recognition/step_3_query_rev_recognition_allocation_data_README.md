# Revenue Recognition Allocation Query – Step 3

This module generates a **recursive SQL query** to calculate **monthly revenue recognition allocation** for each membership period. It is used in **Step 3** of the revenue recognition pipeline and supports inserting normalized monthly-recognized revenue data into a target table.

---

## 📄 File Reference

- **Source File**: `step_1a_create_recognized_revenue_table_controling_allocation_months.sql`
- **Function**: `step_3_query_rev_recognition_allocation_data`
- **Path**:  
  `C:\Users\calla\development\usat\sql_code\21_recognized_membership_revenue\`

---

## 🧠 Purpose

The SQL query produced by this function allocates total membership revenue evenly across each active month in a member’s subscription period. It generates **one row per month** between `starts_mp` and `ends_mp`, enabling monthly revenue recognition tracking and reporting.

---

## ⚙️ Function Signature

```js
function step_3_query_rev_recognition_allocation_data(created_at_mtn, created_at_utc, QUERY_OPTIONS)
```

### Parameters

| Name              | Type     | Description                                                        |
|-------------------|----------|--------------------------------------------------------------------|
| `created_at_mtn`  | `string` | Timestamp for record creation in Mountain Time                     |
| `created_at_utc`  | `string` | Timestamp for record creation in UTC                               |
| `QUERY_OPTIONS`   | `object` | Contains filtering options such as `ends_mp`                       |

Example:
```js
const query = step_3_query_rev_recognition_allocation_data(
  '2025-08-01 09:00:00',
  '2025-08-01 15:00:00',
  { ends_mp: '2025-01-01' }
);
```

---

## 🧱 SQL Query Overview

### 1. Recursive CTE: `membership_months`

- Starts with the **first month** of the membership period.
- Recursively generates one row per month until the **end date** (`ends_mp`).
- Tracks the `month_index` to identify the number of elapsed months.
- Retains revenue, unit, and member metadata for each month.

### 2. Final SELECT

- Joins `membership_months` with a subquery that calculates the **number of recognized months** (`months_mp_allocation_recursive`) per membership period.
- Calculates:
  - `monthly_sales_units = total units / months allocated`
  - `monthly_revenue = total revenue / months allocated`
- Adds date fields such as:
  - `revenue_date`, `revenue_month_date`, `revenue_quarter_date`, `revenue_year_date`
- Flags if the revenue month is the **current month** (`is_current_month`).

---

## 🧾 Output Fields (Selected)

| Field                          | Description                                           |
|--------------------------------|-------------------------------------------------------|
| `id_profiles`                  | Profile ID                                            |
| `id_membership_periods_sa`     | Membership Period ID                                  |
| `revenue_year_month`           | Year and month of recognized revenue (YYYY-MM)        |
| `revenue_date`                 | First day of revenue-recognized month (YYYY-MM-01)    |
| `monthly_sales_units`          | Evenly divided unit count per month                   |
| `monthly_revenue`              | Evenly divided revenue per month                      |
| `recursion_month_index`        | Month index in the recursive sequence                 |
| `is_current_month`             | Flag for current month                                |
| `created_at_mtn`               | Audit timestamp (Mountain Time)                       |
| `created_at_utc`               | Audit timestamp (UTC)                                 |

---

## 🧼 Notes

- Filters only include membership periods where `ends_mp >= QUERY_OPTIONS.ends_mp`.
- Logic supports future extension via `months_mp_allocated_custom` override (currently not used).
- Timestamps for auditing (`created_at_mtn` and `created_at_utc`) are injected via function arguments.
- Heavy metadata columns (e.g., `is_bulk`, `is_stacked_previous_mp`) are intentionally excluded to reduce data volume.

---

## 🛠 Usage Example

```js
const {
  step_3_query_rev_recognition_allocation_data,
} = require('./step_3_query_rev_recognition_allocation_data');

const created_at_mtn = '2025-08-01 09:00:00';
const created_at_utc = '2025-08-01 15:00:00';
const queryOptions = { ends_mp: '2025-01-01' };

const sql = step_3_query_rev_recognition_allocation_data(
  created_at_mtn,
  created_at_utc,
  queryOptions
);

// Execute the `sql` string using your preferred database driver
```

---

## 📦 Module Export

```js
module.exports = {
  step_3_query_rev_recognition_allocation_data,
};
```

---

Let us know if you'd like to add:
- A sample output CSV
- A visual flowchart of the recursive allocation
- Unit test coverage for different edge cases
