import { Router } from 'express';
import { pool } from '../db.js';
import { asyncRoute } from '../asyncRoute.js';

export const organisationsRouter = Router();

organisationsRouter.get('/organisations', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT
      o."Id" AS id,
      o."Name" AS name,
      o."CreatedAt" AS created_at,
      COUNT(u."Id") FILTER (WHERE u."IsActive")::int AS active_user_count,
      COUNT(u."Id")::int AS total_user_count,
      l.seat_cost_cents,
      l.currency,
      l.discount_percent,
      (SELECT COUNT(*) FROM vendor_contracts c WHERE c.org_id = o."Id" AND c.status = 'active')::int AS active_contract_count,
      (SELECT string_agg(u2."DisplayName", ', ' ORDER BY u2."DisplayName")
       FROM "Users" u2
       WHERE u2."OrganisationId" = o."Id" AND u2."IsOrgAdmin" = true) AS org_admins,
      -- No row = disabled (root CLAUDE.md's row-presence semantics) — coalesce so a never-toggled
      -- org still reads as a real false, not null, in the list view.
      COALESCE(fe.enabled, false) AS ai_assistant_enabled
    FROM "Organisations" o
    LEFT JOIN "Users" u ON u."OrganisationId" = o."Id"
    LEFT JOIN vendor_licenses l ON l.org_id = o."Id"
    LEFT JOIN vendor_feature_entitlements fe ON fe.org_id = o."Id" AND fe.feature_key = 'ai_assistant'
    GROUP BY o."Id", o."Name", o."CreatedAt", l.seat_cost_cents, l.currency, l.discount_percent, fe.enabled
    ORDER BY o."Name"
  `);
  res.json(rows);
}));

organisationsRouter.get('/organisations/:id', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      o."Id" AS id,
      o."Name" AS name,
      o."CreatedAt" AS created_at,
      COUNT(u."Id") FILTER (WHERE u."IsActive")::int AS active_user_count,
      COUNT(u."Id")::int AS total_user_count
    FROM "Organisations" o
    LEFT JOIN "Users" u ON u."OrganisationId" = o."Id"
    WHERE o."Id" = $1
    GROUP BY o."Id", o."Name", o."CreatedAt"
    `,
    [req.params.id]
  );

  const org = rows[0];
  if (!org) return res.status(404).json({ error: 'Organisation not found.' });

  const license = await pool.query('SELECT * FROM vendor_licenses WHERE org_id = $1', [req.params.id]);
  const contracts = await pool.query(
    'SELECT * FROM vendor_contracts WHERE org_id = $1 ORDER BY start_date DESC NULLS LAST',
    [req.params.id]
  );
  const entitlements = await pool.query(
    'SELECT feature_key, enabled, updated_at, updated_by FROM vendor_feature_entitlements WHERE org_id = $1',
    [req.params.id]
  );

  res.json({ ...org, license: license.rows[0] || null, contracts: contracts.rows, entitlements: entitlements.rows });
}));
