import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { API_BASE, request, parseJson } from "./lib/api";
import { setTokens, setAdmin, getTokens } from "./lib/auth";
import { DICTIONARIES } from "./lib/i18n";
import ApiHealthBadge from "./components/ApiHealthBadge";
import DashboardPage from "./pages/DashboardPage";
import ReviewQueuePage from "./pages/ReviewQueuePage";
import UsersPage from "./pages/UsersPage";
import InvestigationPage from "./pages/InvestigationPage";
import InvestigationComplaintDetailPage from "./pages/InvestigationComplaintDetailPage";
import FoodsLotsPage from "./pages/FoodsLotsPage";
import RecordsPage from "./pages/RecordsPage";
import EntitiesPage from "./pages/EntitiesPage";
import AuditPage from "./pages/AuditPage";
import ApiTokensPage from "./pages/ApiTokensPage";
import ComplianceDocumentsPage from "./pages/ComplianceDocumentsPage";
import SalesCommissionSettingsPage from "./pages/SalesCommissionSettingsPage";
import AdminTestScenariosPage from "./pages/AdminTestScenariosPage";
import SecurityPage from "./pages/SecurityPage";
import AdminNotificationTestPage from "./pages/AdminNotificationTestPage";
import OrderFlowAdminPage from "./pages/OrderFlowAdminPage";
import { UserDetail } from "./pages/users/DefaultUserDetailScreen";
import type { AdminUser, Language, Dictionary, ApiError, GlobalSearchResultItem, GlobalSearchResultKind } from "./types/core";

