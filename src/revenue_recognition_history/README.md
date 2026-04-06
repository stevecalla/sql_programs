# 📊 Recognition History – Slack Command Guide

This guide explains how to use Slack slash commands to manage monthly recognition history snapshots.

---

## 🔍 Step 0: Validate in Looker (Before & After)

Before making any changes, and again after completion, review the reporting dashboards:

- **History Summary Report = 9.12) Allocated Revenue History Summary:**  
  https://lookerstudio.google.com/u/0/reporting/7f97c13e-287d-4bc0-bc70-969b5f3944be/page/p_8mtk1ieg2d/edit  

- **History Detail Report = 9.13) Allocated Revenue History Detail:**  
  https://lookerstudio.google.com/u/0/reporting/7f97c13e-287d-4bc0-bc70-969b5f3944be/page/p_zcpgoyeg2d/edit  

### What to check
- Total revenue and counts for the target month  
- Any unexpected drops, spikes, or missing data  

---

## 🚀 1. Insert a Monthly Snapshot

Creates a new recognition history snapshot for a given month.

### Command
```bash
/rec_history_insert password=YOUR_PASSWORD year=YYYY month=MM
```

### Example
```bash
/rec_history_insert password=abc123 year=2026 month=03
```

### Notes
- If `year` and `month` are omitted, defaults to the **prior month**
- This pulls current data into the history table

---

## 🗑️ 2. Delete a Snapshot

Deletes an existing snapshot from the history table.

### Command
```bash
/rec_history_delete password=YOUR_PASSWORD snapshot=revenue_month_YYYY_MM
```

### Example
```bash
/rec_history_delete password=abc123 snapshot=revenue_month_2026_03
```

### Notes
- Use when a snapshot needs to be reloaded  
- Snapshot name must match exactly  

---

## 💾 3. Create a Backup

Creates a backup of the recognition history table.

### Command
```bash
/rec_history_backup password=YOUR_PASSWORD backup_type=user
```

### Examples
```bash
/rec_history_backup password=abc123 backup_type=user
/rec_history_backup password=abc123 backup_type=system
```

### Notes
- `backup_type=user` = manual backup (default)  
- `backup_type=system` = system-style backup  

---

## ✅ Recommended Workflow

1. (**before**) Review results in Looker (before & after): `https://lookerstudio.google.com/u/0/reporting/7f97c13e-287d-4bc0-bc70-969b5f3944be/page/p_8mtk1ieg2d/edit`
2. Run a **backup**: `/rec_history_backup password=YOUR_PASSWORD backup_type=user`
3. **Delete** the existing snapshot (if needed): `/rec_history_delete password=YOUR_PASSWORD snapshot=revenue_month_YYYY_MM`
4. Run the **insert** command: `/rec_history_insert password=YOUR_PASSWORD year=YYYY month=MM`
5. Re-check Looker reports (**after**)  

---

## ⏱️ What to Expect

- Immediate **job started** message  
- Possible **still working** updates for longer runs  
- Final confirmation when complete  

---

## ⚠️ Important

If anything looks off in Looker after the update:

➡️ **Stop and reach out before rerunning commands**