import { Router } from 'express';
import { pool } from '../db.js';
import { asyncRoute } from '../asyncRoute.js';

export const entitlementsRouter = Router();

// Kept short and allowlisted rather than accepting any string - a mistyped feature_key would
// otherwise silently create a permanently-dead, never-checked-by-anything row (the main app's own
// AiAssistantService only ever looks up the literal 'ai_assistant' key). Extend this list, not the
// validation itself, whenever a new feature gets entitlement-gated the same way.
const KNOWN_FEATURE_KEYS = ['ai_assistant'];

entitlementsRouter.put('/organisations/:id/entitlements/:featureKey', asyncRoute(async (req, res) => {
  const { id, featureKey } = req.params;
  if (!KNOWN_FEATURE_KEYS.includes(featureKey)) {
    return res.status(400).json({ error: 'Unknown feature key: ' + featureKey });
  }
  const enabled = !!(req.body && req.body.enabled);

  const { rows } = await pool.query(
    `
    INSERT INTO vendor_feature_entitlements (org_id, feature_key, enabled, updated_by, updated_at)
    VALUES ($1, $2, $3, $4, now())
    ON CONFLICT (org_id, feature_key) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
    RETURNING org_id, feature_key, enabled, updated_at, updated_by
    `,
    [id, featureKey, enabled, req.session.username || null]
  );

  res.json(rows[0]);
}));