function AppShell({
  admin,
  onLoggedOut,
  isDarkMode,
  onToggleDarkMode,
  language,
  onToggleLanguage,
}: {
  admin: AdminUser;
  onLoggedOut: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  language: Language;
  onToggleLanguage: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const dict = DICTIONARIES[language];
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [globalSearchInput, setGlobalSearchInput] = useState("");
  const [isGlobalSearchModalOpen, setIsGlobalSearchModalOpen] = useState(false);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchResults, setGlobalSearchResults] = useState<GlobalSearchResultItem[]>([]);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [mountedPages, setMountedPages] = useState<Set<string>>(() => {
    const seg = location.pathname.split("/").filter(Boolean);
    return new Set([`/${seg.slice(0, 2).join("/")}`]);
  });
  const [lastDetailIds, setLastDetailIds] = useState<{ sellers: string | null; buyers: string | null; app: string | null; admins: string | null }>({ sellers: null, buyers: null, app: null, admins: null });
  const globalSearchReqIdRef = useRef(0);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  async function logout() {
    const tokens = getTokens();
    await request("/v1/admin/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken: tokens?.refreshToken }),
    }).catch(() => undefined);

    setTokens(null);
    setAdmin(null);
    onLoggedOut();
    navigate("/login", { replace: true });
  }

  const isSuperAdmin = admin.role === "super_admin";
  const isInvestigationDetailModal = location.pathname.startsWith("/app/investigation/");
  const pathParts = location.pathname.split("/").filter(Boolean);
  const currentBasePath = `/${pathParts.slice(0, 2).join("/")}`;
  const isPageMounted = (path: string) => mountedPages.has(path) || currentBasePath === path;
  const isDetailPage = pathParts.length > 2;
  const parentPath = isDetailPage ? `/${pathParts.slice(0, 2).join("/")}` : null;
  const currentSellerId = location.pathname.match(/^\/app\/sellers\/([^/?#]+)/)?.[1] ?? null;
  const currentBuyerId = location.pathname.match(/^\/app\/buyers\/([^/?#]+)/)?.[1] ?? null;
  const currentAppUserId = location.pathname.match(/^\/app\/users\/([^/?#]+)/)?.[1] ?? null;
  const currentAdminId = location.pathname.match(/^\/app\/admins\/([^/?#]+)/)?.[1] ?? null;
  const visibleAppUserId = currentAppUserId ?? lastDetailIds.app;
  const visibleBuyerId = currentBuyerId ?? lastDetailIds.buyers;
  const visibleSellerId = currentSellerId ?? lastDetailIds.sellers;
  const visibleAdminId = currentAdminId ?? lastDetailIds.admins;
  const handleDetailBack = () => {
    const routerIdx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (routerIdx > 0) {
      navigate(-1);
      return;
    }
    navigate(parentPath ?? "/app");
  };
  const globalSearchMinChars = 2;
  const globalSearchQuery = globalSearchInput.trim();

  useEffect(() => {
    setIsGlobalSearchModalOpen(false);
    setGlobalSearchInput("");
    setGlobalSearchResults([]);
    setGlobalSearchLoading(false);
    setIsProfileMenuOpen(false);
    globalSearchReqIdRef.current += 1;
    const seg = location.pathname.split("/").filter(Boolean);
    const base = `/${seg.slice(0, 2).join("/")}`;
    setMountedPages(prev => prev.has(base) ? prev : new Set([...prev, base]));
    const sellerMatch = location.pathname.match(/^\/app\/sellers\/([^/?#]+)/);
    if (sellerMatch) setLastDetailIds(prev => prev.sellers === sellerMatch[1] ? prev : { ...prev, sellers: sellerMatch[1] });
    const buyerMatch = location.pathname.match(/^\/app\/buyers\/([^/?#]+)/);
    if (buyerMatch) setLastDetailIds(prev => prev.buyers === buyerMatch[1] ? prev : { ...prev, buyers: buyerMatch[1] });
    const appUserMatch = location.pathname.match(/^\/app\/users\/([^/?#]+)/);
    if (appUserMatch) setLastDetailIds(prev => prev.app === appUserMatch[1] ? prev : { ...prev, app: appUserMatch[1] });
    const adminMatch = location.pathname.match(/^\/app\/admins\/([^/?#]+)/);
    if (adminMatch) setLastDetailIds(prev => prev.admins === adminMatch[1] ? prev : { ...prev, admins: adminMatch[1] });
  }, [location.pathname]);

  useEffect(() => {
    if (!isGlobalSearchModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsGlobalSearchModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isGlobalSearchModalOpen]);

  useEffect(() => {
    if (!isGlobalSearchModalOpen) return;
    const timer = window.setTimeout(() => {
      globalSearchInputRef.current?.focus();
    }, 20);
    return () => window.clearTimeout(timer);
  }, [isGlobalSearchModalOpen]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!profileMenuRef.current) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!profileMenuRef.current.contains(target)) setIsProfileMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsProfileMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const query = globalSearchQuery;
    if (query.length < globalSearchMinChars) {
      setGlobalSearchLoading(false);
      setGlobalSearchResults([]);
      return;
    }

    const reqId = ++globalSearchReqIdRef.current;
    setGlobalSearchLoading(true);
    const timer = window.setTimeout(() => {
      request(`/v1/admin/search/global?q=${encodeURIComponent(query)}&limit=12`)
        .then(async (response) => {
          if (reqId !== globalSearchReqIdRef.current) return;
          if (response.status !== 200) {
            setGlobalSearchResults([]);
            return;
          }
          const body = await parseJson<{ data?: GlobalSearchResultItem[] }>(response);
          if (reqId !== globalSearchReqIdRef.current) return;
          setGlobalSearchResults(Array.isArray(body.data) ? body.data : []);
        })
        .catch(() => {
          if (reqId !== globalSearchReqIdRef.current) return;
          setGlobalSearchResults([]);
        })
        .finally(() => {
          if (reqId === globalSearchReqIdRef.current) setGlobalSearchLoading(false);
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [globalSearchQuery]);

  function globalKindLabel(kind: GlobalSearchResultKind): string {
    if (language === "tr") {
      if (kind === "seller") return "Satıcı";
      if (kind === "buyer") return "Alıcı";
      if (kind === "food") return "Yemek";
      if (kind === "order") return "Sipariş";
      if (kind === "lot") return "Lot";
      return "Şikayet";
    }
    if (kind === "seller") return "Seller";
    if (kind === "buyer") return "Buyer";
    if (kind === "food") return "Food";
    if (kind === "order") return "Order";
    if (kind === "lot") return "Lot";
    return "Complaint";
  }

  function renderGlobalSearchHighlight(text: string, query: string) {
    const source = String(text ?? "");
    const needle = query.trim();
    if (!needle) return source;
    const sourceLower = source.toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
    const needleLower = needle.toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
    const firstMatch = sourceLower.indexOf(needleLower);
    if (firstMatch < 0) return source;
    const before = source.slice(0, firstMatch);
    const hit = source.slice(firstMatch, firstMatch + needle.length);
    const after = source.slice(firstMatch + needle.length);
    return (
      <>
        {before}
        <mark className="global-search-hit">{hit}</mark>
        {after}
      </>
    );
  }

  function onSelectGlobalResult(item: GlobalSearchResultItem) {
    setIsGlobalSearchModalOpen(false);
    setGlobalSearchInput("");
    setGlobalSearchResults([]);
    navigate(item.targetPath);
  }

  const shouldDockSearchInput = globalSearchQuery.length >= globalSearchMinChars;
  const profileNameSeed = String(admin.email ?? "Admin").split("@")[0] || "Admin";
  const profileInitials =
    profileNameSeed
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((chunk) => chunk[0]?.toUpperCase() ?? "")
      .join("") || "A";
  const profileAvatarSrc = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#0ea5e9'/><stop offset='100%' stop-color='#22c55e'/></linearGradient></defs><rect width='80' height='80' rx='40' fill='url(#g)'/><text x='50%' y='55%' text-anchor='middle' font-family='Arial,sans-serif' font-size='30' fill='white' font-weight='700'>${profileInitials}</text></svg>`
  )}`;

  return (
    <main className={`shell${isGlobalSearchModalOpen ? " search-open" : ""}`}>
      <header className="navbar">
        <div className="navbar-left">
          <div className="brand">
            <span className="brand-dot" />
            <div>
              <p className="brand-title">{dict.navbar.title}</p>
            </div>
          </div>
          <TopNavTabs
            pathname={location.pathname}
            dict={dict}
            isSuperAdmin={isSuperAdmin}
            language={language}
          />
        </div>
        <button
          type="button"
          className="navbar-search-launch"
          aria-label={language === "tr" ? "Global aramayı aç" : "Open global search"}
          onClick={() => setIsGlobalSearchModalOpen(true)}
        >
          <span className="navbar-search-launch-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <circle cx="11" cy="11" r="6.8" />
              <path d="M16.5 16.5 21 21" />
            </svg>
          </span>
        </button>
        <div className="navbar-actions">
          <div className={`profile-menu ${isProfileMenuOpen ? "is-open" : ""}`} ref={profileMenuRef}>
            <button
              className="profile-menu-trigger"
              type="button"
              aria-haspopup="menu"
              aria-expanded={isProfileMenuOpen}
              aria-label={language === "tr" ? "Profil menüsünü aç" : "Open profile menu"}
              onClick={() => setIsProfileMenuOpen((open) => !open)}
            >
              <img className="profile-menu-avatar" src={profileAvatarSrc} alt={language === "tr" ? "Profil resmi" : "Profile avatar"} />
              <span className="profile-menu-chevron" aria-hidden="true">▾</span>
            </button>
            {isProfileMenuOpen ? (
              <div className="profile-menu-dropdown" role="menu">
                <div className="profile-menu-header">
                  <strong>{profileNameSeed}</strong>
                  <small>{admin.email}</small>
                </div>
                <div className="profile-menu-row">
                  <span>API</span>
                  <ApiHealthBadge />
                </div>
                <button
                  className="profile-menu-item"
                  type="button"
                  onClick={() => {
                    onToggleLanguage();
                    setIsProfileMenuOpen(false);
                  }}
                >
                  🌐 {language === "tr" ? "TR / EN" : "EN / TR"}
                </button>
                <button
                  className="profile-menu-item"
                  type="button"
                  onClick={() => {
                    onToggleDarkMode();
                    setIsProfileMenuOpen(false);
                  }}
                >
                  {isDarkMode ? "☀" : "☾"}
                </button>
                <button
                  className="profile-menu-item is-danger"
                  type="button"
                  onClick={() => {
                    setIsProfileMenuOpen(false);
                    void logout();
                  }}
                >
                  ⎋ {dict.actions.logout}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <section className="main">
        {isDetailPage && parentPath && !isInvestigationDetailModal ? (
          <div className="back-nav">
            <button
              type="button"
              className="ghost back-nav-btn"
              onClick={handleDetailBack}
            >
              ← {language === "tr" ? "Geri" : "Back"}
            </button>
          </div>
        ) : null}
        <div className="page-transition-root">
          {isPageMounted("/app/dashboard") ? (
            <div style={{ display: location.pathname === "/app/dashboard" ? undefined : "none" }}>
              <DashboardPage language={language} />
            </div>
          ) : null}
          {isPageMounted("/app/review-queue") ? (
            <div style={{ display: location.pathname === "/app/review-queue" ? undefined : "none" }}>
              <ReviewQueuePage language={language} />
            </div>
          ) : null}
          {isPageMounted("/app/users") ? (
            <div style={{ display: location.pathname === "/app/users" ? undefined : "none" }}>
              <UsersPage kind="app" isSuperAdmin={isSuperAdmin} language={language} />
            </div>
          ) : null}
          {isPageMounted("/app/buyers") ? (
            <div style={{ display: location.pathname === "/app/buyers" ? undefined : "none" }}>
              <UsersPage kind="buyers" isSuperAdmin={isSuperAdmin} language={language} />
            </div>
          ) : null}
          {isPageMounted("/app/sellers") ? (
            <div style={{ display: location.pathname === "/app/sellers" ? undefined : "none" }}>
              <UsersPage kind="sellers" isSuperAdmin={isSuperAdmin} language={language} />
            </div>
          ) : null}
          {isPageMounted("/app/orders") ? (
            <div style={{ display: location.pathname === "/app/orders" ? undefined : "none" }}>
              <RecordsPage language={language} tableKey="orders" />
            </div>
          ) : null}
          {isPageMounted("/app/foods") ? (
            <div style={{ display: location.pathname === "/app/foods" ? undefined : "none" }}>
              <FoodsLotsPage language={language} />
            </div>
          ) : null}
          {isPageMounted("/app/admins") ? (
            <div style={{ display: location.pathname === "/app/admins" ? undefined : "none" }}>
              <UsersPage kind="admin" isSuperAdmin={isSuperAdmin} language={language} />
            </div>
          ) : null}
          {isPageMounted("/app/investigation") ? (
            <div style={{ display: location.pathname.startsWith("/app/investigation") ? undefined : "none" }}>
              <InvestigationPage language={language} />
            </div>
          ) : null}
          {isInvestigationDetailModal ? (
            <div
              className="buyer-ops-modal-backdrop complaint-detail-modal-backdrop"
              role="dialog"
              aria-modal="true"
              aria-label={dict.investigation.detailTitle}
              onClick={() => navigate("/app/investigation")}
            >
              <div
                className="buyer-ops-modal complaint-detail-modal-shell"
                onClick={(event) => event.stopPropagation()}
              >
                <InvestigationComplaintDetailPage
                  language={language}
                  complaintId={location.pathname.split("/").at(-1) ?? ""}
                />
              </div>
            </div>
          ) : null}
          {isPageMounted("/app/audit") ? (
            <div style={{ display: location.pathname === "/app/audit" ? undefined : "none" }}>
              <AuditPage language={language} />
            </div>
          ) : null}
          {isPageMounted("/app/compliance-documents") ? (
            <div style={{ display: location.pathname === "/app/compliance-documents" ? undefined : "none" }}>
              <ComplianceDocumentsPage language={language} isSuperAdmin={isSuperAdmin} />
            </div>
          ) : null}
          {isPageMounted("/app/security") ? (
            <div style={{ display: location.pathname === "/app/security" ? undefined : "none" }}>
              <SecurityPage language={language} />
            </div>
          ) : null}
          {location.pathname === "/app/order-flow" ? <OrderFlowAdminPage language={language} /> : null}
          {location.pathname === "/app/api-tokens" ? <ApiTokensPage language={language} isSuperAdmin={isSuperAdmin} /> : null}
          {location.pathname === "/app/sales-commission-settings" ? <SalesCommissionSettingsPage language={language} /> : null}
          {location.pathname === "/app/test-scenarios" ? <AdminTestScenariosPage language={language} /> : null}
          {location.pathname === "/app/test-notifications" ? <AdminNotificationTestPage language={language} /> : null}
          {location.pathname === "/app/entities" || location.pathname.startsWith("/app/entities/") ? <EntitiesPage language={language} /> : null}
          {visibleAppUserId ? (
            <div style={{ display: location.pathname.startsWith("/app/users/") ? undefined : "none" }}>
              <UserDetail kind="app" isSuperAdmin={isSuperAdmin} language={language} id={visibleAppUserId} />
            </div>
          ) : null}
          {visibleBuyerId ? (
            <div style={{ display: location.pathname.startsWith("/app/buyers/") ? undefined : "none" }}>
              <UserDetail kind="buyers" isSuperAdmin={isSuperAdmin} language={language} id={visibleBuyerId} />
            </div>
          ) : null}
          {visibleSellerId ? (
            <div style={{ display: location.pathname.startsWith("/app/sellers/") ? undefined : "none" }}>
              <UserDetail kind="sellers" isSuperAdmin={isSuperAdmin} language={language} id={visibleSellerId} />
            </div>
          ) : null}
          {visibleAdminId ? (
            <div style={{ display: location.pathname.startsWith("/app/admins/") ? undefined : "none" }}>
              <UserDetail kind="admin" isSuperAdmin={isSuperAdmin} language={language} id={visibleAdminId} />
            </div>
          ) : null}
        </div>
      </section>
      {isGlobalSearchModalOpen ? (
        <div
          className={`global-search-modal ${shouldDockSearchInput ? "is-docked" : ""}`}
          role="dialog"
          aria-modal="true"
          onClick={() => setIsGlobalSearchModalOpen(false)}
        >
          <div className="global-search-modal-shell">
            <div className="global-search-input-shell" onClick={(event) => event.stopPropagation()}>
              <label className="global-search-input-wrap">
                <span className="global-search-input-icon" aria-hidden="true">⌕</span>
                <input
                  ref={globalSearchInputRef}
                  className="global-search-input"
                  value={globalSearchInput}
                  placeholder={
                    language === "tr"
                      ? "İsim, e-posta, lot no, sipariş no, müşteri ID ara..."
                      : "Search name, e-mail, lot no, order no, customer ID..."
                  }
                  onChange={(event) => setGlobalSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setIsGlobalSearchModalOpen(false);
                    if (event.key === "Enter" && globalSearchResults[0]) {
                      event.preventDefault();
                      onSelectGlobalResult(globalSearchResults[0]);
                    }
                  }}
                />
                {globalSearchInput.trim().length > 0 ? (
                  <button
                    type="button"
                    className="global-search-clear"
                    aria-label={language === "tr" ? "Aramayı temizle" : "Clear search"}
                    onClick={() => {
                      setGlobalSearchInput("");
                      setGlobalSearchResults([]);
                      setGlobalSearchLoading(false);
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </label>
            </div>
            <div className="global-search-results-shell" onClick={(event) => event.stopPropagation()}>
              {globalSearchQuery.length < globalSearchMinChars ? null : globalSearchLoading ? (
                <p className="global-search-empty">{language === "tr" ? "Aranıyor..." : "Searching..."}</p>
              ) : globalSearchResults.length === 0 ? (
                <p className="global-search-empty">{language === "tr" ? "Sonuç bulunamadı." : "No results found."}</p>
              ) : (
                <div className="global-search-list">
                  {globalSearchResults.map((item) => (
                    <button
                      key={`${item.kind}-${item.id}`}
                      type="button"
                      className="global-search-item"
                      onClick={() => onSelectGlobalResult(item)}
                    >
                      <span className={`global-search-kind kind-${item.kind}`}>{globalKindLabel(item.kind)}</span>
                      <span className="global-search-texts">
                        <strong>{renderGlobalSearchHighlight(item.primaryText, globalSearchQuery)}</strong>
                        <small>{renderGlobalSearchHighlight(item.secondaryText, globalSearchQuery)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      <Outlet />
    </main>
  );
}

function TopNavTabs({
  pathname,
  dict,
  isSuperAdmin,
  language,
}: {
  pathname: string;
  dict: Dictionary;
  isSuperAdmin: boolean;
  language: Language;
}) {
  const items = [
    { to: "/app/dashboard", active: pathname === "/app/dashboard", label: dict.menu.dashboard },
    { to: "/app/buyers", active: pathname.startsWith("/app/buyers"), label: dict.menu.buyers },
    { to: "/app/sellers", active: pathname.startsWith("/app/sellers"), label: dict.menu.sellers },
    { to: "/app/orders", active: pathname.startsWith("/app/orders"), label: dict.menu.orders },
    { to: "/app/foods", active: pathname.startsWith("/app/foods"), label: dict.menu.foods },
    { to: "/app/investigation", active: pathname.startsWith("/app/investigation"), label: dict.menu.investigation },
  ];
  const managementItems = [
    { to: "/app/users", active: pathname.startsWith("/app/users"), label: dict.menu.appUsers },
    { to: "/app/admins", active: pathname.startsWith("/app/admins"), label: dict.menu.admins },
    { to: "/app/order-flow", active: pathname.startsWith("/app/order-flow"), label: dict.menu.orderFlow },
    { to: "/app/compliance-documents", active: pathname.startsWith("/app/compliance-documents"), label: dict.menu.complianceDocuments },
    { to: "/app/test-scenarios", active: pathname.startsWith("/app/test-scenarios"), label: dict.menu.testScenarios },
    { to: "/app/test-notifications", active: pathname.startsWith("/app/test-notifications"), label: dict.menu.testNotifications },
    { to: "/app/sales-commission-settings", active: pathname.startsWith("/app/sales-commission-settings"), label: dict.menu.salesCommissionSettings },
    { to: "/app/api-tokens", active: pathname.startsWith("/app/api-tokens"), label: dict.menu.apiTokens },
    { to: "/app/audit", active: pathname.startsWith("/app/audit"), label: dict.menu.audit },
    { to: "/app/security", active: pathname.startsWith("/app/security"), label: dict.menu.security },
    { to: "/app/entities", active: pathname.startsWith("/app/entities"), label: dict.menu.dataExplorer },
  ];
  const docsUrl = `${API_BASE || ""}/v1/docs`;
  const isManagementActive = managementItems.some((item) => item.active);
  const [isManagementOpen, setIsManagementOpen] = useState(false);
  const [isCompactNavOpen, setIsCompactNavOpen] = useState(false);
  const [isResettingDb, setIsResettingDb] = useState(false);
  const [isSeedingDemoData, setIsSeedingDemoData] = useState(false);
  const [gitCommit, setGitCommit] = useState<string>("unknown");
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setIsCompactNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    request("/v1/admin/system/version")
      .then(async (response) => {
        if (response.status !== 200) return;
        const body = await parseJson<{ data?: { commit?: string } }>(response);
        const commit = body.data?.commit?.trim();
        if (commit) setGitCommit(commit);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!menuRef.current.contains(target)) {
        setIsManagementOpen(false);
        setIsCompactNavOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsManagementOpen(false);
        setIsCompactNavOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  async function resetDatabaseFromAdminMenu() {
    if (!isSuperAdmin || isResettingDb) return;

    const firstConfirm = window.confirm(
      language === "tr"
        ? "Bu işlem veritabanındaki tüm kayıtları siler ve şemayı baştan kurar. Devam edilsin mi?"
        : "This action deletes all records and reinitializes the schema. Continue?"
    );
    if (!firstConfirm) return;

    const promptText = window.prompt(
      language === "tr" ? 'Onaylamak için "RESET DATABASE" yazın:' : 'Type "RESET DATABASE" to confirm:'
    );
    if (promptText !== "RESET DATABASE") {
      window.alert(language === "tr" ? "Doğrulama metni eşleşmedi. İşlem iptal edildi." : "Confirmation text mismatch. Operation cancelled.");
      return;
    }

    try {
      setIsResettingDb(true);
      const response = await request("/v1/admin/system/reset-database", {
        method: "POST",
        body: JSON.stringify({ confirmText: "RESET DATABASE" }),
      });
      const body = await parseJson<ApiError & { data?: { message?: string } }>(response);
      if (response.status !== 200) {
        window.alert(body.error?.message ?? (language === "tr" ? "Veritabanı sıfırlama başarısız." : "Database reset failed."));
        return;
      }
      window.alert(body.data?.message ?? (language === "tr" ? "Veritabanı sıfırlandı." : "Database reset complete."));
      window.location.reload();
    } catch {
      window.alert(language === "tr" ? "Veritabanı sıfırlama isteği başarısız." : "Database reset request failed.");
    } finally {
      setIsResettingDb(false);
      setIsManagementOpen(false);
    }
  }

  async function seedDemoDataFromAdminMenu() {
    if (!isSuperAdmin || isSeedingDemoData) return;

    const firstConfirm = window.confirm(
      language === "tr"
        ? "Bu işlem demo alıcı, satıcı, yemek ve sipariş verisi ekler. Devam edilsin mi?"
        : "This action seeds demo buyer, seller, food, and order data. Continue?"
    );
    if (!firstConfirm) return;

    const promptText = window.prompt(
      language === "tr" ? 'Onaylamak için "SEED DEMO DATA" yazın:' : 'Type "SEED DEMO DATA" to confirm:'
    );
    if (promptText !== "SEED DEMO DATA") {
      window.alert(language === "tr" ? "Doğrulama metni eşleşmedi. İşlem iptal edildi." : "Confirmation text mismatch. Operation cancelled.");
      return;
    }

    try {
      setIsSeedingDemoData(true);
      const response = await request("/v1/admin/system/seed-demo-data", {
        method: "POST",
        body: JSON.stringify({ confirmText: "SEED DEMO DATA" }),
      });
      const body = await parseJson<ApiError & { data?: { message?: string; sellerEmail?: string; buyerEmail?: string; defaultPassword?: string } }>(response);
      if (response.status !== 200) {
        window.alert(body.error?.message ?? (language === "tr" ? "Demo veri ekleme başarısız." : "Demo data seed failed."));
        return;
      }

      const sellerEmail = body.data?.sellerEmail ?? "demo.seller@coziyoo.local";
      const buyerEmail = body.data?.buyerEmail ?? "demo.buyer@coziyoo.local";
      const password = body.data?.defaultPassword ?? "Demo12345!";
      window.alert(
        language === "tr"
          ? `Demo veriler eklendi.\nSatici: ${sellerEmail}\nAlici: ${buyerEmail}\nSifre: ${password}`
          : `Demo data seeded.\nSeller: ${sellerEmail}\nBuyer: ${buyerEmail}\nPassword: ${password}`
      );
      window.location.reload();
    } catch {
      window.alert(language === "tr" ? "Demo veri isteği başarısız." : "Demo seed request failed.");
    } finally {
      setIsSeedingDemoData(false);
      setIsManagementOpen(false);
    }
  }

  return (
    <div className="nav-wrap" ref={menuRef}>
      <button
        className={`nav-hamburger ${isCompactNavOpen ? "is-active" : ""}`}
        type="button"
        aria-label={language === "tr" ? "Menüyü aç/kapat" : "Toggle menu"}
        aria-expanded={isCompactNavOpen}
        onClick={() => setIsCompactNavOpen((open) => !open)}
      >
        <span aria-hidden="true">{isCompactNavOpen ? "✕" : "☰"}</span>
      </button>
      <nav className={`nav ${isCompactNavOpen ? "is-open" : ""}`}>
        {items.map((item) => (
          <Link
            key={item.to}
            className={`nav-link ${item.active ? "is-active" : ""}`}
            to={item.to}
            onClick={() => {
              setIsManagementOpen(false);
              setIsCompactNavOpen(false);
            }}
          >
            {item.label}
          </Link>
        ))}
        <button
          className={`nav-link nav-link-button ${isManagementActive ? "is-active" : ""}`}
          onClick={() => {
            setIsManagementOpen((open) => !open);
            setIsCompactNavOpen(true);
          }}
          type="button"
        >
          {dict.menu.management}
        </button>
      </nav>
      {isManagementOpen ? (
        <div className="nav-submenu">
          {managementItems.map((item) => (
            <Link
              key={item.to}
              className={`nav-link ${item.active ? "is-active" : ""}`}
              to={item.to}
              onClick={() => setIsManagementOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          <a
            className="nav-link"
            href={docsUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={() => setIsManagementOpen(false)}
          >
            {dict.menu.apiDocs}
          </a>
          {isSuperAdmin ? (
            <button className="nav-link nav-link-button" type="button" onClick={() => seedDemoDataFromAdminMenu()}>
              {isSeedingDemoData ? (language === "tr" ? "Ekleniyor..." : "Seeding...") : (language === "tr" ? "Demo Veri Ekle" : "Seed Demo Data")}
            </button>
          ) : null}
          {isSuperAdmin ? (
            <button className="nav-link nav-link-button nav-link-danger" type="button" onClick={() => resetDatabaseFromAdminMenu()}>
              {isResettingDb ? (language === "tr" ? "Sıfırlanıyor..." : "Resetting...") : dict.actions.resetDatabase}
            </button>
          ) : null}
          <div className="nav-submenu-meta" title={language === "tr" ? "Mevcut commit" : "Current commit"}>
            {`Commit: ${gitCommit}`}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AppShell;
