<div align="center">

# Agentic Company OS

### İşi ver. Süreci gör. Kontrol sende.

Araçlarla çalışan, görev kayıtlarını tutan ve seçtiğin yetkilere göre hareket eden yapay zekâ ajanları için açık kaynak çalışma alanı.

[**Kuruluma başla**](#hızlı-başlangıç) · [**Çalışma alanını tanı**](#hangi-ekran-ne-işe-yarar) · [**Web sitesi**](https://halittayyar0.github.io/Agentic-Company-OS/)

[English](./README.md) · [Türkçe](./README.tr.md) · [Deutsch](./README.de.md) · [Русский](./README.ru.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · [العربية](./README.ar.md)

**Windows · macOS · Linux** &nbsp; / &nbsp; **7 dil** &nbsp; / &nbsp; **MIT lisansı**

</div>

![Ajanları, projeleri ve faaliyetleri gösteren gerçek Agentic Company OS çalışma alanı](./docs/assets/dashboard.png)

## Bir işi başlatmak ve takip etmek için

Bir ajana belirli bir iş ver veya düzenli tekrarlanacak bir sorumluluk tanımla. Ajan, izin verdiğin araçları kullanabilir, sonuçları kaydedebilir ve eksik bilgi ya da onay gerektiğinde sana başvurabilir. Sen de aynı arayüzden işi takip edebilir, yapılanları inceleyebilir ve çalışmayı durdurabilirsin.

Her kurulum, bilgisayarında veya sunucunda çalışan **tek kullanıcıya ait özel bir çalışma alanıdır**. Model sağlayıcısını sen seçersin; hesap ve erişim anahtarları sende kalır. Herkese açık web sitesi kuruluma yönlendirir; görevlerin kendi çalışma alanında yürütülür.

Kurulumdan önce [üç tarayıcı aracını dene](https://halittayyar0.github.io/Agentic-Company-OS/#try): CSV'de eksik değerleri ve tekrarları bul, JSON yapısını özetle veya iki listeyi karşılaştır. Hesap, model veya yükleme gerekmez; işlem bu sekmede yapılır. Raporu indirebilir, daha ayrıntılı inceleme için özel çalışma alanına bir devam görevi kopyalayabilirsin. [Sınırlar ve gizlilik →](./docs/quick-tools.md)

Aynı kontroller kurulumdan sonra **Beceriler ve araçlar** ekranında da bulunur. Modeli daha sonra bağlamayı seçsen bile yerel bir sonuç alabilirsin; ajan görevleri için çalışan bir model sağlayıcısı gerekir.

Ürünü düzenli olarak geliştirmek için [uzun soluklu Goal metni →](./docs/continuous-development-goal.tr.md)

| Tek seferlik bir işle başla                              | Ya da düzenli bir sorumluluk ver                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| Üç ürünü kaynak bağlantılarıyla karşılaştır.             | Her gün bir web sayfasındaki anlamlı değişiklikleri kaydet.       |
| Bir CSV dosyasındaki eksik ve yinelenen verileri incele. | Düzenli gelen bir raporu belirlediğin takvimde gözden geçir.      |
| Bir kod deposunu incele ve test edilmiş değişiklik öner. | Belirli bir kontrol listesini tekrarla, her turun sonucunu sakla. |

Bunlar örnek görevlerdir. Sonuç; seçilen modele, mevcut araçlara, izinlere ve verdiğin bilgilere bağlıdır.

## Hızlı başlangıç

### 1. Hazır yerel paketi indir

[Sürümler](https://github.com/halittayyar0/Agentic-Company-OS/releases/latest) sayfasından bilgisayarına uygun **v0.5.4** arşivini seç; sürümü ve dosya özetini kontrol et. Node.js, PostgreSQL ve hazır uygulama dahildir. Node.js, Docker, pnpm, Git veya PostgreSQL ayrıca kurulmaz.

| Sistem              | Arşiv                                    |
| ------------------- | ---------------------------------------- |
| Windows x64         | `Agentic-Company-OS-win32-x64.zip`       |
| macOS Intel         | `Agentic-Company-OS-darwin-x64.tar.gz`   |
| macOS Apple Silicon | `Agentic-Company-OS-darwin-arm64.tar.gz` |
| Linux x64           | `Agentic-Company-OS-linux-x64.tar.gz`    |
| Linux ARM64         | `Agentic-Company-OS-linux-arm64.tar.gz`  |

Hedefler: Windows 10 (1903+)/11 x64, Intel/Apple Silicon macOS 15 ve x64/ARM64 Ubuntu 24.04. Linux paketleri Ubuntu 24.04/glibc tabanlıdır; eski glibc ve Alpine/musl destek hedefi değildir. Windows ARM64 yerel paketi yoktur. Windows/macOS paketleri imzasızdır; macOS noter onayı veya SmartScreen itibarı sağlanmaz. Normal güven uyarılarını ve dosya özetini incele; işletim sistemi güvenliğini kapatma.

### 2. Çalışma alanını aç

**Arşivin tamamını** bir klasöre çıkar. Windows’ta `START.cmd` dosyasına çift tıkla. macOS’ta `START.command` dosyasını aç veya macOS/Linux terminalinde `./START.command` çalıştır. Dosyaları bir arada tut. Başlatıcı özel yerel tarayıcı bağlantısını açar ve terminale de yazar. Yedi dilden birini seç, izinleri gözden geçir ve model bağla.

Varsayılan erişim yalnızca bu bilgisayardaki `127.0.0.1` adresidir. Terminali açık tut; **Ctrl+C** uygulamayı, çalışanları ve özel veritabanını durdurur. Tarayıcısız kullanım: `START.cmd --no-browser` veya `./START.command --no-browser`. Veri ve anahtarlar paketin dışındaki özel kurulum klasöründedir. Klasörü ve orijinal paketi sakla; aynı paket orijinal konumunda tekrar açılınca kayıtlı kurulum devam eder. Başka pakete veri taşıma/yükseltme otomatik değildir; doğrulanmış yedek al ve [güncelleme rehberini](./docs/self-hosting.md#upgrades) izle.

Model dosyaları ve sağlayıcı erişimi dahil değildir. Yapay zekâ işleri için yapılandırılmış Ollama modeli veya çalışan sağlayıcı bağlantısı gerekir; bulut sağlayıcısı ücret alabilir. Yerel yardımcı kontroller ücretli sağlayıcı olmadan çalışır.

Gelişmiş seçenekler: ayrı [Docker paketi](./docs/self-hosting.md#portable-container-installer) ve [kaynak koddan kurulum](./docs/self-hosting.md#source-installation-prerequisites) kendi gereksinimlerini korur.

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
| **Beceriler ve araçlar**                   | İş rehberlerini inceler, gereken araçları görür ve proje taslağı oluşturursun.               |
| **Onaylar**                                | Senin kararını bekleyen eylemleri gerçekleşmeden önce incelersin.                            |
| **Operasyonlar ve çalıştırma ayrıntıları** | Araç kullanımını, kesintileri, kurtarma adımlarını ve çalışma kayıtlarını takip edersin.     |
| **Şirket Odası**                           | Seçtiğin ajanlarla konuşur; belirli birine seslenmek için onu etiketlersin.                  |
| **Ayarlar**                                | Model bağlantılarını, dili, erişim politikasını ve kaynak kod çalışma alanlarını yönetirsin. |

**Beceri (skill)** bir işin nasıl yapılacağını anlatan rehberdir. **Araç**, veri incelemek veya tarayıcı kullanmak gibi bir eylemi gerçekleştirir. **Ajan** ise talimatlarını, seçilen modeli ve izin verilen araçları kullanarak görev üzerinde çalışır.

## Hazır araçlar, ekleyebileceğin yetenekler

Kütüphane **araştırma, yazılım, veri, belgeler ve operasyon** alanlarını kapsar: iş rehberleri, beceri araçları ve çalışma araçları bulunur. Ajanlar rehberleri bulabilir ve ihtiyaç duyduklarında okuyabilir.

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

Yerel paketlerin ve ayrı Docker dağıtımının doğrulama kapsamı sürüme özeldir. Hedef sistem listesi, o sürümün kontrollerinin geçtiği anlamına gelmez. [En son sürüm](https://github.com/halittayyar0/Agentic-Company-OS/releases/latest) kendi kaynak kodunu, otomatik kontrollerini ve paketleme çalışmasını belirtir. [0.2.0 kabul kaydı](./docs/verification/2026-09-29-efficient-autonomy.md) önceki kaynak, tarayıcı, platform, konteyner ve sınırlı gerçek model denemelerini belgeler; oradaki test sayıları sonraki değişiklikleri kapsamaz.

24 saatlik kesintisiz test, fiziksel telefon/mobil şebeke denemesi ve ana dili konuşan kişilerin çeviri incelemesi henüz tamamlanmadı. Açık uçlu işler senin bilgine veya kararına ihtiyaç duyabilir; her işin mutlaka tamamlanacağı garantisi verilmez.

[En son sürüm](https://github.com/halittayyar0/Agentic-Company-OS/releases/latest) · [Güncel otomatik kontroller](https://github.com/halittayyar0/Agentic-Company-OS/actions) · [Doğrulama kapsamı](./docs/verification/2026-09-29-efficient-autonomy.md)

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

**Model bağlantısı, v0.4.0 ve sonrası:** [bağlantı rehberi](./docs/model-connections.tr.md) yerel modelleri, ChatGPT’yi, API anahtarlarını ve ilk iş taslağının korunmasını anlatır. Önceki kurulum paketlerinde bu akış bulunmaz.

Kesintiden sonra bir isteği incelemek için proje veya ajan sayfasında **Model kullanım kayıtları** bölümünü aç. Kontrol model tokenı harcamaz ve isteği yeniden göndermez; bilinmeyen kullanım sıfır sayılmaz. [Kullanım kayıtlarını anlama →](./docs/inference-accounting.md)

---

**[MIT lisansıyla](./LICENSE) açık kaynak.** Paketteki IBM Plex yazı tipleri SIL Open Font License 1.1 kapsamındadır; [üçüncü taraf bildirimlerine](./artifacts/agentic-company-os/public/THIRD_PARTY_NOTICES.txt) bakabilirsin.
