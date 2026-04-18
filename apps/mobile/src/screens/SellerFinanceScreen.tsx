import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { readJsonSafe } from "../utils/http";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import { formatCopy, t } from "../copy/brandCopy";
import { getCurrentLanguage } from "../utils/settings";
import { parseApiDate } from "../utils/parseUtils";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerFinanceSummary = {
  totalSellingAmount: number;
  totalCommission: number;
  totalNetEarnings: number;
};

type SellerBalance = {
  availableBalance: number;
  pendingPayoutAmount: number;
  currency: string;
};

type SellerPayout = {
  batchId: string;
  status: string;
  totalAmount: number;
  payoutDate: string;
};

type SellerBankAccount = {
  iban: string;
  accountHolderName: string;
  cardNumber?: string | null;
};

type WalletTab = "overview" | "transactions" | "withdraw";

const MIN_PAYOUT_AMOUNT = 50;
const QUICK_WITHDRAW_AMOUNTS = [100, 250, 500] as const;


function formatDate(value?: string | null): string {
  const parsed = parseApiDate(value);
  if (!parsed) return "-";
  return new Intl.DateTimeFormat(getCurrentLanguage() === "en" ? "en-GB" : "tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}

function isCompletedPayout(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return ["completed", "paid", "success", "done"].includes(normalized);
}

function isPendingPayout(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return ["pending", "queued", "processing", "scheduled"].includes(normalized);
}

function formatMoney(value: number, currency: string): string {
  const amount = Number(value ?? 0);
  if ((currency || "").toUpperCase() === "TRY") return `₺${amount.toFixed(2)}`;
  return `${amount.toFixed(2)} ${currency || "TRY"}`;
}

function formatAmountInput(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

function parseAmountInput(value: string): number {
  const normalized = value.replace(/[^\d,.\-]/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeErrorMessage(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isMissingBankDetailError(status: number, payload: unknown): boolean {
  if (status === 404) return true;
  if (!payload || typeof payload !== "object") return false;
  const row = payload as Record<string, unknown>;
  const msg = normalizeErrorMessage((row.error as Record<string, unknown> | undefined)?.message ?? row.message);
  const code = normalizeErrorMessage((row.error as Record<string, unknown> | undefined)?.code ?? row.code);
  if (msg.includes("bank detail is not exist")) return true;
  if (msg.includes("bank") && msg.includes("not exist")) return true;
  if (msg.includes("bank") && msg.includes("not found")) return true;
  if (code.includes("not_exist") || code.includes("not_found")) return true;
  return false;
}

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

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function SellerFinanceScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<WalletTab>("overview");
  const [summary, setSummary] = useState<SellerFinanceSummary | null>(null);
  const [balance, setBalance] = useState<SellerBalance | null>(null);
  const [payouts, setPayouts] = useState<SellerPayout[]>([]);
  const [iban, setIban] = useState("");
  const [holder, setHolder] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("0,00");

  useEffect(() => {
    setCurrentAuth((prev) => (prev.accessToken === auth.accessToken ? prev : auth));
  }, [auth.accessToken]);

  async function authedFetch(path: string, init?: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentAuth.accessToken}`,
      ...actorRoleHeader(currentAuth, "seller"),
      ...(init?.headers as Record<string, string> | undefined),
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
      const sellerId = currentAuth.userId;
      const summaryPaths = [
        `/v1/finance/sellers/${sellerId}/summary`,
        `/v1/sellers/${sellerId}/finance/summary`,
      ];
      let summaryData: Record<string, unknown> | null = null;
      let summaryError: string | null = null;
      for (const path of summaryPaths) {
        const res = await authedFetch(path, undefined, baseUrl);
        const payload = await readResponsePayload(res);
        if (res.ok && payload.json) {
          summaryData = (payload.json.data as Record<string, unknown> | undefined) ?? payload.json;
          summaryError = null;
          break;
        }
        if (res.status === 404) continue;
        summaryError = responseErrorMessage(res, payload, t('error.seller.finance.summaryLoad'));
      }
      if (!summaryData) {
        throw new Error(summaryError ?? t('error.seller.finance.summaryLoad'));
      }
      setSummary({
        totalSellingAmount: toNumber(summaryData.totalSellingAmount ?? summaryData.totalEarned),
        totalCommission: toNumber(summaryData.totalCommission ?? summaryData.totalPaidOut),
        totalNetEarnings: toNumber(summaryData.totalNetEarnings ?? summaryData.currentBalance),
      });

      const balancePaths = [
        `/v1/sellers/${sellerId}/finance/balance`,
        `/v1/finance/sellers/${sellerId}/balance`,
      ];
      let balanceData: Record<string, unknown> | null = null;
      for (const path of balancePaths) {
        const res = await authedFetch(path, undefined, baseUrl);
        const payload = await readResponsePayload(res);
        if (res.ok && payload.json) {
          balanceData = (payload.json.data as Record<string, unknown> | undefined) ?? payload.json;
          break;
        }
        if (res.status === 404) continue;
      }
      setBalance({
        availableBalance: toNumber(balanceData?.availableBalance ?? summaryData.currentBalance),
        pendingPayoutAmount: toNumber(balanceData?.pendingPayoutAmount),
        currency: String(balanceData?.currency ?? "TRY"),
      });

      const payoutsPaths = [
        `/v1/sellers/${sellerId}/finance/payouts?page=1&pageSize=20`,
        `/v1/finance/sellers/${sellerId}/payouts?page=1&pageSize=20`,
      ];
      let payoutsData: unknown[] = [];
      for (const path of payoutsPaths) {
        const res = await authedFetch(path, undefined, baseUrl);
        const payload = await readResponsePayload(res);
        if (res.ok && payload.json) {
          payoutsData = Array.isArray(payload.json.data) ? payload.json.data : [];
          break;
        }
        if (res.status === 404) continue;
      }
      setPayouts(Array.isArray(payoutsData) ? (payoutsData as SellerPayout[]) : []);

      const bankGetPaths = [
        `/v1/sellers/${sellerId}/bank-account`,
        `/v1/sellers/${sellerId}/finance/bank-account`,
      ];
      let bankData: SellerBankAccount | null = null;
      let bankErrorMessage: string | null = null;
      for (const path of bankGetPaths) {
        const bankRes = await authedFetch(path, undefined, baseUrl);
        const bankJson = await readJsonSafe<{ data?: SellerBankAccount | null; error?: { message?: string } }>(bankRes);
        if (bankRes.ok) {
          bankData = (bankJson?.data ?? null) as SellerBankAccount | null;
          bankErrorMessage = null;
          break;
        }
        if (isMissingBankDetailError(bankRes.status, bankJson)) {
          bankData = null;
          bankErrorMessage = null;
          break;
        }
        if (bankRes.status === 404) continue;
        bankErrorMessage = String(bankJson?.error?.message ?? t('error.seller.finance.bankLoad'));
      }
      if (bankErrorMessage) throw new Error(bankErrorMessage);
      setIban(typeof bankData?.iban === "string" ? bankData.iban : "");
      setHolder(typeof bankData?.accountHolderName === "string" ? bankData.accountHolderName : "");
      setCardNumber(typeof bankData?.cardNumber === "string" ? bankData.cardNumber : "");
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.seller.finance.load'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function saveBankAccount() {
    try {
      if (!iban.trim() || !cardNumber.trim()) {
        Alert.alert(t('headline.common.error'), t('error.seller.finance.bankRequired'));
        return;
      }
      const payload = {
        iban: iban.trim(),
        accountHolderName: holder.trim() || t('headline.seller.finance.bankInfo'),
        cardNumber: cardNumber.trim(),
      };
      const sellerId = currentAuth.userId;
      const candidateRequests: Array<{ method: "PUT" | "POST"; path: string }> = [
        { method: "PUT", path: `/v1/sellers/${sellerId}/bank-account` },
        { method: "POST", path: `/v1/sellers/${sellerId}/bank-account` },
        { method: "PUT", path: `/v1/sellers/${sellerId}/finance/bank-account` },
        { method: "POST", path: `/v1/sellers/${sellerId}/finance/bank-account` },
      ];

      let lastError = t('error.seller.finance.bankSave');
      let saved = false;
      for (const req of candidateRequests) {
        const res = await authedFetch(req.path, { method: req.method, body: JSON.stringify(payload) });
        const json = await readJsonSafe<{ error?: { message?: string } }>(res);
        if (res.ok) {
          saved = true;
          break;
        }
        if (isMissingBankDetailError(res.status, json)) {
          lastError = t('error.seller.finance.bankMissingRetry');
          continue;
        }
        if (res.status === 404 || res.status === 405) {
          lastError = String(json?.error?.message ?? lastError);
          continue;
        }
        lastError = String(json?.error?.message ?? lastError);
      }
      if (!saved) throw new Error(lastError);
      Alert.alert(t('headline.common.success'), t('status.seller.finance.bankSaved'));
      void loadData();
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.seller.finance.bankSave'));
    }
  }

  const currency = (balance?.currency || "TRY").toUpperCase();

  const payoutsSorted = useMemo(
    () => [...payouts].sort((a, b) => (parseApiDate(b.payoutDate)?.getTime() ?? 0) - (parseApiDate(a.payoutDate)?.getTime() ?? 0)),
    [payouts],
  );

  const weekEarnings = useMemo(() => {
    const from = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return payoutsSorted
      .filter((row) => isCompletedPayout(row.status))
      .filter((row) => (parseApiDate(row.payoutDate)?.getTime() ?? 0) >= from)
      .reduce((sum, row) => sum + Number(row.totalAmount ?? 0), 0);
  }, [payoutsSorted]);

  const monthEarnings = useMemo(() => {
    const from = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return payoutsSorted
      .filter((row) => isCompletedPayout(row.status))
      .filter((row) => (parseApiDate(row.payoutDate)?.getTime() ?? 0) >= from)
      .reduce((sum, row) => sum + Number(row.totalAmount ?? 0), 0);
  }, [payoutsSorted]);

  const totalEarnings = Number(summary?.totalNetEarnings ?? 0);

  const lastPayoutDate = useMemo(() => {
    const latest = payoutsSorted.find((row) => isCompletedPayout(row.status));
    return formatDate(latest?.payoutDate);
  }, [payoutsSorted]);

  const nextPayoutDate = useMemo(() => {
    const now = Date.now();
    const next = payoutsSorted.find((row) => {
      if (!isPendingPayout(row.status)) return false;
      const ts = parseApiDate(row.payoutDate)?.getTime();
      return typeof ts === "number" && ts >= now;
    });
    return formatDate(next?.payoutDate);
  }, [payoutsSorted]);

  const availableBalance = Number(balance?.availableBalance ?? 0);
  const pendingBalance = Number(balance?.pendingPayoutAmount ?? 0);
  const withdrawAmountValue = parseAmountInput(withdrawAmount);
  const canRequestWithdraw =
    withdrawAmountValue >= MIN_PAYOUT_AMOUNT && withdrawAmountValue <= availableBalance;

  function setQuickWithdrawAmount(value: number) {
    setWithdrawAmount(formatAmountInput(value));
  }

  function setMaxWithdrawAmount() {
    setWithdrawAmount(formatAmountInput(Math.max(0, availableBalance)));
  }

  function handleWithdrawRequest() {
    if (!canRequestWithdraw) {
      Alert.alert(t('headline.common.error'), formatCopy('error.seller.finance.withdrawMin', {
        amount: formatMoney(MIN_PAYOUT_AMOUNT, currency),
      }));
      return;
    }
    Alert.alert(
      t('status.seller.finance.withdrawRequestedTitle'),
      formatCopy('status.seller.finance.withdrawRequestedBody', {
        amount: formatMoney(withdrawAmountValue, currency),
      }),
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('headline.seller.finance.title')} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.segmentedTabs}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === "overview" && styles.tabBtnActive]}
            onPress={() => setActiveTab("overview")}
          >
            <Ionicons name="grid-outline" size={12} color={activeTab === "overview" ? "#FFFFFF" : "#2E241C"} />
            <Text style={[styles.tabText, activeTab === "overview" && styles.tabTextActive]}>{t('tab.seller.finance.overview')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === "transactions" && styles.tabBtnActive]}
            onPress={() => setActiveTab("transactions")}
          >
            <Ionicons name="list-outline" size={12} color={activeTab === "transactions" ? "#FFFFFF" : "#2E241C"} />
            <Text style={[styles.tabText, activeTab === "transactions" && styles.tabTextActive]}>{t('tab.seller.finance.transactions')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === "withdraw" && styles.tabBtnActive]}
            onPress={() => setActiveTab("withdraw")}
          >
            <Ionicons name="cash-outline" size={12} color={activeTab === "withdraw" ? "#FFFFFF" : "#2E241C"} />
            <Text style={[styles.tabText, activeTab === "withdraw" && styles.tabTextActive]}>{t('tab.seller.finance.withdraw')}</Text>
          </TouchableOpacity>
        </View>

        {loading ? <ActivityIndicator size="large" color={theme.primary} style={styles.loading} /> : null}

        {!loading && activeTab === "overview" ? (
          <>
            <View style={styles.balanceCard}>
              <View>
                <View style={styles.balanceTitleRow}>
                  <Ionicons name="wallet-outline" size={14} color="#FFFFFF" />
                  <Text style={styles.balanceTitle}>{t('status.seller.finance.balanceTitle')}</Text>
                </View>
                <Text style={styles.balanceAmount}>{formatMoney(balance?.availableBalance ?? 0, currency)}</Text>
                <View style={styles.pendingRow}>
                  <Ionicons name="time-outline" size={12} color="#FFFFFF" />
                  <Text style={styles.pendingText}>{formatCopy('status.seller.finance.pending', { amount: formatMoney(balance?.pendingPayoutAmount ?? 0, currency) })}</Text>
                </View>
              </View>
            </View>

            <Text style={styles.sectionTitle}>{t('headline.seller.finance.stats')}</Text>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Ionicons name="calendar-outline" size={14} color="#22C55E" />
                <Text style={styles.statLabel}>{t('status.seller.finance.thisWeek')}</Text>
                <Text style={[styles.statValue, styles.statValueGreen]}>{formatMoney(weekEarnings, currency)}</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons name="calendar-clear-outline" size={14} color="#7C7C7C" />
                <Text style={styles.statLabel}>{t('status.seller.finance.thisMonth')}</Text>
                <Text style={styles.statValue}>{formatMoney(monthEarnings, currency)}</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons name="trophy-outline" size={14} color="#F59E0B" />
                <Text style={styles.statLabel}>{t('status.seller.finance.totalEarnings')}</Text>
                <Text style={[styles.statValue, styles.statValueOrange]}>{formatMoney(totalEarnings, currency)}</Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <View style={styles.infoTitleRow}>
                <Ionicons name="information-circle-outline" size={14} color="#6C6055" />
                <Text style={styles.infoTitle}>{t('headline.seller.finance.paymentInfo')}</Text>
              </View>
              <View style={styles.infoRow}><Text style={styles.infoKey}>{t('status.seller.finance.lastPayout')}</Text><Text style={styles.infoVal}>{lastPayoutDate}</Text></View>
              <View style={styles.infoRow}><Text style={styles.infoKey}>{t('status.seller.finance.nextPayout')}</Text><Text style={styles.infoVal}>{nextPayoutDate}</Text></View>
              <View style={styles.infoRow}><Text style={styles.infoKey}>{t('status.seller.finance.minimumAmount')}</Text><Text style={styles.infoVal}>{formatMoney(MIN_PAYOUT_AMOUNT, currency)}</Text></View>
            </View>
          </>
        ) : null}

        {!loading && activeTab === "transactions" ? (
          <View style={styles.listWrap}>
            {payoutsSorted.length === 0 ? (
              <View style={styles.emptyCard}><Text style={styles.emptyText}>{t('headline.seller.finance.noTransactions')}</Text></View>
            ) : (
              payoutsSorted.map((row) => (
                <View key={row.batchId} style={styles.txnCard}>
                  <View style={styles.txnTop}>
                    <Text style={styles.txnDate}>{formatDate(row.payoutDate)}</Text>
                    <Text style={[styles.txnStatus, isCompletedPayout(row.status) ? styles.txnStatusOk : styles.txnStatusPending]}>
                      {row.status}
                    </Text>
                  </View>
                  <Text style={styles.txnAmount}>{formatMoney(Number(row.totalAmount ?? 0), currency)}</Text>
                </View>
              ))
            )}
          </View>
        ) : null}

        {!loading && activeTab === "withdraw" ? (
          <>
            <View style={styles.withdrawSummaryCard}>
              <View style={styles.withdrawSummaryRow}>
                <Text style={styles.withdrawSummaryLabel}>{t('status.seller.finance.availableBalance')}</Text>
                <Text style={styles.withdrawSummaryValue}>{formatMoney(availableBalance, currency)}</Text>
              </View>
              <View style={styles.withdrawSummaryRow}>
                <Text style={styles.withdrawSummaryLabel}>{t('status.seller.finance.pendingBalance')}</Text>
                <Text style={styles.withdrawSummaryPending}>{formatMoney(pendingBalance, currency)}</Text>
              </View>
            </View>

            <View style={styles.withdrawCard}>
              <Text style={styles.withdrawTitle}>{t('headline.seller.finance.withdrawAmount')}</Text>
              <View style={styles.amountBox}>
                <TextInput
                  style={styles.amountInput}
                  value={withdrawAmount}
                  onChangeText={setWithdrawAmount}
                  keyboardType="decimal-pad"
                  placeholder="0,00"
                  placeholderTextColor="#8B847A"
                  textAlign="center"
                />
              </View>

              <View style={styles.amountChipRow}>
                {QUICK_WITHDRAW_AMOUNTS.map((amount) => (
                  <TouchableOpacity
                    key={`withdraw-${amount}`}
                    style={styles.amountChip}
                    onPress={() => setQuickWithdrawAmount(amount)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.amountChipText}>₺{amount}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.amountChip} onPress={setMaxWithdrawAmount} activeOpacity={0.85}>
                  <Text style={styles.amountChipText}>{t('cta.seller.finance.all')}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.withdrawInfoBox}>
                <View style={styles.withdrawInfoTitleRow}>
                  <Ionicons name="information-circle" size={13} color="#706759" />
                  <Text style={styles.withdrawInfoTitle}>{t('headline.seller.finance.info')}</Text>
                </View>
                <Text style={styles.withdrawInfoLine}>{formatCopy('helper.seller.finance.minAmount', { amount: formatMoney(MIN_PAYOUT_AMOUNT, currency) })}</Text>
                <Text style={styles.withdrawInfoLine}>{t('helper.seller.finance.processTime')}</Text>
                <Text style={styles.withdrawInfoLine}>{t('helper.seller.finance.autoPayout')}</Text>
                <Text style={styles.withdrawInfoLine}>{t('helper.seller.finance.freeFee')}</Text>
              </View>

              <TouchableOpacity
                style={[styles.withdrawRequestBtn, !canRequestWithdraw && styles.withdrawRequestBtnDisabled]}
                onPress={handleWithdrawRequest}
                activeOpacity={0.88}
              >
                <Text style={styles.withdrawRequestBtnText}>{t('cta.seller.finance.requestWithdraw')}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.bankInfoCard}>
              <View style={styles.bankInfoTitleRow}>
                <Ionicons name="business-outline" size={13} color="#3B3129" />
                <Text style={styles.bankInfoTitle}>{t('headline.seller.finance.bankInfo')}</Text>
              </View>
              <TextInput
                style={styles.input}
                value={iban}
                onChangeText={setIban}
                placeholder={t('helper.seller.finance.ibanPlaceholder')}
                placeholderTextColor="#8A7A6A"
              />
              <TextInput
                style={styles.input}
                value={cardNumber}
                onChangeText={setCardNumber}
                placeholder={t('helper.seller.finance.cardPlaceholder')}
                placeholderTextColor="#8A7A6A"
                keyboardType="number-pad"
              />
              <TextInput
                style={styles.input}
                value={holder}
                onChangeText={setHolder}
                placeholder={t('helper.seller.finance.holderPlaceholder')}
                placeholderTextColor="#8A7A6A"
              />
              <TouchableOpacity style={styles.saveBtn} onPress={() => void saveBankAccount()}>
                <Text style={styles.saveText}>{t('cta.seller.finance.saveBank')}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F1EFEB" },
  content: { padding: 12, paddingBottom: 28, gap: 10 },
  loading: { marginTop: 26 },
  segmentedTabs: {
    flexDirection: "row",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#D8D2C8",
    paddingBottom: 8,
  },
  tabBtn: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#E9E5DE",
  },
  tabBtnActive: { backgroundColor: "#8EA08A" },
  tabText: { color: "#2E241C", fontWeight: "700", fontSize: 15 },
  tabTextActive: { color: "#FFFFFF" },

  balanceCard: {
    backgroundColor: "#8A9C86",
    borderRadius: 10,
    padding: 12,
    minHeight: 98,
    justifyContent: "space-between",
  },
  balanceTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  balanceTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  balanceAmount: { color: "#FFFFFF", fontSize: 38, fontWeight: "900", marginTop: 2 },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  pendingText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  withdrawBtn: {
    alignSelf: "flex-end",
    marginTop: 8,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  withdrawBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 12 },

  sectionTitle: { color: "#2E241C", fontSize: 19, fontWeight: "800", marginTop: 6, textAlign: "center" },
  statsRow: { flexDirection: "row", gap: 6, paddingHorizontal: 6 },
  statCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E3DBCF",
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  statLabel: { color: "#5E564D", fontSize: 12, fontWeight: "600" },
  statValue: { color: "#5E564D", fontSize: 15, fontWeight: "800" },
  statValueGreen: { color: "#22C55E" },
  statValueOrange: { color: "#F97316" },

  infoCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E3DBCF",
    padding: 12,
  },
  infoTitleRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  infoTitle: { color: "#3B3129", fontWeight: "800", fontSize: 16 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 3 },
  infoKey: { color: "#7A7065", fontSize: 14 },
  infoVal: { color: "#2E241C", fontSize: 14, fontWeight: "700" },

  listWrap: { gap: 8 },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E3DBCF",
    padding: 12,
  },
  emptyText: { color: "#6C6055", fontWeight: "600" },
  txnCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E3DBCF",
    padding: 12,
  },
  txnTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  txnDate: { color: "#6C6055", fontWeight: "700" },
  txnStatus: { fontWeight: "800", fontSize: 12, textTransform: "capitalize" },
  txnStatusOk: { color: "#1B7A42" },
  txnStatusPending: { color: "#B45309" },
  txnAmount: { color: "#2E241C", fontWeight: "900", marginTop: 6, fontSize: 16 },

  withdrawSummaryCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E3DBCF",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  withdrawSummaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  withdrawSummaryLabel: { color: "#676056", fontSize: 17, fontWeight: "600" },
  withdrawSummaryValue: { color: "#16A34A", fontSize: 18, fontWeight: "900" },
  withdrawSummaryPending: { color: "#F59E0B", fontSize: 18, fontWeight: "900" },

  withdrawCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E3DBCF",
    padding: 12,
  },
  withdrawTitle: { color: "#2E241C", fontWeight: "800", fontSize: 17, marginBottom: 8 },
  amountBox: {
    backgroundColor: "#ECE7DF",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  amountInput: {
    color: "#7D766D",
    fontSize: 34,
    fontWeight: "800",
    width: "100%",
    textAlign: "center",
    paddingVertical: 2,
  },
  amountChipRow: { marginTop: 10, flexDirection: "row", gap: 8 },
  amountChip: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#BEB4A8",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
  },
  amountChipText: { color: "#2E241C", fontWeight: "700", fontSize: 13 },
  withdrawInfoBox: {
    marginTop: 12,
    backgroundColor: "#F0ECE6",
    borderWidth: 1,
    borderColor: "#D8D0C4",
    borderRadius: 10,
    padding: 9,
    gap: 4,
  },
  withdrawInfoTitleRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  withdrawInfoTitle: { color: "#4E443A", fontWeight: "700", fontSize: 15 },
  withdrawInfoLine: { color: "#7A7064", fontSize: 14, fontWeight: "500" },
  withdrawRequestBtn: {
    marginTop: 12,
    backgroundColor: "#A9B5AA",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  withdrawRequestBtnDisabled: { opacity: 0.6 },
  withdrawRequestBtnText: { color: "#FFFFFF", fontWeight: "800", fontSize: 17 },

  bankInfoCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E3DBCF",
    padding: 12,
  },
  bankInfoTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  bankInfoTitle: { color: "#3B3129", fontWeight: "800", fontSize: 18 },

  input: {
    backgroundColor: "#F8F5EF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginTop: 8,
    color: "#2E241C",
  },
  saveBtn: { marginTop: 10, backgroundColor: "#3F855C", borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "800" },
});
