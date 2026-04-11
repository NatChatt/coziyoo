# CLAUDE.md — apps/django

Django monolith: REST API (DRF) + Admin UI (django-unfold). Port 9000.

---

## Dizin Yapısı

```
apps/django/
├── manage.py
├── gunicorn.conf.py
├── requirements.txt
├── coziyoo/                     # Proje konfigürasyonu
│   ├── settings/
│   │   ├── base.py              # Ortak ayarlar (DB, JWT, DRF, CORS, S3, unfold navbar)
│   │   ├── development.py       # DEBUG=True, CORS açık, SQL log
│   │   └── production.py        # DEBUG=False, whitenoise, secure cookies
│   ├── urls.py                  # Tüm URL rotaları
│   ├── exceptions.py            # DRF custom exception handler
│   ├── health.py                # GET /v1/health/
│   ├── admin_search.py          # POST /admin/global-search/
│   └── s3.py                    # S3 presigned URL yardımcıları
├── apps/                        # Domain modülleri
│   ├── authentication/          # Kullanıcı/admin auth, JWT, güvenlik, admin REST views
│   ├── orders/                  # Sipariş yönetimi
│   ├── foods/                   # Ürün + kategori + satıcı görünümleri
│   ├── payments/                # Ödeme kayıtları
│   ├── complaints/              # Şikayet + bilet sistemi
│   ├── compliance/              # Satıcı belge doğrulama
│   ├── finance/                 # Komisyon / finans
│   └── notifications/           # Bildirim modeli
└── templates/
    └── admin/                   # Django admin HTML override'ları (django-unfold)
        ├── base.html
        ├── nav_sidebar.html     # Kullanılmıyor — top navbar'a taşındı
        ├── nav_topbar.html      # Top navbar (sidebar'ın yerine geçti)
        └── authentication/
            ├── buyer_detail.html
            ├── seller_detail.html
            └── users/
                └── change_list.html
```

Her `apps/<domain>/` altındaki dosyalar:

| Dosya | Amaç |
|-------|------|
| `models.py` | `managed=False` — Supabase tablolarına eşlenmiş, migration oluşturulmaz |
| `serializers.py` | DRF serializer'ları |
| `views.py` | API view'ları (APIView / ViewSet) |
| `urls.py` | URL tanımları |
| `admin.py` | Django admin kaydı (UnfoldModelAdmin) |

`authentication` app'inin URL'leri üç dosyaya bölünmüştür:
- `urls/app.py` → buyer/seller auth (`/v1/auth/`)
- `urls/admin_auth.py` → admin login (`/v1/admin/auth/`)
- `urls/admin_panel.py` → admin REST endpointleri (`/v1/admin/`)

---

## URL Haritası

```
/                              → redirect /admin/
/admin/                        → Django admin UI (django-unfold)
/admin/global-search/          → Global arama

/v1/health/                    → Sağlık kontrolü

/v1/auth/                      → Buyer/seller JWT auth (login, refresh, register)
/v1/admin/auth/                → Admin JWT auth (login, refresh)
/v1/admin/                     → Admin REST endpointleri (dashboard, user mgmt, vb.)

/v1/orders/                    → Sipariş CRUD
/v1/foods/                     → Ürün listeleme (buyer/public)
/v1/seller/                    → Satıcı ürün yönetimi (foods/urls_seller.py)
/v1/payments/                  → Ödeme kayıtları
/v1/notifications/             → Bildirimler
/v1/complaints/                → Şikayet oluşturma/listeleme
/v1/tickets/                   → Destek biletleri
/v1/finance/                   → Finans/komisyon
/v1/seller/compliance/         → Satıcı belge yükleme
/v1/admin/compliance/          → Admin belge inceleme
```

---

## Authentication

İki JWT realm, tek backend (`CoziyooJWTAuthentication` — `apps/authentication/backends.py`):

| Realm | Secret env | Kullanım |
|-------|-----------|---------|
| `app` | `APP_JWT_SECRET` | Buyer / Seller mobil |
| `admin` | `ADMIN_JWT_SECRET` | Admin panel |

Backend önce imzasız decode ederek token içindeki `realm` claim'ini okur, sonra doğru secret ile doğrular.

