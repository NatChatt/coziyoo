import type { ApiError } from "./core";

export type AdminApiTokenResponse = {
  data?: {
    sessionId: string;
    label: string;
    role: "admin" | "super_admin";
    token: string;
    createdAt: string;
    preview: {
      iat: string | null;
      exp: string | null;
      claims: Record<string, unknown>;
    } | null;
  };
} & ApiError;

export type AdminApiTokenListItem = {
  id: string;
  sessionId: string;
  label: string;
  role: "admin" | "super_admin";
  tokenPreview: string;
  createdAt: string;
  revokedAt: string | null;
  createdByAdminId: string;
  createdByEmail: string | null;
};

export type ComplianceDocumentListRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  source_info: string | null;
  details: string | null;
  validity_years: number | null;
  is_active: boolean;
  is_required_default: boolean;
  seller_assignment_count: string;
  created_at: string;
  updated_at: string;
};
