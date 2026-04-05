import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import type { AuthSession } from "../utils/auth";
import { loadAuthSession, refreshAuthSession, saveAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import { getSellerProfileCache, setSellerProfileCache, getSellerMeCache, setSellerMeCache } from "../utils/sellerProfileCache";

const MODAL_PLACEHOLDER_COLOR = "#A9A7A1";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onEdit: () => void;
  onOpenOrderHistory: () => void;
  onOpenCompliance: () => void;
  onOpenFinance: () => void;
  onOpenReviews: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onOpenAddresses: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export type SellerProfile = {
  displayName?: string | null;
  username?: string | null;
  email?: string | null;
  profileImageUrl?: string | null;
  phone?: string | null;
  kitchenTitle?: string | null;
  kitchenDescription?: string | null;
  kitchenSpecialties?: string[] | null;
  deliveryRadiusKm?: number | null;
  deliveryEnabled?: boolean;
  deliveryTerms?: string | null;
  workingHours?: Array<{ day: string; open: string; close: string; enabled?: boolean }>;
  status?: "incomplete" | "pending_review" | "active";
  defaultAddress?: { title: string; addressLine: string } | null;
  requirements?: {
    hasPhone: boolean;
    hasDefaultAddress: boolean;
    hasKitchenTitle: boolean;
    hasKitchenDescription: boolean;
    hasDeliveryRadius: boolean;
    hasWorkingHours: boolean;
    complianceRequiredCount: number;
    complianceUploadedRequiredCount: number;
  };
};

const STATUS_CONFIG = {
  active: { label: "Aktif", bg: "#EFF6F1", color: "#2E6B44", border: "#CFE2D5" },
  pending_review: { label: "İncelemede", bg: "#FFF5E9", color: "#7A4D1B", border: "#F0C995" },
  incomplete: { label: "Eksik", bg: "#FFF0EE", color: "#B42318", border: "#F9CECA" },
};

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value?.trim() || "—"}</Text>
    </View>
  );
}

