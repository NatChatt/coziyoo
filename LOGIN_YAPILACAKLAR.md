# Yapilacak Olanlar

Bu dokuman, ilk acilis, onboarding, alici/satici register, login ve hesap tamamlama akislarindaki eksikleri birlikte netlestirmek icin calisma listesidir.

Her bolum tek tek incelenecek. Kullanici tarafindan dogrulanan, degistirilen veya artik gerekli olmayan maddeler bu dokumanda guncellenecek. Tamamlanan maddeler ustu cizilerek kapatilacak.

## 1. Satici Register Akisi

Mevcut tespit:
- `LoginScreen` register akisinda kullanici her zaman `buyer` olarak kaydediliyor.
- Satici olmak isteyen kullanici daha sonra uygulama icinden seller mode'a geciriliyor.

Yapilacaklar:
- [ ] Register ekranina "Alici olarak devam et" / "Satici olarak basvur" secimi eklenecek.
- [ ] Satici secilirse ayri bir seller onboarding/basvuru akisi acilacak.
- [ ] Satici icin minimum bilgiler netlestirilecek:
  - [ ] Mutfak adi
  - [ ] Sehir / ilce
  - [ ] Telefon
  - [ ] Adres
  - [ ] Teslimat tercihi
  - [ ] Kategori
  - [ ] Profil veya home card fotografi

Notlar:
- Bu bolum kullanici tarafindan tekrar incelenecek.

## 2. Register Ekraninda Demo Veri

Mevcut tespit:
- Register'a basinca demo alici bilgileri otomatik dolduruluyor.
- Bu davranis gercek launch icin uygun degil.

Yapilacaklar:
- [ ] Demo otomatik doldurma production'da kapatilacak.
- [ ] Demo otomatik doldurma gerekiyorsa sadece dev/internal build'de acik olacak.
- [ ] Production register formu bos gelecek.

Notlar:
- Demo davranisinin tamamen kaldirilip kaldirilmayacagi netlestirilecek.

## 3. Hizli Alici/Satici Giris Butonlari

Mevcut tespit:
- Login ekraninda hizli alici ve hizli satici giris butonlari gorunuyor.
- Demo icin faydali, production icin guven ve profesyonellik riski.

Yapilacaklar:
- [ ] Hizli giris butonlari `__DEV__` veya `EXPO_PUBLIC_ENABLE_DEMO_LOGIN=true` gibi bir flag arkasina alinacak.
- [ ] Store/production build'lerinde tamamen gizlenecek.

Notlar:
- Internal test build'lerinde gorunup gorunmeyecegi kararlastirilacak.

## 4. Telefon Dogrulama

Mevcut tespit:
- Register sonrasi telefon ve OTP ekranlari var.
- Gercek SMS/OTP gonderimi ve backend dogrulamasi yok.
- OTP demo davranisi ile geciliyor.

Yapilacaklar:
- [ ] SMS saglayici secilecek.
- [ ] `/auth/phone/request-code` endpoint'i eklenecek.
- [ ] `/auth/phone/verify-code` endpoint'i eklenecek.
- [ ] Telefon dogrulanmadan kullanici `verified` sayilmayacak.
- [ ] Satici icin telefon dogrulama zorunlu olacak.

Notlar:
- SMS saglayici, ulke formati ve maliyet karari ayrica verilecek.

## 5. Sifre Sifirlama

Mevcut tespit:
- Sifre sifirlama request endpoint'i basarili donuyor.
- Confirm endpoint'i henuz gercek sifre guncellemesi yapmiyor.

Yapilacaklar:
- [ ] Reset code uretimi eklenecek.
- [ ] Reset code TTL ve retry/rate limit kurgusu eklenecek.
- [ ] Email veya SMS ile kod gonderimi eklenecek.
- [ ] Confirm endpoint'i sifreyi gercekten guncelleyecek.
- [ ] Mobil hata mesajlari gercek akisla uyumlu hale getirilecek.

Notlar:
- Reset kanali email mi SMS mi olacak netlestirilecek.

## 6. Yeni Kayit Sonrasi Profil Tamamlama

Mevcut tespit:
- `isNewRegistration` state'i var, ancak register sonrasi kullanici direkt home'a gidiyor.
- Profil tamamlama zorunlu degil.

Yapilacaklar:
- [ ] Alici icin minimum profil tamamlama akisi belirlenecek:
  - [ ] Ad soyad
  - [ ] Telefon
  - [ ] Varsayilan adres
- [ ] Satici icin profile wizard belirlenecek:
  - [ ] Kimlik bilgileri
  - [ ] Mutfak bilgileri
  - [ ] Belge yukleme
  - [ ] Odeme/IBAN bilgileri
- [ ] Profil tamamlanmadan kritik aksiyonlar kisitlanacak.

Notlar:
- Hangi alanlar zorunlu, hangileri opsiyonel olacak kullanici tarafindan netlestirilecek.

## 7. Onboarding Rol Secimi

Mevcut tespit:
- Ilk acilis onboarding tanitim odakli.
- Kullaniciya alici/satici secimi yaptirmiyor.

