# CLAUDE.md

Coziyoo v2 — ev yemeklerini komşulara bağlayan bir sipariş marketplace'i.

## Aktif Servisler

| Servis | Stack | Port | Açıklama |
|--------|-------|------|---------|
| `apps/django` | Django + DRF + Python | 9000 | REST API + Admin paneli (monolith) |
| `apps/mobile` | Expo + React Native | Expo | Buyer/seller mobil uygulama |

Production/dev ingress (aktif durum):
- `api.coziyoo.com` ve `admin.coziyoo.com` Cloudflare Tunnel üzerinden bu Mac'teki `127.0.0.1:9000` adresine gider.
- Tunnel config: `/Users/ismetkarakus/.cloudflared/config.yml`
- Port `9000`: local Django LaunchAgent `com.coziyoo.django-dev`
- Django komutu: `manage.py runserver 0.0.0.0:9000 --noreload`
- Settings: `coziyoo.settings.development`
- Admin/template degisikliginden sonra sadece GitHub Actions/VPS deploy yeterli degildir; local Django LaunchAgent restart edilmelidir:

```bash
bash scripts/deploy/restart-local-tunnel-django.sh
```

---

## Repo Yapısı

```
apps/
  django/          # Backend + Admin — tüm API ve admin detayları için apps/django/CLAUDE.md
  mobile/          # Expo React Native uygulaması
  api/             # DEVRE DIŞI — Node.js/Express (dokunma)
  admin/           # DEVRE DIŞI — React admin (dokunma)
scripts/
  deploy/
    install.sh     # VPS ilk kurulum
    update.sh      # Güncelleme + servis yeniden başlatma
    deploy.sh      # Yerel → SSH ile VPS tetikleme
    generate-env.sh
installation/
  config.env       # VPS'e özgü ayarlar
.github/
  workflows/
    deploy-django.yml  # main'e push → VPS'e otomatik deploy (KORUMALI)
```

---

## Hızlı Başlangıç

### Django (Backend + Admin)

```bash
cd apps/django
pip install -r requirements.txt
# apps/django/.env dosyası gerekli (DATABASE_URL, APP_JWT_SECRET, ADMIN_JWT_SECRET, DJANGO_SECRET_KEY)
DJANGO_SETTINGS_MODULE=coziyoo.settings.development python manage.py runserver 9000
```

Detaylar: [`apps/django/CLAUDE.md`](apps/django/CLAUDE.md)

### Mobile

```bash
cd apps/mobile
npm install
npm run ios      # veya npm run android
```

### VPS Deploy

```bash
bash scripts/deploy/deploy.sh   # Yerel makineden SSH ile tetikle
```

---

## Mobile Uygulama (`apps/mobile`)

### Yapı

```
App.tsx                  # Root component — navigation state makinesi (stack tabanlı)
src/
  screens/               # Tüm ekranlar
  components/            # Paylaşılan UI bileşenleri
  utils/
    api.ts               # apiRequest() — tüm API çağrılarının tek giriş noktası
    auth.ts              # AuthSession tipi, AsyncStorage JWT yönetimi
    settings.ts          # apiUrl + dil ayarları (AsyncStorage)
    realtime.ts          # Supabase Realtime bağlantısı
    sellerFoodsCache.ts  # Satıcı ürün önbelleği
    sellerOrdersCache.ts # Satıcı sipariş önbelleği
    sellerProfileCache.ts
    http.ts              # Düşük seviyeli fetch yardımcıları
    actorRole.ts         # buyer/seller rol belirleme
    profileImage.ts      # Profil resmi URL çözümleme
  copy/
    brandCopy.ts         # TÜM Türkçe UI metinleri — tek kaynak
  theme/
    colors.ts            # Renk sistemi
  constants/
    foodCategories.ts    # Yemek kategorileri sabitleri
```

### Ekranlar

