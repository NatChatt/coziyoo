import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AuthSession } from "../utils/auth";
import { loadAuthSession, refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import { t } from "../copy/brandCopy";
import { getCurrentLanguage } from "../utils/settings";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerReview = {
  id: string;
  rating: number;
  comment: string;
  foodName: string | null;
  buyerName: string;
  createdAt: string;
};

type ReviewsSummary = {
  averageRating: number;
  totalReviews: number;
};

function formatDate(value: string | undefined): string {
  if (!value?.trim()) return "-";
  const normalized = value.trim().replace(" ", "T").replace(/(\.\d+)?([+-]\d{2})$/, "$1$2:00");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat(getCurrentLanguage() === "en" ? "en-GB" : "tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function StarRow({ rating }: { rating: number }) {
  const safe = Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.round(rating))) : 0;
  return (
    <View style={styles.starsRow}>
      {Array.from({ length: 5 }).map((_, idx) => (
        <Ionicons
          key={`star-${idx}`}
          name={idx < safe ? "star" : "star-outline"}
          size={14}
          color={idx < safe ? "#D4A33B" : "#B8ADA1"}
        />
      ))}
      <Text style={styles.starText}>{safe.toFixed(1)}</Text>
    </View>
  );
}

export default function SellerReviewsScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [summary, setSummary] = useState<ReviewsSummary>({ averageRating: 0, totalReviews: 0 });
  const [reviews, setReviews] = useState<SellerReview[]>([]);

  useEffect(() => {
    setCurrentAuth((prev) => (prev.accessToken === auth.accessToken ? prev : auth));
  }, [auth.accessToken]);

  async function authedFetch(path: string, base = apiUrl): Promise<Response> {
    const makeHeaders = (session: AuthSession): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...actorRoleHeader(session, "seller"),
    });
    const headers = makeHeaders(currentAuth);
    let res = await fetch(`${base}${path}`, { headers });
    if (res.status !== 401 && res.status !== 403) return res;

    const persisted = await loadAuthSession();
    if (persisted && persisted.userId === currentAuth.userId && persisted.accessToken !== currentAuth.accessToken) {
      setCurrentAuth(persisted);
      onAuthRefresh?.(persisted);
      res = await fetch(`${base}${path}`, { headers: makeHeaders(persisted) });
      if (res.status !== 401 && res.status !== 403) return res;
    }

    const refreshed = await refreshAuthSession(
      base,
      persisted && persisted.userId === currentAuth.userId ? persisted : currentAuth,
    );
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${base}${path}`, { headers: makeHeaders(refreshed) });
  }

  async function loadReviews(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setErrorText(null);
    try {
      const settings = await loadSettings();
      const base = settings.apiUrl;
      setApiUrl(base);
      const res = await authedFetch("/v1/seller/reviews?page=1&pageSize=100", base);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? t('cta.seller.profileDetail.reviews'));

      const nextData = json?.data;
      const nextSummary = nextData?.summary;
      const nextItems = Array.isArray(nextData?.items)
        ? nextData.items
        : Array.isArray(nextData)
          ? nextData
          : [];
      setSummary({
        averageRating: Number(nextSummary?.averageRating ?? 0),
        totalReviews: Number(nextSummary?.totalReviews ?? nextItems.length),
      });
      setReviews(
        nextItems.map((row: SellerReview & {
          food_name?: string | null;
          buyer_name?: string | null;
          created_at?: string;
        }) => ({
          id: String(row.id),
          rating: Number(row.rating ?? 0),
          comment: String(row.comment ?? ""),
          foodName: row.foodName ? String(row.foodName) : (row.food_name ? String(row.food_name) : null),
          buyerName: String(row.buyerName ?? row.buyer_name ?? t('status.seller.reviews.anonymousBuyer')),
          createdAt: String(row.createdAt ?? row.created_at ?? ""),
        })),
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('cta.seller.profileDetail.reviews'));
      setSummary({ averageRating: 0, totalReviews: 0 });
      setReviews([]);
    } finally {
      if (showSpinner) setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadReviews(true);
  }, []);

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('cta.seller.profileDetail.reviews')} onBack={onBack} />
      {loading ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadReviews(false); }} />}
          ListHeaderComponent={(
            <View style={styles.headerBlock}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>{t('headline.seller.reviews.average')}</Text>
                  <Text style={styles.summaryValue}>{summary.averageRating.toFixed(1)}</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>{t('headline.seller.reviews.total')}</Text>
                  <Text style={styles.summaryValue}>{summary.totalReviews}</Text>
                </View>
              </View>
              {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
              {summary.totalReviews === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>{t('headline.seller.reviews.emptyTitle')}</Text>
                  <Text style={styles.emptySub}>{t('helper.seller.reviews.emptySubtitle')}</Text>
                </View>
              ) : null}
            </View>
          )}
          renderItem={({ item }) => (
            <View style={styles.reviewCard}>
              <View style={styles.reviewTop}>
                <View style={styles.reviewMeta}>
                  <Text style={styles.buyerName}>{item.buyerName}</Text>
                  <Text style={styles.foodName}>{item.foodName || t('helper.seller.reviews.foodMissing')}</Text>
                </View>
                <Text style={styles.reviewDate}>{formatDate(item.createdAt)}</Text>
              </View>
              <StarRow rating={item.rating} />
              {item.comment?.trim() ? (
                <Text style={styles.comment}>{item.comment.trim()}</Text>
              ) : (
                <Text style={styles.commentMuted}>{t('helper.seller.reviews.commentMissing')}</Text>
              )}
            </View>
          )}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBlock: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4, gap: 10 },
  summaryRow: { flexDirection: "row", gap: 10 },
  summaryCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderColor: "#E6DDCF",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summaryLabel: { color: "#6F6256", fontWeight: "700", fontSize: 12 },
  summaryValue: { color: "#2C241D", fontWeight: "900", fontSize: 22, marginTop: 6 },
  errorText: { color: theme.error, fontWeight: "700", fontSize: 13 },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E6DDCF",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  emptyTitle: { color: "#2C241D", fontWeight: "800", fontSize: 15 },
  emptySub: { color: "#6F6256", marginTop: 4, fontWeight: "500" },
  listContent: { paddingHorizontal: 14, paddingBottom: 20, gap: 10 },
  reviewCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E6DDCF",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  reviewTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  reviewMeta: { flex: 1 },
  buyerName: { color: "#2C241D", fontWeight: "800", fontSize: 14 },
  foodName: { color: "#6F6256", fontWeight: "600", fontSize: 12, marginTop: 2 },
  reviewDate: { color: "#8A7D70", fontWeight: "600", fontSize: 12 },
  starsRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  starText: { marginLeft: 6, color: "#6F6256", fontWeight: "700", fontSize: 12 },
  comment: { color: "#3A3129", fontWeight: "600", lineHeight: 19 },
  commentMuted: { color: "#8A7D70", fontStyle: "italic", fontWeight: "500" },
});
