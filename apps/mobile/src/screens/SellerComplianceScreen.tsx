import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import { t } from "../copy/brandCopy";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type CompliancePayload = {
  data?: {
    profile?: {
      status?: string;
      required_count?: number;
      approved_required_count?: number;
      uploaded_required_count?: number;
      requested_required_count?: number;
      rejected_required_count?: number;
    };
    documents?: Array<{
      id: string;
      name?: string;
      code?: string;
      status?: string;
      is_required?: boolean;
      rejection_reason?: string | null;
      uploaded_at?: string | null;
    }>;
    optionalUploads?: Array<{ id: string; custom_title?: string | null; status?: string }>;
  };
  error?: { message?: string };
};

export default function SellerComplianceScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [uploadingDocCode, setUploadingDocCode] = useState<string | null>(null);
  const [payload, setPayload] = useState<CompliancePayload["data"] | null>(null);

  useEffect(() => setCurrentAuth(auth), [auth]);

  async function authedFetch(path: string, init?: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentAuth.accessToken}`,
      ...actorRoleHeader(currentAuth, "seller"),
    };
    let res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status !== 401) return res;
    const refreshed = await refreshAuthSession(baseUrl, currentAuth);
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...headers,
        Authorization: `Bearer ${refreshed.accessToken}`,
        ...actorRoleHeader(refreshed, "seller"),
      },
    });
  }

  async function loadData() {
    setLoading(true);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const res = await authedFetch("/v1/seller/compliance/profile", undefined, baseUrl);
      const json = (await res.json()) as CompliancePayload;
      if (!res.ok) throw new Error(json.error?.message ?? t('headline.seller.profileDetail.compliance'));
      setPayload(json.data ?? null);
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('headline.seller.profileDetail.compliance'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const requiredDocs = useMemo(
    () => (payload?.documents ?? []).filter((doc) => Boolean(doc.is_required)),
    [payload?.documents],
  );

  async function pickAndUploadDocument(docCode: string) {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('headline.common.permission'), "Belge yüklemek için galeri izni gerekli.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsEditing: false,
        base64: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const dataBase64 = asset.base64;
      if (!dataBase64) {
        Alert.alert(t('headline.common.error'), "Belge verisi okunamadı.");
        return;
      }

      setUploadingDocCode(docCode);
      const res = await authedFetch("/v1/seller/compliance/documents", {
        method: "POST",
        body: JSON.stringify({
          docType: docCode,
          dataBase64,
          contentType: asset.mimeType ?? "image/jpeg",
        }),
      });
      const json = (await res.json()) as CompliancePayload;
      if (!res.ok) {
        throw new Error(json.error?.message ?? "Belge yüklenemedi");
      }
      await loadData();
      Alert.alert(t('headline.common.success'), "Belge yüklendi.");
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : "Belge yüklenemedi");
    } finally {
      setUploadingDocCode(null);
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('headline.seller.profileDetail.compliance')} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        {loading || !payload ? (
          <ActivityIndicator size="large" color={theme.primary} style={styles.loader} />
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Profil Durumu: {payload.profile?.status ?? "-"}</Text>
              <Text style={styles.meta}>Zorunlu: {payload.profile?.required_count ?? 0}</Text>
              <Text style={styles.meta}>Onaylı: {payload.profile?.approved_required_count ?? 0}</Text>
              <Text style={styles.meta}>Yüklü: {payload.profile?.uploaded_required_count ?? 0}</Text>
              <Text style={styles.meta}>İstenen: {payload.profile?.requested_required_count ?? 0}</Text>
              <Text style={styles.meta}>Reddedilen: {payload.profile?.rejected_required_count ?? 0}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Zorunlu Belgeler</Text>
              <Text style={styles.progressText}>
                Tamamlandı: {payload.profile?.uploaded_required_count ?? 0}/{payload.profile?.required_count ?? 0}
              </Text>
              {requiredDocs.length === 0 ? (
                <Text style={styles.empty}>Belge bulunamadı.</Text>
              ) : null}
              {requiredDocs.map((doc) => {
                const isUploading = uploadingDocCode === (doc.code ?? "");
                return (
                  <View key={doc.id} style={styles.docRow}>
                    <View style={styles.docMeta}>
                      <Text style={styles.docTitle}>{doc.name || doc.code || doc.id}</Text>
                      <Text style={styles.docStatus}>Durum: {doc.status || "-"}</Text>
                      {doc.uploaded_at ? <Text style={styles.docHint}>Son yükleme: {new Date(doc.uploaded_at).toLocaleString("tr-TR")}</Text> : null}
                      {doc.rejection_reason ? <Text style={styles.docReject}>Red nedeni: {doc.rejection_reason}</Text> : null}
                    </View>
                    <TouchableOpacity
                      style={[styles.uploadBtn, isUploading ? styles.uploadBtnDisabled : null]}
                      onPress={() => void pickAndUploadDocument(doc.code ?? "")}
                      disabled={isUploading || !doc.code}
                    >
                      <Text style={styles.uploadBtnText}>{isUploading ? "Yükleniyor..." : "Belge Yükle"}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Opsiyonel Yüklemeler</Text>
              {(payload.optionalUploads ?? []).length === 0 ? (
                <Text style={styles.empty}>Yükleme bulunamadı.</Text>
              ) : null}
              {(payload.optionalUploads ?? []).map((upload) => (
                <Text key={upload.id} style={styles.meta}>
                  {upload.custom_title || upload.id} · {upload.status || "-"}
                </Text>
              ))}
            </View>
            <TouchableOpacity style={styles.refreshBtn} onPress={() => void loadData()}>
              <Text style={styles.refreshText}>Yenile</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  loader: { marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  cardTitle: { color: "#2E241C", fontWeight: "800", marginBottom: 6 },
  progressText: { color: "#2E6B44", fontWeight: "700", marginBottom: 8 },
  meta: { color: "#6C6055", marginTop: 3 },
  empty: { color: "#9E8E7E", fontSize: 13, fontStyle: "italic" },
  docRow: { borderWidth: 1, borderColor: "#EFE6DA", borderRadius: 10, padding: 10, marginTop: 8, gap: 8 },
  docMeta: { gap: 3 },
  docTitle: { color: "#2E241C", fontWeight: "700" },
  docStatus: { color: "#5F5348" },
  docHint: { color: "#6F6358", fontSize: 12 },
  docReject: { color: "#B42318", fontSize: 12 },
  uploadBtn: { marginTop: 4, alignSelf: "flex-start", backgroundColor: theme.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  uploadBtnDisabled: { opacity: 0.6 },
  uploadBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  refreshBtn: { backgroundColor: "#EFE9DF", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  refreshText: { color: "#5F5348", fontWeight: "700" },
});
