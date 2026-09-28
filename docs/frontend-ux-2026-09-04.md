# Frontend ve uzman ekibi iyileştirmeleri — 4 Eylül 2026

Çalışılan proje: `D:\Agentic-Company-OS`. Bu değişiklik ana sayfa, proje başlatma,
uzman dizini, uzman oluşturma ve şirket odasındaki uzman yönlendirmesini kapsar.
Depoda önceden bulunan değişiklikler korunmuştur; commit, push veya yayın yapılmamıştır.

## Kullanımda değişenler

- Ana sayfa hedef yazma, iş paylaşımı ve sonucu değerlendirmeyi üç adımda anlatır.
  Üç başlangıç örneği düzenlenebilir metin doldurur. Enter yeni satır açar;
  Ctrl/Command+Enter gönderir. Örnek seçmek kendiliğinden iş başlatmaz.
- Uzmanlar sayfası her kişinin katkısını açıklar. Türkçe arama, temizleme,
  uzmanlık/durum filtreleri ve 12 kartlık sayfalama adres çubuğunda korunur.
- Uzman ekleme uzmanlık seçimiyle başlar. Model, özel talimat ve yetkiler
  isteğe bağlı gelişmiş ayarlardadır. Hata mesajları ilgili alana bağlanır;
  kapalı bölümdeki hatalar görünür olur ve uygun alana odaklanılır.
- Proje ve uzman oluşturma çift gönderimi engeller. Bağlantı hatasında metin
  korunur; geciken katalog kullanıcının kimlik veya özel talimatını değiştirmez.
- Tasarım Uzmanı, Kalite Uzmanı, Veri Analisti ve Otomasyon Uzmanı eklendi.
  Temiz kurulumun kadrosu 14 üyedir. Mevcut veritabanlarının kadrosu değiştirilmez;
  bu roller uzman ekleme kataloğundan seçilebilir. Yeni roller ilave harcama,
  yayınlama, dış iletişim veya yönetici sistem yetkisi almaz.
- Şirket odası yönlendirmesi Türkçe büyük/küçük harfleri, ASCII yazımı ve
  yaygın isim eklerini eşleştirir. Aynı kişinin tekrarlanan etiketleri tek
  deneme sayılır. Bir kelimenin alternatifleri ilgililik puanını katlamaz.
- Temalar ortak CSS tokenlarını kullanır. Düğme durumları, görünür kaydırma
  çubukları ve azaltılmış hareket tercihi ortak bileşenlerde düzeltildi.

## Doğrulama

Araç zinciri: Node `24.19.0`, pnpm `10.17.1`, Chromium / Playwright.
Komutlar depo kökünden `.codex-pnpm-shim` PATH üzerinde çalıştırıldı.

| Kontrol                                                   | Sonuç                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm run build`                                          | Güncel kaynakta bütün tip kontrolleri ve üretim paketleri geçti.                                  |
| `pnpm exec playwright test --config playwright.config.ts` | 28 test geçti; 9 yeni başlangıç/uzman senaryosu dahil. Son yerelleştirme için yenileme bekliyor.  |
| `pnpm test`                                               | 689 test: 685 geçti, 0 hata, 4 ortam kaynaklı atlama.                                             |
| `pnpm run format:check`                                   | Geçti; rapor eklendikten sonra yeniden kontrol edilecek.                                          |
| Yerel gerçek API                                          | `/api/healthz` sağlıklı; `/api/agents` 14 üyeyi ve dört yeni rolü döndürdü.                       |
| Görsel kontrol                                            | 1440, 390 ve 320 px; açık/koyu tema, azaltılmış hareket, ilk/son form bölümleri. Yatay taşma yok. |
| Ana düğme metin kontrastı                                 | Koyu: 7.80:1, hover 6.67:1; açık: 5.72:1, hover 4.69:1.                                           |

Bir tam test turu derleme ve tarayıcı işlemleriyle eşzamanlıyken iki mevcut
`browser-monitor` testi 10 ms ekran görüntüsü süresini aştı. İlgili dosya tek
başına 19/19 geçti; tam paket bu nedenle tek başına yeniden çalıştırıldı.
Test eşikleri veya ürün zaman aşımı davranışı değiştirilmedi.

Dört atlama: üç gerçek PostgreSQL eşzamanlılık testi (`DATABASE_URL` yok)
ve bir Windows symlink testi (`EPERM`). Bu ortamlar için başarı iddiası yoktur.

Tarayıcı iş akışları kontrollü API yanıtları kullanır: yükleme/gecikme, başarısız
kayıt, başarılı kayıt ve liste yenilemesi, klavye, filtrelerin yeniden yüklenmesi,
mobil taşma, tema ve çift gönderim. Gerçek API sağlığı/kadrosu ayrıca okundu;
bu kontroller ücretli model çalışmasının kanıtı değildir.

## Tasarım denetiminin kalan kapsamı

Premium statik denetim strict modda **geçmedi**: 36 ham bulgu döndürdü.
Kaynak incelemesi bunların 19'unu JSX bileşenlerini yerel HTML gibi yorumlayan
araç kısıtı olarak ayırdı. Kalan 17 bulgu eski akışlardaki tasarım sözleşmesi borcudur.

| Bulgu                  | Sayı | Kaynak incelemesi                                                              |
| ---------------------- | ---- | ------------------------------------------------------------------------------ |
| Eylemsiz düğme         | 10   | Radix tetikleyicisi, Link veya iletilen props gerçek eylemi sağlar.            |
| `noValidate` eksikliği | 8    | Eski elle yönetilen formlar ortak form altyapısına taşınmalı.                  |
| Textarea boyutlandırma | 9    | 3 ortak bileşen yanlış pozitifi; 6 eski `resize-y` kullanımı.                  |
| Yerel select           | 8    | 6 Radix yanlış pozitifi; proje ritmi ve toplantı sahibi alanları yerel select. |
| Kaydırma çubuğu        | 1    | Eski command canvas mobil yatay kaydırma çubuğunu gizliyor.                    |

Ham kanıt: `.tmp/studio-ux/final-premium-audit.json`. Ayrıntılı test çıktıları,
kontrast ölçümü ve ekran görüntüleri aynı yerel kanıt klasöründedir. Bu klasör
Git tarafından izlenmez; tekrar çalıştırılabilir testler `tests/ui/studio-onboarding.spec.ts`
ve `artifacts/api-server/src/lib/orchestrator/company-chat-routing-language.test.ts` içindedir.

## Çalışma sınırları

- Yerel API, `DATABASE_URL` olmadığı için süreç ömürlü PGlite kullanıyor;
  yeniden başlatmada bu yerel veriler sıfırlanır.
- Önizleme sırasında zamanlayıcı kapalıdır. Ücretli model/araç yürütme,
  gerçek PostgreSQL yarış testleri ve gerçek 24 saat dayanıklılık koşusu yapılmadı.
- Mobil kontroller Chromium görünüm alanı emülasyonudur; gerçek iOS/Android,
  ekran okuyucu ve kullanıcı kullanılabilirlik araştırması yapılmadı.
- Önceki ve bu çalışmanın değişiklikleri yerel çalışma ağacında commit edilmemiştir.
