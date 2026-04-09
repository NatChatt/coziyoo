import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
  TouchableOpacity,
  Animated,
  PanResponder,
  BackHandler,
  KeyboardAvoidingView,
} from 'react-native';
import Constants from 'expo-constants';
import OnboardingScreen from './src/screens/OnboardingScreen';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ProfileEditScreen from './src/screens/ProfileEditScreen';
import AddressScreen from './src/screens/AddressScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import OrderDetailScreen from './src/screens/OrderDetailScreen';
import FoodDetailScreen, { type FoodItem } from './src/screens/FoodDetailScreen';
import PaymentScreen from './src/screens/PaymentScreen';
import AllergenDisclosureScreen from './src/screens/AllergenDisclosureScreen';
import DeliveryPinScreen from './src/screens/DeliveryPinScreen';
import ReviewScreen from './src/screens/ReviewScreen';
import ComplaintScreen from './src/screens/ComplaintScreen';
import TicketListScreen from './src/screens/TicketListScreen';
import TicketDetailScreen from './src/screens/TicketDetailScreen';
import ChatListScreen from './src/screens/ChatListScreen';
import ChatScreen from './src/screens/ChatScreen';
import FavoritesScreen from './src/screens/FavoritesScreen';
import SellerHomeScreen from './src/screens/SellerHomeScreen';
import SellerProfileDetailScreen from './src/screens/SellerProfileDetailScreen';
import SellerProfileScreen from './src/screens/SellerProfileScreen';
import SellerFoodsScreen from './src/screens/SellerFoodsScreen';
import SellerFoodsManagerScreen from './src/screens/SellerFoodsManagerScreen';
import SellerLotsScreen from './src/screens/SellerLotsScreen';
import SellerLotCreateScreen from './src/screens/SellerLotCreateScreen';
import SellerOrdersScreen from './src/screens/SellerOrdersScreen';
import SellerOrderDetailScreen from './src/screens/SellerOrderDetailScreen';
import SellerComplianceScreen from './src/screens/SellerComplianceScreen';
import SellerFinanceScreen from './src/screens/SellerFinanceScreen';
import SellerReviewsScreen from './src/screens/SellerReviewsScreen';
import { loadAuthSession, clearAuthSession, refreshAuthSession, saveAuthSession, type AuthSession } from './src/utils/auth';
import { loadSettings, subscribeSettings } from './src/utils/settings';
import { t } from './src/copy/brandCopy';
import { theme } from './src/theme/colors';

type NotificationSubscription = { remove: () => void };

type NotificationsModule = {
  setNotificationHandler: (handler: {
    handleNotification: () => Promise<{
      shouldShowAlert: boolean;
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
      shouldShowBanner: boolean;
      shouldShowList: boolean;
    }>;
  }) => void;
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getExpoPushTokenAsync: (options?: { projectId?: string }) => Promise<{ data: string }>;
  addNotificationResponseReceivedListener: (
    listener: (response: { notification: { request: { content: { data: Record<string, unknown> } } } }) => void,
  ) => NotificationSubscription;
};

let Notifications: NotificationsModule | null = null;
try {
  Notifications = require('expo-notifications') as NotificationsModule;
} catch {
  Notifications = null;
}

if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

const NOTIFICATIONS_ENABLED = false;

async function registerPushToken(auth: AuthSession, apiUrl: string): Promise<string | null> {
  if (!NOTIFICATIONS_ENABLED || !Notifications) return null;
  try {
    const projectId =
      (Constants as any)?.easConfig?.projectId
      ?? (Constants.expoConfig as any)?.extra?.eas?.projectId
      ?? null;

    const { status: existing } = await Notifications.getPermissionsAsync();
    const { status } = existing === 'granted'
      ? { status: existing }
      : await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return null;

    const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const token = tokenData.data;
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const appVersion = String(Constants.expoConfig?.version ?? '').trim() || undefined;

    await fetch(`${apiUrl}/v1/notifications/device-token`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ token, platform, appVersion }),
    });
    return token;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    const lower = message.toLowerCase();
    const missingCapability =
      lower.includes('aps-environment')
      || lower.includes("push notifications")
      || lower.includes("capability hasn't been added");
    if (missingCapability) {
      // iOS dev/provisioning environments may not include push entitlements.
      // Treat as expected and continue without push token registration.
      console.info('[push] register skipped (missing push capability)');
      return null;
    }
    // Push registration is best-effort; never block the user
    console.warn('[push] register failed', message || error);
    return null;
  }
}

