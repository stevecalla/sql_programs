/**
 * prune_roster_table.js — apply tiered retention to event_analysis_roster.
 *
 * Policy:
 *   • Last 48 hours  → keep every build (full fidelity during active iteration)
 *   • 48h – 30 days  → keep one build per day (latest build of each day)
 *   • 30 – 90 days   → keep one build per week (latest in each ISO week)
 *   • Older than 90d → keep one build per month (first build of each month)
 *
 * Steady-state row count is bounded — typically <200K rows even with daily
 * builds for years. The "kept" build_at values are computed inside SQL via
 * ROW_NUMBER() partition windows; everything else gets DELETED.
 *
 * Idempotent: only deletes rows that have just aged out of their tier.
 * Re-running it 10 seconds later is a no-op. Safe to call at the end of
 * every build (which is what build_all.js does).
 *
 * Standalone usage:
 *   node src/event_analysis/utilities/prune_roster_table.js
 */

'use strict';

const path   = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const mysqlP = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../../utilities/config');
const { TABLE_NAME } = require('./ensure_roster_table');

/**
 * Identify the set of distinct build_at values that survive retention,
 * then DELETE every roster row whose build_at is NOT in that set.
 *
 * The "kept" set is computed via four UNIONed sub-queries — one per
 * tier — so the logic is visible and tweakable without rewriting code.
 *
 * Returns { kept, deleted } row counts. Never throws on a transient DB
 * error — logs and returns zeros — for the same reason insert_roster
 * doesn't fail the build.
 */
async function prune_roster_table({ silent = false } = {}) {
  let conn;
  try {
    const cfg = await local_usat_sales_db_config();
    conn = await mysqlP.createConnection(cfg);

    // Build the kept-set as DISTINCT build_at values across all four tiers.
    // Each sub-query operates on a different age window and uses
    // ROW_NUMBER() to pick the canonical representative per bucket.
    const kept_sql = `
      SELECT build_at FROM (
        -- Tier 1: last 48 hours — keep everything.
        SELECT DISTINCT build_at FROM \`${TABLE_NAME}\`
         WHERE build_at >= NOW() - INTERVAL 48 HOUR

        UNION

        -- Tier 2: 48h – 30 days — keep the latest build of each calendar day.
        SELECT build_at FROM (
          SELECT build_at,
                 ROW_NUMBER() OVER (PARTITION BY DATE(build_at) ORDER BY build_at DESC) AS rn
            FROM (SELECT DISTINCT build_at FROM \`${TABLE_NAME}\`
                   WHERE build_at <  NOW() - INTERVAL 48 HOUR
                     AND build_at >= NOW() - INTERVAL 30 DAY) d
        ) ranked
        WHERE rn = 1

        UNION

        -- Tier 3: 30 – 90 days — keep the latest build of each ISO week.
        SELECT build_at FROM (
          SELECT build_at,
                 ROW_NUMBER() OVER (PARTITION BY YEARWEEK(build_at, 3) ORDER BY build_at DESC) AS rn
            FROM (SELECT DISTINCT build_at FROM \`${TABLE_NAME}\`
                   WHERE build_at <  NOW() - INTERVAL 30 DAY
                     AND build_at >= NOW() - INTERVAL 90 DAY) d
        ) ranked
        WHERE rn = 1

        UNION

        -- Tier 4: older than 90 days — keep the first build of each month.
        SELECT build_at FROM (
          SELECT build_at,
                 ROW_NUMBER() OVER (PARTITION BY DATE_FORMAT(build_at, '%Y-%m') ORDER BY build_at ASC) AS rn
            FROM (SELECT DISTINCT build_at FROM \`${TABLE_NAME}\`
                   WHERE build_at < NOW() - INTERVAL 90 DAY) d
        ) ranked
        WHERE rn = 1
      ) keep
    `;

    const [kept_rows] = await conn.query(kept_sql);
    const kept_set    = new Set(kept_rows.map(r => r.build_at && r.build_at.toISOString ? r.build_at.toISOString() : String(r.build_at)));

    // Now DELETE everything not in the kept set. We could do this in one
    // statement with NOT IN (...) but that's quadratic-ish on big tables
    // and harder to read. Instead: pull the distinct build_at values
    // that ARE in the table but NOT in the kept set, then DELETE each.
    const [all_distinct] = await conn.query(
      `SELECT DISTINCT build_at FROM \`${TABLE_NAME}\``
    );
    const to_delete = all_distinct
      .map(r => r.build_at)
      .filter(t => {
        const key = t && t.toISOString ? t.toISOString() : String(t);
        return !kept_set.has(key);
      });

    let deleted_total = 0;
    for (const ts of to_delete) {
      const [r] = await conn.query(
        `DELETE FROM \`${TABLE_NAME}\` WHERE build_at = ?`,
        [ts]
      );
      deleted_total += r.affectedRows;
    }

    if (!silent && (deleted_total > 0 || to_delete.length > 0)) {
      console.log(`  Roster pruning: kept ${kept_set.size} build(s), deleted ${deleted_total} row(s) across ${to_delete.length} aged-out build(s).`);
    } else if (!silent) {
      console.log(`  Roster pruning: nothing aged out (${kept_set.size} build(s) currently retained).`);
    }

    return { kept: kept_set.size, deleted: deleted_total };
  } catch (err) {
    if (!silent) console.warn(`  Roster pruning failed (non-fatal): ${err.message}`);
    return { kept: 0, deleted: 0 };
  } finally {
    if (conn) {
      try { await conn.end(); } catch { /* ignore */ }
    }
  }
}

// CLI entry point: `node prune_roster_table.js`
if (require.main === module) {
  prune_roster_table().catch(err => {
    console.error('✗ Failed:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { prune_roster_table };
