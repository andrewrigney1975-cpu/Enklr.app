"use strict";

/**
 * ARCHITECTURE-REVIEW.md finding #3 — fires the same requests at every configured backend tier and
 * diffs status/JSON shape (see scenarios.js) of each non-reference tier against the reference tier
 * (.NET, "net" — the original implementation every other tier is a parity port of). Every tier must
 * already be running before this is invoked; see .github/workflows/ci.yml's `contract-parity` job for
 * how CI boots them, or CLAUDE.md's testing conventions for how to run this the same way locally.
 *
 * Generalized from an original two-tier-only (.NET vs PHP/Postgres) harness to N tiers, compared
 * pairwise against the reference — NOT all-pairs, since every tier is independently a port of the
 * same .NET original, not of each other; a php-vs-mariadb mismatch with no net-vs-either mismatch
 * would just be double-reporting the same single discrepancy from two angles.
 *
 * Usage: set NET_BASE_URL (required, the reference) plus any of PHP_BASE_URL/MARIADB_BASE_URL for
 * whichever other tiers are running — only tiers with a *_BASE_URL actually set are compared; a
 * local run comparing just two of the three tiers works exactly as before, no flag needed.
 *   NET_BASE_URL=http://localhost:8080 PHP_BASE_URL=http://localhost:8081 node run-parity.js
 *   NET_BASE_URL=http://localhost:8080 PHP_BASE_URL=http://localhost:8081 MARIADB_BASE_URL=http://localhost:8082 node run-parity.js
 */

import { createClient, waitForHealth } from './lib/http-client.js';
import { shapesMatch, exactFieldsMatch } from './lib/shape-diff.js';
import { scenarios } from './scenarios.js';

const REFERENCE_TIER = 'net';

// Every tier this harness knows how to compare, in report order — "net" (the reference) is always
// required; the others only participate if their own *_BASE_URL env var is actually set, so a local
// two-tier run (e.g. net+php only) needs no flag to keep working exactly as it did before mariadb
// existed.
const TIER_ENV_VARS = {
  net: { envVar: 'NET_BASE_URL', default: 'http://localhost:8080', required: true },
  php: { envVar: 'PHP_BASE_URL', default: 'http://localhost:8081', required: false },
  mariadb: { envVar: 'MARIADB_BASE_URL', default: null, required: false },
};

function resolveActiveTiers() {
  const active = [];
  for (const [tier, { envVar, default: fallback, required }] of Object.entries(TIER_ENV_VARS)) {
    const url = process.env[envVar] || fallback;
    if (url) {
      active.push({ tier, url });
    } else if (required) {
      throw new Error(`${envVar} is required (the reference tier) but was not set and has no default.`);
    }
  }
  return active;
}

async function main() {
  const activeTiers = resolveActiveTiers();
  const tierNames = activeTiers.map((t) => t.tier);
  if (!tierNames.includes(REFERENCE_TIER)) {
    throw new Error(`Reference tier "${REFERENCE_TIER}" must be active — check NET_BASE_URL.`);
  }
  const comparisonTiers = tierNames.filter((t) => t !== REFERENCE_TIER);
  if (comparisonTiers.length === 0) {
    throw new Error('At least one non-reference tier (PHP_BASE_URL and/or MARIADB_BASE_URL) must be set to compare against.');
  }

  process.stdout.write(`\nWaiting for ${tierNames.length} tier(s) to be healthy (${activeTiers.map((t) => `${t.tier}=${t.url}`).join(', ')})...\n`);
  await Promise.all(activeTiers.map((t) => waitForHealth(t.url)));

  const ctx = { tiers: tierNames };
  for (const { tier, url } of activeTiers) {
    ctx[tier] = { client: createClient(url) };
  }

  process.stdout.write(`\nRunning ${scenarios.length} contract-parity scenarios (reference=${REFERENCE_TIER}, comparing against: ${comparisonTiers.join(', ')})...\n\n`);

  let totalPass = 0;
  let totalFail = 0;
  const failedScenarios = [];

  for (const scenario of scenarios) {
    const mismatches = [];

    try {
      const { results, exactFields } = await scenario.run(ctx);
      const refResult = results[REFERENCE_TIER];

      for (const tier of comparisonTiers) {
        const result = results[tier];
        if (!result) continue; // scenario didn't run this tier (shouldn't happen, but don't crash the report over it)

        if (refResult.status !== result.status) {
          mismatches.push(`[${REFERENCE_TIER} vs ${tier}] status: ${REFERENCE_TIER}=${refResult.status}, ${tier}=${result.status}`);
          continue;
        }
        const tierMismatches = [];
        shapesMatch('body', refResult.body, result.body, tierMismatches);
        exactFieldsMatch('body', refResult.body, result.body, exactFields, tierMismatches);
        tierMismatches.forEach((m) => mismatches.push(`[${REFERENCE_TIER} vs ${tier}] ${m}`));
      }
    } catch (err) {
      mismatches.push(`scenario threw: ${err.stack || err}`);
    }

    if (mismatches.length === 0) {
      totalPass++;
      process.stdout.write('  pass  ' + scenario.name + '\n');
    } else {
      totalFail++;
      failedScenarios.push(scenario.name);
      process.stdout.write('  FAIL  ' + scenario.name + '\n');
      mismatches.forEach((m) => process.stdout.write('         - ' + m + '\n'));
    }
  }

  process.stdout.write('\n' + '─'.repeat(65) + '\n');
  process.stdout.write(`TOTAL: ${totalPass} pass, ${totalFail} fail (${scenarios.length} scenarios)\n`);
  if (failedScenarios.length > 0) {
    process.stdout.write('\nFailed scenarios: ' + failedScenarios.join(', ') + '\n');
  }

  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write('Fatal error running contract-parity harness: ' + (err.stack || err) + '\n');
  process.exit(1);
});