**Buyer akışı:**
- `OnboardingScreen` → `LoginScreen` → `HomeScreen`
- `FoodDetailScreen` → `PaymentScreen` → `AllergenDisclosureScreen`
- `OrdersScreen` → `OrderDetailScreen` → `DeliveryPinScreen` → `ReviewScreen`
- `ComplaintScreen`, `TicketListScreen`, `TicketDetailScreen`
- `ChatListScreen`, `ChatScreen`, `FavoritesScreen`
- `AddressScreen`, `NotificationsScreen`, `ProfileEditScreen`, `SettingsScreen`

**Seller akışı:**
- `SellerHomeScreen` → `SellerOrdersScreen` → `SellerOrderDetailScreen`
- `SellerFoodsScreen` → `SellerFoodsManagerScreen` → `SellerLotsScreen`
- `SellerProfileScreen` → `SellerProfileDetailScreen`
- `SellerComplianceScreen`, `SellerFinanceScreen`, `SellerReviewsScreen`

### Navigation

`App.tsx` — React Navigation yok. Ekran stack'i ve aktif ekran state olarak `App.tsx` içinde yönetilir. Ekran geçişleri prop drilling ile yapılır.

### API İstemcisi

Tüm API çağrıları `src/utils/api.ts` → `apiRequest()` üzerinden geçer:

```ts
const result = await apiRequest<T>(path, authSession, { method, body, actorRole });
// result.ok === true  → result.data
// result.ok === false → result.status, result.code, result.message
```

- `apiUrl` çalışma zamanında `settings.ts`'ten okunur (AsyncStorage + `EXPO_PUBLIC_API_URL`)
- Header: `Authorization: Bearer <token>`
- Buyer/seller her ikisi de olan kullanıcılar için: `x-actor-role: buyer | seller`
- Token süresi dolunca otomatik refresh denenir

### Auth

`src/utils/auth.ts` — `AuthSession` tipi:

```ts
type AuthSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  userType: string;  // "buyer" | "seller" | "both"
  email: string;
};
```

AsyncStorage key: `@coziyoo:auth`

### Marka Metinleri (brandCopy.ts)

**Kullanıcıya gösterilen hiçbir metin doğrudan ekran dosyasına yazılmaz.** Her metin önce `src/copy/brandCopy.ts`'e eklenir, ekranda `t('key')` ile kullanılır.

Marka sesi kuralları (sabit — sadece proje sahibi değiştirebilir):
- Tam Türkçe, samimi "sen" tonu, kısa ve doğrudan cümleler
- Kurumsal/robotik dil yok, Türkçe/İngilizce karışık UI yok
- Sabit slogan: `Komşunun mutfağından, kapına.` (Home hero kartında, arama çubuğunun altında)

### Çevre Değişkeni

| Değişken | Açıklama |
|---------|---------|
| `EXPO_PUBLIC_API_URL` | API base URL (default: `https://api.coziyoo.com`) |

Dev'de fiziksel cihaz kullanılıyorsa `settings.ts` Expo'nun `hostUri`'sinden makine IP'sini otomatik çözer.

---

## CI/CD

GitHub Actions: `.github/workflows/deploy-django.yml`
- Tetikleyici: `main`'e push
- Her hedef VPS'te `scripts/deploy/update.sh` çalıştırır
- Gerekli secrets: `DEPLOY_SSH_KEY`, `DEPLOY_TARGETS`

**Bu dosyayı ve `installation/scripts/` altındaki script'leri izin almadan düzenleme.**

---

## Git Workflow

Kod değişikliklerini tamamladıktan sonra her zaman:

```bash
git pull --rebase --autostash
git push
```

Sormayı bekleme, bunu varsayılan olarak uygula.

---

## Korumalı Dosyalar

Aşağıdaki dosyaları izin almadan düzenleme. Değişiklik gerekliyse etki analizi sun ve onay iste:

- `.github/workflows/*`
- `installation/scripts/update_all.sh`
- `installation/scripts/apply_post_deploy_db_updates.sh`
- `installation/scripts/db-migrate.sh`
