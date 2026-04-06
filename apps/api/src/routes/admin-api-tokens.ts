import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { writeAdminAudit } from "../services/admin-audit.js";
import { signAccessToken } from "../services/token-service.js";

const CreateAdminApiTokenSchema = z.object({
  label: z.string().trim().min(3).max(100),
  role: z.enum(["admin", "super_admin"]).default("admin"),
});

type PgLikeError = {
  code?: string;
};

function tokenPreview(token: string) {
  const payload = jwt.decode(token);
  if (!payload || typeof payload !== "object") return null;
  const claims = payload as Record<string, unknown>;
  const iat = typeof claims.iat === "number" ? new Date(claims.iat * 1000).toISOString() : null;
  const exp = typeof claims.exp === "number" ? new Date(claims.exp * 1000).toISOString() : null;
  return {
    iat,
    exp,
    claims,
  };
}

export const adminApiTokenRouter = Router();

adminApiTokenRouter.use(requireAuth("admin"));

async function tableExists(tableName: string) {
  const result = await pool.query<{ regclass: string | null }>("SELECT to_regclass($1) AS regclass", [tableName]);
  return Boolean(result.rows[0]?.regclass);
}

async function ensureAdminApiTokensTable() {
  if (await tableExists("public.admin_api_tokens")) {
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_api_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'super_admin')),
        token_hash TEXT NOT NULL,
        token_preview TEXT NOT NULL,
        claims_json JSONB,
        created_by_admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_api_tokens_created_by
        ON admin_api_tokens(created_by_admin_id, created_at DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_api_tokens_active
        ON admin_api_tokens(created_at DESC)
        WHERE revoked_at IS NULL
    `);
  } catch (error) {
    const maybePgError = error as PgLikeError;

    // On restricted DB users, CREATE may fail even if the table already exists.
    // If table is present, continue and let normal DML run.
    if (maybePgError.code === "42501" && (await tableExists("public.admin_api_tokens"))) {
      return;
    }

    throw error;
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMask(token: string) {
  if (token.length <= 12) return token;
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

adminApiTokenRouter.post("/api-tokens/admin", async (req, res) => {
  await ensureAdminApiTokensTable();

  const parsed = CreateAdminApiTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  if (input.role === "super_admin" && req.auth!.role !== "super_admin") {
    return res.status(403).json({
      error: { code: "FORBIDDEN", message: "Only super_admin can create super_admin API tokens." },
    });
  }

  const sessionId = `api_${randomUUID()}`;
  const token = signAccessToken(
    {
      sub: req.auth!.userId,
      sessionId,
      realm: "admin",
      role: input.role,
    },
    { expiresInMinutes: null }
  );

  const client = await pool.connect();
  const preview = tokenPreview(token);
  const createdAt = new Date().toISOString();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO admin_api_tokens
        (session_id, label, role, token_hash, token_preview, claims_json, created_by_admin_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz)`,
      [
        sessionId,
        input.label,
        input.role,
        hashToken(token),
        tokenMask(token),
        preview?.claims ? JSON.stringify(preview.claims) : null,
        req.auth!.userId,
        createdAt,
      ]
    );
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_api_token_created",
      entityType: "admin_api_tokens",
      entityId: sessionId,
      after: {
        label: input.label,
        role: input.role,
        expiresAt: null,
        tokenPreview: tokenMask(token),
      },
    });
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "API token could not be created" } });
  } finally {
    client.release();
  }

  return res.status(201).json({
    data: {
      label: input.label,
      role: input.role,
      token,
      createdAt,
      preview,
    },
  });
});

adminApiTokenRouter.get("/api-tokens/admin", async (_req, res) => {
  await ensureAdminApiTokensTable();

  const rows = await pool.query<{
    id: string;
    session_id: string;
    label: string;
    role: "admin" | "super_admin";
    token_preview: string;
    created_at: string;
    revoked_at: string | null;
    created_by_admin_id: string;
    created_by_email: string | null;
  }>(
    `SELECT
       t.id::text,
       t.session_id,
       t.label,
       t.role,
       t.token_preview,
       t.created_at::text,
       t.revoked_at::text,
       t.created_by_admin_id::text,
       a.email AS created_by_email
     FROM admin_api_tokens t
     LEFT JOIN admin_users a ON a.id = t.created_by_admin_id
     ORDER BY t.created_at DESC
     LIMIT 100`
  );

  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      label: row.label,
      role: row.role,
      tokenPreview: row.token_preview,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      createdByAdminId: row.created_by_admin_id,
      createdByEmail: row.created_by_email,
    })),
  });
});
