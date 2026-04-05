import { Fragment, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { request, parseJson } from "../../lib/api";
import { getCachedUser, setCachedUser } from "../../lib/prefetch";
import { ExcelExportButton, LotDetailContent, PrintButton, QuickAccessMenu } from "../../components/ui";
import InvestigationComplaintDetailPage from "../InvestigationComplaintDetailPage";
import { NotesPanel } from "../../components/NotesPanel";
import { formatUiDate, formatTableDateTime, maskEmail, formatCurrency, normalizeImageUrl, sanitizeSeedText } from "../../lib/format";
import {
  mapComplianceRows,
  profileBadgeFromStatus,
  sellerDocumentStatusLabel,
  sellerDocumentStatusTone,
  optionalUploadStatusLabel,
  optionalUploadStatusTone,
  extractPhoneFromChecks,
  knownDocumentCodeRank,
  normalizeComplianceToken,
} from "../../lib/compliance";
import { resolveSellerDetailTab } from "../../lib/routing";
import { fetchAllAdminLots, lotLifecycleLabel, lotLifecycleClass, computeFoodLotDiff, computeAddedItems, toReadableText } from "../../lib/lots";
import { foodMetadataByName, resolveFoodIngredients } from "../../lib/food";
import { printModalContent } from "../../lib/print";
import { deliveryTypeLabel, orderStatusLabel, sellerDecisionStateLabel } from "../../lib/status";
import type { Language, ApiError, Dictionary } from "../../types/core";
import type { SellerDetailTab } from "../../types/seller";
import type {
  SellerFoodRow,
  SellerCompliancePayload,
  SellerAddressRow,
  SellerComplianceStatus,
  ComplianceRowKey,
  ComplianceTone,
  SellerComplianceDocumentStatus,
} from "../../types/seller";
import type { AdminLotRow } from "../../types/lots";
import type { BuyerPagination } from "../../types/buyer";

type TempComplianceUpload = {
  key: ComplianceRowKey;
  fileName: string;
  fileUrl: string;
  uploadedAt: string;
  status: SellerComplianceDocumentStatus;
  rejectionReason: string | null;
};

type SellerPreviewTarget = {
  title: string;
  url: string;
  documentId: string;
  isOptional: boolean;
  status: SellerComplianceDocumentStatus;
  tone: ComplianceTone;
  date?: string | null;
  rejectionReason?: string | null;
};

const COMPLIANCE_DOC_KEY_TOKENS: Record<ComplianceRowKey, string[]> = {
  foodBusiness: ["gida_isletme", "isletme_belgesi", "food_business", "business_license", "food_license"],
  taxPlate: ["vergi_levhasi", "tax_plate", "tax_document", "tax", "vergi"],
  kvkk: ["kvkk", "privacy", "kisisel_veri", "gdpr"],
  foodSafetyTraining: ["gida_guvenligi_egitimi", "food_safety_training", "hygiene_training", "egitim"],
  phoneVerification: ["telefon", "phone", "sms", "phone_verification", "telefon_dogrulama"],
  workplaceInsurance: ["is_yeri_sigortasi", "workplace_insurance", "insurance", "sigorta"],
};

function SellerDetailScreen({ id, isSuperAdmin, dict, language }: { id: string; isSuperAdmin: boolean; dict: Dictionary; language: Language }) {
  const location = useLocation();
  const navigate = useNavigate();
  const routerPreview = (location.state as { preview?: { displayName?: string; email?: string; profileImageUrl?: string; status?: string } } | null)?.preview ?? null;
  const endpoint = `/v1/admin/users/${id}`;
  const [row, setRow] = useState<any | null>(() => getCachedUser(id) ?? null);
  const [compliance, setCompliance] = useState<SellerCompliancePayload | null>(null);
  const [foodRows, setFoodRows] = useState<SellerFoodRow[]>([]);
  const [addresses, setAddresses] = useState<SellerAddressRow[]>([]);
  const [addressSaving, setAddressSaving] = useState(false);
  const [newAddressLine, setNewAddressLine] = useState("");
  const [addressDirty, setAddressDirty] = useState(false);
  const [addressEditorId, setAddressEditorId] = useState<string | null>(null);
  const [addressHistoryOpen, setAddressHistoryOpen] = useState(false);
  const [identityViewerOpen, setIdentityViewerOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [identityViewerUrl, setIdentityViewerUrl] = useState<string | null>(null);
  const [tempComplianceUploads, setTempComplianceUploads] = useState<Record<string, TempComplianceUpload>>({});
  const [previewTarget, setPreviewTarget] = useState<SellerPreviewTarget | null>(null);
  const [previewAction, setPreviewAction] = useState<"reject" | "pending" | null>(null);
  const [previewActionReason, setPreviewActionReason] = useState("");
  const [tempRejectTargetKey, setTempRejectTargetKey] = useState<ComplianceRowKey | null>(null);
  const [tempRejectReason, setTempRejectReason] = useState("");
  const [tempPendingTargetKey, setTempPendingTargetKey] = useState<ComplianceRowKey | null>(null);
  const [tempPendingReason, setTempPendingReason] = useState("");
  const [sellerOrders, setSellerOrders] = useState<
    Array<{
      orderId: string;
      orderNo: string;
      buyerId: string;
      buyerName: string | null;
      buyerEmail: string | null;
      deliveryType: string | null;
      requestedDeliveryType: string | null;
      activeDeliveryType: string | null;
      sellerDecisionState: string | null;
      sellerEtaMinutes: number | null;
      sellerPromisedAt: string | null;
      sellerDeliveryNote: string | null;
      sellerDeliveryTermsSnapshot: string | null;
      approvedAt: string | null;
      paymentCapturedAt: string | null;
      status: string;
      totalAmount: number;
      paymentCompleted: boolean;
      paymentStatus: string;
      paymentProvider: string | null;
      paymentProviderReferenceId: string | null;
      paymentProviderSessionId: string | null;
      paymentUpdatedAt: string | null;
      createdAt: string;
      updatedAt: string;
      items: Array<{ name?: string; quantity?: number }>;
    }>
  >([]);
  const [sellerOrdersPagination, setSellerOrdersPagination] = useState<BuyerPagination | null>(null);
  const [activeTab, setActiveTab] = useState<SellerDetailTab>(() => resolveSellerDetailTab(new URLSearchParams(location.search).get("tab")));
  const [ordersStatusFilter, setOrdersStatusFilter] = useState("all");
  const [ordersPaymentFilter, setOrdersPaymentFilter] = useState<"all" | "successful" | "pending" | "failed">("all");
  const [ordersSearch, setOrdersSearch] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [selectedFoodIds, setSelectedFoodIds] = useState<string[]>([]);
  const [earningsDateFilter, setEarningsDateFilter] = useState<"all" | "last7" | "last30" | "custom">("all");
  const [earningsSelectedDate, setEarningsSelectedDate] = useState("");
  const [earningsPaymentFilter, setEarningsPaymentFilter] = useState<"all" | "successful" | "pending" | "failed">("successful");
  const [earningsSearch, setEarningsSearch] = useState("");
  const [selectedEarningIds, setSelectedEarningIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => getCachedUser(id) === null);
  const [legalSavingKey, setLegalSavingKey] = useState<string | null>(null);
  const [profileImageFailed, setProfileImageFailed] = useState(false);
  const [, setFoodImageErrors] = useState<Record<string, boolean>>({});
  const [lotsByFoodId, setLotsByFoodId] = useState<Record<string, AdminLotRow[]>>({});
  const [expandedFoodIds, setExpandedFoodIds] = useState<Record<string, boolean>>({});
  const [noteItems, setNoteItems] = useState<Array<{ id: string; note: string; createdAt: string; createdByUsername?: string | null }>>([]);
  const [tagItems, setTagItems] = useState<string[]>([]);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [lotsError, setLotsError] = useState<string | null>(null);
  const [flashFoodId, setFlashFoodId] = useState<string | null>(null);
  const [flashLotId, setFlashLotId] = useState<string | null>(null);
  const [pinnedFoodId, setPinnedFoodId] = useState<string | null>(null);
  const [pinnedLotId, setPinnedLotId] = useState<string | null>(null);
  const [reviewRows, setReviewRows] = useState<Array<{
    id: string;
    orderId: string;
    foodId: string;
    foodName: string;
    buyerId: string;
    buyerName: string | null;
    rating: number;
    comment: string | null;
    isVerifiedPurchase: boolean;
    createdAt: string;
  }>>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [reviewsTotalPages, setReviewsTotalPages] = useState(1);
  const [reviewsTotalCount, setReviewsTotalCount] = useState(0);
  const [reviewRatingFilter, setReviewRatingFilter] = useState<"all" | "1" | "2" | "3" | "4" | "5">("all");
  const [reviewSortDir, setReviewSortDir] = useState<"desc" | "asc">("desc");
  const [complaintRows, setComplaintRows] = useState<Array<{
    id: string;
    orderId: string;
    orderNo: string;
    description: string | null;
    categoryCode: string | null;
    categoryName: string | null;
    priority: "low" | "medium" | "high" | "urgent";
    status: "open" | "in_review" | "resolved" | "closed";
    complainantName: string | null;
    createdAt: string;
    resolvedAt: string | null;
  }>>([]);
  const [complaintsLoading, setComplaintsLoading] = useState(false);
  const [complaintsPage, setComplaintsPage] = useState(1);
  const [complaintsTotalPages, setComplaintsTotalPages] = useState(1);
  const [complaintsTotalCount, setComplaintsTotalCount] = useState(0);
  const [complaintsStatusFilter, setComplaintsStatusFilter] = useState<"all" | "open" | "in_review" | "resolved" | "closed">("all");
  const [complaintsSortDir, setComplaintsSortDir] = useState<"desc" | "asc">("desc");
  const [selectedComplaintId, setSelectedComplaintId] = useState<string | null>(null);
  const [selectedInlineFoodId, setSelectedInlineFoodId] = useState<string | null>(null);
  const [selectedInlineLotId, setSelectedInlineLotId] = useState<string | null>(null);
  const quickAccessRef = useRef<HTMLDetailsElement | null>(null);
  const identityModalPrintRef = useRef<HTMLDivElement | null>(null);
  const inlineLotModalRef = useRef<HTMLDivElement | null>(null);
  const complianceUploadInputRef = useRef<HTMLInputElement | null>(null);
  const sellerCriticalReqRef = useRef(0);
  const sellerDeferredReqRef = useRef(0);
  const sellerLotsReqRef = useRef(0);
  const [pendingUploadKey, setPendingUploadKey] = useState<ComplianceRowKey | null>(null);
  const spiceHints = useMemo(() => ([
    "karabiber", "pul biber", "kimyon", "nane", "kekik", "isot", "paprika", "sumak", "tarcin", "yenibahar", "zerdecal",
  ]), []);
  function splitFoodItems(value: string): string[] {
    return value
      .split(/[,;\n]/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function renderWalletSearchHighlight(value: string | null | undefined) {
    const rawText = String(value ?? "").trim();
    if (!rawText) return "-";
    const normalized = rawText
      .replace(/^seed-ref-/i, "")
      .replace(/^seed-session-/i, "");
    const text = normalized.split("-")[0] || normalized;
    const query = earningsSearch.trim();
    if (!query) return text;
    const textLower = text.toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
    const queryLower = query.toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
    const firstMatch = textLower.indexOf(queryLower);
    if (firstMatch < 0) return text;
    const before = text.slice(0, firstMatch);
    const hit = text.slice(firstMatch, firstMatch + query.length);
    const after = text.slice(firstMatch + query.length);
    return (
      <>
        {before}
        <mark className="wallet-search-hit">{hit}</mark>
        {after}
      </>
    );
  }

  function resolveDocTypeCodeFromRowKey(key: ComplianceRowKey): string | null {
    const docs = compliance?.documents ?? [];
    if (docs.length === 0) return null;
    const tokens = COMPLIANCE_DOC_KEY_TOKENS[key];
    for (const doc of docs) {
      if (!doc.is_current) continue;
      const haystacks = [
        normalizeComplianceToken(doc.doc_type),
        normalizeComplianceToken(doc.code),
        normalizeComplianceToken(doc.name),
      ];
      if (haystacks.some((item) => tokens.some((token) => item.includes(token)))) {
        return doc.code;
      }
    }
    return null;
  }

  function resolveDocumentIdFromRowKey(key: ComplianceRowKey): string | null {
    const docs = compliance?.documents ?? [];
    if (docs.length === 0) return null;
    const tokens = COMPLIANCE_DOC_KEY_TOKENS[key];
    const matched = docs.filter((doc) => {
      if (!doc.is_current) return false;
      const haystacks = [
        normalizeComplianceToken(doc.doc_type),
        normalizeComplianceToken(doc.code),
        normalizeComplianceToken(doc.name),
      ];
      return haystacks.some((item) => tokens.some((token) => item.includes(token)));
    });
    if (matched.length === 0) return null;
    matched.sort((a, b) => Date.parse(b.updated_at || "") - Date.parse(a.updated_at || ""));
    return matched[0]?.id ?? null;
  }

  function renderFoodMetaPills(items: string[], emptyLabel = "-") {
    if (items.length === 0) {
      return <span className="seller-food-inline-empty">{emptyLabel}</span>;
    }
    return (
      <span className="seller-food-inline-pills">
        {items.map((item) => (
          <span key={item} className="seller-food-inline-pill">{item}</span>
        ))}
      </span>
    );
  }

  async function loadSellerCritical(options?: { includeFoods?: boolean; includeOrders?: boolean; silent?: boolean }) {
    const requestId = ++sellerCriticalReqRef.current;
    const includeFoods = options?.includeFoods ?? false;
    const includeOrders = options?.includeOrders ?? false;
    const silent = options?.silent ?? false;
    if (!silent && !getCachedUser(id)) setLoading(true);
    setMessage(null);
    const bust = Date.now();
    try {
      const detailResponse = await request(`${endpoint}${endpoint.includes("?") ? "&" : "?"}t=${bust}`);
      if (requestId !== sellerCriticalReqRef.current) return;

      if (detailResponse.status !== 200) {
        const body = await parseJson<ApiError>(detailResponse);
        if (requestId !== sellerCriticalReqRef.current) return;
        setMessage(body.error?.message ?? dict.detail.loadFailed);
        return;
      }
      const detailBody = await parseJson<{ data: any }>(detailResponse);
      if (requestId !== sellerCriticalReqRef.current) return;
      setCachedUser(id, detailBody.data);
      setRow(detailBody.data);

      const [foodsResult, ordersResult] = await Promise.allSettled([
        includeFoods ? request(`/v1/admin/users/${id}/seller-foods?page=1&pageSize=200&sortDir=desc`) : Promise.resolve<Response | null>(null),
        includeOrders ? request(`/v1/admin/users/${id}/seller-orders?page=1&pageSize=20&sortDir=desc`) : Promise.resolve<Response | null>(null),
      ]);
      if (requestId !== sellerCriticalReqRef.current) return;

      if (includeFoods) {
        if (foodsResult.status === "fulfilled" && foodsResult.value) {
          if (foodsResult.value.status === 200) {
            const foodsBody = await parseJson<{ data: SellerFoodRow[] }>(foodsResult.value);
            if (requestId !== sellerCriticalReqRef.current) return;
            setFoodRows(foodsBody.data);
          } else {
            const foodsErrorBody = await parseJson<ApiError>(foodsResult.value);
            setFoodRows([]);
            setMessage(foodsErrorBody.error?.message ?? (language === "tr" ? "Yemek listesi alınamadı." : "Failed to load foods list."));
          }
        } else {
          setFoodRows([]);
        }
      }

      if (includeOrders) {
        if (ordersResult.status === "fulfilled" && ordersResult.value) {
          if (ordersResult.value.status === 200) {
            const ordersBody = await parseJson<{ data: any[]; pagination: BuyerPagination }>(ordersResult.value);
            if (requestId !== sellerCriticalReqRef.current) return;
            setSellerOrders(ordersBody.data);
            setSellerOrdersPagination(ordersBody.pagination);
          } else {
            setSellerOrders([]);
            setSellerOrdersPagination(null);
          }
        } else {
          setSellerOrders([]);
          setSellerOrdersPagination(null);
        }
      }
    } catch {
      if (requestId === sellerCriticalReqRef.current) {
        setMessage(dict.detail.requestFailed);
      }
    } finally {
      if (!silent && requestId === sellerCriticalReqRef.current) {
        setLoading(false);
      }
    }
  }

  async function loadSellerDeferred() {
    const requestId = ++sellerDeferredReqRef.current;
    const bust = Date.now();
    try {
      const [complianceResponse, addressesResponse, notesResponse, tagsResponse] = await Promise.all([
        request(`/v1/admin/compliance/${id}?t=${bust}`),
        request(`/v1/admin/users/${id}/addresses`),
        request(`/v1/admin/sellers/${id}/notes?limit=50`),
        request(`/v1/admin/sellers/${id}/tags`),
      ]);
      if (requestId !== sellerDeferredReqRef.current) return;

      if (complianceResponse.status === 200) {
        const complianceBody = await parseJson<{ data: SellerCompliancePayload }>(complianceResponse);
        if (requestId !== sellerDeferredReqRef.current) return;
        setCompliance(complianceBody.data);
      } else {
        setCompliance(null);
      }
      setTempComplianceUploads((prev) => {
        Object.values(prev).forEach((item) => URL.revokeObjectURL(item.fileUrl));
        return {};
      });

      if (addressesResponse.status === 200) {
        const addressesBody = await parseJson<{ data: SellerAddressRow[] }>(addressesResponse);
        if (requestId !== sellerDeferredReqRef.current) return;
        setAddresses(Array.isArray(addressesBody.data) ? addressesBody.data : []);
      } else {
        setAddresses([]);
      }

      if (notesResponse.status === 200) {
        const body = await parseJson<{ data: Array<{ id: string; note: string; createdAt: string; createdByUsername?: string | null }> }>(notesResponse);
        if (requestId !== sellerDeferredReqRef.current) return;
        setNoteItems(Array.isArray(body.data) ? body.data : []);
      } else {
        setNoteItems([]);
      }

      if (tagsResponse.status === 200) {
        const body = await parseJson<{ data: Array<{ id: string; tag: string }> }>(tagsResponse);
        if (requestId !== sellerDeferredReqRef.current) return;
        setTagItems(Array.isArray(body.data) ? body.data.map((item) => item.tag) : []);
      } else {
        setTagItems([]);
      }
    } catch {
      if (requestId !== sellerDeferredReqRef.current) return;
      setCompliance(null);
      setAddresses([]);
      setNoteItems([]);
      setTagItems([]);
    }
  }

  async function loadSellerLots(options?: { silent?: boolean }) {
    const requestId = ++sellerLotsReqRef.current;
    const silent = options?.silent ?? false;
    if (!silent) {
      setLotsLoading(true);
    }
    setLotsError(null);
    try {
      const lots = await fetchAllAdminLots({ sellerId: id });
      if (requestId !== sellerLotsReqRef.current) return;
      const grouped: Record<string, AdminLotRow[]> = {};
      for (const lot of lots) {
        if (!grouped[lot.food_id]) grouped[lot.food_id] = [];
        grouped[lot.food_id].push(lot);
      }
      setLotsByFoodId(grouped);
    } catch (error) {
      if (requestId !== sellerLotsReqRef.current) return;
      setLotsByFoodId({});
      setLotsError(error instanceof Error ? error.message : dict.detail.requestFailed);
    } finally {
      if (!silent && requestId === sellerLotsReqRef.current) {
        setLotsLoading(false);
      }
    }
  }

  async function loadSellerDetail() {
    await loadSellerCritical({ includeFoods: true, includeOrders: true });
    await loadSellerDeferred();
    await loadSellerLots();
  }

  useEffect(() => {
    const cached = getCachedUser(id);
    setRow(cached ?? null);
    setLoading(cached === null);
    setFoodRows([]);
    setSellerOrders([]);
    setSellerOrdersPagination(null);
    setCompliance(null);
    setAddresses([]);
    setNoteItems([]);
    setTagItems([]);
    setLotsByFoodId({});
    setLotsError(null);
    sellerCriticalReqRef.current += 1;
    sellerDeferredReqRef.current += 1;
    sellerLotsReqRef.current += 1;
    void loadSellerCritical({
      includeFoods: activeTab === "foods",
      includeOrders: activeTab === "orders" || activeTab === "wallet",
    });
    void loadSellerDeferred();
    if (activeTab === "foods") {
      void loadSellerLots();
    } else {
      setLotsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setProfileImageFailed(false);
    setFoodImageErrors({});
    setLotsByFoodId({});
    setExpandedFoodIds({});
    setNoteItems([]);
    setTagItems([]);
    setLotsError(null);
    setFlashFoodId(null);
    setFlashLotId(null);
    setPinnedFoodId(null);
    setPinnedLotId(null);
    setAddresses([]);
    setAddressSaving(false);
    setNewAddressLine("");
    setAddressDirty(false);
    setAddressEditorId(null);
    setAddressHistoryOpen(false);
    setIdentityViewerOpen(false);
    setProfileModalOpen(false);
    setIdentityViewerUrl(null);
    setPreviewTarget(null);
    setPreviewAction(null);
    setPreviewActionReason("");
    setPendingUploadKey(null);
    setTempRejectTargetKey(null);
    setTempRejectReason("");
    setTempPendingTargetKey(null);
    setTempPendingReason("");
    setTempComplianceUploads((prev) => {
      Object.values(prev).forEach((item) => URL.revokeObjectURL(item.fileUrl));
      return {};
    });
  }, [id]);

  useEffect(() => () => {
    Object.values(tempComplianceUploads).forEach((item) => URL.revokeObjectURL(item.fileUrl));
  }, [tempComplianceUploads]);

  useEffect(() => {
    if (addressDirty) return;
    const selected = addresses.find((item) => item.isDefault) ?? addresses[0] ?? null;
    setNewAddressLine(String(selected?.addressLine ?? ""));
    setAddressEditorId(selected?.id ?? null);
  }, [addresses, addressDirty]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const node = quickAccessRef.current;
      if (!node?.open) return;
      const target = event.target;
      if (target instanceof Node && !node.contains(target)) {
        node.open = false;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const node = quickAccessRef.current;
      if (!node?.open) return;
      node.open = false;
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    setActiveTab(resolveSellerDetailTab(new URLSearchParams(location.search).get("tab")));
  }, [location.search]);

  const focusFoodId = useMemo(() => {
    const value = new URLSearchParams(location.search).get("focusFoodId");
    return value ? value.trim() : "";
  }, [location.search]);
  const focusLotId = useMemo(() => {
    const value = new URLSearchParams(location.search).get("focusLotId");
    return value ? value.trim() : "";
  }, [location.search]);
  const walletSearchTx = useMemo(() => {
    const value = new URLSearchParams(location.search).get("searchTx");
    return value ? value.trim() : "";
  }, [location.search]);

  useEffect(() => {
    if (activeTab !== "foods") return;

    let resolvedFoodId = focusFoodId;
    if (!resolvedFoodId && focusLotId) {
      for (const [foodId, lots] of Object.entries(lotsByFoodId)) {
        if (lots.some((lot) => lot.id === focusLotId)) {
          resolvedFoodId = foodId;
          break;
        }
      }
    }
    if (!resolvedFoodId) return;
    if (!foodRows.some((food) => food.id === resolvedFoodId)) return;

    setExpandedFoodIds((prev) => (prev[resolvedFoodId] ? prev : { ...prev, [resolvedFoodId]: true }));

    setFlashFoodId(resolvedFoodId);
    setPinnedFoodId(resolvedFoodId);
    if (focusLotId) setFlashLotId(focusLotId);
    if (focusLotId) setPinnedLotId(focusLotId);

    const timer = window.setTimeout(() => {
      const lotElement = focusLotId ? document.querySelector<HTMLElement>(`[data-lot-row-id="${focusLotId}"]`) : null;
      const foodElement = document.querySelector<HTMLElement>(`[data-food-row-id="${resolvedFoodId}"]`);
      (lotElement ?? foodElement)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [activeTab, focusFoodId, focusLotId, foodRows, lotsByFoodId]);

  useEffect(() => {
    if (activeTab !== "wallet") return;
    if (!walletSearchTx) return;
    setEarningsPaymentFilter("all");
    setEarningsSearch(walletSearchTx);
  }, [activeTab, walletSearchTx]);

  useEffect(() => {
    if (activeTab === "foods" && foodRows.length === 0) {
      void loadSellerCritical({ includeFoods: true, includeOrders: false });
      void loadSellerLots({ silent: true });
      return;
    }
    if ((activeTab === "orders" || activeTab === "wallet") && sellerOrders.length === 0) {
      void loadSellerCritical({ includeFoods: false, includeOrders: true });
    }
  }, [activeTab, foodRows.length, sellerOrders.length]);

  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return;
      void loadSellerCritical({
        includeFoods: activeTab === "foods",
        includeOrders: activeTab === "orders" || activeTab === "wallet",
        silent: true,
      });
      void loadSellerDeferred();
      if (activeTab === "foods") {
        void loadSellerLots({ silent: true });
      }
    };

    const intervalId = window.setInterval(refresh, 20000);
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activeTab, id]);

  useEffect(() => {
    if (!flashFoodId) return;
    const timer = window.setTimeout(() => setFlashFoodId(null), 2200);
    return () => window.clearTimeout(timer);
  }, [flashFoodId]);

  useEffect(() => {
    if (!flashLotId) return;
    const timer = window.setTimeout(() => setFlashLotId(null), 2200);
    return () => window.clearTimeout(timer);
  }, [flashLotId]);

  async function fetchSellerReviews(page: number, ratingFilter: "all" | "1" | "2" | "3" | "4" | "5", sortDir: "asc" | "desc") {
    setReviewsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20", sortDir });
      if (ratingFilter !== "all") params.set("rating", ratingFilter);
      const response = await request(`/v1/admin/users/${id}/seller-reviews?${params.toString()}`);
      if (response.status !== 200) return;
      const body = await parseJson<{ data: typeof reviewRows; pagination: { total: number; totalPages: number } }>(response);
      setReviewRows(body.data ?? []);
      setReviewsTotalPages(body.pagination?.totalPages ?? 1);
      setReviewsTotalCount(body.pagination?.total ?? 0);
    } catch {
      // silently ignore
    } finally {
      setReviewsLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "reviews") return;
    void fetchSellerReviews(reviewsPage, reviewRatingFilter, reviewSortDir);
  }, [activeTab, reviewsPage, reviewRatingFilter, reviewSortDir]);

  async function fetchSellerComplaints(page: number, statusFilter: typeof complaintsStatusFilter, sortDir: "asc" | "desc") {
    setComplaintsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20", sortDir });
      const response = await request(`/v1/admin/users/${id}/seller-complaints?${params.toString()}`);
      if (response.status !== 200) return;
      const body = await parseJson<{ data: typeof complaintRows; pagination: { total: number; totalPages: number } }>(response);
      const allRows = body.data ?? [];
      const filtered = statusFilter === "all" ? allRows : allRows.filter((r) => r.status === statusFilter);
      setComplaintRows(filtered);
      setComplaintsTotalPages(body.pagination?.totalPages ?? 1);
      setComplaintsTotalCount(body.pagination?.total ?? 0);
    } catch {
      // silently ignore
    } finally {
      setComplaintsLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "complaints") return;
    void fetchSellerComplaints(complaintsPage, complaintsStatusFilter, complaintsSortDir);
  }, [activeTab, complaintsPage, complaintsStatusFilter, complaintsSortDir]);

  function openFoodDetailPage(foodId: string, lotId?: string) {
    setSelectedInlineFoodId(foodId);
    setSelectedInlineLotId(lotId ?? null);
  }

  const orderReturnTo = useMemo(() => {
    const params = new URLSearchParams(location.search);
    params.set("tab", activeTab === "wallet" ? "wallet" : "orders");
    return `${location.pathname}?${params.toString()}`;
  }, [location.pathname, location.search, activeTab]);
  const switchSellerTab = (tab: SellerDetailTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(location.search);
    params.set("tab", tab);
    navigate({ pathname: location.pathname, search: params.toString() });
  };

  const orderDetailPath = (orderId: string) => {
    const params = new URLSearchParams({
      search: orderId,
      returnTo: orderReturnTo,
    });
    return `/app/orders?${params.toString()}`;
  };

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSuperAdmin) return;
    const formData = new FormData(event.currentTarget);
    const submittedLanguage = formData.get("language");
    const payload: Record<string, string | null> = {
      email: String(row?.email ?? "").trim(),
      displayName: String(formData.get("displayName") ?? "").trim(),
      fullName: String(formData.get("fullName") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      dob: String(formData.get("dob") ?? "").trim() || null,
      countryCode: String(formData.get("countryCode") ?? "").trim().toUpperCase() || null,
      language: submittedLanguage === null ? (row?.language ?? null) : String(submittedLanguage).trim() || null,
      profileImageUrl: String(formData.get("profileImageUrl") ?? "").trim() || null,
    };
    if (!payload.email || !payload.displayName) {
      setMessage(language === "tr" ? "E-posta ve görünen ad zorunludur." : "Email and display name are required.");
      return;
    }
    const password = String(formData.get("password") ?? "").trim();
    if (password) {
      if (password.length < 8) {
        setMessage(language === "tr" ? "Şifre en az 8 karakter olmalı." : "Password must be at least 8 characters.");
        return;
      }
      payload.password = password;
    }
    const update = await request(endpoint, { method: "PUT", body: JSON.stringify(payload) });
    if (update.status !== 200) {
      const body = await parseJson<ApiError>(update);
      setMessage(body.error?.message ?? dict.detail.updateFailed);
      return;
    }
    const updated = await parseJson<{ data: any }>(update);
    setRow(updated.data);
    setMessage(dict.common.saved);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  async function createAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSuperAdmin || addressSaving) return;
    const addressLine = newAddressLine.trim();
    if (!addressLine) {
      setMessage(language === "tr" ? "Adres zorunludur." : "Address is required.");
      return;
    }
    setAddressSaving(true);
    setMessage(null);
    const currentAddress = (addressEditorId ? addresses.find((item) => item.id === addressEditorId) : null)
      ?? addresses.find((item) => item.isDefault)
      ?? addresses[0]
      ?? null;
    try {
      const response = currentAddress
        ? await request(`/v1/admin/users/${id}/addresses/${currentAddress.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              title: currentAddress.title || (language === "tr" ? "Adres" : "Address"),
              addressLine,
              isDefault: currentAddress.isDefault,
            }),
          })
        : await request(`/v1/admin/users/${id}/addresses`, {
            method: "POST",
            body: JSON.stringify({
              title: language === "tr" ? "Adres" : "Address",
              addressLine,
              isDefault: false,
            }),
          });
      const successCode = currentAddress ? 200 : 201;
      if (response.status !== successCode) {
        const body = await parseJson<ApiError>(response);
        setMessage(body.error?.message ?? dict.detail.requestFailed);
        return;
      }
      setAddressDirty(false);
      await loadSellerDetail();
      setMessage(dict.common.saved);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setAddressSaving(false);
    }
  }

  function onEnterSubmit(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter") return;
    if (event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    event.currentTarget.requestSubmit();
  }

  const paymentStateKey = (value: string | null | undefined): "successful" | "pending" | "failed" => {
    const lower = String(value ?? "").toLowerCase();
    if (lower.includes("fail")) return "failed";
    if (lower.includes("pending")) return "pending";
    return "successful";
  };

  const paymentStateText = (value: string | null | undefined) => {
    const key = paymentStateKey(value);
    if (language === "tr") {
      if (key === "failed") return "Başarısız";
      if (key === "pending") return "Bekliyor";
      return "Başarılı";
    }
    if (key === "failed") return "Failed";
    if (key === "pending") return "Pending";
    return "Successful";
  };

  const deliveryTypeText = (value: string | null | undefined) => {
    return deliveryTypeLabel(value);
  };

  const orderStatusGroup = (order: {
    status: string;
    sellerDecisionState?: string | null;
    activeDeliveryType?: string | null;
    requestedDeliveryType?: string | null;
    deliveryType?: string | null;
  }) => {
    const rawStatus = String(order.status ?? "").toLowerCase();
    if (["rejected", "cancelled"].includes(rawStatus)) return "cancelled";
    if (["delivered", "completed"].includes(rawStatus)) return "delivered";
    if (String(order.sellerDecisionState ?? "").toLowerCase() === "approved" || ["seller_approved", "paid", "preparing", "ready", "in_delivery", "approaching", "at_door"].includes(rawStatus)) {
      return "confirmed";
    }
    return "pending";
  };

  const toLocalDateKey = (value: string | null | undefined) => {
    const date = new Date(String(value ?? ""));
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const filteredSellerOrders = useMemo(() => {
    const query = ordersSearch.trim().toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
    return sellerOrders.filter((order) => {
      const statusMatches = ordersStatusFilter === "all" || orderStatusGroup(order) === ordersStatusFilter;
      const paymentMatches = ordersPaymentFilter === "all" || paymentStateKey(order.paymentStatus) === ordersPaymentFilter;
      if (!statusMatches || !paymentMatches) return false;
      if (!query) return true;
      const foods = Array.isArray(order.items)
        ? order.items.map((item) => `${String(item.name ?? "-")} x${Number(item.quantity ?? 0)}`).join(", ")
        : "";
      const haystack = [
        order.orderNo,
        order.buyerName ?? "",
        order.buyerEmail ?? "",
        order.buyerId ?? "",
        deliveryTypeText(order.activeDeliveryType ?? order.requestedDeliveryType ?? order.deliveryType),
        sellerDecisionStateLabel(order.sellerDecisionState),
        orderStatusLabel(order.status, order.activeDeliveryType ?? order.requestedDeliveryType ?? order.deliveryType),
        foods,
      ].join(" ").toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
      return haystack.includes(query);
    });
  }, [sellerOrders, ordersStatusFilter, ordersPaymentFilter, ordersSearch, language]);
  const hasExpandedFood = useMemo(() => Object.values(expandedFoodIds).some(Boolean), [expandedFoodIds]);

  const filteredSellerEarnings = useMemo(() => {
    const now = Date.now();
    const query = earningsSearch.trim().toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
    return sellerOrders.filter((order) => {
      const paymentKey = paymentStateKey(order.paymentStatus);
      if (earningsPaymentFilter !== "all" && paymentKey !== earningsPaymentFilter) return false;
      if (earningsDateFilter !== "all") {
        const created = Date.parse(String(order.createdAt ?? ""));
        if (Number.isFinite(created)) {
          const diffDays = (now - created) / (1000 * 60 * 60 * 24);
          if (earningsDateFilter === "last7" && diffDays > 7) return false;
          if (earningsDateFilter === "last30" && diffDays > 30) return false;
        }
        if (earningsDateFilter === "custom" && earningsSelectedDate) {
          if (toLocalDateKey(order.createdAt) !== earningsSelectedDate) return false;
        }
      }
      if (!query) return true;
      const haystack = [
        order.orderNo,
        order.buyerName ?? "",
        order.buyerEmail ?? "",
        order.buyerId ?? "",
        order.paymentProviderReferenceId ?? "",
        order.paymentProviderSessionId ?? "",
      ].join(" ").toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
      return haystack.includes(query);
    });
  }, [sellerOrders, earningsDateFilter, earningsSelectedDate, earningsPaymentFilter, earningsSearch, language]);

  const selectedFilteredOrders = useMemo(
    () => filteredSellerOrders.filter((order) => selectedOrderIds.includes(order.orderId)),
    [filteredSellerOrders, selectedOrderIds]
  );
  const selectedFilteredEarnings = useMemo(
    () => filteredSellerEarnings.filter((order) => selectedEarningIds.includes(order.orderId)),
    [filteredSellerEarnings, selectedEarningIds]
  );

  const allFilteredOrdersSelected = filteredSellerOrders.length > 0 && filteredSellerOrders.every((order) => selectedOrderIds.includes(order.orderId));
  const allFilteredEarningsSelected = filteredSellerEarnings.length > 0 && filteredSellerEarnings.every((order) => selectedEarningIds.includes(order.orderId));

  useEffect(() => {
    const visible = new Set(filteredSellerOrders.map((order) => order.orderId));
    setSelectedOrderIds((prev) => prev.filter((id) => visible.has(id)));
  }, [filteredSellerOrders]);

  useEffect(() => {
    const visible = new Set(filteredSellerEarnings.map((order) => order.orderId));
    setSelectedEarningIds((prev) => prev.filter((id) => visible.has(id)));
  }, [filteredSellerEarnings]);

  useEffect(() => {
    const visible = new Set(foodRows.map((food) => food.id));
    setSelectedFoodIds((prev) => prev.filter((id) => visible.has(id)));
  }, [foodRows]);

  useEffect(() => {
    if (activeTab !== "foods" || !hasExpandedFood) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(".seller-food-detail-sheet")) return;
      if (target.closest(".foods-toggle-btn")) return;
      if (target.closest(".seller-food-lots-table-wrap")) return;
      setExpandedFoodIds({});
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [activeTab, hasExpandedFood]);

  function printIdentityDetails() {
    if (!identityViewerOpen) return;
    printModalContent(identityModalPrintRef.current);
  }

  function printInlineLotDetail() {
    printModalContent(inlineLotModalRef.current);
  }

  function downloadInlineLotDetailAsExcel() {
    const food = selectedInlineFoodId ? foodRows.find((f) => f.id === selectedInlineFoodId) ?? null : null;
    const lot = food && selectedInlineLotId ? (lotsByFoodId[food.id]?.find((l) => l.id === selectedInlineLotId) ?? null) : null;
    if (!food || !lot) return;
    const escapeCsv = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lotDiff = computeFoodLotDiff({ foodRecipe: food.recipe ?? null, foodIngredients: food.ingredients, foodAllergens: food.allergens, lot });
    const lines: string[] = [
      [dict.detail.lotNumber, dict.detail.lotLifecycle, dict.detail.lotQuantity, dict.detail.lotProducedAt, dict.detail.lotSaleWindow, language === "tr" ? "Son Kullanma" : "Use By", language === "tr" ? "Lot Malzemeler" : "Lot Ingredients", language === "tr" ? "Lot Alerjen" : "Lot Allergens"].map(escapeCsv).join(","),
      [lot.lot_number, lotLifecycleLabel(lot.lifecycle_status, language), `${lot.quantity_available}/${lot.quantity_produced}`, formatUiDate(lot.produced_at, language), `${formatUiDate(lot.sale_starts_at, language)} - ${formatUiDate(lot.sale_ends_at, language)}`, formatUiDate(lot.use_by, language), toReadableText(lot.ingredients_snapshot_json), toReadableText(lot.allergens_snapshot_json)].map(escapeCsv).join(","),
    ];
    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `lot-detail-${lot.lot_number}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (loading || (row && String(row.id) !== String(id))) return (
    <div className="panel detail-skeleton-panel">
      <div className="detail-skeleton-hero">
        {routerPreview?.profileImageUrl
          ? <img src={routerPreview.profileImageUrl} style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} alt="" />
          : <div className="detail-skeleton-avatar skeleton-pulse" />
        }
        <div className="detail-skeleton-info">
          {routerPreview?.displayName
            ? <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>{routerPreview.displayName}</div>
            : <div className="detail-skeleton-line skeleton-pulse" style={{ width: "42%", height: 22 }} />
          }
          {routerPreview?.email
            ? <div style={{ fontSize: "0.82rem", color: "var(--color-secondary-text)", marginTop: 5 }}>{routerPreview.email}</div>
            : <div className="detail-skeleton-line skeleton-pulse" style={{ width: "62%", height: 13, marginTop: 8 }} />
          }
          <div className="detail-skeleton-line skeleton-pulse" style={{ width: "32%", height: 13, marginTop: 6 }} />
        </div>
      </div>
      <div className="detail-skeleton-tabs skeleton-pulse" />
      <div className="detail-skeleton-body">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="detail-skeleton-line skeleton-pulse" style={{ width: `${70 - i * 10}%`, height: 14 }} />
        ))}
      </div>
    </div>
  );
  if (!row) return <div className="panel">{message ?? dict.common.noRecords}</div>;

  const isActive = row.status === "active";
  const accountStatusLabel = isActive ? dict.common.active : dict.common.disabled;
  const phone = String(row.phone ?? extractPhoneFromChecks(compliance) ?? "").trim();
  const maskedEmail = maskEmail(row.email);
  const totalFoods = Number(row.totalFoods ?? foodRows.length ?? 0);
  const fallbackProfileImageFromFoods = foodRows.map((item) => normalizeImageUrl(item.imageUrl)).find(Boolean) ?? null;
  const profileImageUrl =
    !profileImageFailed
      ? normalizeImageUrl(row.profileImageUrl) ?? normalizeImageUrl(row.profile_image_url) ?? fallbackProfileImageFromFoods
      : null;
  const sellerFallbackAvatar = "/avatar-seller-default.svg";
  const walletAmount = formatCurrency(
    filteredSellerEarnings
      .filter((order) => paymentStateKey(order.paymentStatus) === "successful")
      .reduce((sum, order) => sum + Number(order.totalAmount ?? 0), 0),
    language
  );
  const roleLabel =
    row.role === "seller"
      ? dict.users.userTypeSeller
      : row.role === "buyer"
        ? dict.users.userTypeBuyer
        : row.role === "both"
          ? dict.users.userTypeBoth
          : String(row.role ?? "-");
  const avgRating = row.avgRating != null ? Number(row.avgRating) : null;
  const roundedStars = avgRating != null ? Math.max(0, Math.min(5, Math.round(avgRating))) : 0;
  const contactEmail = String(row.email ?? "").trim();
  const contactPhone = phone;
  const contactPhoneHrefValue = contactPhone.replace(/[^\d+]/g, "");
  const contactHasPhone = contactPhoneHrefValue.length > 0;
  const contactSmsBody = encodeURIComponent(language === "tr" ? "Merhaba" : "Hello");
  const primaryAddressTitle = addresses.find((item) => item.isDefault)?.title ?? addresses[0]?.title ?? "-";
  const primaryAddress = addresses.find((item) => item.isDefault)?.addressLine ?? addresses[0]?.addressLine ?? "-";
  const cityDistrictDisplay = (() => {
    const raw = String(primaryAddressTitle ?? "").trim();
    if (!raw || raw === "-") return "-";
    if (raw.includes("/")) return raw.replace(/\s*\/\s*/g, "/").toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
    if (raw.includes(",")) {
      const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}/${parts.slice(1).join(" ")}`.toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
      return (parts[0] ?? "-").toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) return `${tokens[0]}/${tokens.slice(1).join(" ")}`.toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
    return raw.toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
  })();

  const legalRows = mapComplianceRows(compliance, dict, language);
  const profileBadge = profileBadgeFromStatus(compliance?.profile.status, dict);
  const legalDocuments = [...(compliance?.documents ?? [])].sort((a, b) => {
    const rankDiff = knownDocumentCodeRank(a.code) - knownDocumentCodeRank(b.code);
    if (rankDiff !== 0) return rankDiff;
    const nameDiff = a.name.localeCompare(b.name, language === "tr" ? "tr" : "en", { sensitivity: "base" });
    if (nameDiff !== 0) return nameDiff;
    return b.version - a.version;
  });
  const currentLegalDocuments = legalDocuments.filter((row) => row.is_current);
  const legalTypeRows = currentLegalDocuments;
  const optionalUploads = [...(compliance?.optionalUploads ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const identityDocuments = (() => {
    const isIdentityCode = (value: string) => {
      const code = value.toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
      return (
        code.includes("kimlik") ||
        code.includes("identity") ||
        code.includes("id_card") ||
        code.includes("idcard") ||
        code.includes("passport") ||
        code.includes("selfie")
      );
    };
    const fromLegal = legalDocuments
      .filter((row) => Boolean(row.file_url) && (isIdentityCode(row.code) || isIdentityCode(row.name)))
      .map((row) => ({
        id: row.id,
        label: row.name,
        url: String(row.file_url),
      }));
    const fromOptional = optionalUploads
      .filter((row) => {
        const title = `${row.catalog_doc_name ?? ""} ${row.custom_title ?? ""} ${row.catalog_doc_code ?? ""}`;
        return Boolean(row.file_url) && isIdentityCode(title);
      })
      .map((row) => ({
        id: `optional-${row.id}`,
        label: row.catalog_doc_name ?? row.custom_title ?? (language === "tr" ? "Kimlik Dosyası" : "Identity File"),
        url: row.file_url,
      }));
    return [...fromLegal, ...fromOptional];
  })();
  const selectedIdentityDocument =
    identityDocuments.find((row) => row.url === identityViewerUrl) ?? identityDocuments[0] ?? null;
  const selectedIdentityDocumentIsPdf = /\.pdf(?:$|\?)/i.test(String(selectedIdentityDocument?.url ?? ""));
  const previewTargetIsPdf = /\.pdf(?:$|\?)/i.test(String(previewTarget?.url ?? ""));
  const previewActionsLocked = previewTarget?.status === "approved" || previewTarget?.status === "rejected";
  const legalSaving = legalSavingKey !== null;
  const isSavingDoc = (docId: string) => legalSavingKey === `doc:${docId}`;
  const isSavingOptional = (uploadId: string) => legalSavingKey === `optional:${uploadId}`;
  const isSavingDocType = (docTypeCode: string) => legalSavingKey === `dtype:${docTypeCode}`;

  function recomputeProfile(
    documents: SellerCompliancePayload["documents"],
    prev: SellerCompliancePayload["profile"]
  ): SellerCompliancePayload["profile"] {
    const required = documents.filter((d) => d.is_current && d.is_required);
    const requiredCount = required.length;
    const approvedRequired = required.filter((d) => d.status === "approved").length;
    const uploadedRequired = required.filter((d) => d.status === "uploaded").length;
    const requestedRequired = required.filter((d) => d.status === "requested" || d.status === "expired").length;
    const rejectedRequired = required.filter((d) => d.status === "rejected").length;
    let status: SellerComplianceStatus;
    if (requiredCount === 0) status = "not_started";
    else if (rejectedRequired > 0) status = "rejected";
    else if (approvedRequired === requiredCount) status = "approved";
    else if (requestedRequired > 0) status = "in_progress";
    else status = "under_review";
    return {
      ...prev,
      status,
      required_count: requiredCount,
      approved_required_count: approvedRequired,
      uploaded_required_count: uploadedRequired,
      requested_required_count: requestedRequired,
      rejected_required_count: rejectedRequired,
    };
  }

  async function updateDocumentStatus(documentId: string, status: "requested" | "approved" | "rejected", rejectionReasonInput?: string) {
    setLegalSavingKey(`doc:${documentId}`);
    try {
      const response = await request(`/v1/admin/compliance/${id}/documents/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          rejectionReason: status === "rejected" || status === "requested" ? (rejectionReasonInput ?? null) : null,
        }),
      });
      const body = await parseJson<{ data?: { documentId: string; status: "requested" | "uploaded" | "approved" | "rejected" | "expired" } } & ApiError>(response);
      if (response.status !== 200 || !body.data) {
        setMessage(body.error?.message ?? dict.detail.legalUpdateFailed);
        return;
      }
      const nowIso = new Date().toISOString();
      setCompliance((prev) => {
        if (!prev) return prev;
        const updatedDocuments = prev.documents.map((item) =>
          item.id === body.data!.documentId
            ? {
                ...item,
                status: body.data!.status,
                rejection_reason: body.data!.status === "rejected" || body.data!.status === "requested" ? (rejectionReasonInput ?? null) : null,
                reviewed_at: body.data!.status === "approved" || body.data!.status === "rejected" ? nowIso : null,
                updated_at: nowIso,
              }
            : item
        );
        return {
          ...prev,
          documents: updatedDocuments,
          profile: recomputeProfile(updatedDocuments, prev.profile),
        };
      });
      setTempComplianceUploads((prev) => {
        Object.values(prev).forEach((item) => URL.revokeObjectURL(item.fileUrl));
        return {};
      });
      await loadSellerDetail();
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLegalSavingKey(null);
    }
  }

  async function updateOptionalUploadStatus(uploadId: string, status: "uploaded" | "approved" | "rejected", rejectionReasonInput?: string) {
    setLegalSavingKey(`optional:${uploadId}`);
    try {
      const response = await request(`/v1/admin/compliance/${id}/optional-uploads/${uploadId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          rejectionReason: status === "rejected" || status === "uploaded" ? (rejectionReasonInput ?? null) : null,
        }),
      });
      const body = await parseJson<{ data?: { uploadId: string; status: "uploaded" | "approved" | "rejected" | "archived" | "expired" } } & ApiError>(response);
      if (response.status !== 200 || !body.data) {
        setMessage(body.error?.message ?? dict.detail.legalUpdateFailed);
        return;
      }
      const nowIso = new Date().toISOString();
      setCompliance((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          optionalUploads: prev.optionalUploads.map((item) =>
            item.id === body.data!.uploadId
              ? {
                  ...item,
                  status: body.data!.status,
                  rejection_reason: body.data!.status === "rejected" || body.data!.status === "uploaded" ? (rejectionReasonInput ?? null) : null,
                  reviewed_at: body.data!.status === "approved" || body.data!.status === "rejected" ? nowIso : null,
                  updated_at: nowIso,
                }
              : item
          ),
        };
      });
      setTempComplianceUploads((prev) => {
        Object.values(prev).forEach((item) => URL.revokeObjectURL(item.fileUrl));
        return {};
      });
      await loadSellerDetail();
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLegalSavingKey(null);
    }
  }

  async function updateDocumentRequired(docTypeCode: string, required: boolean) {
    setLegalSavingKey(`dtype:${docTypeCode}`);
    try {
      const response = await request(`/v1/admin/compliance/${id}/doc-types/${encodeURIComponent(docTypeCode)}`, {
        method: "PATCH",
        body: JSON.stringify({ required }),
      });
      if (response.status !== 200) {
        const body = await parseJson<ApiError>(response);
        setMessage(body.error?.message ?? dict.detail.legalUpdateFailed);
        return;
      }
      setCompliance((prev) => {
        if (!prev) return prev;
        const nowIso = new Date().toISOString();
        const updatedDocuments = prev.documents.map((item) =>
          item.code === docTypeCode && item.is_current
            ? {
                ...item,
                is_required: required,
                updated_at: nowIso,
              }
            : item
        );
        return {
          ...prev,
          documents: updatedDocuments,
          profile: recomputeProfile(updatedDocuments, prev.profile),
        };
      });
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLegalSavingKey(null);
    }
  }

  function openCompliancePreview(row: (typeof displayLegalRows)[number]) {
    const fileUrl = row.sourceFileUrl ?? null;
    if (!fileUrl || !row.sourceDocumentId) return;
    setPreviewTarget({
      title: row.label,
      url: fileUrl,
      documentId: row.sourceDocumentId,
      isOptional: false,
      status: row.sourceDocumentStatus ?? "uploaded",
      tone: row.tone,
      date: row.sourceDate ?? null,
      rejectionReason: row.sourceRejectionReason ?? null,
    });
    setPreviewAction(null);
    setPreviewActionReason("");
  }

  function openDocumentPreview(
    documentId: string,
    fileUrl: string,
    title: string,
    status: SellerComplianceDocumentStatus,
    tone: ComplianceTone,
    isOptional: boolean,
    action?: "reject" | "pending",
    rejectionReason?: string | null,
    date?: string | null,
  ) {
    setPreviewTarget({ title, url: fileUrl, documentId, isOptional, status, tone, rejectionReason: rejectionReason ?? null, date: date ?? null });
    setPreviewAction(action ?? null);
    setPreviewActionReason("");
  }

  function triggerComplianceUpload(key: ComplianceRowKey) {
    if (!isSuperAdmin) return;
    setPendingUploadKey(key);
    complianceUploadInputRef.current?.click();
  }

  async function handleComplianceFileChange(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || !pendingUploadKey) {
      input.value = "";
      return;
    }

    const rowKey = pendingUploadKey;
    const docType = resolveDocTypeCodeFromRowKey(rowKey);
    if (!docType) {
      setMessage(language === "tr" ? "Doküman tipi bulunamadı." : "Document type was not found.");
      setPendingUploadKey(null);
      input.value = "";
      return;
    }

    setLegalSavingKey(`upload:${rowKey}`);
    try {
      const presignResponse = await request(`/v1/admin/compliance/${id}/documents/presign-upload`, {
        method: "POST",
        body: JSON.stringify({
          docType,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
        }),
      });
      if (presignResponse.status !== 200) {
        const body = await parseJson<ApiError>(presignResponse);
        setMessage(body.error?.message ?? dict.detail.requestFailed);
        return;
      }

      const presignBody = await parseJson<{ data: { uploadUrl: string; fileUrl: string } }>(presignResponse);
      const upload = await fetch(presignBody.data.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });
      if (!upload.ok) {
        setMessage(language === "tr" ? "Dosya depolamaya yüklenemedi." : "File upload to storage failed.");
        return;
      }

      const completeResponse = await request(`/v1/admin/compliance/${id}/documents/upload`, {
        method: "POST",
        body: JSON.stringify({
          docType,
          fileUrl: presignBody.data.fileUrl,
        }),
      });
      if (completeResponse.status !== 201) {
        const body = await parseJson<ApiError>(completeResponse);
        setMessage(body.error?.message ?? dict.detail.legalUpdateFailed);
        return;
      }

      setTempComplianceUploads((prev) => {
        const current = prev[rowKey];
        if (!current) return prev;
        URL.revokeObjectURL(current.fileUrl);
        const next = { ...prev };
        delete next[rowKey];
        return next;
      });
      await loadSellerDetail();
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLegalSavingKey(null);
      setPendingUploadKey(null);
      input.value = "";
    }
  }

  function closePreviewModal() {
    setPreviewTarget(null);
    setPreviewAction(null);
    setPreviewActionReason("");
  }

  async function approveInPreview() {
    if (!previewTarget) return;
    const { documentId, isOptional } = previewTarget;
    if (isOptional) {
      await updateOptionalUploadStatus(documentId, "approved");
    } else {
      await updateDocumentStatus(documentId, "approved");
    }
    closePreviewModal();
  }

  async function confirmPreviewAction() {
    if (!previewTarget || !previewAction) return;
    const reason = previewActionReason.trim();
    if (reason.length < 3) return;
    const { documentId, isOptional } = previewTarget;
    if (isOptional) {
      await updateOptionalUploadStatus(documentId, previewAction === "reject" ? "rejected" : "uploaded", reason);
    } else {
      await updateDocumentStatus(documentId, previewAction === "reject" ? "rejected" : "requested", reason);
    }
    closePreviewModal();
  }

  function confirmTempReject() {
    if (!tempRejectTargetKey) return;
    const reason = tempRejectReason.trim();
    if (reason.length < 3) return;
    setTempComplianceUploads((prev) => {
      const current = prev[tempRejectTargetKey];
      if (!current) {
        setMessage(language === "tr" ? "Belge kaydı bulunamadı." : "Document record not found.");
        return prev;
      }
      return {
        ...prev,
        [tempRejectTargetKey]: {
          ...current,
          status: "rejected",
          rejectionReason: reason,
        },
      };
    });
    setTempRejectTargetKey(null);
    setTempRejectReason("");
    setMessage(dict.common.saved);
  }

  function cancelTempReject() {
    setTempRejectTargetKey(null);
    setTempRejectReason("");
  }

  function confirmTempPending() {
    if (!tempPendingTargetKey) return;
    const reason = tempPendingReason.trim();
    if (reason.length < 3) return;
    setTempComplianceUploads((prev) => {
      const current = prev[tempPendingTargetKey];
      if (!current) {
        setMessage(language === "tr" ? "Belge kaydı bulunamadı." : "Document record not found.");
        return prev;
      }
      return {
        ...prev,
        [tempPendingTargetKey]: {
          ...current,
          status: "requested",
          rejectionReason: reason,
        },
      };
    });
    setTempPendingTargetKey(null);
    setTempPendingReason("");
    setMessage(dict.common.saved);
  }

  function cancelTempPending() {
    setTempPendingTargetKey(null);
    setTempPendingReason("");
  }

  const displayLegalRows = legalRows.map((item) => {
    const tempUpload = tempComplianceUploads[item.key];
    if (!tempUpload || item.sourceDocumentId) return item;
    const tone = sellerDocumentStatusTone(tempUpload.status);
    const statusLabel = sellerDocumentStatusLabel(tempUpload.status, dict);
    const rejectionText = tempUpload.rejectionReason ? ` • ${tempUpload.rejectionReason}` : "";
    return {
      ...item,
      tone,
      statusLabel,
      detailText: `${statusLabel} • ${formatUiDate(tempUpload.uploadedAt, language)}${rejectionText}`,
      sourceType: "document" as const,
      sourceDocumentId: null,
      sourceFileUrl: tempUpload.fileUrl,
      sourceDocumentStatus: tempUpload.status,
    };
  });

  async function downloadSellerFoodsAsExcel(foodIds?: string[]) {
    const scopedIds = Array.isArray(foodIds) ? foodIds.filter(Boolean) : [];
    if (scopedIds.length === 0 && foodRows.length === 0) {
      setMessage(language === "tr" ? "Disa aktarilacak yemek kaydi bulunamadi." : "No foods to export.");
      return;
    }
    if (scopedIds.length > 0 && !foodRows.some((food) => scopedIds.includes(food.id))) {
      setMessage(language === "tr" ? "Secili yemek bulunamadi." : "Selected foods not found.");
      return;
    }

    const query = new URLSearchParams();
    if (scopedIds.length === 1) query.set("foodId", scopedIds[0]);
    else if (scopedIds.length > 1) query.set("foodIds", scopedIds.join(","));

    try {
      const response = await request(`/v1/admin/users/${id}/seller-foods/export${query.size ? `?${query.toString()}` : ""}`);
      if (response.status !== 200) {
        const body = await parseJson<ApiError>(response);
        setMessage(body.error?.message ?? (language === "tr" ? "Excel dışa aktarma başarısız." : "Excel export failed."));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const disposition = response.headers.get("content-disposition") ?? "";
      const matchedFileName = disposition.match(/filename="([^"]+)"/i)?.[1];
      anchor.href = url;
      anchor.download = matchedFileName ?? `seller-foods-${new Date().toISOString().slice(0, 10)}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setMessage(language === "tr" ? "Excel dışa aktarma başarısız." : "Excel export failed.");
    }
  }

  function downloadSellerOrdersAsExcel() {
    if (selectedFilteredOrders.length === 0) {
      setMessage(language === "tr" ? "Disa aktarilacak siparis bulunamadi." : "No orders to export.");
      return;
    }

    const headers = [
      language === "tr" ? "Tarih / Saat" : "Date / Time",
      language === "tr" ? "Siparis No" : "Order No",
      language === "tr" ? "Alici" : "Buyer",
      language === "tr" ? "Teslimat" : "Delivery",
      language === "tr" ? "Yemekler" : "Foods",
      language === "tr" ? "Tutar" : "Amount",
      language === "tr" ? "Odeme" : "Payment",
      language === "tr" ? "Durum" : "Status",
    ];
    const rowsForExport = selectedFilteredOrders.map((order) => {
      const paymentText = paymentStateText(order.paymentStatus);
      const foods = Array.isArray(order.items)
        ? order.items.map((item) => `${String(item.name ?? "-")} x${Number(item.quantity ?? 0)}`).join(", ")
        : "-";
      return [
        formatTableDateTime(order.createdAt),
        order.orderNo,
        order.buyerName ?? order.buyerEmail ?? order.buyerId,
        deliveryTypeText(order.activeDeliveryType ?? order.requestedDeliveryType ?? order.deliveryType),
        foods || "-",
        formatCurrency(Number(order.totalAmount ?? 0), language),
        paymentText,
        orderStatusLabel(order.status, order.activeDeliveryType ?? order.requestedDeliveryType ?? order.deliveryType),
      ];
    });

    const escapeCsv = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
    const csv = [headers, ...rowsForExport].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `seller-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadSellerEarningsAsExcel() {
    if (selectedFilteredEarnings.length === 0) {
      setMessage(language === "tr" ? "Disa aktarilacak kazanc kaydi bulunamadi." : "No earnings to export.");
      return;
    }
    const headers = [
      language === "tr" ? "Tarih / Saat" : "Date / Time",
      language === "tr" ? "Siparis No" : "Order No",
      language === "tr" ? "Alici" : "Buyer",
      language === "tr" ? "İşlem Ref" : "Transaction Ref",
      language === "tr" ? "Oturum No" : "Session No",
      language === "tr" ? "Odeme" : "Payment",
      language === "tr" ? "Kazanc" : "Earning",
    ];
    const rowsForExport = selectedFilteredEarnings.map((order) => [
      formatTableDateTime(order.createdAt),
      order.orderNo,
      order.buyerName ?? order.buyerEmail ?? order.buyerId,
      order.paymentProviderReferenceId ?? "-",
      order.paymentProviderSessionId ?? "-",
      paymentStateText(order.paymentStatus),
      formatCurrency(Number(order.totalAmount ?? 0), language),
    ]);
    const escapeCsv = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
    const csv = [headers, ...rowsForExport].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `seller-earnings-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleAddNote(text: string): Promise<void> {
    try {
      const response = await request(`/v1/admin/sellers/${id}/notes`, {
        method: "POST",
        body: JSON.stringify({ note: text }),
      });
      if (response.status >= 200 && response.status < 300) {
        const body = await parseJson<{ data?: { id: string; note: string; createdAt: string; createdByUsername?: string | null } } & ApiError>(response);
        if (body.data?.id) {
          setNoteItems((prev) => [body.data as { id: string; note: string; createdAt: string; createdByUsername?: string | null }, ...prev]);
        } else {
          await loadSellerDetail();
        }
      } else {
        setMessage(language === "tr" ? "Not kaydedilemedi." : "Failed to save note.");
      }
    } catch {
      setMessage(language === "tr" ? "Not kaydedilemedi." : "Failed to save note.");
    }
  }

  async function handleAddTag(tag: string): Promise<void> {
    try {
      const response = await request(`/v1/admin/sellers/${id}/tags`, {
        method: "POST",
        body: JSON.stringify({ tag }),
      });
      if (response.status >= 200 && response.status < 300) {
        if (!tagItems.includes(tag)) {
          setTagItems((prev) => [tag, ...prev].slice(0, 16));
        }
      } else {
        setMessage(language === "tr" ? "Etiket kaydedilemedi." : "Failed to save tag.");
      }
    } catch {
      setMessage(language === "tr" ? "Etiket kaydedilemedi." : "Failed to save tag.");
    }
  }

  async function handleDeleteTag(tag: string): Promise<void> {
    try {
      const response = await request(`/v1/admin/sellers/${id}/tags`, {
        method: "DELETE",
        body: JSON.stringify({ tag }),
      });
      if (response.status === 204) {
        setTagItems((prev) => prev.filter((item) => item !== tag));
      } else {
        setMessage(language === "tr" ? "Etiket silinemedi." : "Failed to delete tag.");
      }
    } catch {
      setMessage(language === "tr" ? "Etiket silinemedi." : "Failed to delete tag.");
    }
  }

  async function handleSaveNote(noteId: string, newText: string): Promise<void> {
    try {
      const response = await request(`/v1/admin/sellers/${id}/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify({ note: newText }),
      });
      if (response.status === 200) {
        const body = await parseJson<{ data?: { id: string; note: string; createdAt: string; createdByUsername?: string | null } } & ApiError>(response);
        if (body.data?.id) {
          setNoteItems((prev) => prev.map((item) => (item.id === noteId ? (body.data as { id: string; note: string; createdAt: string; createdByUsername?: string | null }) : item)));
        }
        return;
      }
      setMessage(language === "tr" ? "Not güncellenemedi." : "Failed to update note.");
    } catch {
      setMessage(language === "tr" ? "Not güncellenemedi." : "Failed to update note.");
    }
  }

  const sellerRawPayload = {
    id: row.id,
    user: row,
    addresses,
    compliance,
    foods: foodRows,
    orders: {
      rows: sellerOrders,
      pagination: sellerOrdersPagination,
    },
    derived: {
      emailMasked: maskedEmail,
      phoneFromComplianceChecks: phone,
      roleLabel,
      isActive,
    },
    generalProfileSnapshot: {
      customerId: row.id,
      email: row.email ?? null,
      displayName: row.displayName ?? null,
      fullName: row.fullName ?? null,
      phone: row.phone ?? null,
      dob: row.dob ?? null,
      countryCode: row.countryCode ?? null,
      language: row.language ?? null,
      profileImageUrl: row.profileImageUrl ?? row.profile_image_url ?? null,
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
      status: row.status ?? null,
      role: row.role ?? null,
    },
    legalHoldState: Boolean(row.legalHoldState),
  };

  const tabs = [
    { key: "general", label: dict.detail.sellerTabs.general },
    { key: "foods", label: dict.detail.sellerTabs.foods },
    { key: "orders", label: dict.detail.sellerTabs.orders },
    { key: "wallet", label: dict.detail.sellerTabs.wallet },
    { key: "identity", label: language === "tr" ? "Uygunluk" : "Compliance" },
    { key: "security", label: dict.detail.sellerTabs.security },
    { key: "reviews", label: dict.detail.sellerTabs.reviews },
    { key: "complaints", label: dict.detail.sellerTabs.complaints },
    { key: "notes", label: dict.detail.sellerTabs.notes },
    { key: "raw", label: dict.detail.sellerTabs.raw },
  ] as const;
  const canExportActiveSellerTab = activeTab === "orders" || activeTab === "wallet" || activeTab === "foods";
  const exportActiveSellerTabAsExcel = () => {
    if (activeTab === "foods") {
      void downloadSellerFoodsAsExcel(selectedFoodIds);
      return;
    }
    if (activeTab === "orders") {
      downloadSellerOrdersAsExcel();
      return;
    }
    if (activeTab === "wallet") {
      downloadSellerEarningsAsExcel();
    }
  };

  return (
    <div className="app seller-detail-page">
      {message ? <div className="alert">{message}</div> : null}

      <section className="panel seller-hero">
        <article className="seller-hero-main">
          <div className="seller-avatar-col">
            <button
              type="button"
              className="seller-avatar-button"
              onClick={() => setProfileModalOpen(true)}
              aria-label={language === "tr" ? "Profil bilgilerini aç" : "Open profile details"}
            >
              <div className="seller-avatar">
                <img
                  src={profileImageUrl ?? sellerFallbackAvatar}
                  alt={row.displayName ?? "seller"}
                  onError={() => setProfileImageFailed(true)}
                />
              </div>
            </button>
          </div>
          <div className="seller-hero-text">
            <div className="seller-hero-title-stack">
              <div className="seller-hero-title-row">
                <h1>{row.displayName ?? row.email}</h1>
                <QuickAccessMenu
                  ref={quickAccessRef}
                  className="seller-rating-quick-access"
                  language={language}
                  email={contactEmail}
                  phoneHrefValue={contactHasPhone ? contactPhoneHrefValue : ""}
                  smsBody={contactSmsBody}
                />
              </div>
              <div className="seller-rating-row" aria-label={`rating ${avgRating != null ? avgRating.toFixed(1) : "0.0"}`}>
                <span className="rating-value">{avgRating != null ? avgRating.toFixed(1) : "0.0"}</span>
                <span className="rating-stars" aria-hidden="true">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <span key={index} className={index < roundedStars ? "is-filled" : ""}>★</span>
                  ))}
                </span>
                {avgRating == null && row.reviewCount <= 0 ? (
                  <span className="panel-meta">{language === "tr" ? "henüz yorum yok" : "no reviews yet"}</span>
                ) : null}
              </div>
            </div>
          </div>
        </article>
        <div className="seller-hero-right">
          <div className="seller-hero-stats">
            <article>
              <p>{dict.detail.sellerTabs.wallet}</p>
              <strong>{walletAmount}</strong>
            </article>
            <article>
              <p>{dict.detail.updatedAtLabel}</p>
              <strong>{formatUiDate(row.updatedAt, language)}</strong>
            </article>
          </div>
        </div>
      </section>

      <section className="panel seller-tabs-panel">
        <div className="seller-tabs" role="tablist" aria-label={dict.detail.sellerTabs.title}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={activeTab === tab.key ? "is-active" : ""}
              onClick={() => switchSellerTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
          <ExcelExportButton
            className="seller-tabs-export-btn"
            type="button"
            onClick={exportActiveSellerTabAsExcel}
            disabled={!canExportActiveSellerTab}
            labelTr={activeTab === "foods" ? (selectedFoodIds.length > 0 ? `Seçili Yemekleri Excel'e Aktar (${selectedFoodIds.length})` : "Tüm Yemekleri Excel'e Aktar") : undefined}
            labelEn={activeTab === "foods" ? (selectedFoodIds.length > 0 ? `Export Selected Foods to Excel (${selectedFoodIds.length})` : "Export All Foods to Excel") : undefined}
            language={language}
          />
        </div>
      </section>

      {activeTab === "general" ? (
        <section className="panel seller-general-panel">
          <div className="seller-general-grid">
            <article className="seller-general-card">
              <div className="panel-header">
                <h2>{language === "tr" ? "Kimlik Kartı" : "Identity Card"}</h2>
              </div>
              <div className="seller-id-lines">
                <button
                  className="seller-id-line"
                  type="button"
                  onClick={() => navigator.clipboard.writeText(String(row.id ?? "")).catch(() => undefined)}
                  title={language === "tr" ? "Customer ID kopyala" : "Copy customer ID"}
                >
                  <span className="seller-id-line-text">
                    <span className="seller-id-line-label">{language === "tr" ? "Customer ID" : "Customer ID"}:</span>
                    <strong className="seller-id-line-value">{String(row.id ?? "-")}</strong>
                  </span>
                  <span aria-hidden="true">⧉</span>
                </button>
              </div>
              <div className="seller-general-kv">
                <div>
                  <span>{language === "tr" ? "Rol" : "Role"}</span>
                  <strong>{roleLabel}</strong>
                </div>
                <div>
                  <span>{language === "tr" ? "Kayıt" : "Created"}</span>
                  <strong>{formatUiDate(row.createdAt, language)}</strong>
                </div>
              </div>
              <div className="seller-general-kv" style={{ marginTop: 14 }}>
                <div>
                  <span>{language === "tr" ? "Şehir/İlçe" : "City/District"}</span>
                  <strong>{String(cityDistrictDisplay || "-")}</strong>
                </div>
                <div>
                  <span>{language === "tr" ? "Adres" : "Address"}</span>
                  <strong>{String(primaryAddress || "-")}</strong>
                </div>
              </div>
            </article>

            <article className="seller-general-card">
              <div className="seller-profile-head compact">
                <strong>{String(row.displayName ?? "-")}</strong>
                <span className="seller-inline-status">
                  <span className={`seller-status-dot ${isActive ? "is-active" : "is-disabled"}`} aria-hidden="true" />
                  {accountStatusLabel}
                </span>
              </div>
              <form className="form-grid seller-general-form" onSubmit={onSave} onKeyDown={onEnterSubmit}>
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{language === "tr" ? "Görünen Ad" : "Display Name"}</span>
                  <input name="displayName" defaultValue={String(row.displayName ?? "")} placeholder=" " disabled={!isSuperAdmin} required minLength={3} />
                </label>
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{dict.auth.email}</span>
                  <input
                    name="email"
                    type="email"
                    value={String(row.email ?? "")}
                    readOnly
                    disabled
                    placeholder=" "
                    autoComplete="off"
                  />
                </label>
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{language === "tr" ? "Ad Soyad" : "Full Name"}</span>
                  <input name="fullName" defaultValue={String(row.fullName ?? "")} placeholder=" " disabled={!isSuperAdmin} />
                </label>
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{language === "tr" ? "Telefon" : "Phone"}</span>
                  <input name="phone" defaultValue={String(row.phone ?? "")} placeholder=" " disabled={!isSuperAdmin} />
                </label>
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{language === "tr" ? "Doğum Tarihi" : "Date of Birth"}</span>
                  <input name="dob" type="date" defaultValue={String(row.dob ?? "").slice(0, 10)} placeholder=" " disabled={!isSuperAdmin} />
                </label>
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{language === "tr" ? "Ülke Kodu" : "Country Code"}</span>
                  <input name="countryCode" maxLength={3} defaultValue={String(row.countryCode ?? "")} placeholder=" " disabled={!isSuperAdmin} />
                </label>
                <input type="hidden" name="profileImageUrl" value={String(row.profileImageUrl ?? row.profile_image_url ?? "")} />
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{dict.detail.passwordOptional}</span>
                  <input name="password" type="password" placeholder=" " disabled={!isSuperAdmin} autoComplete="new-password" />
                </label>
                <div className="seller-profile-actions-grid">
                  <button
                    className="ghost seller-profile-action-btn"
                    type="button"
                    onClick={() => {
                      setIdentityViewerUrl(identityDocuments[0]?.url ?? null);
                      setIdentityViewerOpen(true);
                    }}
                  >
                    {language === "tr" ? "Kimlik Detay" : "Identity Details"}
                  </button>
                  <button className="primary seller-profile-action-btn" type="submit" disabled={!isSuperAdmin}>
                    {dict.actions.save}
                  </button>
                </div>
              </form>
              {!isSuperAdmin ? <p className="panel-meta">{dict.detail.readOnly}</p> : null}
            </article>

          </div>
        </section>
      ) : null}
      {identityViewerOpen ? (
        <div className="buyer-ops-modal-backdrop" onClick={() => setIdentityViewerOpen(false)}>
          <div ref={identityModalPrintRef} className="buyer-ops-modal seller-doc-viewer-modal print-target-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Kimlik Dosyaları</h3>
            {identityDocuments.length === 0 ? (
              <p className="panel-meta">Kimlik dosyası bulunamadı.</p>
            ) : (
              <div className="seller-doc-viewer-grid">
                <div className="seller-doc-viewer-list">
                  {identityDocuments.map((doc) => (
                    <button
                      key={doc.id}
                      className={`ghost ${doc.url === selectedIdentityDocument?.url ? "is-active" : ""}`}
                      type="button"
                      onClick={() => setIdentityViewerUrl(doc.url)}
                    >
                      {doc.label}
                    </button>
                  ))}
                </div>
                <div className="seller-doc-viewer-preview">
                  {selectedIdentityDocument ? (
                    selectedIdentityDocumentIsPdf ? (
                      <iframe src={selectedIdentityDocument.url} title={selectedIdentityDocument.label} />
                    ) : (
                      <img src={selectedIdentityDocument.url} alt={selectedIdentityDocument.label} />
                    )
                  ) : (
                    <p className="panel-meta">Görüntülenecek dosya yok.</p>
                  )}
                </div>
              </div>
            )}
            <div className="buyer-ops-modal-actions">
              {selectedIdentityDocument ? (
                <a className="ghost" href={selectedIdentityDocument.url} target="_blank" rel="noreferrer">
                  Yeni Sekmede Aç
                </a>
              ) : null}
              <PrintButton className="ghost" type="button" onClick={printIdentityDetails} language="tr" />
              <button className="primary" type="button" onClick={() => setIdentityViewerOpen(false)}>
                Kapat
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {profileModalOpen ? (
        <div
          className="buyer-ops-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={language === "tr" ? "Profil Bilgileri" : "Profile Details"}
          onClick={() => setProfileModalOpen(false)}
        >
          <div className="buyer-ops-modal buyer-ref-profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="buyer-ref-profile-modal-head">
              <div>
                <h3>{language === "tr" ? "Profil Bilgileri" : "Profile Details"}</h3>
                <p>{String(row.displayName ?? "-")}</p>
              </div>
              <button type="button" className="ghost buyer-ops-mini-btn" onClick={() => setProfileModalOpen(false)}>
                {language === "tr" ? "Kapat" : "Close"}
              </button>
            </div>
            <table className="buyer-ref-profile-table">
              <tbody>
                <tr>
                  <th>{language === "tr" ? "E-posta" : "E-mail"}</th>
                  <td>{contactEmail || "-"}</td>
                </tr>
                <tr>
                  <th>{language === "tr" ? "Adres" : "Address"}</th>
                  <td>{String(primaryAddress || "-")}</td>
                </tr>
                <tr>
                  <th>{language === "tr" ? "Cep" : "Phone"}</th>
                  <td>{contactPhone || "-"}</td>
                </tr>
                <tr>
                  <th>{language === "tr" ? "Son Güncelleme" : "Last Update"}</th>
                  <td>{formatUiDate(row.updatedAt, language)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {previewTarget ? (
        <div className="buyer-ops-modal-backdrop" onClick={closePreviewModal}>
          <div className="buyer-ops-modal seller-doc-viewer-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{language === "tr" ? "Belge Ön İzleme" : "Document Preview"}</h3>
            <div className="seller-doc-preview-meta">
              <strong>{previewTarget.title}</strong>
              <span className={`status-pill compliance-status-pill is-${previewTarget.tone}`}>
                {sellerDocumentStatusLabel(previewTarget.status, dict)}
              </span>
              {previewTarget.date ? <span className="panel-meta">{previewTarget.date}</span> : null}
            </div>
            {previewTarget.rejectionReason ? (
              <p className="panel-meta">
                <strong>{previewTarget.status === "rejected" ? dict.detail.legalRejectionReason : dict.detail.legalPendingReason}:</strong>{" "}
                {previewTarget.rejectionReason}
              </p>
            ) : null}
            <div className="seller-doc-viewer-preview seller-doc-preview-single">
              {previewTargetIsPdf ? (
                <iframe src={previewTarget.url} title={previewTarget.title} />
              ) : (
                <img src={previewTarget.url} alt={previewTarget.title} />
              )}
            </div>
            {previewAction ? (
              <>
                <label>
                  {previewAction === "reject" ? dict.detail.legalRejectionReason : dict.detail.legalPendingReason}
                  <textarea
                    value={previewActionReason}
                    onChange={(event) => setPreviewActionReason(event.target.value)}
                    rows={3}
                    autoFocus
                  />
                </label>
                <div className="buyer-ops-modal-actions">
                  <button
                    className="ghost"
                    type="button"
                    disabled={legalSaving}
                    onClick={() => { setPreviewAction(null); setPreviewActionReason(""); }}
                  >
                    {dict.common.cancel}
                  </button>
                  <button
                    className="primary"
                    type="button"
                    disabled={previewActionReason.trim().length < 3 || legalSaving}
                    onClick={() => void confirmPreviewAction()}
                  >
                    {previewAction === "reject" ? dict.detail.legalReject : dict.detail.legalPend}
                  </button>
                </div>
              </>
            ) : (
              <div className="buyer-ops-modal-actions">
                <a className="ghost" href={previewTarget.url} target="_blank" rel="noreferrer">
                  {language === "tr" ? "Yeni Sekmede Aç" : "Open in New Tab"}
                </a>
                <button className="ghost" type="button" onClick={closePreviewModal}>
                  {dict.common.cancel}
                </button>
                {!previewActionsLocked && (
                  <>
                    <button className="ghost" type="button" disabled={legalSaving} onClick={() => setPreviewAction("pending")}>
                      {dict.detail.legalPend}
                    </button>
                    <button className="ghost" type="button" disabled={legalSaving} onClick={() => setPreviewAction("reject")}>
                      {dict.detail.legalReject}
                    </button>
                    <button className="primary" type="button" disabled={legalSaving} onClick={() => void approveInPreview()}>
                      {dict.detail.legalApprove}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tempRejectTargetKey ? (
        <div
          className="buyer-ops-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={dict.detail.legalRejectModalTitle}
          onClick={cancelTempReject}
        >
          <div className="buyer-ops-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{dict.detail.legalRejectModalTitle}</h3>
            <label>
              {dict.detail.legalRejectionReason}
              <textarea value={tempRejectReason} onChange={(event) => setTempRejectReason(event.target.value)} rows={4} />
            </label>
            <div className="buyer-ops-modal-actions">
              <button className="ghost" type="button" onClick={cancelTempReject}>
                {dict.common.cancel}
              </button>
              <button
                className="primary"
                type="button"
                disabled={tempRejectReason.trim().length < 3}
                onClick={confirmTempReject}
              >
                {dict.detail.legalReject}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tempPendingTargetKey ? (
        <div
          className="buyer-ops-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={dict.detail.legalPend}
          onClick={cancelTempPending}
        >
          <div className="buyer-ops-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{dict.detail.legalPend}</h3>
            <label>
              {dict.detail.legalRejectionReason}
              <textarea value={tempPendingReason} onChange={(event) => setTempPendingReason(event.target.value)} rows={4} />
            </label>
            <div className="buyer-ops-modal-actions">
              <button className="ghost" type="button" onClick={cancelTempPending}>
                {dict.common.cancel}
              </button>
              <button
                className="primary"
                type="button"
                disabled={tempPendingReason.trim().length < 3}
                onClick={confirmTempPending}
              >
                {dict.detail.legalPend}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "identity" ? (
        <section className="panel seller-identity-compliance">
            <input
              ref={complianceUploadInputRef}
              type="file"
              accept="image/*,.pdf"
              hidden
              onChange={handleComplianceFileChange}
            />
            <div className="seller-compliance-header">
              <div className="seller-compliance-title">
                <span className="seller-compliance-flag" aria-hidden="true">🇹🇷</span>
                <h2>{dict.detail.trCompliance}</h2>
              </div>
              <span className={`status-pill compliance-status-pill is-${profileBadge.tone}`}>{profileBadge.label}</span>
            </div>
            <div className="seller-compliance-list">
              {displayLegalRows.map((item) => (
                <article className="seller-compliance-row" key={`identity-${item.key}`}>
                  <span className={`compliance-icon is-${item.tone}`} aria-hidden="true" />
                  <div>
                    <strong>{item.label}</strong>
                    <p className="panel-meta">{item.detailText}</p>
                    {item.sourceRejectionReason ? (
                      <p className="panel-meta legal-doc-note">
                        {item.sourceDocumentStatus === "rejected"
                          ? dict.detail.legalRejectionReason
                          : dict.detail.legalPendingReason}
                        {": "}
                        {item.sourceRejectionReason}
                      </p>
                    ) : null}
                  </div>
                  <div className="legal-doc-actions">
                    <button
                      className="ghost compliance-edit-btn"
                      type="button"
                      disabled={!isSuperAdmin || legalSavingKey === `upload:${item.key}`}
                      onClick={() => triggerComplianceUpload(item.key)}
                    >
                      {language === "tr" ? "Yükle" : "Upload"}
                    </button>
                    <button
                      className="ghost compliance-edit-btn compliance-preview-btn"
                      type="button"
                      disabled={!item.sourceFileUrl}
                      onClick={() => openCompliancePreview(item)}
                    >
                      <span className="compliance-preview-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" role="presentation">
                          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" strokeWidth="1.8" />
                          <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
                        </svg>
                      </span>
                      <span>{language === "tr" ? "Ön İzle" : "Preview"}</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          {!isSuperAdmin ? <p className="panel-meta">{dict.detail.readOnly}</p> : null}
        </section>
      ) : null}

      {activeTab === "legal" ? (
        <section className="panel">
          <article className="seller-compliance-card">
            <div className="seller-compliance-header">
              <div className="seller-compliance-title">
                <span className="seller-compliance-flag" aria-hidden="true">🇹🇷</span>
                <h2>{dict.detail.trCompliance}</h2>
              </div>
              <span className={`status-pill compliance-status-pill is-${profileBadge.tone}`}>{profileBadge.label}</span>
            </div>
            {compliance?.profile.review_notes ? <div className="panel-note">{compliance.profile.review_notes}</div> : null}
            <div className="seller-compliance-list">
              <h3>{dict.detail.legalDocumentTypesTitle}</h3>
              {legalTypeRows.length === 0 ? (
                <p className="panel-meta">{dict.detail.noComplianceData}</p>
              ) : (
                <div className="buyer-ops-table-wrap legal-docs-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{dict.detail.legalDocType}</th>
                        <th>{dict.detail.legalRequired}</th>
                        <th>{dict.detail.legalStatus}</th>
                        <th>{dict.detail.updatedAtLabel}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {legalTypeRows.map((row) => {
                        const tone = sellerDocumentStatusTone(row.status);
                        return (
                          <tr key={`dtype-${row.code}`}>
                            <td>
                              <strong>{row.name}</strong>
                              <div className="panel-meta legal-doc-sub">{row.code}</div>
                            </td>
                            <td>
                              <label className="legal-required-toggle">
                                <input
                                  type="checkbox"
                                  checked={row.is_required}
                                  disabled={!isSuperAdmin || isSavingDocType(row.code)}
                                  onChange={(event) => {
                                    void updateDocumentRequired(row.code, event.target.checked);
                                  }}
                                />
                                <span>{row.is_required ? dict.common.yes : dict.common.no}</span>
                              </label>
                            </td>
                            <td><span className={`status-pill compliance-status-pill is-${tone}`}>{sellerDocumentStatusLabel(row.status, dict)}</span></td>
                            <td>{formatTableDateTime(row.updated_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="seller-compliance-list legal-doc-history-block">
              <h3>{dict.detail.legalDocumentHistoryTitle}</h3>
              {legalDocuments.length === 0 ? (
                <p className="panel-meta">{dict.detail.noComplianceData}</p>
              ) : (
                <div className="buyer-ops-table-wrap legal-docs-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{dict.detail.legalUploadedAt}</th>
                        <th>{dict.detail.legalDocType}</th>
                        <th>{dict.detail.legalVersion}</th>
                        <th>{dict.detail.legalFile}</th>
                        <th>{dict.detail.legalStatus}</th>
                        <th>{dict.detail.legalExpiresAt}</th>
                        <th>{dict.detail.legalReviewedAt}</th>
                        <th>{dict.detail.legalNote}</th>
                        <th>{dict.detail.legalActions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {legalDocuments.map((row) => {
                        const tone = sellerDocumentStatusTone(row.status);
                        return (
                          <tr key={row.id}>
                            <td>{formatTableDateTime(row.uploaded_at)}</td>
                            <td>
                              <strong>{row.name}</strong>
                              <div className="panel-meta legal-doc-sub">{row.code}</div>
                            </td>
                            <td>
                              {`v${row.version}`}
                              {!row.is_current ? <div className="panel-meta">{dict.detail.legalHistorical}</div> : null}
                            </td>
                            <td>
                              {row.file_url ? (
                                <a href={row.file_url} target="_blank" rel="noreferrer" className="inline-copy">{dict.detail.legalOpenFile}</a>
                              ) : (
                                <span className="panel-meta">-</span>
                              )}
                            </td>
                            <td><span className={`status-pill compliance-status-pill is-${tone}`}>{sellerDocumentStatusLabel(row.status, dict)}</span></td>
                            <td>{formatTableDateTime(row.expires_at)}</td>
                            <td>{formatTableDateTime(row.reviewed_at)}</td>
                            <td>{row.rejection_reason ?? "-"}</td>
                            <td>
                              <div className="legal-doc-actions">
                                {row.file_url ? (
                                  <button
                                    className="ghost compliance-edit-btn compliance-preview-btn"
                                    type="button"
                                    onClick={() => openDocumentPreview(row.id, row.file_url!, row.name, row.status, sellerDocumentStatusTone(row.status), false, undefined, row.rejection_reason, formatTableDateTime(row.reviewed_at ?? row.uploaded_at))}
                                  >
                                    <span>{language === "tr" ? "Ön İzle" : "Preview"}</span>
                                  </button>
                                ) : null}
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!row.is_current || isSavingDoc(row.id) || row.status === "approved" || row.status === "rejected"}
                                  onClick={() => void updateDocumentStatus(row.id, "approved")}
                                >
                                  {dict.detail.legalApprove}
                                </button>
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!row.is_current || isSavingDoc(row.id) || row.status === "approved" || row.status === "rejected"}
                                  onClick={() => {
                                    if (row.file_url) {
                                      openDocumentPreview(row.id, row.file_url, row.name, row.status, sellerDocumentStatusTone(row.status), false, "reject", row.rejection_reason, formatTableDateTime(row.reviewed_at ?? row.uploaded_at));
                                    }
                                  }}
                                >
                                  {dict.detail.legalReject}
                                </button>
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!row.is_current || isSavingDoc(row.id) || row.status === "approved" || row.status === "rejected"}
                                  onClick={() => {
                                    if (row.file_url) {
                                      openDocumentPreview(row.id, row.file_url, row.name, row.status, sellerDocumentStatusTone(row.status), false, "pending", row.rejection_reason, formatTableDateTime(row.reviewed_at ?? row.uploaded_at));
                                    }
                                  }}
                                >
                                  {dict.detail.legalPend}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="seller-compliance-list legal-doc-history-block">
              <h3>{dict.detail.optionalUploadsTitle}</h3>
              {optionalUploads.length === 0 ? (
                <p className="panel-meta">{dict.detail.noComplianceData}</p>
              ) : (
                <div className="buyer-ops-table-wrap legal-docs-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{dict.detail.legalUploadedAt}</th>
                        <th>{dict.detail.optionalTitle}</th>
                        <th>{dict.detail.legalFile}</th>
                        <th>{dict.detail.legalStatus}</th>
                        <th>{dict.detail.legalReviewedAt}</th>
                        <th>{dict.detail.legalNote}</th>
                        <th>{dict.detail.legalActions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optionalUploads.map((row) => {
                        const tone = optionalUploadStatusTone(row.status);
                        const title = row.catalog_doc_name ?? row.custom_title ?? row.catalog_doc_code ?? "-";
                        return (
                          <tr key={`optional-${row.id}`}>
                            <td>{formatTableDateTime(row.created_at)}</td>
                            <td>
                              <strong>{title}</strong>
                              {row.custom_description ? <div className="panel-meta legal-doc-sub">{row.custom_description}</div> : null}
                            </td>
                            <td>
                              <a href={row.file_url} target="_blank" rel="noreferrer" className="inline-copy">{dict.detail.legalOpenFile}</a>
                            </td>
                            <td><span className={`status-pill compliance-status-pill is-${tone}`}>{optionalUploadStatusLabel(row.status, dict)}</span></td>
                            <td>{formatTableDateTime(row.reviewed_at)}</td>
                            <td>{row.rejection_reason ?? "-"}</td>
                            <td>
                              <div className="legal-doc-actions">
                                {row.file_url && row.status !== "archived" ? (
                                  <button
                                    className="ghost compliance-edit-btn compliance-preview-btn"
                                    type="button"
                                    onClick={() => openDocumentPreview(row.id, row.file_url!, title, row.status as SellerComplianceDocumentStatus, tone, true, undefined, row.rejection_reason, formatTableDateTime(row.reviewed_at ?? row.created_at))}
                                  >
                                    <span>{language === "tr" ? "Ön İzle" : "Preview"}</span>
                                  </button>
                                ) : null}
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={isSavingOptional(row.id) || row.status === "archived" || row.status === "approved" || row.status === "rejected"}
                                  onClick={() => void updateOptionalUploadStatus(row.id, "approved")}
                                >
                                  {dict.detail.legalApprove}
                                </button>
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={isSavingOptional(row.id) || row.status === "archived" || row.status === "approved" || row.status === "rejected"}
                                  onClick={() => {
                                    if (row.file_url) {
                                      openDocumentPreview(row.id, row.file_url, title, row.status as SellerComplianceDocumentStatus, tone, true, "reject", row.rejection_reason, formatTableDateTime(row.reviewed_at ?? row.created_at));
                                    }
                                  }}
                                >
                                  {dict.detail.legalReject}
                                </button>
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={isSavingOptional(row.id) || row.status === "archived" || row.status === "approved" || row.status === "rejected"}
                                  onClick={() => {
                                    if (row.file_url) {
                                      openDocumentPreview(row.id, row.file_url, title, row.status as SellerComplianceDocumentStatus, tone, true, "pending", row.rejection_reason, formatTableDateTime(row.reviewed_at ?? row.created_at));
                                    }
                                  }}
                                >
                                  {dict.detail.legalPend}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </article>
        </section>
      ) : null}

      {activeTab === "foods" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.sellerTabs.foods}</h2>
          </div>
          <p className="panel-meta">{`${dict.detail.totalFoods}: ${totalFoods}`}</p>
          {lotsError ? <div className="alert">{lotsError}</div> : null}
          {foodRows.length === 0 ? (
            <p className="panel-meta">{dict.common.noRecords}</p>
          ) : (
            <div className="table-wrap">
              <table className="foods-lots-main-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={foodRows.length > 0 && foodRows.every((food) => selectedFoodIds.includes(food.id))}
                        aria-label={language === "tr" ? "Tum yemekleri sec" : "Select all foods"}
                        onChange={(event) => {
                          setSelectedFoodIds(event.target.checked ? foodRows.map((food) => food.id) : []);
                        }}
                      />
                    </th>
                    <th>{dict.detail.lotActions}</th>
                    <th>{dict.detail.foodName}</th>
                    <th>{language === "tr" ? "Kategori" : "Category"}</th>
                    <th>{language === "tr" ? "Mutfak" : "Cuisine"}</th>
                    <th>{dict.detail.foodStatus}</th>
                    <th>{dict.detail.foodPrice}</th>
                    <th>{dict.detail.updatedAtLabel}</th>
                    <th>{dict.detail.lotSummary}</th>
                  </tr>
                </thead>
                <tbody>
                  {foodRows.map((food) => {
                    const isActiveFood = food.status === "active";
                    const foodLots = lotsByFoodId[food.id] ?? [];
                    const activeLots = Number(food.activeLotCount ?? foodLots.filter((lot) => lot.lifecycle_status === "on_sale").length);
                    const onSaleQuantity = Number(food.onSaleQuantity ?? 0);
                    const recalledLots = foodLots.filter((lot) => lot.lifecycle_status === "recalled").length;
                    const foodExpanded = Boolean(expandedFoodIds[food.id]);
                    const metadata = foodMetadataByName(food.name);
                    const ingredientsText = sanitizeSeedText(resolveFoodIngredients(food.ingredients, food.recipe, metadata?.ingredients ?? null, language)) ?? "";
                    const ingredientItems = splitFoodItems(ingredientsText);
                    const lowerIngredients = ingredientItems.map((item) => item.toLocaleLowerCase("tr-TR"));
                    const spices = ingredientItems.filter((item, index) => spiceHints.some((hint) => lowerIngredients[index].includes(hint)));
                    const allergens = Array.isArray(food.allergens) ? food.allergens.filter((item) => String(item ?? "").trim()) : [];
                    return (
                      <Fragment key={food.id}>
                        <tr
                          data-food-row-id={food.id}
                          className={[
                            "foods-main-row",
                            foodExpanded ? "is-expanded" : "",
                            hasExpandedFood && !foodExpanded ? "is-background-muted" : "",
                            flashFoodId === food.id ? "search-focus-flash" : "",
                            pinnedFoodId === food.id ? "search-focus-pinned" : "",
                          ].filter(Boolean).join(" ") || undefined}
                          onClick={() => openFoodDetailPage(food.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openFoodDetailPage(food.id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedFoodIds.includes(food.id)}
                              aria-label={language === "tr" ? "Yemegi sec" : "Select food"}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                setSelectedFoodIds((prev) => (
                                  event.target.checked ? [...new Set([...prev, food.id])] : prev.filter((id) => id !== food.id)
                                ));
                              }}
                            />
                          </td>
                          <td>
                            <button
                              className="ghost foods-toggle-btn"
                              type="button"
                              aria-label={foodExpanded ? dict.detail.hideLots : dict.detail.showLots}
                              onClick={(event) => {
                                event.stopPropagation();
                                setExpandedFoodIds((prev) => ({ ...prev, [food.id]: !prev[food.id] }));
                              }}
                            >
                              {foodExpanded ? "−" : "+"}
                            </button>
                          </td>
                          <td>
                            <strong>{`${food.name} (${food.code || "-"})`}</strong>
                            {Array.isArray(food.menuItems) && food.menuItems.length > 0 ? (
                              <div className="panel-meta">{`${language === "tr" ? "İçindekiler" : "Items"}: ${food.menuItems.map((item) => item.name).join(", ")}`}</div>
                            ) : null}
                          </td>
                          <td>{food.categoryName ?? <span className="panel-meta">-</span>}</td>
                          <td>{food.cuisine ?? <span className="panel-meta">-</span>}</td>
                          <td>
                            <span className={`status-pill ${isActiveFood ? "is-active" : "is-disabled"}`}>
                              {isActiveFood ? dict.common.active : dict.common.disabled}
                            </span>
                          </td>
                          <td>{formatCurrency(food.price, language)}</td>
                          <td>{formatTableDateTime(food.updatedAt)}</td>
                          <td>
                            <div className="lot-summary-cell">
                              <span>{`${dict.detail.lotsTitle}: ${foodLots.length}`}</span>
                              <span>{`${language === "tr" ? "Satışta" : "On Sale"}: ${activeLots}`}</span>
                              <span>{`${language === "tr" ? "Satışta Stok" : "On-Sale Stock"}: ${onSaleQuantity}`}</span>
                              {recalledLots > 0 ? <span className="lot-summary-danger">{`${language === "tr" ? "Geri çağrılan" : "Recalled"}: ${recalledLots}`}</span> : null}
                            </div>
                          </td>
                        </tr>
                        {foodExpanded ? (
                          <tr className="foods-lots-expanded-row">
                            <td colSpan={9}>
                              {lotsLoading ? (
                                <p className="panel-meta">{dict.common.loading}</p>
                              ) : foodLots.length === 0 ? (
                                <p className="panel-meta">{dict.detail.noLotsForFood}</p>
                              ) : (
                                <div className="seller-food-lots-table-wrap">
                                  <table className="seller-food-lots-table">
                                    <thead>
                                      <tr>
                                        <th>{dict.detail.lotNumber}</th>
                                        <th>{dict.detail.lotLifecycle}</th>
                                        <th>{dict.detail.lotQuantity}</th>
                                        <th>{dict.detail.lotProducedAt}</th>
                                        <th>{dict.detail.lotSaleWindow}</th>
                                        <th>{language === "tr" ? "Fark" : "Diff"}</th>
                                        <th>{dict.detail.lotActions}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {foodLots.map((lot) => {
                                        const diff = computeFoodLotDiff({
                                          foodRecipe: food.recipe ?? null,
                                          foodIngredients: food.ingredients ?? null,
                                          foodAllergens: food.allergens ?? null,
                                          lot,
                                        });
                                        return (
                                          <tr
                                            key={lot.id}
                                            data-lot-row-id={lot.id}
                                            className={[
                                              flashLotId === lot.id ? "search-focus-flash" : "",
                                              pinnedLotId === lot.id ? "search-focus-pinned" : "",
                                            ].filter(Boolean).join(" ") || undefined}
                                          >
                                            <td>{lot.lot_number}</td>
                                            <td>
                                              <span className={`status-pill ${lotLifecycleClass(lot.lifecycle_status)}`}>
                                                {lotLifecycleLabel(lot.lifecycle_status, language)}
                                              </span>
                                            </td>
                                            <td>{`${lot.quantity_available}/${lot.quantity_produced}`}</td>
                                            <td>{formatTableDateTime(lot.produced_at)}</td>
                                            <td>{`${formatTableDateTime(lot.sale_starts_at)} – ${formatTableDateTime(lot.sale_ends_at)}`}</td>
                                            <td>
                                              {diff.hasMissingSnapshot || diff.recipeChanged || diff.ingredientsChanged || diff.allergensChanged ? (
                                                <div className="lot-diff-badges">
                                                  {diff.hasMissingSnapshot && <span className="status-pill is-neutral">{dict.detail.lotSnapshotMissing}</span>}
                                                  {diff.recipeChanged && <span className="status-pill is-warning">{dict.detail.lotDiffRecipe}</span>}
                                                  {diff.ingredientsChanged && <span className="status-pill is-warning">{dict.detail.lotDiffIngredients}</span>}
                                                  {diff.allergensChanged && <span className="status-pill is-danger">{dict.detail.lotDiffAllergens}</span>}
                                                </div>
                                              ) : (
                                                <span className="status-pill is-active">{dict.detail.lotSnapshotOk}</span>
                                              )}
                                            </td>
                                            <td>
                                              <button
                                                className="ghost"
                                                type="button"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  openFoodDetailPage(food.id, lot.id);
                                                }}
                                              >
                                                {language === "tr" ? "Detay" : "Detail"}
                                              </button>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "orders" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.sellerTabs.orders}</h2>
          </div>
          <div className="seller-detail-filter-row">
            <label className="ghost seller-detail-filter-item">
              <span>{language === "tr" ? "Durum" : "Status"}</span>
              <select value={ordersStatusFilter} onChange={(event) => setOrdersStatusFilter(event.target.value)}>
                <option value="all">{language === "tr" ? "Hepsi" : "All"}</option>
                <option value="pending">{language === "tr" ? "Bekliyor" : "Pending"}</option>
                <option value="confirmed">{language === "tr" ? "Onaylandı" : "Confirmed"}</option>
                <option value="delivered">{language === "tr" ? "Teslim Edildi" : "Delivered"}</option>
                <option value="cancelled">{language === "tr" ? "İptal" : "Cancelled"}</option>
              </select>
            </label>
            <label className="ghost seller-detail-filter-item">
              <span>{language === "tr" ? "Ödeme" : "Payment"}</span>
              <select value={ordersPaymentFilter} onChange={(event) => setOrdersPaymentFilter(event.target.value as typeof ordersPaymentFilter)}>
                <option value="all">{language === "tr" ? "Hepsi" : "All"}</option>
                <option value="successful">{language === "tr" ? "Başarılı" : "Successful"}</option>
                <option value="pending">{language === "tr" ? "Bekliyor" : "Pending"}</option>
                <option value="failed">{language === "tr" ? "Başarısız" : "Failed"}</option>
              </select>
            </label>
            <label className="ghost seller-detail-filter-item seller-detail-filter-search">
              <span>{language === "tr" ? "Ara" : "Search"}</span>
              <input
                value={ordersSearch}
                onChange={(event) => setOrdersSearch(event.target.value)}
              />
            </label>
          </div>
          {filteredSellerOrders.length === 0 ? (
            <p className="panel-meta">{dict.common.noRecords}</p>
          ) : (
            <>
              <div className="buyer-ops-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={allFilteredOrdersSelected}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelectedOrderIds(filteredSellerOrders.map((order) => order.orderId));
                            } else {
                              setSelectedOrderIds([]);
                            }
                          }}
                          aria-label={language === "tr" ? "Tum siparisleri sec" : "Select all orders"}
                        />
                      </th>
                      <th>Tarih / Saat</th>
                      <th>Sipariş No</th>
                      <th>Alıcı</th>
                      <th>{language === "tr" ? "Plan" : "Plan"}</th>
                      <th>Yemekler</th>
                      <th>Tutar</th>
                      <th>Ödeme</th>
                      <th>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSellerOrders.map((order) => {
                      const paymentText = paymentStateText(order.paymentStatus);
                      const deliveryText = deliveryTypeText(order.activeDeliveryType ?? order.requestedDeliveryType ?? order.deliveryType);
                      const decisionText = sellerDecisionStateLabel(order.sellerDecisionState);
                      const statusText = orderStatusLabel(order.status, order.activeDeliveryType ?? order.requestedDeliveryType ?? order.deliveryType);
                      const foods = Array.isArray(order.items)
                        ? order.items.map((item) => `${String(item.name ?? "-")} x${Number(item.quantity ?? 0)}`).join(", ")
                        : "-";
                      return (
                        <tr key={order.orderId}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedOrderIds.includes(order.orderId)}
                              onChange={(event) => {
                                setSelectedOrderIds((prev) => {
                                  if (event.target.checked) return [...new Set([...prev, order.orderId])];
                                  return prev.filter((id) => id !== order.orderId);
                                });
                              }}
                              aria-label={language === "tr" ? "Siparisi sec" : "Select order"}
                            />
                          </td>
                          <td>{formatTableDateTime(order.createdAt)}</td>
                          <td>
                            <Link className="inline-copy" to={orderDetailPath(order.orderId)}>
                              {order.orderNo}
                            </Link>
                          </td>
                          <td>
                            {order.buyerId ? (
                              <Link className="inline-copy" to={`/app/buyers/${order.buyerId}`}>
                                {order.buyerName ?? order.buyerEmail ?? order.buyerId}
                              </Link>
                            ) : (order.buyerName ?? order.buyerEmail ?? "-")}
                          </td>
                          <td>
                            <div className="buyer-login-cell">
                              <strong>{deliveryText}</strong>
                              <small>{`${decisionText}${order.sellerPromisedAt ? ` • ${formatTableDateTime(order.sellerPromisedAt)}` : ""}`}</small>
                            </div>
                          </td>
                          <td>{foods || "-"}</td>
                          <td>{formatCurrency(Number(order.totalAmount ?? 0), language)}</td>
                          <td>{paymentText}</td>
                          <td>{statusText}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="panel-meta">
                {`${filteredSellerOrders.length} ${language === "tr" ? "sipariş" : "orders"} • ${selectedFilteredOrders.length} ${language === "tr" ? "seçili" : "selected"}`}
              </p>
            </>
          )}
        </section>
      ) : null}

      {activeTab === "wallet" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.sellerTabs.wallet}</h2>
          </div>
          <div className="seller-detail-filter-row">
            <label className="ghost seller-detail-filter-item">
              <span>{language === "tr" ? "Dönem" : "Period"}</span>
              <select value={earningsDateFilter} onChange={(event) => setEarningsDateFilter(event.target.value as typeof earningsDateFilter)}>
                <option value="all">{language === "tr" ? "Tüm Zamanlar" : "All Time"}</option>
                <option value="last7">{language === "tr" ? "Son 7 Gün" : "Last 7 Days"}</option>
                <option value="last30">{language === "tr" ? "Son 30 Gün" : "Last 30 Days"}</option>
                <option value="custom">{language === "tr" ? "Tarih Seç" : "Pick Date"}</option>
              </select>
            </label>
            {earningsDateFilter === "custom" ? (
              <label className="ghost seller-detail-filter-item">
                <span>{language === "tr" ? "Tarih" : "Date"}</span>
                <input
                  type="date"
                  value={earningsSelectedDate}
                  onChange={(event) => setEarningsSelectedDate(event.target.value)}
                  aria-label={language === "tr" ? "Tarih seç" : "Select date"}
                />
              </label>
            ) : null}
            <label className="ghost seller-detail-filter-item">
              <span>{language === "tr" ? "Ödeme" : "Payment"}</span>
              <select value={earningsPaymentFilter} onChange={(event) => setEarningsPaymentFilter(event.target.value as typeof earningsPaymentFilter)}>
                <option value="all">{language === "tr" ? "Hepsi" : "All"}</option>
                <option value="successful">{language === "tr" ? "Başarılı" : "Successful"}</option>
                <option value="pending">{language === "tr" ? "Bekliyor" : "Pending"}</option>
                <option value="failed">{language === "tr" ? "Başarısız" : "Failed"}</option>
              </select>
            </label>
            <label className="ghost seller-detail-filter-item seller-detail-filter-search">
              <span>{language === "tr" ? "Ara" : "Search"}</span>
              <input
                value={earningsSearch}
                onChange={(event) => setEarningsSearch(event.target.value)}
              />
            </label>
          </div>
          {filteredSellerEarnings.length === 0 ? (
            <p className="panel-meta">{dict.common.noRecords}</p>
          ) : (
            <>
              <div className="buyer-ops-table-wrap seller-wallet-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={allFilteredEarningsSelected}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelectedEarningIds(filteredSellerEarnings.map((order) => order.orderId));
                            } else {
                              setSelectedEarningIds([]);
                            }
                          }}
                          aria-label={language === "tr" ? "Tum kazanc kayitlarini sec" : "Select all earnings"}
                        />
                      </th>
                      <th>{language === "tr" ? "Tarih / Saat" : "Date / Time"}</th>
                      <th>{language === "tr" ? "Sipariş No" : "Order No"}</th>
                      <th>{language === "tr" ? "Alıcı" : "Buyer"}</th>
                      <th>{language === "tr" ? "İşlem Ref" : "Transaction Ref"}</th>
                      <th>{language === "tr" ? "Oturum No" : "Session No"}</th>
                      <th>{language === "tr" ? "Ödeme" : "Payment"}</th>
                      <th>{language === "tr" ? "Kazanç" : "Earning"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSellerEarnings.map((order) => (
                      <tr key={`earning-${order.orderId}`}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedEarningIds.includes(order.orderId)}
                            onChange={(event) => {
                              setSelectedEarningIds((prev) => {
                                if (event.target.checked) return [...new Set([...prev, order.orderId])];
                                return prev.filter((id) => id !== order.orderId);
                              });
                            }}
                            aria-label={language === "tr" ? "Kazanc kaydini sec" : "Select earning"}
                          />
                        </td>
                        <td>{formatTableDateTime(order.createdAt)}</td>
                        <td>
                          <Link className="inline-copy" to={orderDetailPath(order.orderId)}>
                            {order.orderNo}
                          </Link>
                        </td>
                        <td>
                          {order.buyerId ? (
                            <Link className="inline-copy" to={`/app/buyers/${order.buyerId}`}>
                              {order.buyerName ?? order.buyerEmail ?? order.buyerId}
                            </Link>
                          ) : (order.buyerName ?? order.buyerEmail ?? "-")}
                        </td>
                        <td>{renderWalletSearchHighlight(order.paymentProviderReferenceId)}</td>
                        <td>{renderWalletSearchHighlight(order.paymentProviderSessionId)}</td>
                        <td>{paymentStateText(order.paymentStatus)}</td>
                        <td>{formatCurrency(Number(order.totalAmount ?? 0), language)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="panel-meta">{`${filteredSellerEarnings.length} ${language === "tr" ? "kayıt" : "records"} • ${selectedFilteredEarnings.length} ${language === "tr" ? "seçili" : "selected"}`}</p>
            </>
          )}
        </section>
      ) : null}

      {activeTab === "reviews" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.sellerTabs.reviews}</h2>
            {reviewsTotalCount > 0 ? <span className="panel-meta">({reviewsTotalCount})</span> : null}
          </div>
          <div className="seller-detail-filter-row">
            <label className="ghost seller-detail-filter-item">
              <span>{language === "tr" ? "Yıldız" : "Stars"}</span>
              <select value={reviewRatingFilter} onChange={(event) => { setReviewRatingFilter(event.target.value as typeof reviewRatingFilter); setReviewsPage(1); }}>
                <option value="all">{language === "tr" ? "Hepsi" : "All"}</option>
                <option value="5">★★★★★ (5)</option>
                <option value="4">★★★★☆ (4)</option>
                <option value="3">★★★☆☆ (3)</option>
                <option value="2">★★☆☆☆ (2)</option>
                <option value="1">★☆☆☆☆ (1)</option>
              </select>
            </label>
            <label className="ghost seller-detail-filter-item">
              <span>{language === "tr" ? "Sıralama" : "Sort"}</span>
              <select value={reviewSortDir} onChange={(event) => { setReviewSortDir(event.target.value as "asc" | "desc"); setReviewsPage(1); }}>
                <option value="desc">{language === "tr" ? "En Yeni" : "Newest"}</option>
                <option value="asc">{language === "tr" ? "En Eski" : "Oldest"}</option>
              </select>
            </label>
          </div>
          {reviewsLoading ? (
            <p className="panel-meta">{dict.common.loading}</p>
          ) : reviewRows.length === 0 ? (
            <p className="panel-meta">{dict.common.noRecords}</p>
          ) : (
            <>
              <div className="buyer-ops-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{language === "tr" ? "Tarih" : "Date"}</th>
                      <th>{language === "tr" ? "Alıcı" : "Buyer"}</th>
                      <th>{language === "tr" ? "Yemek" : "Food"}</th>
                      <th>{language === "tr" ? "Puan" : "Rating"}</th>
                      <th>{language === "tr" ? "Yorum" : "Comment"}</th>
                      <th>{language === "tr" ? "Doğrulanmış" : "Verified"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewRows.map((item) => (
                      <tr key={item.id}>
                        <td>{formatTableDateTime(item.createdAt)}</td>
                        <td>{item.buyerName ?? <span className="panel-meta">-</span>}</td>
                        <td>{item.foodName}</td>
                        <td>
                          <span className="review-stars">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <span key={i} className={i < item.rating ? "review-star is-filled" : "review-star"}>{i < item.rating ? "★" : "☆"}</span>
                            ))}
                            <span className="review-star-count">{item.rating.toFixed(1)}</span>
                          </span>
                        </td>
                        <td>{item.comment ?? <span className="panel-meta">-</span>}</td>
                        <td>{item.isVerifiedPurchase ? (language === "tr" ? "✓ Evet" : "✓ Yes") : <span className="panel-meta">-</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {reviewsTotalPages > 1 ? (
                <div className="seller-detail-filter-row" style={{ marginTop: 12 }}>
                  <button className="ghost" type="button" disabled={reviewsPage <= 1} onClick={() => setReviewsPage((p) => p - 1)}>
                    {language === "tr" ? "← Önceki" : "← Prev"}
                  </button>
                  <span className="panel-meta">{reviewsPage} / {reviewsTotalPages}</span>
                  <button className="ghost" type="button" disabled={reviewsPage >= reviewsTotalPages} onClick={() => setReviewsPage((p) => p + 1)}>
                    {language === "tr" ? "Sonraki →" : "Next →"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {activeTab === "complaints" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.sellerTabs.complaints}</h2>
            {complaintsTotalCount > 0 ? <span className="panel-meta">({complaintsTotalCount})</span> : null}
          </div>
          <div className="seller-detail-filter-row">
            <label className="ghost seller-detail-filter-item">
              <span>{language === "tr" ? "Durum" : "Status"}</span>
              <select value={complaintsStatusFilter} onChange={(event) => { setComplaintsStatusFilter(event.target.value as typeof complaintsStatusFilter); setComplaintsPage(1); }}>
                <option value="all">{language === "tr" ? "Hepsi" : "All"}</option>
                <option value="open">{language === "tr" ? "Açık" : "Open"}</option>
                <option value="in_review">{language === "tr" ? "İncelemede" : "In Review"}</option>
                <option value="resolved">{language === "tr" ? "Çözüldü" : "Resolved"}</option>
                <option value="closed">{language === "tr" ? "Kapalı" : "Closed"}</option>
              </select>
            </label>
            <label className="ghost seller-detail-filter-item">
              <span>{language === "tr" ? "Sıralama" : "Sort"}</span>
              <select value={complaintsSortDir} onChange={(event) => { setComplaintsSortDir(event.target.value as "asc" | "desc"); setComplaintsPage(1); }}>
                <option value="desc">{language === "tr" ? "En Yeni" : "Newest"}</option>
                <option value="asc">{language === "tr" ? "En Eski" : "Oldest"}</option>
              </select>
            </label>
          </div>
          {complaintsLoading ? (
            <p className="panel-meta">{dict.common.loading}</p>
          ) : complaintRows.length === 0 ? (
            <p className="panel-meta">{dict.common.noRecords}</p>
          ) : (
            <>
              <div className="buyer-ops-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{language === "tr" ? "Tarih" : "Date"}</th>
                      <th>{language === "tr" ? "Sipariş" : "Order"}</th>
                      <th>{language === "tr" ? "Şikayet Eden" : "Complainant"}</th>
                      <th>{language === "tr" ? "Kategori" : "Category"}</th>
                      <th>{language === "tr" ? "Öncelik" : "Priority"}</th>
                      <th>{language === "tr" ? "Durum" : "Status"}</th>
                      <th>{language === "tr" ? "Malzemeler / Baharatlar" : "Ingredients / Spices"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {complaintRows.map((item) => {
                      const priorityLabel: Record<string, string> = language === "tr"
                        ? { low: "Düşük", medium: "Orta", high: "Yüksek", urgent: "Acil" }
                        : { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
                      const statusLabel: Record<string, string> = language === "tr"
                        ? { open: "Açık", in_review: "İncelemede", resolved: "Çözüldü", closed: "Kapalı" }
                        : { open: "Open", in_review: "In Review", resolved: "Resolved", closed: "Closed" };
                      const statusTone: Record<string, string> = {
                        open: "is-danger",
                        in_review: "is-warning",
                        resolved: "is-success",
                        closed: "is-neutral",
                      };
                      return (
                        <tr
                          key={item.id}
                          className="investigation-click-row"
                          onClick={() => setSelectedComplaintId(item.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedComplaintId(item.id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <td>{formatTableDateTime(item.createdAt)}</td>
                          <td>{item.orderNo}</td>
                          <td>{item.complainantName ?? <span className="panel-meta">-</span>}</td>
                          <td>{item.categoryName ?? <span className="panel-meta">-</span>}</td>
                          <td>{priorityLabel[item.priority] ?? item.priority}</td>
                          <td><span className={`status-pill ${statusTone[item.status] ?? ""}`}>{statusLabel[item.status] ?? item.status}</span></td>
                          <td style={{ maxWidth: 280, whiteSpace: "normal" }}>{item.description ?? <span className="panel-meta">-</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {complaintsTotalPages > 1 ? (
                <div className="seller-detail-filter-row" style={{ marginTop: 12 }}>
                  <button className="ghost" type="button" disabled={complaintsPage <= 1} onClick={() => setComplaintsPage((p) => p - 1)}>
                    {language === "tr" ? "← Önceki" : "← Prev"}
                  </button>
                  <span className="panel-meta">{complaintsPage} / {complaintsTotalPages}</span>
                  <button className="ghost" type="button" disabled={complaintsPage >= complaintsTotalPages} onClick={() => setComplaintsPage((p) => p + 1)}>
                    {language === "tr" ? "Sonraki →" : "Next →"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {activeTab === "security" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.sellerTabs.security}</h2>
          </div>
          <p className="panel-meta">{dict.detail.sectionPlanned}</p>
        </section>
      ) : null}

      {selectedComplaintId ? (
        <div
          className="buyer-ops-modal-backdrop complaint-detail-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedComplaintId(null)}
        >
          <div
            className="buyer-ops-modal complaint-detail-modal-shell"
            onClick={(event) => event.stopPropagation()}
          >
            <InvestigationComplaintDetailPage
              language={language}
              complaintId={selectedComplaintId}
              onClose={() => setSelectedComplaintId(null)}
            />
          </div>
        </div>
      ) : null}

      {activeTab === "notes" ? (
        <NotesPanel
          noteItems={noteItems}
          tagItems={tagItems}
          language={language}
          onAddNote={handleAddNote}
          onSaveNote={handleSaveNote}
          onAddTag={handleAddTag}
          onDeleteTag={handleDeleteTag}
        />
      ) : null}

      {activeTab === "raw" ? (
        <section className="panel">
          <section className="seller-json-card">
            <div className="seller-json-header">
              <h2>{dict.detail.accountJson}</h2>
              <button
                className="ghost seller-json-copy"
                type="button"
                onClick={() => navigator.clipboard.writeText(JSON.stringify(sellerRawPayload, null, 2)).catch(() => undefined)}
              >
                {dict.detail.copyJson}
              </button>
            </div>
            <pre className="json-box">{JSON.stringify(sellerRawPayload, null, 2)}</pre>
          </section>
        </section>
      ) : null}

      {activeTab !== "general" && activeTab !== "identity" && activeTab !== "legal" && activeTab !== "foods" && activeTab !== "orders" && activeTab !== "wallet" && activeTab !== "security" && activeTab !== "reviews" && activeTab !== "complaints" && activeTab !== "notes" && activeTab !== "raw" ? (
        <section className="panel">
          <p className="panel-meta">{dict.detail.sectionPlanned}</p>
        </section>
      ) : null}

      {selectedInlineFoodId ? (() => {
        const food = foodRows.find((f) => f.id === selectedInlineFoodId) ?? null;
        const lot = selectedInlineLotId ? (lotsByFoodId[selectedInlineFoodId]?.find((l) => l.id === selectedInlineLotId) ?? null) : null;
        const closeInlineModal = () => { setSelectedInlineFoodId(null); setSelectedInlineLotId(null); };
        if (!food) return null;
        return (
          <div className="buyer-ops-modal-backdrop" onClick={closeInlineModal}>
            <div ref={inlineLotModalRef} className="buyer-ops-modal foods-detail-modal print-target-modal" onClick={(event) => event.stopPropagation()}>
              <h3>{lot ? (language === "tr" ? "Lot Detayı" : "Lot Detail") : (language === "tr" ? "Yemek Detayı" : "Food Detail")}</h3>
              {!lot ? (
                <>
                  <div className="foods-detail-grid">
                    <div><span className="panel-meta">ID</span><strong>{food.id}</strong></div>
                    <div><span className="panel-meta">{dict.detail.foodName}</span><strong>{food.name}</strong></div>
                    <div><span className="panel-meta">{language === "tr" ? "Kategori" : "Category"}</span><strong>{food.categoryName ?? "-"}</strong></div>
                    <div><span className="panel-meta">{language === "tr" ? "Mutfak" : "Cuisine"}</span><strong>{food.cuisine ?? "-"}</strong></div>
                    <div><span className="panel-meta">{dict.detail.foodStatus}</span><strong>{food.status === "active" ? dict.common.active : dict.common.disabled}</strong></div>
                    <div><span className="panel-meta">{dict.detail.foodPrice}</span><strong>{formatCurrency(food.price, language)}</strong></div>
                    <div><span className="panel-meta">{dict.detail.updatedAtLabel}</span><strong>{formatUiDate(food.updatedAt, language)}</strong></div>
                  </div>
                  {Array.isArray(food.imageUrls) && food.imageUrls.length > 0 ? (
                    <div className="foods-detail-text-block">
                      <h4>{language === "tr" ? "Yemek Fotoğrafları" : "Food Photos"}</h4>
                      <div className="seller-detail-inline-gallery">
                        {food.imageUrls.map((url, index) => (
                          <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer">
                            <img src={url} alt={`${food.name}-${index + 1}`} />
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {(() => {
                    const ingredientsText = (food.ingredients ?? "").trim() || (food.description ?? "").trim();
                    if (!ingredientsText) return null;
                    return (
                      <div className="foods-detail-text-block">
                        <h4>{language === "tr" ? "Malzemeler / Baharatlar" : "Ingredients / Spices"}</h4>
                        <p className="foods-detail-paragraph">{ingredientsText}</p>
                      </div>
                    );
                  })()}
                  {food.recipe ? (
                    <div className="foods-detail-text-block">
                      <h4>{language === "tr" ? "Tarif" : "Recipe"}</h4>
                      <p className="foods-detail-paragraph">{food.recipe}</p>
                    </div>
                  ) : null}
                  {Array.isArray(food.menuItems) && food.menuItems.some((item) => (item.pricing ?? "free") !== "paid") ? (
                    <div className="foods-detail-text-block">
                      <h4>{language === "tr" ? "Yan Ürünler" : "Side Items"}</h4>
                      <p className="foods-detail-paragraph">
                        {food.menuItems
                          .filter((item) => (item.pricing ?? "free") !== "paid")
                          .map((item) => item.name)
                          .join(", ")}
                      </p>
                    </div>
                  ) : null}
                  {Array.isArray(food.secondaryCategories) && food.secondaryCategories.length > 0 ? (
                    <div className="foods-detail-text-block">
                      <h4>{language === "tr" ? "Alt Kategoriler" : "Secondary Categories"}</h4>
                      <p className="foods-detail-paragraph">{food.secondaryCategories.map((item) => item.name).join(", ")}</p>
                    </div>
                  ) : null}
                  {food.allergens.length > 0 ? (
                    <div className="foods-detail-text-block">
                      <h4>{language === "tr" ? "Alerjenler" : "Allergens"}</h4>
                      <p className="foods-detail-paragraph">{food.allergens.join(", ")}</p>
                    </div>
                  ) : null}
                </>
              ) : (() => {
                  const lotDiff = computeFoodLotDiff({ foodRecipe: food.recipe ?? null, foodIngredients: food.ingredients, foodAllergens: food.allergens, lot });
                  const addedIngredients = lotDiff.ingredientsChanged ? computeAddedItems(food.ingredients, lot.ingredients_snapshot_json) : [];
                  const addedAllergens = lotDiff.allergensChanged ? computeAddedItems(food.allergens, lot.allergens_snapshot_json) : [];
                  return (
                    <LotDetailContent
                      lot={lot}
                      language={language}
                      labels={{ lotNumber: dict.detail.lotNumber, lotLifecycle: dict.detail.lotLifecycle, lotQuantity: dict.detail.lotQuantity, lotProducedAt: dict.detail.lotProducedAt, lotSaleWindow: dict.detail.lotSaleWindow }}
                      lotDiff={lotDiff}
                      addedIngredients={addedIngredients}
                      addedAllergens={addedAllergens}
                    />
                  );
                })()
              }
              <div className="buyer-ops-modal-actions">
                {lot ? <ExcelExportButton type="button" onClick={downloadInlineLotDetailAsExcel} language={language} /> : null}
                {lot ? <PrintButton className="ghost" type="button" onClick={printInlineLotDetail} language={language} /> : null}
                <button className="primary" type="button" onClick={closeInlineModal}>
                  {language === "tr" ? "Kapat" : "Close"}
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}


export default SellerDetailScreen;
