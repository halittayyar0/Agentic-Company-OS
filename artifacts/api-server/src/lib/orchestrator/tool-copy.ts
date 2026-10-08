/** App-authored tool prose. Source text and machine identifiers stay literal. */
export const toolTr = {
  budgetFamilyResumed:
    "Kullanım sınırı kontrol edildi; {count} iş yeniden sıraya alındı.",
  pathInvalid: "Hata: path bir metin olmalı.",
  pathNoncanonical:
    "Hata: path başında veya sonunda boşluk bulunamaz; dosya adı sessizce değiştirilmez.",
  teamToolNameInvalid:
    "Hata: toolName başında veya sonunda boşluk olmadan tam araç kimliği olmalı.",
  directoryObserved: "Gözlenen {count} kaydın {shown} tanesi gösteriliyor.",
  directoryScanLimited:
    "Dizin taraması sınıra ulaştı; başka kayıtlar bulunabilir.",
  directoryEntriesSkipped: "İncelenemeyen kayıt sayısı: {count}.",
  pathRequired: "Hata: boş olmayan bir path gerekli.",
  contentRequired:
    "Hata: content bir metin olmalı; boş dosya için açıkça boş metin gönderin.",
  listDispatch: "Dosya listesi okunuyor",
  readDispatch: "Dosya okunuyor",
  writeDispatch: "Dosya yazılıyor",
  directoryEmpty: "Dizin boş: /{path}",
  directoryFile: "[FILE] {path} ({bytes} bayt)",
  directoryTotal: "(toplam {count} kayıt)",
  directoryListed: "{name} dizini listeledi: /{path}",
  directoryEmptyListed: "{name} boş dizini listeledi: /{path}",
  directoryListFailed: "{name} dizini listelerken hata aldı.",
  fileRead: "{name} dosyayı okudu: {path}",
  fileWritten: "{name} çalışma alanına dosya yazdı: {path} ({bytes} bayt).",
  fileWriteComplete: "Dosya yazıldı: {path} ({bytes} bayt).",
  fileReadFailed: "{name} dosyayı okurken hata aldı.",
  fileWriteFailed: "{name} dosyayı yazarken hata aldı.",
  listFailure: "Dosya listesi okunamadı.",
  readFailure: "Dosya okunamadı.",
  writeFailure: "Dosya yazılamadı.",
  fileTruncated: "...(kesildi)",
  computerPermissionDenied: "Hata: bu ajanın bilgisayar gözlem yetkisi yok.",
  computerDispatch: "Bilgisayar durumu okunuyor",
  computerTitle: "BİLGİSAYAR DURUMU",
  workspaceTitle: "TERMİNAL / ÇALIŞMA ALANI",
  browserTitle: "TARAYICI",
  computerRecent: "SON BİLGİSAYAR ADIMLARI (eskiden yeniye)",
  computerNext:
    "Sonraki bilgisayar eylemini bu gerçek duruma göre tek adım olarak seç; sonucunu gördükten sonra devam et.",
  computerObserved: "{name} bilgisayar durumunu gözlemledi.",
  computerObservationFailed:
    "{name} bilgisayar durumunu gözlemlerken hata aldı.",
  computerFailure: "Bilgisayar gözlemi başarısız.",
  computerError: "Gözlem hatası: {message}",
  emergencyBlocked:
    "ENGELLENDİ: acil durdurma etkinleştirildi veya yürütme sırasında değişti; araç işlemi durduruldu.",
  operationFailure: "Araç işlemi tamamlanamadı.",
  browserPermissionDenied: "Hata: bu ajanın tarayıcı izni yok (canBrowse).",
  browserWorkerOnly:
    "ENGELLENDİ: split API runtime tarayıcı araçlarını yerel olarak çalıştıramaz; bu işlemi bir worker runtime yürütmelidir.",
  browserUrlRequired: "Hata: url boş olmayan bir metin olmalı.",
  browserUrlInvalid: "Hata: url geçersiz.",
  browserRefRequired: "Hata: ref pozitif ve güvenli bir tamsayı olmalı.",
  browserInputTextInvalid:
    "Tarayıcı metni boş olmamalı, geçerli Unicode içermeli ve NUL içermemelidir; sınır 4096 UTF-16 kod birimidir.",
  browserTextRequired: "Hata: text bir metin olmalı.",
  browserSubmitInvalid: "Hata: submit yalnız true veya false olabilir.",
  browserDirectionRequired: "Hata: direction yalnız up veya down olabilir.",
  browserWaitRequired: "Hata: milliseconds sonlu bir sayı olmalı.",
  browserNameInvalid: "Hata: name bir metin olmalı.",
  browserSeparateSubmit:
    "ENGELLENDİ: metin girişi ve form gönderimi ayrı onaylı eylemler olmalı. Önce browser_type submit=false kullan; sonra yeni snapshot al ve kesin gönder düğmesini browser_click ile ayrı onaya sun.",
  browserTargetChanged:
    "ENGELLENDİ: onaylı tarayıcı hedefi değişti veya mevcut değil; yeni snapshot ve onay gerekli.",
  browserFieldChanged:
    "ENGELLENDİ: onaylı tarayıcı alanı değişti, hassaslaştı veya mevcut değil; yeni snapshot ve onay gerekli.",
  browserSensitiveBlocked:
    "ENGELLENDİ: ajan parola, OTP, kart veya benzeri hassas kimlik alanlarını dolduramaz. Bu alanı kurucu Browser Workbench üzerinden kendisi doldurmalı.",
  browserUnknown: "Bilinmeyen hata",
  browserOpenDispatch: "Tarayıcı sayfası açılıyor",
  browserSnapshotDispatch: "Tarayıcı sayfası gözlemleniyor",
  browserApprovedClickDispatch: "Onaylı tıklama gönderiliyor",
  browserClickDispatch: "Tarayıcı tıklaması gönderiliyor",
  browserLinkDispatch: "Güvenli bağlantı açılıyor",
  browserApprovedTypeDispatch: "Onaylı metin gönderiliyor",
  browserTypeDispatch: "Tarayıcı metni gönderiliyor",
  browserScrollDispatch: "Tarayıcı kaydırılıyor",
  browserExtractDispatch: "Tarayıcı metni okunuyor",
  browserWaitDispatch: "Tarayıcı bekletiliyor",
  browserScreenshotDispatch: "Tarayıcı kanıtı kaydediliyor",
  browserOpened: "{name} tarayıcısında sayfa açtı.",
  browserOpenFailed: "{name} tarayıcı sayfasını açamadı.",
  browserObserved: "{name} tarayıcı sayfasını gözlemledi.",
  browserObserveFailed: "{name} tarayıcı gözleminde hata aldı.",
  browserApprovedClicked: "{name} onaylı sayfa hedefini tıkladı.",
  browserClicked: "Tıklandı.",
  browserClickFailed: "{name} tarayıcı tıklamasında hata aldı.",
  browserClickApproval: "{name} tarayıcı tıklaması için onay bekliyor.",
  browserLinkOpened: "{name} güvenli bağlantı hedefini açtı.",
  browserLinkFailed: "{name} güvenli bağlantıyı açarken hata aldı.",
  browserLinkFailure: "Güvenli bağlantı açılamadı.",
  browserApprovedTyped: "{name} onaylı tarayıcı alanına metin yazdı.",
  browserTyped: "Metin yazıldı. Güncel sayfa görünümü aşağıda.",
  browserSensitiveAvoided:
    "{name} hassas tarayıcı alanından güvenli biçimde çekildi.",
  browserTypeApproval: "{name} tarayıcı metin girişi için onay bekliyor.",
  browserTypeFailed: "{name} tarayıcı metin girişinde hata aldı.",
  browserScrolledDown: "{name} tarayıcı sayfasını aşağı kaydırdı.",
  browserScrolledUp: "{name} tarayıcı sayfasını yukarı kaydırdı.",
  browserDown: "Aşağı kaydırıldı.",
  browserUp: "Yukarı kaydırıldı.",
  browserScrollFailed: "{name} tarayıcı kaydırmasında hata aldı.",
  browserExtracted: "{name} tarayıcıdaki görünür metni çıkardı.",
  browserExtractFailed: "{name} tarayıcı metni çıkarırken hata aldı.",
  browserEmptyText: "(sayfa metni boş)",
  browserWaited: "{name} dinamik tarayıcı sayfasını yeniden gözlemledi.",
  browserWaitComplete: "{milliseconds} ms beklendi.",
  browserWaitFailed: "{name} tarayıcı bekleme adımında hata aldı.",
  browserScreenshotSaved:
    "{name} tarayıcı ekran görüntüsünü kanıt olarak kaydetti.",
  browserScreenshotFailed: "{name} tarayıcı kanıt görüntüsünü kaydedemedi.",
  browserPngSaved: "PNG kanıtı kaydedildi: {path}",
  browserSize: "Boyut: {bytes} bayt",
  browserError: "Tarayıcı hatası: {message}",
  browserSnapshotError: "Sayfa gözlem hatası: {message}",
  browserClickError: "Tıklama hatası: {message}",
  browserTypeError: "Yazma hatası: {message}",
  browserScrollError: "Kaydırma hatası: {message}",
  browserExtractError: "Metin çıkarma hatası: {message}",
  browserWaitError: "Bekleme hatası: {message}",
  browserScreenshotError: "Ekran görüntüsü hatası: {message}",
  browserPage: "SAYFA: {title} · {url}",
  browserUntitled: "(başlıksız)",
  browserReferences: "ETKİLEŞİMLİ ÖĞE REFERANSLARI:",
  browserValue: "{text} (değer: {value})",
  browserVisibleText: "GÖRÜNÜR METİN (ilk bölüm):",
  browserActionUnknown:
    "Tarayıcı eylemi gönderildi ancak sonucu doğrulanamadı. Otomatik tekrar engellendi.",
  browserLaunchFailed: "Tarayıcı başlatılamadı ({channel}): {message}",
  browserLaunchUnavailable: "Tarayıcı başlatılamadı ({channel}).",
  browserDisconnected:
    "Tarayıcı oturumu etkin eylem sırasında koptu; eylem yeni oturumda otomatik tekrarlanmayacak.",
  browserSessionLimit:
    "Tarayıcı oturum sınırı dolu ({limit}). Boştaki oturumlar otomatik kapanır.",
  browserSessionMissing: "Tarayıcı oturumu kullanılamıyor.",
  browserAffinityFailure:
    "Tarayıcı oturumu çalıştırıcıya güvenle bağlanamadı; oturum kapatıldı.",
  browserSessionChanged:
    "Tarayıcı oturumu kapandı veya değişti; komut uygulanmadı.",
  browserApprovedSessionChanged:
    "Onaylı tarayıcı oturumu kapandı veya değişti; yeni onay gerekli.",
  browserRefMissing: "ref={ref} bulunamadı. Önce browser_snapshot al.",
  browserRefDetached: "ref={ref} artık sayfada görünmüyor.",
  browserRefStale: "ref={ref} eski bir snapshot’a ait. Yeni snapshot al.",
  browserApprovedElementChanged:
    "Sayfa veya hedef öğe onaydan sonra değişti; yeni onay gerekli.",
  browserApprovedFieldChanged:
    "Sayfa veya hedef alan onaydan sonra değişti; yeni onay gerekli.",
  browserOperatorLeaseRequired: "Operatör eylemi için etkin leaseId gerekli.",
  browserClosing: "Tarayıcı oturumu kapatılıyor; yeni eylem başlatılamaz.",
  browserRuntimeClosing:
    "Tarayıcı çalıştırıcısı zaten kapatılıyor veya duraklatılıyor.",
  browserQueueFull:
    "Tarayıcı girdi kuyruğu dolu ({limit}); istemci yavaşlamalı.",
  browserOperatorOwns:
    "Operatör bu tarayıcıyı devraldı; ajan eylemleri {expiresAt} zamanına kadar kullanılamaz.",
  browserAgentBusy:
    "Ajan tarayıcı eylemi sürüyor; devralmak için eylemin bitmesini bekleyip yeniden dene.",
  browserOtherOperator:
    "Tarayıcı başka bir operatörün yürütme yetkisi altında.",
  browserLeaseInvalid: "Tarayıcı kontrol yetkisi geçersiz veya süresi dolmuş.",
  browserReleaseOwnerOnly:
    "Tarayıcıyı ajana yalnız etkin kontrol yetkisinin sahibi geri verebilir.",
  browserOperatorBusy:
    "Operatör tarayıcı eylemi sürüyor; kontrol henüz bırakılamaz.",
  browserActionInFlight:
    "Tarayıcı eylemi sürerken oturum kapatılamaz; eylemin bitmesini bekle.",
  browserCloseOwnerOnly:
    "Operatör kontrolündeki tarayıcı yalnız tam ve etkin leaseId ile kapatılabilir.",
  browserTargetInvalid: "Geçersiz tarayıcı hedefi.",
  browserPrivateTarget:
    "Özel veya yerel ağ hedefleri tarayıcı güvenlik politikası tarafından engellendi.",
  browserPrivateIp: "Özel veya yerel IP hedefleri engellendi.",
  browserUnsafeResolution:
    "Hedef alan adı için güvenli ve kullanılabilir bir IP adresi doğrulanamadı.",
  browserUnresolved: "Hedef alan adı çözümlenemedi.",
  browserProtocolDenied: "Yalnız http ve https adreslerine izin verilir.",
  browserCredentialsDenied:
    "URL içinde kullanıcı adı veya parola kullanılamaz.",
  teamStringRequired: "Hata: {field} boş olmayan bir metin olmalı.",
  teamStringInvalid: "Hata: {field} metin olmalı.",
  teamNumberInvalid: "Hata: {field} geçerli bir sayı olmalı.",
  teamChoiceInvalid: "Hata: {field} şu değerlerden biri olmalı: {choices}.",
  teamBriefTooLong: "Hata: brief en fazla 8000 karakter olabilir.",
  teamCadenceInvalid:
    "Hata: autonomyMode finite/continuous olmalı; cadenceSeconds yalnız continuous için 60-604800 aralığında olabilir.",
  teamCreateDenied: "Hata: bu ajanın alt ajan oluşturma yetkisi yok.",
  teamDelegateDenied: "Hata: bu ajanın görev devretme yetkisi yok.",
  teamAgentCapacity: "ENGELLENDİ: aktif ajan kapasitesi dolu (limit={limit}).",
  teamTaskCapacity:
    "ENGELLENDİ: bekleyen görev kapasitesi dolu (limit={limit}).",
  teamCreateStopped: "ENGELLENDİ: görev durduruldu; alt ajan oluşturulmadı.",
  teamAgentCreated: "Yeni alt ajan oluşturuldu. agentId={id}",
  teamAgentActivity:
    '{name}, "{child}" ({role}) adlı yeni bir alt ajan oluşturdu.',
  teamDelegateStopped:
    "ENGELLENDİ: hedef ajan pasif/uygunsuz veya kaynak görev durduruldu; delegasyon oluşturulmadı.",
  teamDelegated: "Görev oluşturuldu ve devredildi. taskId={id}",
  teamTaskCreatedActivity: 'Yeni görev oluşturuldu: "{title}"',
  teamDelegatedActivity:
    '{name}, "{title}" görevini {target} ({role}) adlı ajana devretti.',
  teamTaskContext: "Hata: aktif bir görev bağlamında değilsin.",
  teamProgressDefault: "İlerleme güncellendi.",
  teamProgressStopped: "ENGELLENDİ: görev durduruldu; ilerleme yazılmadı.",
  teamProgressSaved: "İlerleme kaydedildi: %{progress}.",
  teamTaskLost: "ENGELLENDİ: görev durduruldu veya yürütme yetkisi kaybedildi.",
  teamChildUnresolved:
    "ENGELLENDİ: bağlı alt görev taskId={id} halen {status}; önce alt görev sonucunu çöz veya iptal et.",
  teamCompletionRejected:
    "Denetim bu tamamlanmayı reddetti: {reason} Lütfen görevi orijinal talimatla uyumlu hale getirip tekrar dene.",
  teamCyclePrepared:
    "Bu çalışma döngüsü {at} için atomik sonlandırmaya hazırlandı.",
  teamCompletionPrepared: "Görev tamamlanması atomik sonlandırmaya hazırlandı.",
  teamCycleActivity:
    "Sürekli sorumluluğun bu döngüsü tamamlandı; sonraki çalışma planlandı: {summary}",
  teamCompletionWarnActivity:
    "Görev tamamlandı (denetim uyarısı ile): {summary}",
  teamCompletionActivity: "Görev tamamlandı: {summary}",
  teamChildCompletedActivity:
    '{name}, bağlı alt görevi tamamladı: "{title}" -- {summary}',
  teamCompletionStopped: "ENGELLENDİ: görev durduruldu; tamamlanma yazılmadı.",
  teamCycleComplete:
    "Bu çalışma döngüsü tamamlandı; görev {at} tarihinde yeniden çalışacak.",
  teamComplete: "Görev başarıyla tamamlandı olarak işaretlendi.",
  teamApprovalUnsupported:
    "ENGELLENDİ: {tool} onaydan sonra atomik olarak çalıştırılabilen bir eylem değildir; araç adı taşıyan eylemsiz onay oluşturulamaz.",
  teamApprovalScopeRequired:
    "ENGELLENDİ: araç kapsamlı onay toolName ve toolArgs alanlarını birlikte gerektirir.",
  teamApprovalArgsInvalid: "Hata: toolArgs bir JSON nesnesi olmalı.",
  teamSudoDenied:
    "ENGELLENDİ: sudo onayı yalnızca çalışma izni açık, aktif ve yetkili kök CEO tarafından oluşturulabilir.",
  teamSudoInvalid: "ENGELLENDİ: geçersiz sudo onayı ({reason})",
  teamSudoTitle: "KRİTİK: CEO Host Shell komutu",
  teamSudoDescription:
    "Bu onay, aşağıdaki tam komutu belirtilen host ve başlangıç dizininde API servis hesabının mevcut işletim sistemi yetkileriyle bir kez çalıştırır; root/Administrator yükseltmesi sağlamaz. Komutun çağırdığı betik/program onaydan sonra değişebilir; başlatılan alt süreçler shell timeout süresini aşabilir.",
  teamCategoryRequired:
    "ENGELLENDİ: {tool} eylemi category={category} gerektirir; daha düşük bir kategoriyle onay kapsamı oluşturulamaz.",
  teamCategoryDenied:
    "ENGELLENDİ: bu ajanın {category} kategorisinde eylem önerme yetkisi yok.",
  teamBrowserApprovalContext:
    "ENGELLENDİ: tarayıcı onayı aktif bir worker, mevcut snapshot ve sayısal ref gerektirir.",
  teamBrowserApprovalMissing:
    "ENGELLENDİ: tarayıcı hedefi mevcut oturumda bulunamadı; yeni snapshot al ve yeniden öner.",
  teamBrowserApprovalSensitive:
    "ENGELLENDİ: hassas tarayıcı alanları ajan onayıyla doldurulamaz.",
  teamSpendAmount:
    "ENGELLENDİ: harcama onayı pozitif ve sonlu amountUsd gerektirir.",
  teamApprovalStopped:
    "ENGELLENDİ: görev durduruldu; onay talebi oluşturulmadı.",
  teamAmount: "Tutar: ${amount}",
  teamApprovalRejected:
    "Denetim bu onay talebini reddetti: {reason} Bu eylemi başlatma.",
  teamSudoRevoked:
    "ENGELLENDİ: sudo yetkisi onay kaydı oluşturulmadan önce geri alındı.",
  teamSudoTargetChanged:
    "ENGELLENDİ: sudo host veya çalışma alanı onay oluşturulmadan önce değişti.",
  teamApprovalPrepared: "Onay talebi atomik sonlandırmaya hazırlandı.",
  teamApprovalActivity: "Onay talebi: {title}",
  teamApprovalCapacity:
    "ENGELLENDİ: onay/görev kapasitesi dolu (limit={limit}).",
  teamApprovalCreated:
    "Onay talebi oluşturuldu (approvalId={id}, taskId={taskId}); kullanıcının onayı bekleniyor.",
  teamApprovalExpiry: " Onay {minutes} dakika ve tek kullanım için geçerlidir.",
  teamReviewNote: " (Denetim notu: {reason})",
  teamQuestionBound:
    "Hata: question görünür metin içermeli ve 1000 karakteri aşmamalı. Tek, tam ve kısa bir soru sor.",
  teamQuestionPrepared: "Soru atomik sonlandırmaya hazırlandı.",
  teamInputWaiting: "Kullanıcı girdisi bekleniyor.",
  teamQuestionActivity: "Soru: {question}",
  teamQuestionStopped: "ENGELLENDİ: görev durduruldu; soru kaydedilmedi.",
  teamQuestionSaved: "Soru kaydedildi, kullanıcının cevabı bekleniyor.",
  teamNoteSaved: "Not kaydedildi.",
  teamMessageBound: "Hata: ortak kanal mesajı en fazla 4000 karakter olabilir.",
  teamChannelName: "Ortak Şirket Chat",
  teamChannelMissing: "Şirket kanalı bulunamadı.",
  teamMembershipMissing: "Ajan Şirket Odası üyesi değil veya aktif değil.",
  teamReplyMissing: "Yanıt verilen ortak kanal mesajı bulunamadı.",
  teamMessageCooldown:
    "Aynı ajanın ortak kanal mesajları arasında en az 5 saniye olmalıdır.",
  teamMessageCapacity:
    "ENGELLENDİ: ortak kanal mesaj kapasitesi dolu (limit={limit}).",
  teamBlocked: "ENGELLENDİ: {reason}",
  teamMessageFailed: "ENGELLENDİ: ortak kanal mesajı kaydedilemedi.",
  teamMessageSaved:
    "Ortak şirket kanalı mesajı gerçek gönderen kimliğinle kaydedildi (messageId={id}).",
  previewInstance: "API işlem örneği: {id}",
  previewHost: "Host: {host}",
  previewDirectory: "Başlangıç dizini: {path}",
  previewCommand: "Tam komut (aynen çalıştırılacak):",
  previewWarning:
    "Uyarı: Komutun çağırdığı betik/program onaydan sonra değişebilir; başlatılan alt süreçler shell timeout süresini aşabilir.",
  previewPage: "Sayfa: {url}",
  previewUnknown: "(bilinmiyor)",
  previewField: "Alan: {role} · {text}",
  previewFieldDefault: "alan",
  previewUnlabeled: "(etiketsiz)",
  previewContext: "Bağlam: {text}",
  previewText: "Yazılacak metin: {text}",
  previewSubmit: "Enter ile gönder: {value}",
  previewYes: "evet",
  previewNo: "hayır",
  previewElement: "Öğe: {role} · {text}",
  previewElementDefault: "öğe",
  previewLink: "Bağlantı: {url}",
  previewForm: "Form hedefi: {url}",
  judgeMissingReason: "Denetim gerekçe döndürmedi.",
  judgeSudoReason:
    "Sudo önerisi {verdict} olarak sınıflandırıldı; tam komut yalnızca yerel insan onayında gösterilir.",
  judgeReview: "Denetim ({purpose}): {verdict}",
  judgeCompletion: "tamamlama",
  judgeApproval: "onay talebi",
  judgeRedacted: "[GİZLENDİ: tam sudo komutu yalnızca bekleyen onayda tutulur]",
  judgeCompletionUnavailable:
    "Denetim doğrulanamadığı için tamamlama güvenli biçimde durduruldu.",
  judgeApprovalUnavailable:
    "Denetim servisi çalışmadı; bu talep yalnızca insan onayıyla ilerleyebilir.",
  judgeUnavailable: "Denetim kullanılamadı: {verdict}",
  teamAgentReplayed:
    "Alt ajan daha önce oluşturuldu; tekrar oluşturulmadı. agentId={id}",
  teamTaskReplayed:
    "Delegasyon daha önce kaydedildi; tekrar oluşturulmadı. taskId={id}",
  teamApprovalReplayed:
    "Onay talebi daha önce atomik olarak kaydedildi; tekrar oluşturulmadı. approvalId={id}",
  teamOperationReplayed:
    "İşlem daha önce atomik olarak kaydedildi; tekrar uygulanmadı.{evidence}",
  teamEvidence: " Kanıt: {data}.",
  readReplayed:
    "Okuma daha önce tamamlandı; ham içerik işlem kaydında saklanmadı. Güncel veri için yeni bir okuma çağrısı yap.",
  readReconciled:
    "Operatör bu okumayı uygulanmış olarak uzlaştırdı; otomatik tekrar yapılmadı ve ham içerik saklanmadı.",
  readRetry:
    "Okuma tamamlanamadı; güvenli yeniden deneme için serbest bırakıldı.",
  teamCreateDispatch: "Alt ajan oluşturuluyor",
  teamDelegateDispatch: "Görev devrediliyor",
  teamProgressDispatch: "İlerleme kaydediliyor",
  teamCompleteDispatch: "Görev sonucu inceleniyor",
  teamApprovalDispatch: "Operatör onayı isteniyor",
  teamQuestionDispatch: "Kullanıcıdan bilgi isteniyor",
  teamNoteDispatch: "Kanıt notu kaydediliyor",
  teamMessageDispatch: "Ortak kanala mesaj yazılıyor",
  toolDispatch: "Araç çalıştırılıyor · {tool}",
  chatAnalyzing: "Mesaj analiz ediliyor",
  chatPlanning: "Yanıt hazırlanıyor · tur {round}/{total}",
  taskAnalyzing: "Görev analiz ediliyor",
  taskPlanning: "Plan hazırlanıyor · tur {round}/{total}",
  taskModelRunning: "Model çalışıyor · {model}",
  taskOwnerMissing:
    "Görev sahibi ajan bulunamadı veya pasif; görev başarısız olarak işaretlendi.",
  taskLeaseMismatch: "Görev ve ajan çalışma izinlerinin sahipleri eşleşmedi.",
  modelFallback:
    "Birincil model bu adımda ilerleyemedi; görev izin verilen yedek model {model} ile devam ediyor.",
  modelRouteFailed:
    "Model kullanılamadı; görev izin verilen sonraki model {model} ile devam etmeyi deniyor.",
  taskUnknownError: "Bilinmeyen görev adımı hatası.",
  taskBlocked:
    "Görev {count} ardışık çalışma hatasından sonra durduruldu; kullanıcı incelemesi gerekiyor.",
  taskProviderRetry:
    "İzin verilen tüm modellerle yapılan denemeler sonuçsuz kaldı; görev korundu ve {at} için yeniden sıraya alındı.",
  taskRuntimeRetry:
    "Bu adımda sistem hatası oluştu; görev {at} için yeniden sıraya alındı.",
  receiptLabel: "İşlem kaydı: {id}",
  toolUnknown: "Hata: bilinmeyen araç '{tool}'.",
  approvedToolCompleted: "Onaylı eylem tamamlandı: {tool}.",
  approvedToolFailed: "Onaylı eylem başarısız oldu: {tool}.",
  exclusiveTurnInstruction:
    "Kullanıcı bu turu açıkça şu araçlarla sınırladı: {tools}. İzinli sonucu üretmek için yararlı görünse bile bu kapsamın dışına çıkma; kapsam dışında not, dosya, görev veya alt ajan oluşturma. İzinli araçlar yetersizse kapsamı genişletmeden bunu bildir.",
  exclusiveSudoExactInstruction:
    "Sudo onayı yalnızca kullanıcının yazdığı tam komut için istenebilir.",
  exclusiveSudoUnavailableInstruction:
    "Tam sudo komutu güvenle çıkarılamadı. Bu turda sudo aracı kullanma; kapsamı genişletmeden engeli bildir.",
  operationReconciled: "Belirsiz işlem operatör tarafından uzlaştırıldı.",
  approvalBindingInvalidated:
    "Onaylı tarayıcı bağlantısı geçersizleşti; yeni onay gerekiyor.",
  judgeRunning: "Görev denetimi çalışıyor",
  taskAdvanceInstruction:
    "Görevi bir adım ilerlet. Mevcut durumu değerlendir ve uygun araç çağrılarını yap.",
  taskOpenInstruction:
    "Görev hâlen açık. Yalnızca açıklama üretip durma: sonraki güvenli somut aracı çağır, insan girdisi gerekiyorsa request_user_input kullan veya kabul kriterleri kanıtla karşılandıysa complete_task çağır.",
  taskPassiveFallbackInstruction:
    "Önceki model iki kez görev yaşam döngüsü aracı kullanmadan durdu. Aynı bağlamı koruyarak işi somut bir araç adımıyla sürdür.",
  taskBatchFallbackInstruction:
    "Önceki model güvenli araç toplu çağrı sınırını aştı ({count}/{limit}). Aynı görevi koruyarak tur başına bu sınırın altında kal ve en güvenli somut adımdan devam et.",
  taskLifecycleFallbackInstruction:
    "Önceki model görev yaşam döngüsü aracını iki kez geçersiz veya reddedilen argümanlarla çağırdı. Aynı bağlamı koruyarak sonucu doğrula ve yaşam döngüsü aracını geçerli argümanlarla çağır.",
  taskToolRetryInstruction:
    "Bu turdaki tüm araç çağrıları geçersiz, yetkisiz veya çalıştırılmamış olarak reddedildi. Araç şemasını ve izinleri düzeltip bir kez daha somut, geçerli bir araç çağrısı yap.",
  taskToolFallbackInstruction:
    "Önceki model araç protokolünü iki kez kullanamadı. Aynı bağlamı koru; izinli araç şemasına tam uyan tek bir somut adımla devam et.",
  operationCompleted: "İşlem tamamlandı: {tool}.",
  modelFailure: "{reason} ({source})",
  failureRateLimit: "Modelin istek sınırına ulaşıldı.",
  failureTimeout: "Model isteği zaman aşımına uğradı.",
  failureAuthentication: "Model sağlayıcısı kimlik doğrulamayı reddetti.",
  failurePayment: "Model sağlayıcısı ödeme veya kullanılabilir bakiye istiyor.",
  failureModelUnavailable: "İstenen model kullanılamıyor.",
  failureToolCompatibility:
    "Model gerekli araç protokolüyle kullanılabilir bir yanıt üretemedi.",
  failureProviderUnavailable: "Model sağlayıcısına ulaşılamıyor.",
  schedulerClaimed: "Görev sırası alındı",
  projectMeetingRunning: "Proje toplantısında yanıt hazırlıyor: {title}",
  schedulerAccepted: "Görev teslim alındı; çalışma başlatıldı.",
  schedulerRecovered:
    "Kesintiye uğrayan çalışma kurtarıldı ve yeniden sıraya alındı.",
  schedulerRecoveryPaused:
    "Kesintiye uğrayan çalışma kurtarıldı; acil durdurma nedeniyle yürütme bekliyor.",
  schedulerRecoveryPausedNote:
    "Kesintiye uğrayan çalışmanın sahipliği bırakıldı; acil durdurma kaldırılana kadar yürütme bekliyor.",
  schedulerRecoveryNote:
    "Kesintiye uğrayan çalışmanın sahipliği bırakıldı; görev yeniden sıraya alındı.",
  schedulerStepBudget: "Operatör adım sınırı aşıldı ({used}/{limit}).",
  schedulerTokenBudget: "Token bütçesi aşıldı ({used}/{limit}).",
  schedulerUnreportedTokenUsage:
    "Bu işin token kullanımı eksik raporlandı. Ölçülemeyen harcamayı önlemek için yeni model çağrıları durduruldu. Kayıtlı çağrıları inceleyin; devam etmek için token kullanımını raporlayan bir sağlayıcıyla yeni bir iş başlatın. Mevcut kayıtlar korunur.",
  schedulerCostBudget:
    "Sağlayıcı-raporlu maliyet bütçesi aşıldı (${used}/{limit}).",
  schedulerFamilyTokenBudget:
    "Ana iş #{rootTaskId} ve alt görevleri için ortak token bütçesine ulaşıldı ({used}/{limit}).",
  schedulerFamilyCostBudget:
    "Ana iş #{rootTaskId} ve alt görevleri için sağlayıcı-raporlu ortak maliyet bütçesine ulaşıldı (${used}/{limit}).",
  schedulerFamilyDailyTokenBudget:
    "Ana iş #{rootTaskId} ve alt görevleri için son 24 saatin ortak token bütçesine ulaşıldı ({used}/{limit}).",
  schedulerFamilyDailyCostBudget:
    "Ana iş #{rootTaskId} ve alt görevleri için son 24 saatin sağlayıcı-raporlu ortak maliyet bütçesine ulaşıldı (${used}/{limit}).",
  schedulerBudgetStopped:
    "Görev güvenlik bütçesi nedeniyle durduruldu: {reason}",
} as const;

export type ToolMessageKey = keyof typeof toolTr;
export type ToolCopy = { [Key in ToolMessageKey]: string };

export interface ToolMessage {
  key: ToolMessageKey;
  params?: Readonly<Record<string, string | number>>;
}