export default function SellerProfileDetailScreen({
  auth,
  onBack,
  onEdit,
  onOpenOrderHistory,
  onOpenCompliance,
  onOpenFinance,
  onOpenReviews,
  onOpenSettings,
  onLogout,
  onOpenAddresses,
  onAuthRefresh,
}: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(() => getSellerProfileCache() === null);
  const [profile, setProfile] = useState<SellerProfile | null>(() => getSellerProfileCache());
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [masterName, setMasterName] = useState(() => getSellerProfileCache()?.displayName?.trim() ?? "");
  const [fullName, setFullName] = useState(() => getSellerMeCache()?.fullName ?? "");
  const [contactEmail, setContactEmail] = useState(() => getSellerMeCache()?.email || getSellerProfileCache()?.email?.trim() || "");
  const [contactPhone, setContactPhone] = useState(() => getSellerProfileCache()?.phone?.trim() ?? "");
  const [contactDob, setContactDob] = useState(() => getSellerMeCache()?.dob ?? "");
  const [cityDistrict, setCityDistrict] = useState(() => getSellerProfileCache()?.defaultAddress?.title?.trim() ?? "");
  const [addressLine, setAddressLine] = useState(() => getSellerProfileCache()?.defaultAddress?.addressLine?.trim() ?? "");
  const [contactCountryCode, setContactCountryCode] = useState(() => getSellerMeCache()?.countryCode ?? "");
  const [tcKimlikNo, setTcKimlikNo] = useState(() => getSellerMeCache()?.nationalId ?? "");
  const [deliveryEnabled, setDeliveryEnabled] = useState(() => Boolean(getSellerProfileCache()?.deliveryEnabled));
  const [deliveryTerms, setDeliveryTerms] = useState(() => getSellerProfileCache()?.deliveryTerms?.trim() ?? "");
  const [deliveryRadiusKmInput, setDeliveryRadiusKmInput] = useState(() => String(getSellerProfileCache()?.deliveryRadiusKm ?? 3));
  const [deliveryEnabledDraft, setDeliveryEnabledDraft] = useState(() => Boolean(getSellerProfileCache()?.deliveryEnabled));
  const [deliveryTermsDraft, setDeliveryTermsDraft] = useState(() => getSellerProfileCache()?.deliveryTerms?.trim() ?? "");
  const [deliveryRadiusKmDraft, setDeliveryRadiusKmDraft] = useState(() => String(getSellerProfileCache()?.deliveryRadiusKm ?? 3));
  const [idCardFrontUri, setIdCardFrontUri] = useState<string | null>(null);
  const [idCardBackUri, setIdCardBackUri] = useState<string | null>(null);
  const [idCardFrontBase64, setIdCardFrontBase64] = useState<string | null>(null);
  const [idCardFrontMime, setIdCardFrontMime] = useState<string>("image/jpeg");
  const [idCardBackBase64, setIdCardBackBase64] = useState<string | null>(null);
  const [idCardBackMime, setIdCardBackMime] = useState<string>("image/jpeg");
  const [idCardUploading, setIdCardUploading] = useState(false);

  const [isKitchenModalOpen, setIsKitchenModalOpen] = useState(false);
  const [kitchenDescInput, setKitchenDescInput] = useState("");
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [newSpecialty, setNewSpecialty] = useState("");
  const [kitchenSaving, setKitchenSaving] = useState(false);

  useEffect(() => setCurrentAuth(auth), [auth]);

  async function readResponsePayload(res: Response): Promise<{ json: Record<string, unknown> | null; rawText: string }> {
    const rawText = await res.text();
    const trimmed = rawText.trim();
    if (!trimmed) return { json: {}, rawText };
    try {
      return { json: JSON.parse(trimmed) as Record<string, unknown>, rawText };
    } catch {
      return { json: null, rawText };
    }
  }

  function responseErrorMessage(
    res: Response,
    payload: { json: Record<string, unknown> | null; rawText: string },
    fallback: string,
  ): string {
    const apiError = payload.json?.error;
    if (apiError && typeof apiError === "object" && typeof (apiError as { message?: unknown }).message === "string") {
      const message = (apiError as { message?: string }).message?.trim();
      if (message) return message;
    }
    const raw = payload.rawText.trim();
    if (raw.startsWith("<")) return `${fallback} (Sunucu JSON yerine HTML döndü, HTTP ${res.status})`;
    if (raw) return `${fallback}: ${raw.slice(0, 180)}`;
    return `${fallback} (${res.status})`;
  }

  async function authedFetch(path: string, baseUrl = apiUrl, init?: RequestInit): Promise<Response> {
    const makeHeaders = (session: AuthSession): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...actorRoleHeader(session, "seller"),
      ...(init?.headers as Record<string, string> | undefined),
    });

    const headers = makeHeaders(currentAuth);
    let res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status !== 401) return res;

    const persisted = await loadAuthSession();
    if (persisted && persisted.userId === currentAuth.userId && persisted.accessToken !== currentAuth.accessToken) {
      setCurrentAuth(persisted);
      onAuthRefresh?.(persisted);
      res = await fetch(`${baseUrl}${path}`, { ...init, headers: makeHeaders(persisted) });
      if (res.status !== 401) return res;
    }

    const refreshed = await refreshAuthSession(
      baseUrl,
      persisted && persisted.userId === currentAuth.userId ? persisted : currentAuth,
    );
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: makeHeaders(refreshed),
    });
  }

  async function load() {
    if (getSellerProfileCache() === null) setLoading(true);
    setError(null);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const profileRes = await authedFetch("/v1/seller/profile", baseUrl, undefined);
      const profilePayload = await readResponsePayload(profileRes);
      if (!profileRes.ok || profilePayload.json === null) {
        throw new Error(responseErrorMessage(profileRes, profilePayload, "Profil yüklenemedi"));
      }
      const profileJson = profilePayload.json as { data?: SellerProfile };
      const loaded: SellerProfile | null = profileJson.data ?? null;
      setSellerProfileCache(loaded);
      setProfile(loaded);
      setMasterName(String(loaded?.displayName ?? "").trim());
      const profileEmail = String(loaded?.email ?? "").trim();
      setContactEmail(profileEmail || currentAuth.email?.trim() || auth.email?.trim() || "");
      setContactPhone(String(loaded?.phone ?? "").trim());
      setContactDob("");
      setCityDistrict(String(loaded?.defaultAddress?.title ?? "").trim());
      setAddressLine(String(loaded?.defaultAddress?.addressLine ?? "").trim());
      setDeliveryEnabled(Boolean(loaded?.deliveryEnabled));
      setDeliveryTerms(String(loaded?.deliveryTerms ?? "").trim());
      setDeliveryRadiusKmInput(String(loaded?.deliveryRadiusKm ?? 3));
      setKitchenDescInput(loaded?.kitchenDescription?.trim() ?? "");
      setSpecialties(Array.isArray(loaded?.kitchenSpecialties) ? loaded.kitchenSpecialties : []);

      const meRes = await authedFetch("/v1/auth/me", baseUrl, undefined);
      const mePayload = await readResponsePayload(meRes);
      const meJson = mePayload.json as { data?: Record<string, unknown> } | null;
      if (meRes.ok && meJson?.data) {
        const fullNameVal = String(meJson.data.fullName ?? "").trim();
        const dobVal = formatDobForDisplay(String(meJson.data.dob ?? ""));
        const countryCodeVal = String(meJson.data.countryCode ?? "").trim().toUpperCase();
        const nationalIdVal = String(meJson.data.nationalId ?? "").trim();
        const meEmail = String(meJson.data.email ?? "").trim();
        setSellerMeCache({ fullName: fullNameVal, dob: dobVal, countryCode: countryCodeVal, nationalId: nationalIdVal, email: meEmail });
        setFullName(fullNameVal);
        setContactDob(dobVal);
        setContactCountryCode(countryCodeVal);
        setTcKimlikNo(nationalIdVal);
        if (meEmail) setContactEmail(meEmail);
      } else {
        setFullName("");
        setContactDob("");
        setContactCountryCode("");
        setTcKimlikNo("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Profil yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleAvatarPress() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("İzin gerekli", "Galeriden resim seçebilmek için izin vermelisin.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.55,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? "image/jpeg";
      const base64Image = asset.base64 ?? null;
      if (!base64Image) {
        Alert.alert("Hata", "Resim verisi alınamadı.");
        return;
      }
      if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
        Alert.alert("Hata", "Sadece JPEG, PNG veya WebP seçebilirsin.");
        return;
      }

      setAvatarUploading(true);
      const baseUrl = apiUrl || (await loadSettings()).apiUrl;
      const uploadRes = await authedFetch("/v1/auth/me/profile-image/upload", baseUrl, {
        method: "POST",
        body: JSON.stringify({
          contentType: mimeType,
          dataBase64: base64Image,
        }),
      });
      const uploadPayload = await readResponsePayload(uploadRes);
      if (!uploadRes.ok || uploadPayload.json === null) {
        throw new Error(responseErrorMessage(uploadRes, uploadPayload, "Profil resmi yüklenemedi"));
      }
      const uploadJson = uploadPayload.json as { data?: { profileImageUrl?: string } };
      const nextUrl = String(uploadJson?.data?.profileImageUrl ?? "").trim();
      if (nextUrl) {
        setProfile((prev) => (prev ? { ...prev, profileImageUrl: nextUrl } : prev));
      }
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Profil resmi yüklenemedi");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function pickIdCardImage(side: "front" | "back") {
    const label = side === "front" ? "ön" : "arka";

    const source = await new Promise<"camera" | "gallery" | null>((resolve) => {
      Alert.alert("Kimlik Fotoğrafı", `${label.charAt(0).toUpperCase() + label.slice(1)} yüz fotoğrafını nasıl eklemek istersin?`, [
        { text: "Kamera", onPress: () => resolve("camera") },
        { text: "Galeri", onPress: () => resolve("gallery") },
        { text: "İptal", style: "cancel", onPress: () => resolve(null) },
      ]);
    });
    if (!source) return;

    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === "camera") {
        const camPerm = await ImagePicker.requestCameraPermissionsAsync();
        if (!camPerm.granted) {
          Alert.alert("İzin gerekli", "Fotoğraf çekebilmek için kamera izni vermelisin.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [16, 10],
          quality: 0.7,
          base64: true,
        });
      } else {
        const libPerm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!libPerm.granted) {
          Alert.alert("İzin gerekli", "Galeriden resim seçebilmek için izin vermelisin.");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [16, 10],
          quality: 0.7,
          base64: true,
        });
      }
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const mime = asset.mimeType ?? "image/jpeg";
      const b64 = asset.base64 ?? null;
      if (!b64) {
        Alert.alert("Hata", "Resim verisi alınamadı.");
        return;
      }
      if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
        Alert.alert("Hata", "Sadece JPEG, PNG veya WebP seçebilirsin.");
        return;
      }

      if (side === "front") {
        setIdCardFrontUri(asset.uri);
        setIdCardFrontBase64(b64);
        setIdCardFrontMime(mime);
      } else {
        setIdCardBackUri(asset.uri);
        setIdCardBackBase64(b64);
        setIdCardBackMime(mime);
      }
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Resim yüklenemedi");
    }
  }

  function parseWorkingHours(value: string): Array<{ day: string; open: string; close: string; enabled: boolean }> {
    const parts = value.split(",").map((x) => x.trim()).filter(Boolean);
    const parsed = parts
      .map((part) => {
        const [day, range] = part.split(" ");
        if (!day || !range || !range.includes("-")) return null;
        const [open, close] = range.split("-");
        return { day, open, close, enabled: true };
      })
      .filter((x): x is { day: string; open: string; close: string; enabled: boolean } => Boolean(x));
    return parsed.length > 0 ? parsed : [{ day: "Her gün", open: "09:00", close: "20:00", enabled: true }];
  }

  function addSpecialty() {
    const val = newSpecialty.trim();
    if (!val || specialties.includes(val)) return;
    setSpecialties((prev) => [...prev, val]);
    setNewSpecialty("");
  }

  function removeSpecialty(item: string) {
    setSpecialties((prev) => prev.filter((s) => s !== item));
  }

  function normalizeDobForApi(value: string): string | null {
    const raw = value.trim();
    if (!raw) return null;

    const ensureValidDate = (year: string, month: string, day: string): string | null => {
      const yyyy = Number(year);
      const mm = Number(month);
      const dd = Number(day);
      if (!Number.isInteger(yyyy) || !Number.isInteger(mm) || !Number.isInteger(dd)) return null;
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
      const date = new Date(Date.UTC(yyyy, mm - 1, dd));
      if (
        date.getUTCFullYear() !== yyyy ||
        date.getUTCMonth() !== mm - 1 ||
        date.getUTCDate() !== dd
      ) {
        return null;
      }
      return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    };

    const normalized = raw.replace(/\./g, "-").replace(/\//g, "-");
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    if (ymd) return ensureValidDate(ymd[1], ymd[2], ymd[3]);

    const ymdWithTime = /^(\d{4})-(\d{2})-(\d{2})T/.exec(raw);
    if (ymdWithTime) return ensureValidDate(ymdWithTime[1], ymdWithTime[2], ymdWithTime[3]);

    const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(normalized);
    if (dmy) return ensureValidDate(dmy[3], dmy[2], dmy[1]);

    const digitsOnly = raw.replace(/\D/g, "");
    if (digitsOnly.length === 8) {
      return ensureValidDate(
        digitsOnly.slice(4, 8),
        digitsOnly.slice(2, 4),
        digitsOnly.slice(0, 2),
      );
    }

    return null;
  }

  function formatDobInput(value: string): string {
    const digits = value.replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  }

  function formatDobForDisplay(value: string): string {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
    const ymdWithTime = /^(\d{4})-(\d{2})-(\d{2})T/.exec(raw);
    if (ymdWithTime) return `${ymdWithTime[3]}/${ymdWithTime[2]}/${ymdWithTime[1]}`;
    return formatDobInput(raw);
  }

  async function saveKitchen() {
    setKitchenSaving(true);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      const res = await authedFetch("/v1/seller/profile", baseUrl, {
        method: "PUT",
        body: JSON.stringify({
          kitchenDescription: kitchenDescInput.trim(),
          kitchenSpecialties: specialties,
        }),
      });
      const payload = await readResponsePayload(res);
      if (!res.ok || payload.json === null) throw new Error(responseErrorMessage(res, payload, "Kaydedilemedi"));
      setIsKitchenModalOpen(false);
      void load();
    } catch (e) {
      console.error("[kitchen save]", e);
    } finally {
      setKitchenSaving(false);
    }
  }

  function openDeliverySettingsModal() {
    setDeliveryEnabledDraft(Boolean(deliveryEnabled));
    setDeliveryTermsDraft(deliveryTerms);
    setDeliveryRadiusKmDraft(deliveryRadiusKmInput?.trim() ? deliveryRadiusKmInput : "3");
    setIsDeliveryModalOpen(true);
  }

  async function saveDeliverySettings() {
    setDeliverySaving(true);
    try {
      const normalizedDeliveryRadius = Number(deliveryRadiusKmDraft || 0);
      if (!Number.isFinite(normalizedDeliveryRadius) || normalizedDeliveryRadius <= 0) {
        Alert.alert("Hata", "Teslimat yarıçapı 0'dan büyük bir sayı olmalı.");
        setDeliverySaving(false);
        return;
      }

      const nextDeliveryTerms = deliveryTermsDraft.trim();
      const baseUrl = (await loadSettings()).apiUrl;
      const res = await authedFetch("/v1/seller/profile", baseUrl, {
        method: "PUT",
        body: JSON.stringify({
          deliveryEnabled: deliveryEnabledDraft,
          deliveryTerms: nextDeliveryTerms,
          deliveryRadiusKm: normalizedDeliveryRadius,
        }),
      });
      const payload = await readResponsePayload(res);
      if (!res.ok || payload.json === null) {
        throw new Error(responseErrorMessage(res, payload, "Teslimat ayarları kaydedilemedi"));
      }

      setDeliveryEnabled(deliveryEnabledDraft);
      setDeliveryTerms(nextDeliveryTerms);
      setDeliveryRadiusKmInput(String(normalizedDeliveryRadius));
      setProfile((prev) => (prev
        ? {
            ...prev,
            deliveryEnabled: deliveryEnabledDraft,
            deliveryTerms: nextDeliveryTerms,
            deliveryRadiusKm: normalizedDeliveryRadius,
          }
        : prev));
      setIsDeliveryModalOpen(false);
      Alert.alert("Başarılı", "Teslimat ayarları kaydedildi.");
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Teslimat ayarları kaydedilemedi");
    } finally {
      setDeliverySaving(false);
    }
  }

  async function saveContactProfile() {
    setContactSaving(true);
    try {
      const baseUrl = (await loadSettings()).apiUrl;
      const payload: Record<string, string> = {};

      if (contactEmail.trim()) payload.email = contactEmail.trim();
      if (masterName.trim()) payload.displayName = masterName.trim();
      if (fullName.trim()) payload.fullName = fullName.trim();
      if (contactPhone.trim()) payload.phone = contactPhone.trim();
      if (contactCountryCode.trim()) payload.countryCode = contactCountryCode.trim().toUpperCase();
      const nationalIdInput = tcKimlikNo.trim();
      payload.nationalId = /^\d{11}$/.test(nationalIdInput) ? nationalIdInput : "11111111111";
      if (contactDob.trim()) {
        const normalizedDob = normalizeDobForApi(contactDob);
        if (!normalizedDob) {
          Alert.alert("Hata", "Doğum tarihi formatı GG/AA/YYYY veya YYYY-AA-GG olmalı.");
          setContactSaving(false);
          return;
        }
        payload.dob = normalizedDob;
      }

      const titleInput = cityDistrict.trim();
      const lineInput = addressLine.trim();
      const currentAddressTitle = String(profile?.defaultAddress?.title ?? "").trim();
      const currentAddressLine = String(profile?.defaultAddress?.addressLine ?? "").trim();
      const title = titleInput || currentAddressTitle;
      const line = lineInput || currentAddressLine;
      const hasAddressInput = Boolean(titleInput || lineInput);
      const hasAddressUpdate = hasAddressInput && Boolean(title && line) && (
        title !== currentAddressTitle || line !== currentAddressLine
      );
      const hasProfileUpdate = Object.keys(payload).length > 0;
      const hasIdCardImages = Boolean(idCardFrontBase64 || idCardBackBase64);
      if (hasAddressInput) {
        if (!title || !line) {
          Alert.alert("Hata", "Adres için şehir/ilçe ve açık adres bilgilerini birlikte gir.");
          setContactSaving(false);
          return;
        }
        if (line.length < 10) {
          Alert.alert("Hata", "Adres en az 10 karakter olmalı.");
          setContactSaving(false);
          return;
        }
        const words = line.split(/\s+/).filter((w) => w.length > 0);
        if (words.length < 2) {
          Alert.alert("Hata", "Geçerli bir adres girin (mahalle, sokak, bina no gibi).");
          setContactSaving(false);
          return;
        }
      }
      if (!hasProfileUpdate && !hasAddressUpdate && !hasIdCardImages) {
        setIsEditModalOpen(false);
        setContactSaving(false);
        return;
      }

      let addressErrorMessage: string | null = null;
      if (hasProfileUpdate) {
        const meRes = await authedFetch("/v1/auth/me", baseUrl, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        const mePayload = await readResponsePayload(meRes);
        if (!meRes.ok || mePayload.json === null) throw new Error(responseErrorMessage(meRes, mePayload, "Profil bilgileri kaydedilemedi"));
        const meJson = mePayload.json as { data?: { email?: string } };
        const updatedEmail = String(meJson.data?.email ?? "").trim();
        if (updatedEmail && updatedEmail !== currentAuth.email) {
          const nextSession: AuthSession = {
            ...currentAuth,
            email: updatedEmail,
          };
          setCurrentAuth(nextSession);
          onAuthRefresh?.(nextSession);
          await saveAuthSession(nextSession);
        }
      }

      setIsEditModalOpen(false);

      if (hasAddressUpdate) {
        try {
          const listRes = await authedFetch("/v1/auth/me/addresses", baseUrl, undefined);
          const listPayload = await readResponsePayload(listRes);
          if (!listRes.ok || listPayload.json === null) throw new Error(responseErrorMessage(listRes, listPayload, "Adres listesi alınamadı"));
          const listJson = listPayload.json as { data?: Array<{ id?: string; isDefault?: boolean }> };
          const defaultAddress = Array.isArray(listJson?.data)
            ? listJson.data.find((item: { isDefault?: boolean }) => item?.isDefault)
            : null;

          if (defaultAddress?.id) {
            const patchRes = await authedFetch(`/v1/auth/me/addresses/${defaultAddress.id}`, baseUrl, {
              method: "PATCH",
              body: JSON.stringify({
                title,
                addressLine: line,
                isDefault: true,
              }),
            });
            const patchPayload = await readResponsePayload(patchRes);
            if (!patchRes.ok || patchPayload.json === null) throw new Error(responseErrorMessage(patchRes, patchPayload, "Adres kaydedilemedi"));
          } else {
            const addrRes = await authedFetch("/v1/auth/me/addresses", baseUrl, {
              method: "POST",
              body: JSON.stringify({
                title,
                addressLine: line,
                isDefault: true,
              }),
            });
            const addrPayload = await readResponsePayload(addrRes);
            if (!addrRes.ok || addrPayload.json === null) throw new Error(responseErrorMessage(addrRes, addrPayload, "Adres kaydedilemedi"));
          }
        } catch (addressError) {
          addressErrorMessage = addressError instanceof Error ? addressError.message : "Adres kaydedilemedi";
        }
      }

      if (hasIdCardImages) {
        setIdCardUploading(true);
        try {
          if (idCardFrontBase64) {
            const frontRes = await authedFetch("/v1/seller/compliance/documents", baseUrl, {
              method: "POST",
              body: JSON.stringify({
                docType: "national_id_front",
                dataBase64: idCardFrontBase64,
                contentType: idCardFrontMime,
              }),
            });
            const frontPayload = await readResponsePayload(frontRes);
            if (!frontRes.ok || frontPayload.json === null) throw new Error(responseErrorMessage(frontRes, frontPayload, "Kimlik ön yüz yüklenemedi"));
          }
          if (idCardBackBase64) {
            const backRes = await authedFetch("/v1/seller/compliance/documents", baseUrl, {
              method: "POST",
              body: JSON.stringify({
                docType: "national_id_back",
                dataBase64: idCardBackBase64,
                contentType: idCardBackMime,
              }),
            });
            const backPayload = await readResponsePayload(backRes);
            if (!backRes.ok || backPayload.json === null) throw new Error(responseErrorMessage(backRes, backPayload, "Kimlik arka yüz yüklenemedi"));
          }
        } catch (idCardError) {
          Alert.alert("Uyarı", idCardError instanceof Error ? idCardError.message : "Kimlik fotoğrafları yüklenemedi");
        } finally {
          setIdCardUploading(false);
        }
      }

      await load();
      if (addressErrorMessage) {
        Alert.alert("Uyarı", `Profil güncellendi, adres kaydedilemedi: ${addressErrorMessage}`);
      } else {
        Alert.alert("Başarılı", "İletişim bilgileri kaydedildi.");
      }
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Bilgiler kaydedilemedi");
    } finally {
      setContactSaving(false);
    }
  }

  const statusCfg = STATUS_CONFIG[profile?.status ?? "incomplete"];
  const initials = (profile?.displayName ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const complianceRequired = profile?.requirements?.complianceRequiredCount ?? 0;
  const complianceUploaded = profile?.requirements?.complianceUploadedRequiredCount ?? 0;
  const complianceRemaining = Math.max(0, complianceRequired - complianceUploaded);

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Satıcı Profili"
        onBack={onBack}
      />

      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} style={styles.loader} />
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
            <Text style={styles.retryBtnText}>Tekrar Dene</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutErrBtn} onPress={onLogout}>
            <Text style={styles.logoutErrBtnText}>Çıkış Yap</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>

          {/* Avatar + İsim + Durum */}
          <View style={styles.heroCard}>
            <TouchableOpacity style={styles.avatar} activeOpacity={0.85} onPress={() => void handleAvatarPress()} disabled={avatarUploading}>
              {profile?.profileImageUrl ? (
                <Image source={{ uri: profile.profileImageUrl }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{initials}</Text>
              )}
              <View style={styles.avatarEditBadge}>
                {avatarUploading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="camera" size={12} color="#fff" />
                )}
              </View>
            </TouchableOpacity>
            <View style={styles.heroInfo}>
              <Text style={styles.displayName}>{profile?.displayName ?? "—"}</Text>
              {profile?.username ? <Text style={styles.kitchenTitle}>@{profile.username}</Text> : null}
              {profile?.kitchenTitle ? <Text style={styles.kitchenTitle}>{profile.kitchenTitle}</Text> : null}
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg, borderColor: statusCfg.border }]}>
              <Text style={[styles.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
            </View>
          </View>

          {/* Belge Durumu */}
          <TouchableOpacity style={styles.complianceCard} activeOpacity={0.85} onPress={onOpenCompliance}>
            <Text style={styles.complianceTitle}>Belge Durumu</Text>
            <Text style={styles.complianceText}>
              Tamamlanan: {complianceUploaded}/
              <Text style={styles.complianceRemainingInlineText}>{complianceRemaining}</Text>
            </Text>
            <Text style={styles.complianceAction}>Belgeleri aç →</Text>
          </TouchableOpacity>

          {/* Profili Düzenle */}
          <View style={styles.card}>
            <View style={styles.profileEditCardHeader}>
              <Text style={styles.cardTitleNoCaps}>Profili Düzenle</Text>
              <TouchableOpacity
                style={styles.profileEditIconBtn}
                onPress={() => setIsEditModalOpen(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="pencil" size={18} color={theme.primary} />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={openDeliverySettingsModal}>
            <View style={styles.profileEditCardHeader}>
              <Text style={styles.cardTitle}>Teslimat Ayarı</Text>
              <View style={styles.profileEditIconBtn}>
                <Ionicons name="pencil" size={16} color={theme.primary} />
              </View>
            </View>
            <InfoRow label="Teslimat" value={deliveryEnabled ? "Açık" : "Kapalı"} />
            <InfoRow label="Yarıçap" value={deliveryRadiusKmInput?.trim() ? `${deliveryRadiusKmInput} km` : "—"} />
            <InfoRow label="Koşullar" value={deliveryTerms || "Henüz eklenmedi"} />
            <Text style={styles.addressLink}>Düzenlemek için dokun</Text>
          </TouchableOpacity>

          {/* Mutfak Bilgileri */}
          <View style={styles.card}>
            <View style={styles.profileEditCardHeader}>
              <Text style={styles.cardTitle}>Hakkımda</Text>
              <TouchableOpacity
                style={styles.profileEditIconBtn}
                onPress={() => setIsKitchenModalOpen(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="pencil" size={18} color={theme.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Navigasyon Butonları */}
          <TouchableOpacity style={styles.navBtn} onPress={onOpenOrderHistory}>
            <Text style={styles.navBtnText}>Sipariş Geçmişim</Text>
            <Text style={styles.navArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={onOpenReviews}>
            <Text style={styles.navBtnText}>Yorumlar / Değerlendirmeler</Text>
            <Text style={styles.navArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={onOpenSettings}>
            <Text style={styles.navBtnText}>Ayarlar</Text>
            <Text style={styles.navArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
            <Text style={styles.logoutBtnText}>Çıkış Yap</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.editFullBtn} onPress={onEdit}>
            <Text style={styles.editFullText}>Profili Düzenle</Text>
          </TouchableOpacity>

          {/* Çalışma Saatleri */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Çalışma Saatleri</Text>
            {(profile?.workingHours ?? []).length > 0 ? (
              profile!.workingHours!.map((h, i) => (
                <View key={i} style={styles.hourRow}>
                  <Text style={styles.hourDay}>{h.day}</Text>
                  <Text style={styles.hourRange}>{h.open} – {h.close}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.infoValue}>—</Text>
            )}
          </View>

        </ScrollView>
      )}

      <Modal visible={isDeliveryModalOpen} transparent animationType="fade" onRequestClose={() => setIsDeliveryModalOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 18 : 0}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setIsDeliveryModalOpen(false)}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Teslimat Ayarları</Text>
            <Text style={styles.modalLabel}>Teslimat ayarı</Text>
            <TouchableOpacity
              style={[styles.deliveryToggleCard, deliveryEnabledDraft && styles.deliveryToggleCardActive]}
              activeOpacity={0.85}
              onPress={() => setDeliveryEnabledDraft((prev) => !prev)}
            >
              <View style={styles.deliveryToggleCopy}>
                <Text style={styles.deliveryToggleTitle}>{deliveryEnabledDraft ? "Teslimat açık" : "Teslimat kapalı"}</Text>
                <Text style={styles.deliveryToggleSubtitle}>
                  {deliveryEnabledDraft ? "Sipariş bazında teslimat teklif edebilirsin." : "Siparişler varsayılan olarak Gel Al kalır."}
                </Text>
              </View>
              <View style={[styles.deliveryTogglePill, deliveryEnabledDraft && styles.deliveryTogglePillActive]}>
                <View style={[styles.deliveryToggleKnob, deliveryEnabledDraft && styles.deliveryToggleKnobActive]} />
              </View>
            </TouchableOpacity>

            <Text style={styles.modalLabel}>Teslimat yarıçapı (km)</Text>
            <TextInput
              style={styles.modalInput}
              value={deliveryRadiusKmDraft}
              onChangeText={setDeliveryRadiusKmDraft}
              keyboardType="numeric"
              placeholder="Örn: 3"
              placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
            />

            <Text style={styles.modalLabel}>Teslimat koşulları</Text>
            <TextInput
              style={[styles.modalInput, styles.modalAddressInput]}
              value={deliveryTermsDraft}
              onChangeText={setDeliveryTermsDraft}
              placeholder="Örn: 3 km içi, apartman kapısına teslim, akşam 21:00'e kadar."
              placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
              multiline
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setIsDeliveryModalOpen(false)} disabled={deliverySaving}>
                <Text style={styles.modalCancelText}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={() => void saveDeliverySettings()} disabled={deliverySaving}>
                <Text style={styles.modalSaveText}>{deliverySaving ? "Kaydediliyor..." : "Kaydet"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={isEditModalOpen} transparent animationType="fade" onRequestClose={() => setIsEditModalOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 18 : 0}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setIsEditModalOpen(false)}
          />
          <View style={styles.modalCard}>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              <Text style={styles.modalTitle}>İletişim Bilgileri</Text>

              <Text style={styles.modalLabel}>Satıcı Adı</Text>
              <TextInput
                style={styles.modalInput}
                value={masterName}
                onChangeText={setMasterName}
                placeholder="Örn: Lezzet Durağı"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
              />

              <Text style={styles.modalLabel}>Adı Soyadı</Text>
              <TextInput
                style={styles.modalInput}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Örn: Ayşe Hanım"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
              />

              <Text style={styles.modalLabel}>Doğum Tarihi</Text>
              <TextInput
                style={styles.modalInput}
                value={contactDob}
                onChangeText={(value) => setContactDob(formatDobInput(value))}
                keyboardType="number-pad"
                placeholder="Örn: 15/01/1990"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
                maxLength={10}
              />

              <Text style={styles.modalLabel}>E-posta</Text>
              <View style={styles.modalEmailRow}>
                <TextInput
                  style={[styles.modalInput, styles.modalEmailInput]}
                  value={contactEmail}
                  onChangeText={setContactEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholder="Örn: ayse@example.com"
                  placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
                />
                <Ionicons name="shield-checkmark" size={18} color="#2563EB" />
              </View>

              <Text style={styles.modalLabel}>Telefon</Text>
              <TextInput
                style={styles.modalInput}
                value={contactPhone}
                onChangeText={setContactPhone}
                keyboardType="phone-pad"
                placeholder="Örn: 0555 111 22 33"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
              />

              <Text style={styles.modalLabel}>Şehir/İlçe</Text>
              <TextInput
                style={styles.modalInput}
                value={cityDistrict}
                onChangeText={setCityDistrict}
                placeholder="Örn: Kadıköy, İstanbul"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
              />

              <Text style={styles.modalLabel}>Adres</Text>
              <TextInput
                style={[styles.modalInput, styles.modalAddressInput]}
                value={addressLine}
                onChangeText={setAddressLine}
                placeholder="Örn: Rıhtım Cd. No:12, Kadıköy"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
                multiline
              />

              <Text style={styles.modalLabel}>Ülke Kodu</Text>
              <TextInput
                style={styles.modalInput}
                value={contactCountryCode}
                onChangeText={(value) => setContactCountryCode(value.toUpperCase())}
                autoCapitalize="characters"
                maxLength={3}
                placeholder="Örn: TR (Türkiye), GB (İngiltere)"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
              />

              <Text style={styles.modalLabel}>T.C. Kimlik</Text>
              <TextInput
                style={styles.modalInput}
                value={tcKimlikNo}
                onChangeText={setTcKimlikNo}
                keyboardType="numeric"
                maxLength={11}
                placeholder="11 haneli T.C. kimlik numarası"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
              />

              <Text style={[styles.modalLabel, { marginTop: 16 }]}>Kimlik Fotoğrafı</Text>
              <View style={styles.idCardRow}>
                <TouchableOpacity
                  style={styles.idCardSlot}
                  onPress={() => void pickIdCardImage("front")}
                  activeOpacity={0.7}
                >
                  {idCardFrontUri ? (
                    <Image source={{ uri: idCardFrontUri }} style={styles.idCardPreview} />
                  ) : (
                    <View style={styles.idCardPlaceholder}>
                      <Ionicons name="camera-outline" size={24} color="#9A8C82" />
                      <Text style={styles.idCardPlaceholderText}>Ön Yüz</Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.idCardSlot}
                  onPress={() => void pickIdCardImage("back")}
                  activeOpacity={0.7}
                >
                  {idCardBackUri ? (
                    <Image source={{ uri: idCardBackUri }} style={styles.idCardPreview} />
                  ) : (
                    <View style={styles.idCardPlaceholder}>
                      <Ionicons name="camera-outline" size={24} color="#9A8C82" />
                      <Text style={styles.idCardPlaceholderText}>Arka Yüz</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setIsEditModalOpen(false)} disabled={contactSaving}>
                <Text style={styles.modalCancelText}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={() => void saveContactProfile()} disabled={contactSaving}>
                <Text style={styles.modalSaveText}>{contactSaving ? "Kaydediliyor..." : "Kaydet"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={isKitchenModalOpen} transparent animationType="fade" onRequestClose={() => setIsKitchenModalOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 18 : 0}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setIsKitchenModalOpen(false)}
          />
          <View style={[styles.modalCard, styles.kitchenModalCard]}>
            <View style={styles.kitchenModalBody}>
              <Text style={styles.modalTitle}>Hakkımda</Text>

              <Text style={styles.modalLabel}>Açıklama</Text>
              <TextInput
                style={[styles.modalInput, styles.modalDescInput]}
                value={kitchenDescInput}
                onChangeText={setKitchenDescInput}
                placeholder="Kendinizi ve mutfak deneyiminizi tanıtın"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
                multiline
              />

              <Text style={[styles.modalLabel, { marginTop: 16 }]}>Uzmanlık Alanları</Text>
              {specialties.length > 0 && (
                <View style={styles.tagsRow}>
                  {specialties.map((item) => (
                    <View key={item} style={styles.tag}>
                      <Text style={styles.tagText}>{item}</Text>
                      <TouchableOpacity onPress={() => removeSpecialty(item)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name="close-circle" size={18} color="#E53935" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.modalLabel}>Yeni Kategori Ekle</Text>
              <View style={styles.addSpecialtyRow}>
                <TextInput
                  style={[styles.modalInput, styles.addSpecialtyInput]}
                  value={newSpecialty}
                  onChangeText={setNewSpecialty}
                  placeholder="Örn: Tatlı, Kek, Fırın Yemekleri"
                  placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
                  onSubmitEditing={addSpecialty}
                  returnKeyType="done"
                />
                <TouchableOpacity style={styles.addSpecialtyBtn} onPress={addSpecialty}>
                  <Ionicons name="add" size={22} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setIsKitchenModalOpen(false)} disabled={kitchenSaving}>
                <Text style={styles.modalCancelText}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={() => void saveKitchen()} disabled={kitchenSaving}>
                <Text style={styles.modalSaveText}>{kitchenSaving ? "Kaydediliyor..." : "Kaydet"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  loader: { marginTop: 60 },
  errorContainer: { alignItems: "center", marginTop: 60, paddingHorizontal: 24, gap: 12 },
  errorText: { textAlign: "center", color: "#B42318", fontSize: 15, fontWeight: "600" },
  retryBtn: { backgroundColor: "#3F855C", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
  retryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  logoutErrBtn: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28, borderWidth: 1, borderColor: "#D6CCBD" },
  logoutErrBtnText: { color: "#5F5348", fontWeight: "700", fontSize: 15 },
  content: { padding: 16, paddingBottom: 40, gap: 10 },

  heroCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#3F855C",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarEditBadge: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#2E6B44",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#fff",
  },
  avatarText: { color: "#fff", fontSize: 20, fontWeight: "800" },
  heroInfo: { flex: 1 },
  displayName: { fontSize: 17, fontWeight: "800", color: "#2E241C" },
  kitchenTitle: { marginTop: 2, fontSize: 13, color: "#6C6055" },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusText: { fontSize: 12, fontWeight: "700" },


  complianceCard: {
    backgroundColor: "#EFF6F1",
    borderColor: "#CFE2D5",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  complianceTitle: { color: "#2E6B44", fontWeight: "800" },
  complianceText: { marginTop: 4, color: "#2E6B44" },
  complianceRemainingInlineText: { color: "#B42318", fontWeight: "700" },
  complianceAction: { marginTop: 6, color: "#2E6B44", fontWeight: "700" },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    padding: 14,
    gap: 6,
  },
  profileEditCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitleNoCaps: {
    fontSize: 15,
    fontWeight: "800",
    color: "#2E241C",
  },
  profileEditIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D6CCBD",
    backgroundColor: "#F5F0E8",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 12, fontWeight: "800", color: "#2E241C", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },

  infoRow: { flexDirection: "row", justifyContent: "space-between" },
  infoLabel: { fontSize: 13, color: "#9A8C82", flex: 1 },
  infoValue: { fontSize: 13, color: "#2E241C", flex: 2, textAlign: "right" },

  hourRow: { flexDirection: "row", justifyContent: "space-between" },
  hourDay: { fontSize: 13, color: "#4E433A", fontWeight: "600" },
  hourRange: { fontSize: 13, color: "#6C6055" },

  addressLink: { marginTop: 6, color: "#3F855C", fontWeight: "700", fontSize: 13 },

  checkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkOk: { fontSize: 14, color: "#2E6B44", fontWeight: "700", width: 18 },
  checkMissing: { fontSize: 14, color: "#B42318", fontWeight: "700", width: 18 },
  checkLabel: { fontSize: 13, color: "#4E433A" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    backgroundColor: "#F2F2F2",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D8D8D8",
    padding: 14,
    maxHeight: "88%",
  },
  kitchenModalCard: {
    maxHeight: "92%",
  },
  kitchenModalBody: {
    paddingBottom: 4,
  },
  modalScroll: {
    maxHeight: "74%",
  },
  modalScrollContent: {
    paddingBottom: 24,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1F1F1F",
    marginBottom: 8,
  },
  modalLabel: {
    marginTop: 10,
    marginBottom: 6,
    color: "#2E2E2E",
    fontWeight: "600",
    fontSize: 14,
  },
  modalInput: {
    backgroundColor: "#E7E6E4",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#C7C7C7",
    height: 42,
    paddingHorizontal: 12,
    color: "#242424",
  },
  modalAddressInput: {
    minHeight: 58,
    textAlignVertical: "top",
    paddingTop: 10,
    paddingBottom: 10,
  },
  modalDescInput: {
    minHeight: 90,
    textAlignVertical: "top",
    paddingTop: 10,
    paddingBottom: 10,
  },
  deliveryToggleCard: {
    backgroundColor: "#E7E6E4",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#C7C7C7",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  deliveryToggleCardActive: {
    borderColor: "#3F855C",
    backgroundColor: "#EDF7F0",
  },
  deliveryToggleCopy: {
    flex: 1,
  },
  deliveryToggleTitle: {
    color: "#1F1F1F",
    fontWeight: "700",
    fontSize: 14,
  },
  deliveryToggleSubtitle: {
    color: "#5C5B57",
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  deliveryTogglePill: {
    width: 48,
    height: 28,
    borderRadius: 999,
    backgroundColor: "#CFC9C1",
    padding: 3,
    justifyContent: "center",
  },
  deliveryTogglePillActive: {
    backgroundColor: "#3F855C",
  },
  deliveryToggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#fff",
  },
  deliveryToggleKnobActive: {
    alignSelf: "flex-end",
  },
  idCardRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 8,
  },
  idCardSlot: {
    flex: 1,
    aspectRatio: 1.6,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#C7C7C7",
    borderStyle: "dashed",
    backgroundColor: "#E7E6E4",
    overflow: "hidden",
  },
  idCardPreview: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  idCardPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  idCardPlaceholderText: {
    fontSize: 12,
    color: "#9A8C82",
    fontWeight: "600",
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#E7E6E4",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagText: { fontSize: 13, color: "#2E2E2E", fontWeight: "500" },
  addSpecialtyRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginBottom: 24,
  },
  addSpecialtyInput: { flex: 1 },
  addSpecialtyBtn: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: "#3F855C",
    alignItems: "center",
    justifyContent: "center",
  },
  modalEmailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modalEmailInput: {
    flex: 1,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 22,
    paddingTop: 12,
    marginBottom: 12,
  },
  modalCancelBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#C9C9C9",
    backgroundColor: "#F0F0F0",
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText: {
    color: "#373737",
    fontWeight: "600",
  },
  modalSaveBtn: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: "#8A9A87",
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSaveText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  navBtn: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  navBtnText: { fontSize: 15, fontWeight: "700", color: "#2E241C" },
  navArrow: { fontSize: 20, color: "#9A8C82" },
  logoutBtn: {
    backgroundColor: "#FFF0EE",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#F9CECA",
    paddingVertical: 13,
    alignItems: "center",
  },
  logoutBtnText: { color: "#B42318", fontWeight: "700", fontSize: 15 },

  editFullBtn: {
    backgroundColor: "#3F855C",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  editFullText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
