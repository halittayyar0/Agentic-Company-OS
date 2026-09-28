import type { CatalogLocale } from "../catalog-types";
export const tr: CatalogLocale = {
  copy: {
    title: "Beceriler ve araçlar",
    intro:
      "Hazır bir çalışma yapısıyla başlayın. Girdileri inceleyip beceriyi projenize uyarlayın.",
    search: "Beceri ara",
    all: "Tüm alanlar",
    empty: "Bu aramayla eşleşen beceri yok.",
    skills: "İş becerileri",
    tools: "Yerleşik araçlar",
    inputs: "Sağlanacak bilgiler",
    steps: "Çalışma adımları",
    checks: "Teslimden önce",
    deliverable: "Beklenen çıktı",
    use: "Proje taslağı oluştur",
    requirements: "Araçlar ve erişim",
    browser: "Tarayıcı erişimi",
    files: "Çalışma alanı dosya erişimi",
    boundary:
      "Beceriler çalışma rehberidir; yetki veya sonuç garantisi vermez. Eksik bilgileri sorun. Kullanıcının kapsamına ve mevcut onay kurallarına uyun. Yetki olmadan kurulum, harcama, yayımlama veya başkalarıyla iletişim yapmayın. Kullanılamayan araçları ve doğrulanmayan sonuçları belirtin. Başlatmadan önce bu taslağı inceleyin.",
    toolBoundary:
      "Bu araçlar verilen veriyi yerel olarak işler. Dosya açmaz, ağa erişmez ve abonelik eklemez. Ajanların model kullanımı sağlayıcı ayarlarınıza bağlıdır.",
    error: "Beceri kütüphanesi yüklenemedi.",
    retry: "Yeniden dene",
    loading: "Beceri kütüphanesi yükleniyor…",
    invalid:
      "Araç girdisi geçersiz veya sınırlarını aşıyor. Araç şemasını ve verilen veriyi kontrol edin.",
    completed: "Araç sonucu",
    skillMissing: "Bu yerleşik beceri bulunamadı.",
  },
  groups: {
    research: {
      title: "Araştırma",
      inputs: [
        "Soru, hedef kitle, alınacak karar ve tarih aralığı.",
        "İzin verilen kaynaklar, kapsam dışı konular ve tarayıcı erişimi.",
      ],
      steps: [
        "Kanıt toplamadan önce soruyu ve kaynak seçme ölçütlerini netleştirin.",
        "Varsa birincil kaynakları açın; adresleri, tarihleri, alıntıları ve belirsizliği ayrı kaydedin.",
        "Bağımsız kanıtları karşılaştırın; çelişkileri işaretleyip gözlemleri çıkarımlardan ayırın.",
      ],
    },
    engineering: {
      title: "Yazılım",
      inputs: [
        "Depo veya ilgili dosyalar, beklenen davranış ve yeniden üretme adımları.",
        "Çalışma ortamı sınırları, dosya erişimi ve izin verilen test komutları.",
      ],
      steps: [
        "Değişiklik önermeden önce ilgili kodu ve sözleşmeleri inceleyin.",
        "Girdileri, hata durumlarını ve izinleri takip edin; en küçük yeniden üretimi veya kesin kod kanıtını toplayın.",
        "Bulguları etkisine göre sıralayın; sınırlı bir düzeltme, doğrulama ve geri alma yolu belirtin. Çalıştırılmayan testi geçti saymayın.",
      ],
    },
    data: {
      title: "Veri ve analiz",
      inputs: [
        "CSV/JSON/metin verisi, alan tanımları, birimler ve dönem.",
        "Soru, beklenen veri kümesi ve eksik veya yinelenen veri kuralları.",
      ],
      steps: [
        "Verinin yapısını, boyutunu ve kaynağını inceleyip aslını koruyun.",
        "Hesaplamadan önce eksikleri, tekrarları ve tür uyumsuzluklarını ölçün; dışlanan kayıtları ve paydaları belirtin.",
        "Temel toplamları araçlarla yeniden hesaplayın; birim ve yuvarlamayı yazıp kanıtı varsayımdan ayırın.",
      ],
    },
    content: {
      title: "Belgeler ve içerik",
      inputs: [
        "Kaynak içerik, hedef kitle, dil, üslup ve çıktı biçimi.",
        "Onaylı bilgiler, uzunluk sınırı ve yayımlama koşulları.",
      ],
      steps: [
        "Onaylı bilgileri çıkarın ve hedef kitlenin bilgi ihtiyacını belirleyin.",
        "İstenen taslağı anlaşılır başlıklarla yazın; adları, sayıları ve kaynak anlamını koruyun.",
        "Taslağı kaynakla karşılaştırın, tutarlılığı kontrol edin ve cevapsız soruları işaretleyin. İncelemeye hazır taslak teslim edin.",
      ],
    },
    operations: {
      title: "Operasyon",
      inputs: [
        "Hedef, mevcut süreç, sorumlular, son tarihler ve saat dilimleri.",
        "Bağımlılıklar, kaynaklar, sınırlamalar ve onay sınırları.",
      ],
      steps: [
        "Mevcut durumu çıkarın; eksik sorumluları ve kritik sınırlamaları sorun.",
        "İşi sorumlusu, bağımlılığı ve açık bitiş koşulu olan gözlemlenebilir adımlara bölün.",
        "Zamanlamayı ve riskleri kontrol edin; üst sorumluya aktarma ve kurtarma adımlarını ekleyin, dış taahhütleri yetkili incelemesine bırakın.",
      ],
    },
  },
  checks: [
    "Her olgusal iddianın kaynağı olsun veya varsayım olduğu açıkça yazılsın; çözülmeyen eksikleri koruyun.",
    "Beklenen çıktıyı verilen bilgilerle karşılaştırın. Kontrol edilenleri, başarısız olanları ve doğrulanmayanları listeleyin.",
  ],
  skills: [
    [
      "Kaynaklı araştırma özeti",
      "Kaynak tablosu, tarihler, güven sınırları ve sonraki kararı içeren kısa bir yanıt teslim edin.",
    ],
    [
      "Rakip haritası",
      "Belirlenen rakipleri hedef kitle, teklif, doğrulanabilir özellikler ve tarihli fiyatlarla karşılaştırın; eksik kanıtı belirtin.",
    ],
    [
      "İddia doğrulama",
      "Her iddia için destekleyici ve çelişen kanıtları, kaynak tarihlerini ve belirsizlik değerlendirmesini tabloya dökün.",
    ],
    [
      "Ürün karşılaştırma",
      "Gereksinim ağırlıklarına dayalı; tarihli kaynak, eleme ölçütü ve açık tercih bedelleri içeren karşılaştırma hazırlayın.",
    ],
    [
      "Literatür haritası",
      "İlgili yayınları soru, yöntem, örneklem, bulgular ve sınırlara göre eşleyin; derlemeyi özgün araştırmadan ayırın.",
    ],
    [
      "Görüşme planı",
      "Yönlendirmeyen sorular, katılımcı profili, rıza notları ve sentez şablonu hazırlayın; katılımcılara mesaj göndermeyin.",
    ],
    [
      "Kod inceleme",
      "Dosya konumu, somut hata senaryosu ve hedefli düzeltme içeren öncelikli bulgular sunun; doğrulanan kusurları sorulardan ayırın.",
    ],
    [
      "Hata ön incelemesi",
      "Beklenen ve gerçekleşen davranışı, kanıtları, olası nedenleri ve asgari doğrulama planını içeren yeniden üretilebilir hata raporu yazın.",
    ],
    [
      "Test planı",
      "Kritik davranışları normal, sınır ve hata testleriyle eşleyin; test verilerini ve ölçülebilir geçiş koşullarını tanımlayın.",
    ],
    [
      "API sözleşmesi inceleme",
      "İstek ve yanıt sözleşmelerini, kimlik doğrulamayı, hataları ve sayfalamayı karşılaştırın; uyumsuz değişiklikleri örnekleyin.",
    ],
    [
      "Yayıma hazırlık",
      "Geçen, başarısız ve çalıştırılmayan kontrolleri; çıktı kimliğini, geri alma adımlarını ve kalan engelleri içeren liste hazırlayın.",
    ],
    [
      "Bağımlılık inceleme",
      "Bağımlılık ve sürüm envanterini, doğrudan/dolaylı kapsamı, lisans kanıtını ve güncelleme riskini çıkarın; güvenlik açığı uydurmayın.",
    ],
    [
      "CSV kalite raporu",
      "Başlık sorunlarını, eksik hücreleri, düzensiz satırları, tekrarları ve sayısal aralıkları raporlayın; kaynağı değiştirmeden düzeltme kuralları verin.",
    ],
    [
      "JSON yapı denetimi",
      "JSON türlerini, zorunlu alanları ve seçilen yolları inceleyin; eksik yolları ve sözleşme uyumsuzluklarını sınırlı örneklerle gösterin.",
    ],
    [
      "Metrik raporu",
      "Açık tanımlı metrikleri birimleri, paydaları, dönemleri ve yeniden üretilebilir toplamlarıyla hesaplayın; eksik değeri sıfırdan ayırın.",
    ],
    [
      "Veri sözlüğü",
      "Her alanın anlamını, türünü, birimini, geçerli değerlerini, kaynağını ve belirsizliklerini kaynak örnekleriyle belgeleyin.",
    ],
    [
      "Kayıt mutabakatı",
      "İki veri kümesini kararlaştırılmış anahtarla karşılaştırın; tekrarları, eksik kayıtları, değer farklarını ve mutabık toplamları raporlayın.",
    ],
    [
      "Deney analizi",
      "Deney ve kontrol sayılarını, sonuç tanımlarını, etki tahminlerini ve sınırlamaları özetleyin; geçerli tasarım olmadan nedensellik çıkarmayın.",
    ],
    [
      "Belge iskeleti",
      "Hedef kitleye göre ana mesajları, kanıtları, bölüm amaçlarını ve cevapsız soruları içeren belge iskeleti oluşturun.",
    ],
    [
      "Metin düzenleme",
      "Düzenlenmiş metni kısa değişiklik gerekçesiyle teslim edin; onaylı bilgileri, adları, sayısal anlamı ve istenen üslubu koruyun.",
    ],
    [
      "Çeviri inceleme",
      "Kaynak ve çeviriyi anlam, terminoloji, sayılar, yer tutucular ve yerel kullanım açısından karşılaştırın; belirsiz ifadeleri listeleyin.",
    ],
    [
      "Sık sorulan sorular",
      "Olası kullanıcı sorularına kaynaklı yanıt taslakları yazın; dayanaksız yanıtları işaretleyip sorumluya ulaşma yolunu belirtin.",
    ],
    [
      "Değişiklik notları",
      "Verilen değişiklikleri kullanıcı etkisi, geçiş ihtiyacı ve bilinen sınırlara göre özetleyin; belgelenmeyen düzeltme iddiası kullanmayın.",
    ],
    [
      "Toplantı aksiyonları",
      "Notlardan kararları, sorumluları, son tarihleri ve açık soruları çıkarın; atanmamış işleri ve belirsiz tarihleri işaretleyin.",
    ],
    [
      "Proje planı",
      "Kilometre taşlarını, bağımlılıkları, sorumluları, kabul ölçütlerini ve varsayımları açık, riskleri dikkate alan gerçekçi takvimi oluşturun.",
    ],
    [
      "Olay değerlendirmesi",
      "Kanıta dayalı olay zaman çizelgesi, etki özeti, katkıda bulunan etkenler ve sorumlusu belli düzeltici işler hazırlayın.",
    ],
    [
      "İşletim rehberi",
      "Ön koşulları, numaralı adımları, gözlemlenebilir kontrolleri, hata yollarını, üst sorumluya aktarmayı ve geri almayı yazın.",
    ],
    [
      "Risk kaydı",
      "Somut riskleri olasılık gerekçesi, etki, erken sinyaller, sorumlu, azaltma adımı ve kalan riskle listeleyin.",
    ],
    [
      "Süreç haritası",
      "Mevcut sürecin tetikleyicilerini, girdilerini, adımlarını, devirlerini, kararlarını, darboğazlarını ve ölçülebilir çıktılarını eşleyin.",
    ],
    [
      "İş devri",
      "Mevcut durum, kanıt bağlantıları, sorumlular, bekleyen kararlar, sonraki adımlar ve kurtarma talimatlarını içeren devir hazırlayın.",
    ],
  ],
  tools: [
    ["Beceri bul", "Yerleşik becerileri sözcük veya alana göre bulun."],
    [
      "Beceri oku",
      "Tam kimliğiyle bir becerinin adımlarını, girdilerini ve kontrollerini yükleyin.",
    ],
    [
      "Hesapla",
      "Sonlu sayılardan toplam, oran, yüzde ve betimleyici özet hesaplayın.",
    ],
    [
      "Metin analizi",
      "Sözcük, satır, Unicode karakter ve UTF-8 bayt sayılarını bulun.",
    ],
    [
      "Metin karşılaştır",
      "Satır konumlarını sınırlı alıntılar ve açık kesilme bilgisiyle karşılaştırın.",
    ],
    [
      "JSON incele",
      "JSON verisini ayrıştırıp tam bir JSON Pointer yolunu inceleyin.",
    ],
    [
      "CSV profili",
      "Tırnaklı CSV, alan kalitesi, satır yapısı ve sayısal aralıkları kontrol edin.",
    ],
    [
      "Tarih ve saat dönüştür",
      "Saat dilimi açıkça verilen zamanı seçilen saat dilimine dönüştürün.",
    ],
    ["Adres incele", "Adresi açmadan URL bileşenlerini ayrıştırın."],
    [
      "Metin parmak izi",
      "Değiştirilmemiş UTF-8 metnin SHA-256 özetini hesaplayın; metni şifrelemez.",
    ],
  ],
};
