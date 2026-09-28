import type { BrowserCopy } from "../browser-copy";
const copy: BrowserCopy = {
  zoomIn: "Gerçek görüntü boyutu",
  zoomOut: "Görüntüyü sığdır",
  title: "Tarayıcı",
  help: "Ajanın tarayıcısını inceleyin, ardından etkileşim için kontrolü devralın. Görüntüler belirli aralıklarla yenilenir.",
  address: "Web sitesi adresi",
  go: "Adresi aç",
  addressInvalid:
    "İçinde kullanıcı adı veya parola olmayan bir HTTP ya da HTTPS adresi girin.",
  take: "Kontrolü devral",
  release: "Kontrolü geri ver",
  ownerAgent: "Tarayıcı kontrolü ajanda",
  ownerOperator: "Tarayıcı kontrolü sizde",
  ownerOther: "Operatör kontrolü etkin; bu sekmedeki yetkiniz doğrulanmadı.",
  agentBusy: "Ajanın devam eden tarayıcı işleminin bitmesini bekleyin.",
  blocked:
    "Güvenlik kontrolleri izin verene kadar tarayıcı değişiklikleri duraklatıldı.",
  loading: "Tarayıcı denetleniyor…",
  refresh: "Görüntüyü yenile",
  pause: "Görüntüleri duraklat",
  resume: "Görüntüleri sürdür",
  polling: "Görüntüler aralıklı yenileniyor",
  paused: "Görüntüler duraklatıldı · girdi kapalı",
  syncLost:
    "Son görüntü doğrulanamadı. Girdi kapalı; önceki görüntü korunuyor.",
  received: "Görüntünün alındığı zaman",
  empty: "Tarayıcı oturumu yok. Kontrolü devralıp bir adres açın.",
  imageLabel: "Tarayıcı görüntüsü",
  frameHelp:
    "Hedefi seçmek için görüntüye tıklayın. Tab görüntüden çıkar; Escape kontrol düğmesine odaklanır. Uzak tuşlar için aşağıdaki düğmeleri kullanın. Görüntü, uzak sayfanın içeriğini ekran okuyucuya sunmaz.",
  textLabel: "Seçilen uzak alan için metin",
  textHelp:
    "Görüntüde bir alan seçin, metni burada yazıp gönderin. Enter yeni satır ekler. Parolalar burada görünür; işiniz bitince taslağı temizleyin.",
  textInvalid:
    "NUL veya eksik Unicode karakteri içermeyen, 1–4096 UTF-16 kod birimi uzunluğunda metin girin.",
  send: "Metni gönder",
  busy: "Tarayıcıdan yanıt bekleniyor…",
  sent: "Tarayıcı işlemi onaylandı.",
  unknown: "İşlemin sonucu bilinmiyor.",
  unknownHelp:
    "Otomatik tekrar yapılmaz. Devam etmeden önce görüntüyü yenileyip uzak sayfayı inceleyin. Bu yerel işaret metin veya adres içermez ve sunucu makbuzu değildir.",
  review: "Güncel görüntüyü incele",
  reviewCheck:
    "Güncel sayfayı inceledim; önceki işlemin gerçekleşmiş olabileceğini anlıyorum.",
  reviewDone: "İncelemeyi bitir",
  reviewRequired:
    "Yeni işlem göndermeden önce sonucu belirsiz işlemi inceleyin.",
  error:
    "İstek reddedildi. Görüntüyü yenileyip tarayıcının kimde olduğunu kontrol edin.",
  close: "Tarayıcıyı kapat",
  closeTitle: "Bu tarayıcı oturumu kapatılsın mı?",
  closeHelp:
    "Uzak sayfa ve kaydedilmemiş verileri kapanacak. Geçerli kontrol yetkiniz gerekir.",
  cancel: "Vazgeç",
  confirm: "Oturumu kapat",
  fullscreen: "Tam ekran",
  exitFullscreen: "Tam ekrandan çık",
  fullscreenError: "Bu tarayıcıda tam ekran kullanılamıyor.",
  back: "Geri",
  forward: "İleri",
  reload: "Sayfayı yenile",
  tab: "Sonraki alan",
  shiftTab: "Önceki alan",
  enter: "Enter",
  backspace: "Geri sil",
  escape: "Escape",
  up: "Yukarı",
  down: "Aşağı",
  left: "Sol",
  right: "Sağ",
  scrollUp: "Yukarı kaydır",
  scrollDown: "Aşağı kaydır",
  storageError:
    "Yerel kurtarma kaydı saklanamıyor. Düzelene kadar yeni işlemler kapalı.",
  retryStorage: "Yerel kaydı yeniden dene",
  damaged:
    "Yerel kurtarma işareti okunamıyor. Temizlemeden önce güncel sayfayı inceleyin.",
  draftsHint:
    "Metin ve adres taslakları yalnız bu sekmenin belleğinde tutulur. Sayfayı yenilemeden veya sekmeyi kapatmadan önce kopyalayın.",
  windowVisible: "Pencere ana bilgisayarda görünür",
  windowHidden: "Tarayıcı arka planda çalışıyor",
};
copy.unknownHelp += " İşlem daha sonra da tamamlanabilir.";
export default copy;
