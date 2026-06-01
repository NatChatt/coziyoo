import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import { formatCopy, t } from "../copy/brandCopy";
import { getCurrentLanguage } from "../utils/settings";

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
      isRequired?: boolean;
      rejection_reason?: string | null;
      rejectionReason?: string | null;
      uploaded_at?: string | null;
      uploadedAt?: string | null;
      file_url?: string | null;
      fileUrl?: string | null;
    }>;
    optionalUploads?: Array<{ id: string; custom_title?: string | null; customTitle?: string | null; name?: string | null; status?: string }>;
  };
  error?: { message?: string };
};

export default function SellerComplianceScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [uploadingDocCode, setUploadingDocCode] = useState<string | null>(null);
  const [uploadChoiceDocCode, setUploadChoiceDocCode] = useState<string | null>(null);
  const [payload, setPayload] = useState<CompliancePayload["data"] | null>(null);

  useEffect(() => {
    setCurrentAuth((prev) => (prev.accessToken === auth.accessToken ? prev : auth));
  }, [auth.accessToken]);

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
    () => (payload?.documents ?? []).filter((doc) => Boolean(doc.is_required ?? doc.isRequired)),
    [payload?.documents],
  );

  async function uploadDocumentBase64(docCode: string, dataBase64: string, contentType: string) {
    setUploadingDocCode(docCode);
    const res = await authedFetch("/v1/seller/compliance/documents", {
      method: "POST",
      body: JSON.stringify({
        docType: docCode,
        dataBase64,
        contentType,
      }),
    });
    const json = (await res.json()) as CompliancePayload;
    if (!res.ok) {
      throw new Error(json.error?.message ?? t('error.seller.compliance.upload'));
    }
    await loadData();
    Alert.alert(t('headline.common.success'), t('status.seller.compliance.uploadedSuccess'));
  }

  async function pickPhotoDocument(docCode: string) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('headline.common.permission'), t('error.seller.compliance.galleryPermission'));
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
      Alert.alert(t('headline.common.error'), t('error.seller.compliance.assetMissing'));
      return;
    }
    await uploadDocumentBase64(docCode, dataBase64, asset.mimeType ?? "image/jpeg");
  }

  async function pickPdfDocument(docCode: string) {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const dataBase64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!dataBase64) {
      Alert.alert(t('headline.common.error'), t('error.seller.compliance.assetMissing'));
      return;
    }
    await uploadDocumentBase64(docCode, dataBase64, asset.mimeType ?? "application/pdf");
  }

  function pickAndUploadDocument(docCode: string) {
    setUploadChoiceDocCode(docCode);
  }

  function closeUploadChoice() {
    setUploadChoiceDocCode(null);
  }

  function chooseUploadSource(source: "photo" | "pdf") {
    const docCode = uploadChoiceDocCode;
    closeUploadChoice();
    if (!docCode) return;
    void runUploadChoice(() => source === "photo" ? pickPhotoDocument(docCode) : pickPdfDocument(docCode));
  }

  async function runUploadChoice(action: () => Promise<void>) {
    try {
      await action();
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.seller.compliance.upload'));
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
              <Text style={styles.cardTitle}>{t('headline.seller.compliance.profileStatus')}</Text>
              <Text style={styles.meta}>{formatCopy('status.seller.compliance.state', { status: payload.profile?.status ?? '-' })}</Text>
              <Text style={styles.meta}>{formatCopy('status.seller.compliance.required', { count: payload.profile?.required_count ?? 0 })}</Text>
              <Text style={styles.meta}>{formatCopy('status.seller.compliance.approved', { count: payload.profile?.approved_required_count ?? 0 })}</Text>
              <Text style={styles.meta}>{formatCopy('status.seller.compliance.uploaded', { count: payload.profile?.uploaded_required_count ?? 0 })}</Text>
              <Text style={styles.meta}>{formatCopy('status.seller.compliance.requested', { count: payload.profile?.requested_required_count ?? 0 })}</Text>
              <Text style={styles.meta}>{formatCopy('status.seller.compliance.rejected', { count: payload.profile?.rejected_required_count ?? 0 })}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('headline.seller.compliance.requiredDocuments')}</Text>
              <Text style={styles.progressText}>{formatCopy('status.seller.compliance.completed', {
                uploaded: payload.profile?.uploaded_required_count ?? 0,
                required: payload.profile?.required_count ?? 0,
              })}</Text>
              {requiredDocs.length === 0 ? (
                <Text style={styles.empty}>{t('helper.seller.compliance.emptyDocuments')}</Text>
              ) : null}
              {requiredDocs.map((doc) => {
                const isUploading = uploadingDocCode === (doc.code ?? "");
                const uploadedAt = doc.uploaded_at ?? doc.uploadedAt ?? null;
                const rejectionReason = doc.rejection_reason ?? doc.rejectionReason ?? null;
                return (
                  <View key={doc.id} style={styles.docRow}>
                    <View style={styles.docMeta}>
                      <Text style={styles.docTitle}>{doc.name || doc.code || doc.id}</Text>
                      <Text style={styles.docStatus}>{formatCopy('status.seller.compliance.state', { status: doc.status || '-' })}</Text>
                      {uploadedAt ? <Text style={styles.docHint}>{formatCopy('status.seller.compliance.lastUpload', {
                        date: new Date(uploadedAt).toLocaleString(getCurrentLanguage() === 'en' ? 'en-GB' : 'tr-TR'),
                      })}</Text> : null}
                      {rejectionReason ? <Text style={styles.docReject}>{formatCopy('status.seller.compliance.rejectReason', { reason: rejectionReason })}</Text> : null}
                    </View>
                    <TouchableOpacity
                      style={[styles.uploadBtn, isUploading ? styles.uploadBtnDisabled : null]}
                      onPress={() => void pickAndUploadDocument(doc.code ?? "")}
                      disabled={isUploading || !doc.code}
                    >
                      <Text style={styles.uploadBtnText}>{isUploading ? t('status.seller.compliance.uploading') : t('cta.seller.compliance.uploadDocument')}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('headline.seller.compliance.optionalUploads')}</Text>
              {(payload.optionalUploads ?? []).length === 0 ? (
                <Text style={styles.empty}>{t('helper.seller.compliance.emptyUploads')}</Text>
              ) : null}
              {(payload.optionalUploads ?? []).map((upload) => (
                <Text key={upload.id} style={styles.meta}>
                  {upload.custom_title || upload.customTitle || upload.name || upload.id} · {upload.status || "-"}
                </Text>
              ))}
            </View>
            <TouchableOpacity style={styles.refreshBtn} onPress={() => void loadData()}>
              <Text style={styles.refreshText}>{t('cta.seller.compliance.refresh')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
      <Modal
        visible={Boolean(uploadChoiceDocCode)}
        transparent
        animationType="fade"
        onRequestClose={closeUploadChoice}
      >
        <Pressable style={styles.modalBackdrop} onPress={closeUploadChoice}>
          <Pressable style={styles.uploadChoiceModal} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.uploadChoiceTitle}>{t('cta.seller.compliance.uploadDocument')}</Text>
            <Text style={styles.uploadChoiceBody}>{t('helper.seller.compliance.uploadChoice')}</Text>
            <TouchableOpacity style={styles.uploadChoiceButton} onPress={() => chooseUploadSource("photo")}>
              <Text style={styles.uploadChoiceButtonText}>{t('cta.seller.compliance.choosePhoto')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.uploadChoiceButton} onPress={() => chooseUploadSource("pdf")}>
              <Text style={styles.uploadChoiceButtonText}>{t('cta.seller.compliance.choosePdf')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.uploadChoiceCancel} onPress={closeUploadChoice}>
              <Text style={styles.uploadChoiceCancelText}>{t('cta.common.cancel')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
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
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(46, 36, 28, 0.42)",
    padding: 16,
  },
  uploadChoiceModal: {
    borderRadius: 18,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5DDCF",
    padding: 16,
    gap: 10,
  },
  uploadChoiceTitle: { color: "#2E241C", fontWeight: "800", fontSize: 17 },
  uploadChoiceBody: { color: "#6C6055", lineHeight: 20 },
  uploadChoiceButton: {
    borderRadius: 12,
    backgroundColor: theme.primary,
    paddingVertical: 13,
    alignItems: "center",
  },
  uploadChoiceButtonText: { color: "#fff", fontWeight: "800" },
  uploadChoiceCancel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    paddingVertical: 13,
    alignItems: "center",
  },
  uploadChoiceCancelText: { color: "#5F5348", fontWeight: "800" },
});