Yapilacaklar:
- [ ] Onboarding sonunda rol secimi eklenecek.
- [ ] "Yemek almak istiyorum" secen buyer register/login akisina gidecek.
- [ ] "Yemek satmak istiyorum" secen seller basvuru/register akisina gidecek.
- [ ] "Zaten hesabim var" linki her zaman gorunur olacak.

Notlar:
- Onboarding ekran sayisi ve metinleri tekrar tasarlanacak.

## 8. Saticiya Donus / Seller Mode

Mevcut tespit:
- Alici kullanici uygulama icinden kolayca seller mode'a geciriliyor.
- Belge, profil ve admin onayi akisindan gecmeden saticilik acilabiliyor gibi gorunuyor.

Yapilacaklar:
- [ ] Kullanici dogrudan seller yapilmayacak.
- [ ] `seller_application_status` benzeri bir durum modeli netlestirilecek:
  - [ ] `draft`
  - [ ] `pending`
  - [ ] `approved`
  - [ ] `rejected`
- [ ] Admin onayi gelmeden yemek yayinlama kapali olacak.
- [ ] Admin onayi gelmeden siparis alma kapali olacak.

Notlar:
- Mevcut backend/admin tarafinda olan alanlar yeniden incelenecek.

## 9. Register Backend Validasyonu

Mevcut tespit:
- Backend register email/password minimum kontrolu yapiyor.
- `userType` disaridan gelen degerle yaziliyor.
- Display name ve username validasyonu sinirli.

Yapilacaklar:
- [ ] `userType` izinli degerlerle sinirlanacak.
- [ ] Public register'da dogrudan `seller` veya `both` kabul edilmeyecek.
- [ ] Email format backend'de net dogrulanacak.
- [ ] Password policy backend'de net uygulanacak.
- [ ] Display name uzunluk ve karakter kurallari netlestirilecek.
- [ ] Username uzunluk ve karakter kurallari netlestirilecek.
- [ ] Ayni telefonla tekrar kayit kontrolu eklenecek.

Notlar:
- Alici ve satici register validasyonlari ayri dusunulebilir.

## 10. KVKK / Sartlar Onayi

Mevcut tespit:
- Register ekraninda gizlilik politikasi, kullanim sartlari, acik riza veya pazarlama izni onaylari gorunmuyor.

Yapilacaklar:
- [ ] Zorunlu "Kullanim Sartlari ve Gizlilik Politikasi" onayi eklenecek.
- [ ] KVKK aydinlatma metni eklenecek.
- [ ] Pazarlama izni ayri ve opsiyonel olacak.
- [ ] Onay versiyonu backend'de kayit altina alinacak.
- [ ] Onay tarihi ve kullanici id'si saklanacak.

Notlar:
- Hukuki metinlerin final hali ayrica hazirlanacak.

## Onerilen Yeni Akislar

### Ilk Acilis

- [ ] Logo/brand onboarding
- [ ] 2-3 kisa deger ekrani
- [ ] Son ekran:
  - [ ] "Yemek almak istiyorum"
  - [ ] "Yemek satmak istiyorum"
  - [ ] "Zaten hesabim var"

### Alici Register

- [ ] Ad soyad
- [ ] Email
- [ ] Telefon
- [ ] Sifre
- [ ] KVKK / sartlar onayi
- [ ] SMS dogrulama
- [ ] Opsiyonel ilk adres ekleme

### Satici Register

- [ ] Temel hesap
- [ ] Telefon dogrulama
- [ ] Mutfak adi
- [ ] Profil/home card fotografi
- [ ] Adres / hizmet bolgesi
- [ ] Kategori secimi
- [ ] Belgeler
- [ ] IBAN / odeme bilgisi
- [ ] Admin onayi bekleme ekrani

### Login

- [ ] Email / sifre
- [ ] Gercek sifremi unuttum akisi
- [ ] Demo giris production'da gizli
- [ ] Apple login ileride degerlendirilecek

## Oncelik Sirasi

- [ ] Demo login ve demo register otomatik doldurmayi production'dan kaldir.
- [ ] Buyer/seller rol secim ekrani ekle.
- [ ] Satici basvuru akisini gercek onboarding'e cevir.
- [ ] OTP/telefon dogrulamayi gercek hale getir.
- [ ] Sifre sifirlamayi tamamla.
- [ ] KVKK/sartlar onaylarini ekle.
- [ ] Backend register validasyonlarini sikilastir.
- [ ] Yeni kullaniciyi profil tamamlama ekranina yonlendir.
- [ ] Satici admin onayi olmadan satis yapamasin.
- [ ] Bu akislar icin uctan uca test senaryolari yaz.

## Karar Bekleyen Konular

- [ ] Demo giris tamamen kaldirilacak mi, yoksa sadece internal build'de mi kalacak?
- [ ] Satici basvurusu mobil uygulamada mi tamamlanacak, yoksa admin/onay merkeziyle birlikte mi ilerleyecek?
- [ ] Telefon dogrulama SMS ile mi, WhatsApp/email alternatifleriyle mi yapilacak?
- [ ] Alici icin adres ekleme register sirasinda zorunlu mu olacak?
- [ ] Satici belgeleri hangi sirada ve hangi zorunlulukla alinacak?
- [ ] KVKK ve sozlesme metinlerinin final kaynagi ne olacak?

