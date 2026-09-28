/** App-authored Terminal prose only. Commands, machine codes and source output
 * never become lookup keys or templates. Translate every placeholder exactly. */
export const terminalTr = {
  emptyDirectory: "(boş)",
  usageCat: "Kullanım: cat <dosya>",
  usageMkdir: "Kullanım: mkdir <dizin>",
  usageTouch: "Kullanım: touch <dosya>",
  usageWrite: "Kullanım: write <dosya> <içerik>",
  usageRemove: "Kullanım: rm <yol>",
  written: "{path} yazıldı ({bytes} bayt)",
  removed: "{path} silindi",
  helpBuiltins: "Yerleşik komutlar:",
  helpProcessesEnabled:
    "Harici programlar etkin: {commands}. Çalışma dizini ajan alanıdır; bu programlar ana sisteme erişebilir. Yalıtım ayrı bir container/VM tarafından sağlanmalıdır.",
  helpProcessesDisabled:
    "Harici programlar kapalı: {commands}. Yalnız yalıtılmış bir container/VM içinde ALLOW_AGENT_PROCESS_EXEC=true ile etkinleştirin; komut listesi bir güvenlik sınırı değildir.",
  helpDeleteReview:
    "rm/del doğrudan siler. Sürüm incelemesiyle silmek için Dosyalar ekranındaki silme akışını kullanın.",
  emptyCommand: "Boş komut.",
  forbiddenCommand:
    "Komut güvenlik nedeniyle engellendi: kabuk yönlendirme, zincirleme, tırnak, ters eğik çizgi ve satır sonu karakterleri kullanılamaz.",
  commandNotAllowed:
    'Komuta izin verilmiyor: "{command}". Liste için help kullanın.',
  processDisabled:
    "Harici program çalıştırma varsayılan olarak kapalı. Dosya komutlarını kullanın veya yalnız yalıtılmış bir container/VM içinde ALLOW_AGENT_PROCESS_EXEC=true ayarlayın.",
  queuedCancelled: "Acil durdurma nedeniyle bekleyen ajan komutu iptal edildi.",
  invalidWorkspace: "Geçersiz çalışma alanı kimliği.",
  unsafePath: 'Güvensiz yol reddedildi: "{path}"',
  regularFileReadOnly: "Yalnız normal dosyalar okunabilir.",
  readLimit: "Dosya okuma sınırını aşıyor.",
  workspaceSymlink: "Ajan çalışma alanı sembolik bağlantı olamaz.",
  pathSymlink: "Sembolik bağlantı yolu reddedildi: {path}",
  directoryMissing: "Dizin bulunamadı: {path}",
  directoryUnreadable: "Dizin okunamadı: {path}",
  filePathRequired: "Dosya yolu gerekli.",
  fileMissing: "Dosya bulunamadı: {path}",
  fileUnreadable: "Dosya okunamadı: {path}",
  rootReplaceDenied: "Çalışma alanı kökü bir dosyayla değiştirilemez.",
  contentTooLarge: "İçerik çok büyük (sınır {bytes} bayt).",
  binaryTooLarge: "İkili içerik çok büyük (sınır {bytes} bayt).",
  pathRequired: "Yol gerekli.",
  rootDeleteDenied: "Çalışma alanı kökü silinemez.",
  rootNotFile: "Çalışma alanı kökü bir dosya değildir.",
  regularFileTouchOnly: "touch yalnız normal dosyalara uygulanabilir.",
  fileChanged: "Dosya incelemeden sonra değişti. Yeni sürümü inceleyin.",
  fileNotEditable: "Bu dosya bu akışta düzenlenemez.",
  fileVersionRequired: "Düzenleme için incelenmiş dosya sürümü gerekli.",
  deleteChanged:
    "Silinecek içerik incelemeden sonra değişti. Yeniden inceleyin.",
  deleteMissing: "Silinecek içerik artık mevcut değil.",
  deleteNotReviewable: "Silinecek içerik güvenli inceleme sınırlarını aşıyor.",
  deleteVersionRequired:
    "Silme için incelenmiş sürüm gerekli. Dosyalar ekranındaki silme incelemesini kullanın.",
  commandRequired: "command zorunludur.",
  sudoCommandTooLong: "sudo komutu en fazla {limit} karakter olabilir.",
  sudoCommandControls:
    "sudo komutu ASCII kontrol veya Unicode yönlendirme karakteri içeremez.",
  sudoWorkspaceSymlink: "Ajan sudo çalışma alanı sembolik bağlantı olamaz.",
  sudoDisabled: "Ajan sudo kapalı (açmak için ALLOW_AGENT_SUDO=true gerekir).",
  sudoAuthorityDenied: "Ajan sudo yetkisi canlı kimlik denetiminde reddedildi.",
  sudoTargetUnverified: "Ajan sudo fiziksel çalışma alanı doğrulanamadı.",
  sudoTargetMismatch: "Ajan sudo host/çalışma alanı bağlantısı eşleşmedi.",
  sudoAuthorityChanged: "Ajan sudo yetkisi etki sınırından sonra reddedildi.",
  sudoTargetRecheckFailed:
    "Ajan sudo fiziksel çalışma alanı yeniden doğrulanamadı.",
  sudoTargetChanged:
    "Ajan sudo host/çalışma alanı bağlantısı etki sınırından sonra eşleşmedi.",
  founderDisabled:
    "Founder shell kapalı (açmak için ALLOW_FOUNDER_SHELL=true gerekir).",
  terminalPermissionDenied: "Hata: bu ajanın sanal Terminal izni yok.",
  errorPrefix: "Hata: {message}",
  approvalRequired:
    "ENGELLENDİ: {toolName} için tek kullanımlık, kapsamı belirli kullanıcı onayı gerekli. request_approval aracını şu bilgilerle çağır: category={category}, toolName={toolName}, toolArgs={args}. Onay gelene kadar bu eylemi veya eşdeğerini deneme.",
  sudoRootOnly: "ENGELLENDİ: CEO Host Shell yalnızca kök CEO ajanı içindir.",
  sudoPermissionDenied: "ENGELLENDİ: kök CEO ajanın host shell izni yok.",
  sudoApprovalRequired:
    "ENGELLENDİ: vm_run_sudo_command her tam komut için ayrı, tek kullanımlık kullanıcı onayı gerektirir. request_approval aracını toolName=vm_run_sudo_command ve toolArgs içinde önerilen aynı command ile çağır; sunucu kritik onay metnini ve hedefi kendisi oluşturur. Onay gelene kadar dur.",
  terminalDispatch: "Terminal komutu gönderiliyor",
  sudoDispatch: "Onaylı Terminal komutu gönderiliyor",
  terminalExecuted: "{name} sanal bilgisayarında {command} çalıştırdı.",
  terminalFailed: "{name} Terminal komutunda hata aldı.",
  sudoExecuted:
    "{name} için onaylı CEO Host Shell komutu yürütüldü (exitCode={exitCode}).",
  sudoFailed: "{name} onaylı Terminal komutunda hata aldı.",
  terminalFailureFallback: "Terminal komutu başarısız",
  sudoFailureFallback: "Onaylı Terminal komutu başarısız",
  terminalError: "Terminal hatası: {message}",
  noOutput: "(çıktı yok)",
  interrupted: "(komut tamamlanmadan kesildi)",
  exitCode: "(çıkış kodu: {code})",
  note: " [not: {note}]",
  operatorComplete: "Operatör isteği tamamlandı",
  operatorReview: "Operatör isteğinin sonucu inceleme gerektiriyor",
  invalidToolJson: "Hata: araç argümanları geçersiz JSON içeriyor.",
  invalidToolObject: "Hata: araç argümanları bir JSON nesnesi olmalı.",
  exclusiveTools:
    "ENGELLENDİ: {toolName} bu tur için izin verilen araçlar arasında değil. İzin verilen araçlar: {tools}. Başka bir yoldan aynı eylemi deneme.",
  exclusiveSudoMismatch:
    "ENGELLENDİ: command, kullanıcının belirttiği tam komutla eşleşmiyor. Komutu değiştirme veya eşdeğerini çalıştırma.",
  emergencyBlocked:
    "ENGELLENDİ: acil durdurma etkinleştirildi veya yürütme sırasında değişti; Terminal işlemi durduruldu.",
  agentInactive: "ENGELLENDİ: ajan pasifleştirildi; araç çalıştırılmadı.",
  categoryRevoked:
    "ENGELLENDİ: onay kategorisi için ajan yetkisi geri alındı; eylem çalıştırılmadı.",
  taskLeaseMissing:
    "ENGELLENDİ: görev yürütme yetkisi eksik; araç çalıştırılmadı.",
  taskLeaseLost:
    "ENGELLENDİ: görev durduruldu veya görev, ajan ya da deneme üzerindeki yürütme yetkisi kaybedildi.",
  operationLeaseLost: "ENGELLENDİ: işlem çağrısını yürütme yetkisi kaybedildi.",
  taskBoundary: "Araç sınırı · {tool}",
  computerBoundary: "Bilgisayar adımı · {tool}",
  computerStarted: "{name} bilgisayar adımına başladı: {tool}.",
  stepStart: "başlangıç",
  replayComplete:
    "İşlem daha önce tamamlandı; dış etki yeniden çalıştırılmadı.{evidence}",
  safeEvidence: " Güvenli kanıt: {data}.",
  receiptUnknown:
    "İşlem sonucu belirsiz; otomatik tekrar engellendi. Receipt: {id}.",
  receiptFailed: "İşlem kalıcı olarak başarısız kapatıldı. Receipt: {id}.",
  receiptBusy:
    "Aynı mantıksal işlem başka bir worker tarafından yürütülüyor. Receipt: {id}.",
  effectFailure:
    "İşlem güvenli biçimde tamamlanamadı; ham hata veya çıktı kaydedilmedi.",
  approvedAction: "Onaylı eylem · {tool}",
  approvedScopeInvalid: "Hata: onaylı eylemin kapsam bütünlüğü doğrulanamadı.",
  approvedAgentMissing: "Hata: onaylı eylemin ajanı bulunamadı veya pasif.",
  computerSelected: "{name} sıradaki bilgisayar adımını seçti: {tool}.",
  computerDeferred:
    "ERTELENDİ: {tool}, aynı model grubundaki önceki bilgisayar adımının sonucu görülmeden güvenle çalıştırılamaz. Önceki araç sonucunu incele; gerekirse computer_observe ile güncel durumu gör ve sonraki turda bu eylemi yeniden öner.",
  approvedCompleted: "Onaylı {tool} eylemi tamamlandı (exitCode={exitCode}).",
  approvedFailed: "Onaylı {tool} eylemi başarısız oldu (exitCode={exitCode}).",
  approvedUnknown:
    "Onaylı eylemin sonucu doğrulanamadı; otomatik tekrar engellendi. Operatör incelemesi gerekiyor.",
  unknownFinalization: "Bilinmeyen sonuç kaydetme hatası",
  invocationExpired: "ENGELLENDİ: işlem çağrısının yürütme süresi doldu.",
  runtimeUnavailable:
    "ENGELLENDİ: çalıştırıcı bu işlem için yürütme yetkisini kaybetti.",
  agentAuthorityLost:
    "ENGELLENDİ: ajanın yürütme yetkisi sona erdi veya değişti.",
  taskAuthorityLost:
    "ENGELLENDİ: görevin yürütme yetkisi sona erdi veya değişti.",
  operationStateInvalid:
    "İşlemin durumu doğrulanamadı. Operatör incelemesi gerekiyor.",
  commandNotStarted: "(komut başlatılmadı)",
  scopeActivated:
    "Kapsam koruması etkin: bu sohbet turunda izin verilen araçlar: {tools}.",
  taskUnknownStopped:
    "İşlem sonucu belirsiz; görev ve sonraki araç çağrıları durduruldu. Otomatik tekrar engellendi.",
  taskDeferred:
    "İşlem başka bir worker tarafından yürütülüyor; görev güvenli biçimde yeniden denenmek üzere sıraya alındı.",
} as const;

export type TerminalMessageKey = keyof typeof terminalTr;
export type TerminalCopy = { [Key in TerminalMessageKey]: string };
export interface TerminalMessage {
  key: TerminalMessageKey;
  params?: Readonly<Record<string, string | number>>;
}