`request.user` standart Django ORM User **değil**, `AuthUser` nesnesidir:
- `request.user.id` — UUID string
- `request.user.realm` — `"app"` veya `"admin"`
- `request.user.role` — token içindeki rol
- `request.user.session_id`

Admin kontrolü: `request.user.realm != 'admin'`

`request.user.is_staff`, `.groups`, `.has_perm()` gibi Django ORM özellikleri çalışmaz.

---

## Modeller

Tüm modeller `managed = False` (Supabase'deki mevcut tablolara eşlenmiş, inspectdb çıktısı).

**`makemigrations` çalıştırma.** Şema değişiklikleri Supabase tarafında yapılır, ardından `models.py` güncellenir.

```python
class Meta:
    managed = False
    db_table = 'tablo_adi'
```

---

## API Response Kuralı

Tüm yanıtlar `application/json`. Hata formatı:

```json
{ "error": { "code": "HATA_KODU", "message": "İnsan okunabilir mesaj" } }
```

HTTP: 401 = kimlik doğrulanmamış, 403 = yetkisiz.

Custom exception handler: `coziyoo/exceptions.py`

DRF genel ayarları (`settings/base.py`):
- Sayfalama: `PageNumberPagination`, `PAGE_SIZE=20`
- Throttling: anon `120/min`, user `300/min`, login `10/min`
- Filter backends: DjangoFilterBackend + SearchFilter + OrderingFilter
- Renderer: sadece JSON (`JSONRenderer`)

---

## Admin UI (django-unfold)

Admin template'leri `templates/admin/` altında. **Herhangi bir template dosyasını düzenlemeden önce ve sonra `coziyoo-design-system` skill'ini çağır.**

### Tasarım Sistemi Özeti

KPI kart renk sistemi (tonal):

| Rol | Tailwind sınıfları |
|-----|-------------------|
| Toplam / Nötr | `bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800` |
| Pozitif / Aktif | `bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800` |
| Uyarı / Harcama | `bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800` |
| Tehlike / Risk | `bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800` |

Tablo hover: `hover:bg-base-100/40 dark:hover:bg-base-700/30 transition-colors`

Birincil renk: mor (`primary-600` = `#9333ea`)

### Admin Kart Ritmi

Admin dashboard ve detail ekranlarindaki kartlarda asagidaki ritim korunmali:

- Kart ici padding "sikisik" olmamali. Kucuk kartlarda minimum `px-4 py-4`, orta/buyuk kartlarda minimum `px-5 py-4` kullan.
- Ikon kutusu, metin blogu ve sagdaki badge/deger ayni dikey eksende ortali ya da bilincli bicimde `items-start` ile hizali olmali; "yarim center" gorunumu olmamali.
- Baslik ile aciklama arasinda minimum `mt-1`, aciklama satirinda da rahat okunur line-height (`leading-5`) kullan.
- Kart gruplari arasinda nefes birak. Ust panel ile alt kart listeleri arasinda minimum `space-y-4` veya esdeger bosluk kullan.
- Tiklanabilir kartlar bilgi kartlarindan ayri gorunmeli:
  - tiklanabilir/action kart: yon oku, hover hareketi veya daha belirgin border/zemin
  - salt bilgi karti: daha sakin arka plan, daha az hareket
- Kart tasarlarken "tek bakista tarama" testi uygula: ikon, baslik, alt metin ve sayi birbirine yapisik gorunuyorsa spacing yetersizdir.
- Yeni admin karti eklerken mevcut iyi referans olarak `templates/admin/index.html` icindeki live activity kart ritmini izle.

### Buyer/Seller Detail Header

5 sütunlu grid: `grid grid-cols-5 gap-4 items-center`
- Col 1: Profil (avatar + isim + düzenle butonu)
- Col 2: Boş spacer
- Col 3–5: KPI kartları (rose / emerald / blue)

### Top Navbar Navigasyonu

Navigasyon, sol sidebar yerine sayfanın üstünde bir top navbar olarak tasarlanmıştır (`templates/admin/nav_topbar.html`).
Navbar öğeleri `coziyoo/settings/base.py` içindeki `UNFOLD["SIDEBAR"]` dict'inde tanımlanır (Unfold'un kendi config key'i):

- **Platform:** Users, Orders, Foods, Categories, Production Lots, Reviews
- **Compliance & Support:** Compliance Docs, Doc Types, Complaints, Complaint Categories
- **Settings & Security:** Admin Users, Commission Settings, API Tokens, Audit Log, Login Events

### Alpine.js + Tailwind

Template'lerde interaktivite Alpine.js ile sağlanır. `x-data`, `x-show`, `x-cloak`, Alpine.store kullanılır. Tailwind sınıfları CDN'den değil Unfold'un derlemiş olduğundan gelir — yeni utility sınıfı eklenirse Unfold'un desteklediğini doğrula.

---

## Çalıştırma

### Geliştirme

```bash
cd apps/django
pip install -r requirements.txt

# Minimum .env içeriği:
# DATABASE_URL=postgresql://...
# APP_JWT_SECRET=...
# ADMIN_JWT_SECRET=...
# DJANGO_SECRET_KEY=...

DJANGO_SETTINGS_MODULE=coziyoo.settings.development python manage.py runserver 9000
```

### Üretim (Gunicorn)

```bash
DJANGO_SETTINGS_MODULE=coziyoo.settings.production \
  gunicorn --config gunicorn.conf.py coziyoo.wsgi:application
```

`gunicorn.conf.py` ayarları:
- Bind: `GUNICORN_BIND` (default `0.0.0.0:9000`)
- Workers: `GUNICORN_WORKERS` (default `max(2, cpu_count)`)
- Timeout: `GUNICORN_TIMEOUT` (default `60s`)
- Log: `/var/log/coziyoo/django-access.log` + `django-error.log`

### Database

```bash
python manage.py migrate          # Migration uygula
python manage.py createsuperuser  # Admin kullanıcı oluştur
# Varsayılan: admin@coziyoo.com / Admin12345
```

---

## Environment Değişkenleri

`apps/django/.env` — `python-decouple` okur.

| Değişken | Açıklama |
|---------|---------|
| `DJANGO_SECRET_KEY` | Django secret key |
| `DJANGO_SETTINGS_MODULE` | `coziyoo.settings.development` veya `production` |
| `ALLOWED_HOSTS` | Virgülle ayrılmış hostlar (prod) |
| `DATABASE_URL` | PostgreSQL bağlantı URL'i (dj-database-url formatı) |
| `APP_JWT_SECRET` | Buyer/seller JWT imzalama anahtarı |
| `ADMIN_JWT_SECRET` | Admin JWT imzalama anahtarı |
| `ACCESS_TOKEN_TTL_MINUTES` | Access token ömrü (default `15`) |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh token ömrü (default `30`) |
| `CORS_ALLOWED_ORIGINS` | Virgülle ayrılmış CORS origin listesi |
| `CORS_ALLOW_ALL_ORIGINS` | `True` sadece dev'de |
| `S3_ENDPOINT` | S3 uyumlu depolama endpoint |
| `S3_REGION` | S3 bölgesi (default `us-east-1`) |
| `S3_BUCKET_SELLER_DOCS` | Satıcı belgeleri bucket adı |
| `S3_ACCESS_KEY_ID` | S3 erişim anahtarı |
| `S3_SECRET_ACCESS_KEY` | S3 gizli anahtar |
| `S3_SIGNED_URL_TTL_SECONDS` | Presigned URL geçerlilik süresi (default `900`) |
| `SUPABASE_HOST_URL` | Supabase proje URL'i (admin template Realtime) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (admin template Realtime) |
| `GUNICORN_BIND` | Bind adresi |
| `GUNICORN_WORKERS` | Worker sayısı |
| `GUNICORN_TIMEOUT` | Request timeout (saniye) |

---

## Deploy

CI/CD: `.github/workflows/deploy-django.yml` — `main`'e push → otomatik VPS deploy.
Secrets: `DEPLOY_SSH_KEY`, `DEPLOY_TARGETS`.
Her hedef: `scripts/deploy/update.sh`.

**`deploy-django.yml` ve `installation/scripts/` dosyalarını izin almadan düzenleme.**

---

## Dikkat Edilecekler

- `models.py` → `managed=False` — asla `makemigrations` çalıştırma
- `request.user` → `AuthUser` nesnesi, Django ORM User değil
- Admin template değişikliklerinde `coziyoo-design-system` skill'ini çağır
- `.github/workflows/` dosyalarına dokunma; değişiklik gerekiyorsa önce etki analizi sun
