import { useEffect, useState } from "react";
import { request, parseJson } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
import { adminRoleLabel, formatTableDateTime } from "../lib/format";
import type { Language, ApiError } from "../types/core";
import type { AdminApiTokenResponse, AdminApiTokenListItem } from "../types/api-tokens";

export default function ApiTokensPage({ language, isSuperAdmin }: { language: Language; isSuperAdmin: boolean }) {
  const dict = DICTIONARIES[language];
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<"admin" | "super_admin">("admin");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<AdminApiTokenListItem[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);

  async function loadTokens() {
    setLoadingRecords(true);
    try {
      const response = await request("/v1/admin/api-tokens/admin");
      const body = await parseJson<{ data?: AdminApiTokenListItem[] } & ApiError>(response);
      if (response.status !== 200 || !body.data) return;
      setRecords(body.data);
    } finally {
      setLoadingRecords(false);
    }
  }

  useEffect(() => {
    loadTokens().catch(() => undefined);
  }, []);

  async function createToken() {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError(dict.apiTokens.tokenCreateFailed);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await request("/v1/admin/api-tokens/admin", {
        method: "POST",
        body: JSON.stringify({
          label: trimmedLabel,
          role,
        }),
      });
      let body: AdminApiTokenResponse | null = null;
      try {
        body = await parseJson<AdminApiTokenResponse>(response);
      } catch {
        body = null;
      }

      if (response.status !== 201 || !body?.data) {
        setError(body?.error?.message ?? `HTTP ${response.status}: ${dict.apiTokens.tokenCreateFailed}`);
        return;
      }
      setLabel("");
      await loadTokens();
    } catch {
      setError(dict.apiTokens.tokenRequestFailed);
    } finally {
      setSaving(false);
    }
  }

  async function copyPreviewToken(value: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{dict.apiTokens.eyebrow}</p>
          <h1>{dict.apiTokens.title}</h1>
          <p className="subtext">{dict.apiTokens.subtitle}</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.apiTokens.create}</h2>
          <span className="panel-meta">{dict.apiTokens.nonExpiring}</span>
        </div>
        <div className="form-grid">
          <label>
            {dict.apiTokens.label}
            <input value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <label>
            {dict.apiTokens.role}
            <select value={role} onChange={(event) => setRole(event.target.value as "admin" | "super_admin")}>
              <option value="admin">{dict.users.roleAdmin}</option>
              <option value="super_admin" disabled={!isSuperAdmin}>{dict.users.roleSuperAdmin}</option>
            </select>
          </label>
        </div>
        {error ? <div className="alert">{error}</div> : null}
        <div className="topbar-actions">
          <button className="primary" type="button" disabled={saving} onClick={() => createToken()}>
            {dict.apiTokens.create}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{language === "tr" ? "Kayıtlı API Tokenları" : "Saved API Tokens"}</h2>
          <span className="panel-meta">{loadingRecords ? dict.common.loading : `${records.length}`}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{dict.apiTokens.label}</th>
                <th>{dict.apiTokens.role}</th>
                <th>{language === "tr" ? "Token Önizleme" : "Token Preview"}</th>
                <th>{language === "tr" ? "Oluşturan" : "Created By"}</th>
                <th>{language === "tr" ? "Oluşturulma" : "Created At"}</th>
                <th>{language === "tr" ? "Durum" : "Status"}</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={6}>{dict.apiTokens.noToken}</td>
                </tr>
              ) : (
                records.map((row) => (
                  <tr key={row.id}>
                    <td>{row.label}</td>
                    <td>{adminRoleLabel(dict, row.role)}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <code>{row.tokenPreview}</code>
                        <button className="ghost" type="button" onClick={() => copyPreviewToken(row.tokenPreview)}>
                          {dict.apiTokens.copyToken}
                        </button>
                      </div>
                    </td>
                    <td>{row.createdByEmail ?? row.createdByAdminId}</td>
                    <td>{formatTableDateTime(row.createdAt)}</td>
                    <td>{row.revokedAt ? (language === "tr" ? "İptal" : "Revoked") : (language === "tr" ? "Aktif" : "Active")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
