<div align="center">

# Agentic Company OS

### İşi ver. Süreci gör. Kontrol sende.

Araçlarla çalışan, görev kayıtlarını tutan ve seçtiğin yetkilere göre hareket eden yapay zekâ ajanları için açık kaynak çalışma alanı.

[**Kuruluma başla**](#hızlı-başlangıç) · [**Çalışma alanını tanı**](#hangi-ekran-ne-işe-yarar) · [**Web sitesi**](https://halittayyar0.github.io/Agentic-Company-OS/) · [**English**](./README.md)

**Windows · macOS · Linux** &nbsp; / &nbsp; **7 dil** &nbsp; / &nbsp; **MIT lisansı**

</div>

![Ajanları, projeleri ve faaliyetleri gösteren gerçek Agentic Company OS çalışma alanı](./docs/assets/dashboard.png)

## Bir işi başlatmak ve takip etmek için

Bir ajana belirli bir iş ver veya düzenli tekrarlanacak bir sorumluluk tanımla. Ajan, izin verdiğin araçları kullanabilir, sonuçları kaydedebilir ve eksik bilgi ya da onay gerektiğinde sana başvurabilir. Sen de aynı arayüzden işi takip edebilir, yapılanları inceleyebilir ve çalışmayı durdurabilirsin.

Her kurulum, bilgisayarında veya sunucunda çalışan **tek kullanıcıya ait özel bir çalışma alanıdır**. Model sağlayıcısını sen seçersin; hesap ve erişim anahtarları sende kalır. Herkese açık web sitesi kuruluma yönlendirir; görevlerin kendi çalışma alanında yürütülür.

| Tek seferlik bir işle başla                              | Ya da düzenli bir sorumluluk ver                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| Üç ürünü kaynak bağlantılarıyla karşılaştır.             | Her gün bir web sayfasındaki anlamlı değişiklikleri kaydet.       |
| Bir CSV dosyasındaki eksik ve yinelenen verileri incele. | Düzenli gelen bir raporu belirlediğin takvimde gözden geçir.      |
| Bir kod deposunu incele ve test edilmiş değişiklik öner. | Belirli bir kontrol listesini tekrarla, her turun sonucunu sakla. |

Bunlar örnek görevlerdir. Sonuç; seçilen modele, mevcut araçlara, izinlere ve verdiğin bilgilere bağlıdır.

## Hızlı başlangıç

### 1. Kurulum yolunu seç

|                                | Hazır konteyner paketi                                                                                                            | Kaynak koddan yerel kurulum                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Kime uygun?**                | Hazır uygulamayla başlamak isteyenlere                                                                                            | Kaynak kod ve bilgisayar araçlarıyla doğrudan çalışmak isteyenlere                          |
| **Önce ne gerekli?**           | Node.js 24 + Linux motoru ve Compose v2 ile çalışan Docker                                                                        | Git, Node.js 24, projede belirtilen pnpm, PostgreSQL; tarayıcı araçları için Chromium       |
| **Uygulama nasıl hazırlanır?** | Sürümü sabitlenmiş hazır imaj indirilir                                                                                           | Bilgisayarında derlenir                                                                     |
| **Nereden başlamalı?**         | [Kurulum ZIP’ini indir](https://github.com/halittayyar0/Agentic-Company-OS/releases/latest/download/Agentic-Company-OS-setup.zip) | [Yerel kurulum rehberi](./docs/self-hosting.md#guided-installation-windows-linux-and-macos) |

Konteyner, uygulamanın ihtiyaçlarıyla birlikte ayrı bir ortamda çalışmasını sağlar. Hazır paket PostgreSQL veritabanını ve Chromium tarayıcısını içerir; Git, pnpm veya kaynak kod derlemesi gerektirmez. Yerel yapay zekâ modeli kullanacaksan donanım ihtiyacı seçtiğin modele göre artar.

### 2. Kurulum ekranını aç

ZIP dosyasını çıkar ve çıkan klasörden başlat:

| İşletim sistemin | Yapacağın işlem                        |
| ---------------- | -------------------------------------- |
| Windows          | `START.cmd` dosyasına çift tıkla       |
| macOS / Linux    | Terminalde `sh START.command` çalıştır |

Terminalde gösterilen **özel yerel bağlantıyı** aç. Dilini, model sağlayıcını, izinlerini ve araç paketlerini seç. Kurulum ekranı veritabanını hazırlar ve çalışma alanının açıldığını kontrol eder.

**Çıkardığın paketi ve terminalde belirtilen kurulum klasörünü sakla.** Yeniden başlatma ve yarım kalan kuruluma devam etme işlemlerinde bunlar kullanılır. [Yeniden başlatma, yedekleme ve sunucu kurulumu →](./docs/self-hosting.md)

### 3. İlk işini tanımla

Bir proje oluştur, ajan seç ve beklediğin sonucu anlat. Kolayca kontrol edebileceğin bir işle başla:

> [Konu] için üç seçeneği karşılaştır. Birincil kaynakları kullan; bağlantılar ve tarihlerle bir sayfalık rapor kaydet. Bağımsız işler gerekmedikçe tek ajanla ilerle. Zorunlu bir bilgi eksikse bana sor.

Düzenli bir iş için hem aralığı hem de her turun ne zaman tamamlanacağını belirt:

> Her 24 saatte bir [açık web sayfası] üzerindeki anlamlı değişiklikleri kontrol et. Değişiklik varsa tarihli bir özet kaydet. Her turu tamamla ve bir sonraki zamanı bekle. Kimseye mesaj gönderme veya dışarıya içerik yayımlama.

**İyi bir görev tanımı şunları içerir:** kullanılacak bilgi, beklenen çıktı, doğrulama ölçütü ve eylem/harcama sınırları.

## Hangi ekran ne işe yarar?

| Ekran                                      | Ne yaparsın?                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **Ana Sayfa**                              | Ajanlarını, devam eden işleri ve son faaliyetleri görürsün.                                  |
| **Projeler**                               | Görev tanımını, sohbetleri, devredilen işleri, toplantıları ve sonuçları bir arada tutarsın. |
| **Uzmanlar ve Ekip Stüdyosu**              | Ajan rollerini ve modellerini düzenler veya hazır bir ekip şablonuyla başlarsın.             |
| **Beceriler ve araçlar**                   | 30 iş rehberini inceler, gereken araçları görür ve proje taslağı oluşturursun.               |
| **Onaylar**                                | Senin kararını bekleyen eylemleri gerçekleşmeden önce incelersin.                            |
| **Operasyonlar ve çalıştırma ayrıntıları** | Araç kullanımını, kesintileri, kurtarma adımlarını ve çalışma kayıtlarını takip edersin.     |
| **Şirket Odası**                           | Seçtiğin ajanlarla konuşur; belirli birine seslenmek için onu etiketlersin.                  |
| **Ayarlar**                                | Model bağlantılarını, dili, erişim politikasını ve kaynak kod çalışma alanlarını yönetirsin. |

**Beceri (skill)** bir işin nasıl yapılacağını anlatan rehberdir. **Araç**, veri incelemek veya tarayıcı kullanmak gibi bir eylemi gerçekleştirir. **Ajan** ise talimatlarını, seçilen modeli ve izin verilen araçları kullanarak görev üzerinde çalışır.

## Hazır araçlar, ekleyebileceğin yetenekler

Kütüphane **araştırma, yazılım, veri, belgeler ve operasyon** alanlarını kapsar: 30 iş rehberi, 24 beceri aracı ve 22 çalışma aracı bulunur. Ajanlar rehberleri bulabilir ve ihtiyaç duyduklarında okuyabilir.

- **Kendi rehberini ekle.** Kişisel beceriler ve yardımcı araç şablonları oluştur, düzenle, içe veya dışa aktar.
- **Çalıştırılabilir araç yaz.** Düzenleyiciden Node araçları tanımla; çalıştırma, seçilen izin ve onay kurallarına uyar. [Araç oluşturma →](./docs/personal-programs.md)
- **Kaynak kod üzerinde çalış.** Bir Git deposu bağla; ajan ayrı bir kopyada değişiklik hazırlasın. Farkları incele, kontrolleri çalıştır ve ardından uygula. Çalışan uygulamayı yeni koda geçirmek ayrı bir adımdır. [Kaynak kod iş akışı →](./docs/source-workspaces.md)

[Beceri ve araç rehberini incele →](./docs/skills-and-tools.md)

## İşin büyüklüğüne göre çalışma

Rutin görevler ekonomik model seçimiyle başlar. Ek araçların tanımları ihtiyaç olduğunda yüklenir. Mevcut ajanlar tekrar kullanılabilir; görev dağıtımı sunucu tarafından sınırlandırılır. Varsayılan olarak ana görev ve ona bağlı alt görevlerden **en fazla dördü aynı anda aktif** olabilir.

Alt görevlerin bitmesini bekleyen ana görev modele istek atmaz. Düzenli işler, planlanan turlar arasında bekler. Kullanım kontrolleri hem çalışma hem sonuç inceleme çağrılarını kapsar; görev/tur sınırlarına ek olarak düzenli işler için son 24 saatin kullanımı izlenir.

**Model maliyeti seçimine bağlıdır.** Bulut modelleri kendi sağlayıcı hesabından ücretlenir; yerel modeller donanımını kullanır. Açıkça ücretsiz veya yerel model seçildiğinde ücretli modele sessizce geçilmez. Başlamış bir istek kullanım sınırını aşabilir; sağlayıcının bildirmediği maliyet sıfır sayılmaz. Kesin fatura sınırını sağlayıcı hesabında ayarla.

[Model seçimi, görev dağıtımı ve bütçe ayarları →](./docs/efficient-work.md)

## Erişim şeklini sen seç

Kurulumda veya Ayarlar’da **salt okunur, onaylı, tam erişim ya da özel politika** seçebilirsin. Tam erişim, etkin araçlarda daha geniş eylem izni verir; bilgisayarda komut çalıştırmanın ayrıca ayarları ve kontrolleri vardır. Geniş bilgisayar erişimini açmadan önce [güvenlik modelini](./docs/security-model.md) incele.

**Telefondan:** aynı arayüzü özel HTTPS bağlantısıyla açarsın. İsteğe bağlı kurulum mevcut Tailscale bağlantını kullanır; kendi yönettiğin VPN yolu da belgelenmiştir. Bilgisayarın veya sunucun açık kalmalıdır. [Türkçe telefon erişimi rehberi →](./docs/mobile-access.tr.md)

**Kendi dilinde:** Türkçe · English · Deutsch · Русский · 简体中文 · 繁體中文 · العربية. Arapça sağdan sola düzeni destekler. Özel talimatların, dış kaynak çıktıları ve geçmiş kayıtlar özgün metnini korur. [Çeviri kapsamı →](./docs/localization.md)

> [!NOTE]
> Her kurulum bir güvenilir kullanıcı içindir. Ortak kullanıcı hesapları ve birbirinden yalıtılmış çok kullanıcılı alanlar henüz bulunmaz. Uzak erişimi özel tut; HTTPS ve operatör kimlik doğrulaması kullan.

## Neler doğrulandı?

**0.2.0 sürümü**, hazır Linux amd64/arm64 imajı ve yönlendirmeli kurulumla yayımlandı. Kaydedilen kabul sonuçları:

- **1.479 başarılı kaynak testi**, sıfır hata ve ortama bağlı altı atlama; PostgreSQL eşzamanlılık kontrolleri ayrıca çalıştırıldı.
- **922 başarılı tarayıcı testi**; Windows, Intel Mac ve Apple Silicon Mac kontrolleri.
- Gerçek konteyner kurulumu ve yeniden açma; kısa kurtarma/dayanıklılık kontrolleri; gerçek modelle tek görev ve düzenli işin iki turuna ait sınırlı doğrulama.
- Hesap açmadan paket indirme, dosya özeti eşleşmesi ve açık başlangıç sayfasının telefon genişliğinde yedi dil kontrolü.

Bunlar belirtilen sürümün sonuçlarıdır. 24 saatlik kesintisiz test, fiziksel telefon/mobil şebeke denemesi ve ana dili konuşan kişilerin çeviri incelemesi henüz tamamlanmadı. Açık uçlu işler senin bilgine veya kararına ihtiyaç duyabilir; her işin mutlaka tamamlanacağı garantisi verilmez.

[Sürüm ve kanıtlar](https://github.com/halittayyar0/Agentic-Company-OS/releases/tag/v0.2.0) · [Güncel otomatik kontroller](https://github.com/halittayyar0/Agentic-Company-OS/actions) · [Doğrulama kapsamı](./docs/verification/2026-09-29-efficient-autonomy.md)

## İhtiyacın olan belgeye git

| Şunu yapmak istiyorum…                                                  | Buradan başla                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Kurmak, yeniden başlatmak veya yedeklemek                               | [Kurulum ve barındırma](./docs/self-hosting.md)                                 |
| Ortam değişkenlerini ayarlamak veya geliştirme sunucularını çalıştırmak | [Türkçe teknik başvuru kaynağı](./docs/operator-reference.tr.md)                |
| API, çalışan süreçler ve veritabanını anlamak                           | [Mimari](./docs/architecture.md)                                                |
| Yetkileri ve mevcut sınırları öğrenmek                                  | [Güvenlik modeli](./docs/security-model.md)                                     |
| Yenilikleri ve sıradaki işleri görmek                                   | [Değişiklikler](./CHANGELOG.md) · [Yol haritası](./docs/roadmap.md)             |
| Kod, belge veya çeviri katkısı yapmak                                   | [Katkı rehberi](./CONTRIBUTING.md) · [Davranış kuralları](./CODE_OF_CONDUCT.md) |
| Güvenlik açığını özel olarak bildirmek                                  | [Güvenlik bildirimi](./SECURITY.md)                                             |

Teknik belgelerin bir bölümü İngilizcedir. Tekrarlanabilir bir hata bildirimi, daha anlaşılır bir çeviri, faydalı bir rehber veya test edilmiş küçük bir düzeltme de değerli bir katkıdır.

---

**[MIT lisansıyla](./LICENSE) açık kaynak.** Paketteki IBM Plex yazı tipleri SIL Open Font License 1.1 kapsamındadır; [üçüncü taraf bildirimlerine](./artifacts/agentic-company-os/public/THIRD_PARTY_NOTICES.txt) bakabilirsin.
