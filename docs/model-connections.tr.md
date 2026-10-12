# Modeli bağla, ilk işini koru

[English](./model-connections.md) · [Türkçe](./model-connections.tr.md) · [Deutsch](./model-connections.de.md) · [Русский](./model-connections.ru.md) · [简体中文](./model-connections.zh-CN.md) · [繁體中文](./model-connections.zh-TW.md) · [العربية](./model-connections.ar.md)

> v0.4.0 ve sonrası için. Önceki kurulum paketlerinde bu akış bulunmaz.

## Önce istediğin sonucu yaz

Ana sayfada veya Yeni proje ekranında işini yazıp model bağlantısını aç.
Pencereyi kapatmak, girişi iptal etmek veya dili değiştirmek işini göndermez.
Görevi yalnızca sen başlatırsın. Tarayıcı kayıt yapamıyorsa uyarı, yeniden
yüklemenin sınırını anlatır.

| Seçenek      | Gereken                                            | Kaydetmenin doğruladığı                                              |
| ------------ | -------------------------------------------------- | -------------------------------------------------------------------- |
| Yerel model  | Ollama sunucusu ve kurulu, araç kullanabilen model | Adres ve keşfedilen modeller; model indirilmez veya denenmez         |
| ChatGPT      | Uygun hesap ve model kullanımı izni                | İncelenen hesabın kaydı ve ayrı hesap seçimi; kota ayrıca geçerlidir |
| API anahtarı | Kendi OpenAI veya OpenRouter anahtarın             | Sağlayıcı ayarının kaydı; sağlayıcı ücretlendirebilir                |

Ollama adresine **backend** ulaşmalıdır. Telefonun `localhost` adresi telefonu,
konteynerinki konteyneri gösterir. Kurulu sunucunun ulaşabildiği özel adresi
kullan. Kurulum varsayılanına dönmek kayıtlı adresi kaldırır; ortam değişkenindeki
bağlantı etkin kalabilir.

## Başlatmadan önce kontrol et

Görevler başlangıçta yalnız hesaplama, tamamlama ve araç yükleme şemalarını
kullanır. Rehber, soru ve onay araçları dahil diğer yetkili araçlar gerektiğinde
eksiksiz şemalarıyla yüklenir. Yüklemek izin vermez. İlk istek küçülür; bazı
akışlar ek model çağrısı gerektirir. Küçük yerel modellerin gerçek bir görevle
denenmesi gerekir.

Modelin listelenmesi, bağlanması ve denenmesi farklı durumlardır. Gelişmiş
Ayarlardaki açık model testi istek gönderir; kaydetmek göndermez. Önceden
başlatılmış, sağlayıcı bekleyen işler bağlantı kaydedilince devam edebilir.
Kayıt belirsizse yeniden kaydetmeden önce güncel durumu oku.

ChatGPT hesabını kaydetmek ve seçmek ayrı adımlardır. Yalnız kimlik izni model
çalıştırmaz. Sunucu veya konteyner için kendi bilgisayarından [korumalı aktarım
rehberini](./chatgpt-connection.md#on-a-server-or-in-a-container) izle; telefon,
sunucunun yerel giriş dönüşüne ulaşamaz. Kimlik bilgilerini tarayıcıya yapıştırma.

İşine dön, izinleri ve beklediğin çıktıyı kontrol edip başlat. [Telefondan özel
erişim](./mobile-access.md) aynı web arayüzünü kullanır. İsteğe bağlı Codex kodlama
yürütücüsünün [ayrı platform gereksinimleri](./chatgpt-connection.md#optional-governed-coding-runtime)
vardır; model bağlamak onu kendiliğinden etkinleştirmez.

Model token kullanımını raporlamazsa iş ve alt görevleri yeni çağrılardan önce
duraklar. Yapılan işin kayıtları korunur. Çağrıları inceleyip kullanım raporlayan
bir sağlayıcıyla yeni iş başlat. Token raporu tam olsa bile raporlanmayan dolar
maliyeti bilinmiyor olarak kalır.

## İsteğe bağlı kodlama kurulumu

Container kurulumunda ayrı ve varsayılan olarak kapalı **Codex kodlama çalışanı** seçeneği vardır. Linux x64 motoru, Compose 2.24.4 veya üstü ve terminal izni gerekir. Kod araç paketini seçmek bunu etkinleştirmez. Uygun hesabını kurulumdan sonra bağla; diğer görevler seçtiğin sağlayıcıda kalır. AppArmor sunucusunda yöneticinin paketteki profili yüklemesi gerekir. [Kurulum gereksinimlerine](./self-hosting.md#optional-coding-workers) bak.

## Yerel model verimliliği (geliştirme dalı)

Araç kullanılan işlerde, düşünme destekli yerel modellere varsayılan olarak `reasoning_effort: none` gönderilir. Gelişmiş API çağrıları `localReasoningEffort` ile bunu seçebilir. Araçsız sohbet modelin varsayılanını kullanır; bulut modellerine bu ayar eklenmez. Destek ve sonuç modele bağlıdır. Kısaltılan ortak iç politika İngilizcedir; seçtiğin dil ve yerelleştirilmiş veya özel rol metni korunur.

## Tamamlanma denetimi (geliştirme dalı)

Tamamlanma denetçisi, istenen her işlemi bu görev döngüsündeki araç kayıtlarıyla karşılaştırır. Doğru cevap, istenen işlemin yerine geçmez. Son kayıt örneklerine ek olarak döngü boyunca sınırlı araç sayaçlarını okur; kırpılmış kayıtlarda bir işlem görünmemesi, hiç yapılmadığını kanıtlamaz. Mevcut denetim çağrısı kullanılır. Kayıt metadatası ve model kararı, dosyaların, testlerin veya sonuçların kalitesini garanti etmez.

## Bozuk yeniden deneme kaydını temizle (geliştirme dalı)

Duraklayan görevde bozuk kayıt uyarısı varsa **Bozuk kaydı temizle** seçeneğini kullan. Önce sunucudaki güncel görev kontrol edilir, sonra yalnız bu sekmedeki değişmemiş bozuk kayıt kaldırılır. Model çağrısı yapılmaz, görev devam ettirilmez. Görevi inceleyip ayrıca **Bu görevi yeniden dene** seçeneğini kullan; yeniden deneme token tüketebilir.

Geçerli ve sonucu belirsiz bir istek bu yolla silinmez; yeniden deneme işlem kaydını incele. Depolamaya erişilemiyorsa veya kayıt kontrol sırasında değişirse temizleme doğrulanmaz. Görev durumunu ve tarayıcı depolamasını kontrol edip sayfayı yeniden yükle. Kabul veya ret sonrasında çıkan depolama uyarısı sunucunun sonucunu değiştirmez.