async function unregisterPushToken(auth: AuthSession, apiUrl: string, token?: string | null) {
  if (!NOTIFICATIONS_ENABLED) return;
  try {
    await fetch(`${apiUrl}/v1/notifications/device-token`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: token ? JSON.stringify({ token }) : JSON.stringify({}),
    });
  } catch {
    // Push unregistration is best-effort; never block logout
  }
}

type Screen =
  | 'loading' | 'onboarding' | 'login' | 'home'
  | 'settings' | 'profileEdit' | 'addresses'
  | 'orders' | 'orderDetail' | 'complaintOrders' | 'ticketList' | 'ticketDetail'
  | 'foodDetail' | 'payment'
  | 'allergenDisclosure' | 'deliveryPin'
  | 'review' | 'complaint'
  | 'favorites'
  | 'sellerProfileDetail' | 'sellerProfile' | 'sellerFoods' | 'sellerFoodsManager' | 'sellerLots' | 'sellerLotCreate' | 'sellerOrders' | 'sellerOrderDetail' | 'sellerCompliance' | 'sellerFinance' | 'sellerReviews'
  | 'chatList' | 'chat';

type TabKey = 'home' | 'messages' | 'cart' | 'notifications' | 'profile';
type OrderDetailBackTarget = 'orders' | 'home';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [homeTab, setHomeTab] = useState<TabKey>('home');
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [actorMode, setActorMode] = useState<'buyer' | 'seller'>('buyer');

  // Screen params
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderDetailBackTarget, setOrderDetailBackTarget] = useState<OrderDetailBackTarget>('orders');
  const [sellerOrderModalVisible, setSellerOrderModalVisible] = useState(false);
  const sheetTranslateY = useRef(new Animated.Value(0)).current;
  const sheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) {
          sheetTranslateY.setValue(gesture.dy);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 120 || gesture.vy > 0.5) {
          closeSheet();
        } else {
          Animated.spring(sheetTranslateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
        }
      },
    }),
  ).current;
  function closeSheet() {
    Animated.timing(sheetTranslateY, {
      toValue: 600,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      sheetTranslateY.setValue(0);
      setSellerOrderModalVisible(false);
    });
  }
  useEffect(() => {
    if (sellerOrderModalVisible) {
      sheetTranslateY.setValue(600);
      Animated.spring(sheetTranslateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }).start();
    }
  }, [sellerOrderModalVisible]);
  useEffect(() => {
    if (!sellerOrderModalVisible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeSheet();
      return true;
    });
    return () => sub.remove();
  }, [sellerOrderModalVisible]);
  const [sellerFoodsInitialEditId, setSellerFoodsInitialEditId] = useState<string | null>(null);
  const [sellerFoodsInitialEditFood, setSellerFoodsInitialEditFood] = useState<any | null>(null);
  const [sellerFoodsFromManager, setSellerFoodsFromManager] = useState(false);
  const [sellerLotCreatePreselectedFoodId, setSellerLotCreatePreselectedFoodId] = useState<string | undefined>(undefined);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedChatName, setSelectedChatName] = useState('');
  const [complaintBackTarget, setComplaintBackTarget] = useState<'orderDetail' | 'complaintOrders'>('orderDetail');

  const [isNewRegistration, setIsNewRegistration] = useState(false);
  const responseListener = useRef<NotificationSubscription | null>(null);
  const pushTokenRef = useRef<string | null>(null);
  const [, setLanguageVersion] = useState(0);

  useEffect(() => {
    loadAuthSession().then((stored) => {
      if (stored) {
        setAuth(stored);
        setActorMode(stored.userType === 'seller' ? 'seller' : 'buyer');
        setScreen('home');
      } else {
        setScreen('onboarding');
      }
    });
  }, []);

  useEffect(() => {
    void loadSettings().then(() => {
      setLanguageVersion((value) => value + 1);
    });
    return subscribeSettings(() => {
      setLanguageVersion((value) => value + 1);
    });
  }, []);

  // Register push token and notification listeners when auth is set
  useEffect(() => {
    if (!auth) return;
    if (!NOTIFICATIONS_ENABLED || !Notifications) return;

    loadSettings().then((s) => {
      registerPushToken(auth, s.apiUrl)
        .then((token) => { pushTokenRef.current = token ?? null; })
        .catch(() => { pushTokenRef.current = null; });
    });

    // Navigate to order detail when notification is tapped
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const orderId = data?.orderId as string | undefined;
      if (orderId) {
        setSelectedOrderId(orderId);
        setOrderDetailBackTarget('home');
        setScreen('orderDetail');
      }
    });

    return () => { responseListener.current?.remove(); };
  }, [auth]);

  function handleLogin(session: AuthSession) {
    setAuth(session);
    setActorMode(session.userType === 'seller' ? 'seller' : 'buyer');
    setScreen('home');
  }

  function handleOnboardingComplete(session: AuthSession) {
    setAuth(session);
    setActorMode(session.userType === 'seller' ? 'seller' : 'buyer');
    setIsNewRegistration(false);
    setScreen('home');
  }

  async function handleLogout() {
    const currentAuth = auth;
    setScreen('login');
    setAuth(null);
    if (currentAuth) {
      try {
        const { apiUrl } = await loadSettings();
        if (NOTIFICATIONS_ENABLED) {
          await unregisterPushToken(currentAuth, apiUrl, pushTokenRef.current);
        }
      } catch {
        // Ignore push cleanup errors on logout
      }
    }
    pushTokenRef.current = null;
    await clearAuthSession();
  }

  function goHome(tab: TabKey = 'home') {
    setHomeTab(tab);
    setScreen('home');
  }

  async function enableSellerModeAndOpen() {
    try {
      const session = auth;
      if (!session) {
        Alert.alert(t('headline.common.session'), t('error.home.sessionExpired'));
        return;
      }

      if (session.userType === 'seller' || session.userType === 'both') {
        setActorMode('seller');
        setScreen('home');
        return;
      }

      const { apiUrl } = await loadSettings();
      let currentSession: AuthSession = session;
      let response = await fetch(`${apiUrl}/v1/auth/me/enable-seller`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentSession.accessToken}`,
        },
      });

      if (response.status === 401) {
        const refreshed = await refreshAuthSession(apiUrl, currentSession);
        if (!refreshed) {
          Alert.alert(t('headline.common.session'), t('error.home.sessionExpired'));
          return;
        }
        currentSession = refreshed;
        setAuth(refreshed);
        response = await fetch(`${apiUrl}/v1/auth/me/enable-seller`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${currentSession.accessToken}`,
          },
        });
      }

      const payload = await response.json().catch(() => ({} as { error?: { message?: string }; data?: { user?: { userType?: string }; tokens?: { accessToken?: string } } }));
      if (!response.ok) {
        Alert.alert(t('headline.common.error'), payload?.error?.message ?? t('error.home.requestFailed'));
        return;
      }

      const nextUserType = payload?.data?.user?.userType ?? 'both';
      const nextAccessToken = payload?.data?.tokens?.accessToken ?? currentSession.accessToken;
      const nextSession: AuthSession = {
        ...currentSession,
        accessToken: nextAccessToken,
        userType: nextUserType,
      };
      await saveAuthSession(nextSession);
      setAuth(nextSession);
      setActorMode('seller');
      setScreen('home');
    } catch (error) {
      Alert.alert(t('headline.common.error'), error instanceof Error ? error.message : t('error.home.requestFailed'));
    }
  }

  if (screen === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  if (screen === 'onboarding' && !auth) {
    return (
      <OnboardingScreen
        onComplete={handleOnboardingComplete}
        onGoToLogin={() => setScreen('login')}
      />
    );
  }

  if (screen === 'login' || !auth) {
    return <LoginScreen onLogin={handleLogin} onGoToRegister={() => setScreen('onboarding')} />;
  }

  if (screen === 'settings') {
    return (
      <SettingsScreen
        auth={auth}
        onBack={() => goHome('profile')}
        onOpenComplaintOrders={() => setScreen('ticketList')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'ticketList') {
    return (
      <TicketListScreen
        auth={auth}
        onBack={() => setScreen('settings')}
        onCreateTicket={() => setScreen('complaintOrders')}
        onOpenTicket={(ticketId) => {
          setSelectedTicketId(ticketId);
          setScreen('ticketDetail');
        }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'ticketDetail' && selectedTicketId) {
    return (
      <TicketDetailScreen
        auth={auth}
        ticketId={selectedTicketId}
        onBack={() => setScreen('ticketList')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'profileEdit') {
    return (
      <ProfileEditScreen
        auth={auth}
        isNewRegistration={isNewRegistration}
        onBack={() => {
          if (isNewRegistration) {
            setIsNewRegistration(false);
            goHome('home');
          } else {
            goHome('profile');
          }
        }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'addresses') {
    return (
      <AddressScreen
        auth={auth}
        onBack={() => {
          if (actorMode === 'seller') setScreen('sellerProfileDetail');
          else goHome('profile');
        }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'orders') {
    return (
      <OrdersScreen
        auth={auth}
        onBack={() => goHome('home')}
        onOpenOrderDetail={(id) => {
          setSelectedOrderId(id);
          setOrderDetailBackTarget('orders');
          setScreen('orderDetail');
        }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'complaintOrders') {
    return (
      <OrdersScreen
        auth={auth}
        title={t('headline.orders.complaintTitle')}
        emptyTitle={t('headline.orders.complaintEmptyTitle')}
        emptySubtitle={t('helper.orders.complaintEmptySubtitle')}
        onBack={() => setScreen('settings')}
        onOpenOrderDetail={(id) => {
          setSelectedOrderId(id);
          setComplaintBackTarget('complaintOrders');
          setScreen('complaint');
        }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'orderDetail' && selectedOrderId) {
    return (
      <OrderDetailScreen
        auth={auth}
        orderId={selectedOrderId}
        onBack={() => {
          if (orderDetailBackTarget === 'home') goHome('home');
          else setScreen('orders');
        }}
        onOpenPayment={(id) => { setSelectedOrderId(id); setScreen('payment'); }}
        onOpenDeliveryPin={(id) => { setSelectedOrderId(id); setScreen('deliveryPin'); }}
        onOpenReview={(id) => { setSelectedOrderId(id); setScreen('review'); }}
        onOpenComplaint={(id) => {
          setSelectedOrderId(id);
          setComplaintBackTarget('orderDetail');
          setScreen('complaint');
        }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'foodDetail' && selectedFood) {
    return (
      <FoodDetailScreen
        food={selectedFood}
        onBack={() => goHome('home')}
        onAddToCart={(_food: FoodItem, _quantity: number) => goHome('cart')}
        onOpenSeller={() => goHome('home')}
      />
    );
  }

  if (screen === 'payment' && selectedOrderId) {
    return (
      <PaymentScreen
        auth={auth}
        orderId={selectedOrderId}
        onBack={() => { setScreen('orderDetail'); }}
        onPaymentComplete={() => { setScreen('orderDetail'); }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'allergenDisclosure' && selectedOrderId) {
    return (
      <AllergenDisclosureScreen
        auth={auth}
        orderId={selectedOrderId}
        onBack={() => setScreen('orderDetail')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'deliveryPin' && selectedOrderId) {
    return (
      <DeliveryPinScreen
        auth={auth}
        orderId={selectedOrderId}
        onBack={() => setScreen('orderDetail')}
        onVerified={() => goHome('home')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'review' && selectedOrderId) {
    return (
      <ReviewScreen
        auth={auth}
        orderId={selectedOrderId}
        onBack={() => setScreen('orderDetail')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'complaint' && selectedOrderId) {
    return (
      <ComplaintScreen
        auth={auth}
        orderId={selectedOrderId}
        onCreated={(ticket) => {
          setSelectedTicketId(ticket.id);
          setScreen('ticketDetail');
        }}
        onBack={() => setScreen(complaintBackTarget)}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'chatList') {
    return (
      <ChatListScreen
        auth={auth}
        onBack={() => goHome('messages')}
        onOpenChat={(chatId, name) => { setSelectedChatId(chatId); setSelectedChatName(name); setScreen('chat'); }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'chat' && selectedChatId) {
    return (
      <ChatScreen
        auth={auth}
        chatId={selectedChatId}
        sellerName={selectedChatName}
        onBack={() => setScreen('chatList')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'favorites') {
    return (
      <FavoritesScreen
        auth={auth}
        onBack={() => goHome('profile')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerProfileDetail') {
    return (
      <SellerProfileDetailScreen
        auth={auth}
        onBack={() => setScreen('home')}
        onEdit={() => setScreen('sellerProfile')}
        onOpenOrderHistory={() => setScreen('sellerOrders')}
        onOpenCompliance={() => setScreen('sellerCompliance')}
        onOpenFinance={() => setScreen('sellerFinance')}
        onOpenReviews={() => setScreen('sellerReviews')}
        onOpenSettings={() => setScreen('settings')}
        onLogout={handleLogout}
        onOpenAddresses={() => setScreen('addresses')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerProfile') {
    return (
      <SellerProfileScreen
        auth={auth}
        onBack={() => setScreen('sellerProfileDetail')}
        onOpenAddresses={() => setScreen('addresses')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerFoods') {
    return (
      <SellerFoodsScreen
        auth={auth}
        initialEditFoodId={sellerFoodsInitialEditId}
        initialEditFood={sellerFoodsInitialEditFood}
        onBack={() => setScreen(sellerFoodsFromManager ? 'sellerFoodsManager' : 'home')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerFoodsManager') {
    return (
      <SellerFoodsManagerScreen
        auth={auth}
        onBack={() => setScreen('home')}
        onOpenFoodsForm={(mode, foodId, food) => {
          setSellerFoodsFromManager(true);
          setSellerFoodsInitialEditId(mode === 'edit' ? (foodId ?? null) : null);
          setSellerFoodsInitialEditFood(mode === 'edit' ? (food ?? null) : null);
          setScreen('sellerFoods');
        }}
        onOpenLotCreate={(foodId) => {
          setSellerLotCreatePreselectedFoodId(foodId);
          setScreen('sellerLotCreate');
        }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerLots') {
    return (
      <SellerLotsScreen
        auth={auth}
        onBack={() => setScreen('home')}
        onOpenLotCreate={() => {
          setSellerLotCreatePreselectedFoodId(undefined);
          setScreen('sellerLotCreate');
        }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerLotCreate') {
    return (
      <SellerLotCreateScreen
        auth={auth}
        onBack={() => setScreen('sellerLots')}
        preselectedFoodId={sellerLotCreatePreselectedFoodId}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerOrders') {
    return (
      <SellerOrdersScreen
        auth={auth}
        onBack={() => setScreen('sellerProfileDetail')}
        onOpenOrder={(id) => { setSelectedOrderId(id); setScreen('sellerOrderDetail'); }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerOrderDetail' && selectedOrderId) {
    return (
      <SellerOrderDetailScreen
        auth={auth}
        orderId={selectedOrderId}
        onBack={() => setScreen('sellerOrders')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerCompliance') {
    return (
      <SellerComplianceScreen
        auth={auth}
        onBack={() => setScreen('home')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerFinance') {
    return (
      <SellerFinanceScreen
        auth={auth}
        onBack={() => setScreen('home')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerReviews') {
    return (
      <SellerReviewsScreen
        auth={auth}
        onBack={() => setScreen('sellerProfileDetail')}
        onAuthRefresh={setAuth}
      />
    );
  }

  const canSwitchRole = auth.userType === 'both';
  if (actorMode === 'seller' && screen === 'home') {
    return (
      <>
        <SellerHomeScreen
          auth={auth}
          onOpenProfile={() => setScreen('sellerProfileDetail')}
          onOpenFinance={() => setScreen('sellerFinance')}
          onOpenLots={() => setScreen('sellerLots')}
          onOpenFoodsManager={(foodId) => {
            if (foodId) {
              setSellerFoodsFromManager(false);
              setSellerFoodsInitialEditId(foodId);
              setSellerFoodsInitialEditFood(null);
              setScreen('sellerFoods');
              return;
            }
            setScreen('sellerFoodsManager');
          }}
          onOpenOrder={(id) => {
            setSelectedOrderId(id);
            sheetTranslateY.setValue(0);
            setSellerOrderModalVisible(true);
          }}
          onAuthRefresh={setAuth}
          onSwitchToBuyer={canSwitchRole ? () => setActorMode('buyer') : undefined}
        />
        {sellerOrderModalVisible && selectedOrderId ? (
          <KeyboardAvoidingView
            style={styles.sheetOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          >
            <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={closeSheet} />
            <Animated.View style={[styles.sheetCard, { transform: [{ translateY: sheetTranslateY }] }]}>
              <View style={styles.sheetGrabberTouchArea} {...sheetPanResponder.panHandlers}>
                <View style={styles.sheetGrabber} />
              </View>
              <SellerOrderDetailScreen
                auth={auth}
                orderId={selectedOrderId}
                onBack={closeSheet}
                onAuthRefresh={setAuth}
              />
            </Animated.View>
          </KeyboardAvoidingView>
        ) : null}
      </>
    );
  }

  return (
    <HomeScreen
      auth={auth}
      initialTab={homeTab}
      onOpenSettings={() => setScreen('settings')}
      onOpenOrders={() => setScreen('orders')}
      onOpenChatList={() => setScreen('chatList')}
      onOpenFavorites={() => setScreen('favorites')}
      onOpenFoodDetail={(food: FoodItem) => { setSelectedFood(food); setScreen('foodDetail'); }}
      onLogout={handleLogout}
      onAuthRefresh={setAuth}
      onSwitchToSeller={auth.userType === 'seller' || auth.userType === 'both' || auth.userType === 'buyer'
        ? () => { void enableSellerModeAndOpen(); }
        : undefined}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: theme.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
    zIndex: 999,
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheetCard: {
    height: '88%',
    backgroundColor: '#F7F4EF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  sheetGrabberTouchArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 2,
  },
  sheetGrabber: {
    width: 52,
    height: 5,
    borderRadius: 99,
    backgroundColor: '#D2C8BA',
    alignSelf: 'center',
  },
});
