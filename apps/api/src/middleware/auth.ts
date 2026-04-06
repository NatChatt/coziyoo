import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db/client.js";
import { verifyAccessToken, type AccessTokenPayload, type AuthRealm } from "../services/token-service.js";

export function requireAuth(realm: AuthRealm) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing bearer token" } });
    }

    const token = authHeader.slice("Bearer ".length);
    let payload: AccessTokenPayload;
    try {
      payload = verifyAccessToken(token, realm);
    } catch {
      return res.status(401).json({ error: { code: "TOKEN_INVALID", message: "Invalid or expired token" } });
    }

    if (payload.realm !== realm) {
      return res.status(403).json({
        error: { code: "AUTH_REALM_MISMATCH", message: "Token realm not allowed for this endpoint" },
      });
    }

    // Admin API tokens are non-expiring JWTs and must be matched against
    // stored token hashes, otherwise a leaked token cannot be revoked.
    if (realm === "admin" && payload.sessionId.startsWith("api_")) {
      try {
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const row = await pool.query<{ ok: number }>(
          `SELECT 1 AS ok
           FROM admin_api_tokens
           WHERE session_id = $1
             AND token_hash = $2
             AND revoked_at IS NULL
           LIMIT 1`,
          [payload.sessionId, tokenHash]
        );
        if ((row.rowCount ?? 0) === 0) {
          return res.status(401).json({ error: { code: "TOKEN_INVALID", message: "Invalid or revoked API token" } });
        }
      } catch {
        return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Auth token validation failed" } });
      }
    }

    req.auth = {
      userId: payload.sub,
      sessionId: payload.sessionId,
      realm: payload.realm,
      role: payload.role,
    };
    return next();
  };
}
