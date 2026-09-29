import type { WorkspaceLocale } from "../workspace-locale";
import type { AdvancedGuideId } from "./advanced-guides";
import { guide, type GuideText } from "./advanced-guide-text";
import { advancedDe, advancedRu } from "./advanced-guide-locales-europe";
import {
  advancedZhCN,
  advancedZhTW,
  advancedAr,
} from "./advanced-guide-locales-global";

type Translation = Record<AdvancedGuideId, GuideText>;
const en: Translation = {
  "procurement-scorecard": guide(
    "Procurement scorecard; A sourced vendor shortlist with weighted scores, total cost assumptions, disqualifiers and a decision owner.; Required capabilities, budget and purchase horizon|Vendor quotes, source dates and evaluation weights; Separate mandatory requirements from preferences|Normalize currency, billing period, setup and support costs|Score only evidenced capabilities and mark missing answers|Compare sensitivity to weights and draft clarification questions; Weights total 100 and unknown evidence never earns a score|Recommendation includes cost exclusions and requires purchase approval",
  ),
  "research-watch-brief": guide(
    "Research watch brief; A dated change brief listing new evidence, changed claims and follow-up questions for the next manual review.; Watch topics, source URLs and previous snapshots|Review window and relevance criteria; Record publisher, publication date and retrieval date|Compare supplied previous and current source text|Group meaningful changes and link each to its source|Draft a concise brief and proposed next review date; Distinguish publication dates from retrieval dates|No recurring monitor is claimed to be scheduled",
  ),
  "feedback-synthesis": guide(
    "Customer feedback synthesis; An evidence-linked theme register with affected segments, frequency, severity and prioritized research questions.; Anonymized feedback with source IDs and dates|Segment definitions and decision to inform; Remove duplicate submissions without erasing distinct customers|Code themes and preserve contrary examples|Count distinct respondents per theme and segment|Rank issues using frequency and severity with quoted evidence; Counts reconcile to the deduplicated sample|Sample bias and unsupported generalizations are explicit",
  ),
  "source-change-review": guide(
    "Source change impact review; A before/after evidence table identifying changed facts, affected documents and required human decisions.; Previous and current text with source URLs and capture dates|Claims or documents that depend on the source; Verify snapshots describe the same page and scope|Compare content while separating navigation noise|Map added, removed and qualified claims to dependent material|Draft corrections with exact supporting excerpts; Every impact traces to a real text difference|Unavailable snapshots are marked unverified, never reconstructed",
  ),
  "debugging-case": guide(
    "Reproducible debugging case; A diagnostic packet containing reproduction steps, evidence, competing causes and a minimal fix validation plan.; Expected versus observed behavior and sanitized logs|Relevant files, environment versions and failure timing; Build the smallest reproduction from provided evidence|Trace inputs through the failing code path|Rank hypotheses and define one discriminating check each|Propose the smallest correction and regression scenario; Separate observed failures from untested hypotheses|Do not claim reproduction or a passing test without execution evidence",
  ),
  "performance-investigation": guide(
    "Performance investigation; A bottleneck report with baseline measurements, likely causes, a prioritized experiment and rollback thresholds.; Timings or profiles with workload and environment|Latency target, traffic mix and resource limits; Separate cold starts, steady state and outliers|Compare percentiles and throughput for matching workloads|Trace the largest measured cost to a component|Design one change with measurement and rollback criteria; Never compare averages to percentile targets|Report sample sizes and label unmeasured speedups as estimates",
  ),
  "security-threat-review": guide(
    "Security threat review; A scoped threat register mapping trust boundaries to evidence, impact, mitigations and verification steps.; Architecture, relevant source and data sensitivity|Actors, exposed interfaces and existing controls; Map data entry points and trust boundaries|Trace authorization, input handling and secret storage|Write concrete abuse scenarios supported by code or design|Prioritize mitigations and safe validation steps; Distinguish confirmed defects from plausible threats|No exploit execution, secret disclosure or compliance certification",
  ),
  "migration-rehearsal": guide(
    "Migration rehearsal plan; A migration checklist with dependency order, mapping rules, reconciliation queries and rollback decision points.; Source and target schemas, sanitized samples and constraints|Maintenance window, owners and rollback requirements; Compare types, nullability, keys and unsupported values|Define deterministic field mappings and exception handling|Plan a dry run with counts, totals and representative records|Specify cutover gates and rollback triggers with owners; Row counts alone cannot establish data correctness|Execution and destructive changes require separate authorization",
  ),
  "sales-pipeline-audit": guide(
    "Sales pipeline audit; A pipeline exception report with stage totals, stale deals, missing evidence and owner follow-ups.; Deal export with stage, amount, owner and last activity|Stage definitions, currency and reporting date; Profile missing IDs, amounts and invalid stage names|Deduplicate deals and group by stage and owner|Calculate age and flag stalled or unsupported close dates|Draft prioritized follow-ups with evidence per deal; Exclude incompatible currencies from combined totals|Weighted pipeline is a scenario, not booked revenue",
  ),
  "cohort-retention-review": guide(
    "Cohort retention review; A cohort table showing eligible users, retained users, rates and observation limits with a decision brief.; Anonymized user signup and qualifying activity events|Cohort interval, timezone and retention definition; Deduplicate users and invalid event timestamps|Assign each user to a signup cohort|Count qualifying returning users per elapsed interval|Compare only mature intervals and explain segment differences; Retained users cannot exceed eligible users|Incomplete intervals are unavailable rather than zero retention",
  ),
  "funnel-dropoff-review": guide(
    "Funnel drop-off review; A stepwise conversion table with denominator definitions, biggest losses and testable improvement hypotheses.; Anonymized event export and ordered funnel steps|Conversion window, timezone and identity rules; Validate event names and deduplicate repeated events|Build ordered user paths within the conversion window|Compute step and overall conversion from explicit denominators|Locate major losses and propose one test per issue; Users cannot appear in later steps without required earlier steps|Correlation is not presented as the cause of abandonment",
  ),
  "inventory-reorder-plan": guide(
    "Inventory reorder planning; A SKU-level reorder worksheet with stock cover, lead-time demand, shortage flags and review quantities.; Stock, open purchase orders and demand history by SKU|Lead times, safety stock, pack sizes and budget; Reconcile SKU keys and separate available from reserved stock|Estimate daily demand and flag seasonal or sparse history|Calculate reorder need as max(0, lead-time demand plus safety stock minus usable supply)|Round proposed quantities to pack size and show cash needs; Document units and avoid double-counting incoming stock|Recommendations are drafts and do not place orders",
  ),
  "client-proposal": guide(
    "Client proposal draft; A reviewable proposal containing outcomes, scope, milestones, assumptions, pricing basis and acceptance criteria.; Client problem, audience and agreed requirements|Capacity, commercial constraints and approved evidence; Translate needs into measurable outcomes|Define deliverables, exclusions and client dependencies|Build milestones with review gates and a pricing basis|Draft a concise proposal and unresolved decision list; No invented credentials, testimonials or price commitments|Submission and commercial acceptance remain with the user",
  ),
  "help-center-article": guide(
    "Help center article; A task-focused support article with prerequisites, numbered instructions, expected results and recovery paths.; Product behavior and verified UI labels or screenshots|Reader role, permissions and common failure cases; Define one user task and its successful result|List required access and preconditions|Write actions in interface order with expected feedback|Add symptom-based recovery and an escalation packet; Every instruction matches supplied product evidence|Unverified UI behavior is flagged for product review",
  ),
  "onboarding-sequence": guide(
    "Onboarding sequence draft; A staged onboarding pack linking each message to a user milestone, action, trigger and success measure.; Audience, activation milestone and product capabilities|Available channels, timing rules and approved tone; Identify the shortest path to first useful outcome|Map messages to milestones and eligibility conditions|Draft each message with one clear action and help path|Add stop conditions and a measurement plan; Avoid sending redundant messages after milestone completion|No campaign is scheduled or sent by creating this draft",
  ),
  "editorial-calendar": guide(
    "Editorial calendar; A dated content plan with audience needs, source requirements, owners, review gates and reusable briefs.; Content goals, audience questions and publishing channels|Planning dates, team capacity and approval requirements; Group topics around distinct reader needs|Match formats and channels to each topic|Allocate production and review dates within capacity|Draft briefs with evidence requirements and success measures; Dates use an explicit timezone and include review time|Publication remains pending editorial approval",
  ),
  "recurring-operations-review": guide(
    "Recurring operations review; A recurring work register with owners, due rules, evidence of completion and escalation thresholds.; Task list, cadence, owners and recent completion records|Reporting date, timezone and escalation policy; Normalize cadence and define what completion evidence means|Compare due work with recorded completions|Identify overdue tasks, missing ownership and blocked dependencies|Draft an exception brief and proposed next review window; Missing evidence is not assumed to mean completed work|No scheduler or recurring job is created by this guide",
  ),
  "launch-coordination-plan": guide(
    "Launch coordination plan; A launch checklist with dependencies, accountable owners, go/no-go gates and a rollback communication draft.; Launch scope, target date and readiness evidence|Owners, approval gates and rollback constraints; Work backward from the launch date through dependencies|Assign a single accountable owner to each gate|Define measurable readiness and stop conditions|Draft the launch timeline and contingency communication; Missing critical evidence blocks the go recommendation|Deployment and external announcements require explicit approval",
  ),
  "vendor-handoff-packet": guide(
    "Vendor handoff packet; A handoff manifest with required files, version fingerprints, access needs and acceptance responsibilities.; Agreed scope, deliverable files and contract requirements|Recipient role, permitted data and acceptance deadline; Match each contractual output to a supplied artifact|Record filenames, versions and supplied-content hashes|List access prerequisites and redact unnecessary sensitive data|Draft delivery instructions and an acceptance checklist; Missing artifacts and unresolved access are clearly listed|No files are uploaded or shared without user authorization",
  ),
  "standard-operating-procedure": guide(
    "Standard operating procedure; An executable SOP draft with trigger, prerequisites, numbered actions, exceptions and completion evidence.; Current process, participants and examples of failures|Authority limits, required records and escalation contacts; Define start and end conditions with a process owner|Turn observed work into ordered steps with expected results|Add decision branches, exception recovery and stop points|Walk through a sample case and record gaps for review; Each decision has an owner or an explicit escalation route|Do not invent policy, authority or successful walkthrough evidence",
  ),
};

const tr: Translation = {
  "procurement-scorecard": guide(
    "Tedarikçi seçim tablosu; Kaynakları, ağırlıklı puanları, toplam maliyet varsayımlarını ve eleme nedenlerini içeren karar tablosu.; Zorunlu özellikler, bütçe ve satın alma dönemi|Tedarikçi teklifleri, kaynak tarihleri ve ölçüt ağırlıkları; Zorunlu koşulları tercihlerden ayır|Para birimi, dönem, kurulum ve destek maliyetlerini eşitle|Yalnızca kanıtlanan özellikleri puanla, eksikleri işaretle|Ağırlık değişimine duyarlılığı incele ve soruları hazırla; Ağırlıklar toplamı 100 olmalı, bilinmeyen bilgi puan almamalı|Hariç tutulan maliyetleri belirt ve satın alma onayını kullanıcıya bırak",
  ),
  "research-watch-brief": guide(
    "Araştırma değişim özeti; Yeni kanıtları, değişen iddiaları ve sonraki inceleme sorularını kaynaklarıyla gösteren tarihli özet.; İzlenecek konular, kaynak bağlantıları ve önceki kopyalar|İnceleme dönemi ve önem ölçütleri; Yayıncıyı, yayın tarihini ve erişim tarihini kaydet|Önceki ve güncel kaynak metinlerini karşılaştır|Anlamlı değişimleri grupla ve kaynaklarına bağla|Kısa özeti ve önerilen sonraki inceleme tarihini yaz; Yayın tarihi ile erişim tarihini karıştırma|Otomatik izleme kurulmuş gibi sunma",
  ),
  "feedback-synthesis": guide(
    "Müşteri geri bildirimi analizi; Segmentleri, sıklığı, ciddiyeti ve kanıt alıntılarını içeren öncelikli tema listesi.; Kaynak kimliği ve tarih içeren anonim geri bildirimler|Segment tanımları ve desteklenecek karar; Tekrarlanan gönderileri ayıkla, farklı müşterileri koru|Temaları etiketle ve karşıt örnekleri sakla|Tema ve segment başına benzersiz katılımcıları say|Sıklık ve ciddiyete göre sorunları kanıtlarıyla sırala; Sayımlar tekilleştirilmiş örneklemle tutarlı olmalı|Örneklem yanlılığını ve dayanaksız genellemeleri belirt",
  ),
  "source-change-review": guide(
    "Kaynak değişikliği etki incelemesi; Değişen bilgileri, etkilenen belgeleri ve gereken kararları önceki ve sonraki kanıtlarla gösteren tablo.; Bağlantı ve kayıt tarihiyle önceki ve güncel metin|Bu kaynağa dayanan iddialar veya belgeler; Kopyaların aynı sayfa ve kapsamı anlattığını doğrula|İçeriği karşılaştır, gezinme öğelerindeki değişimleri ayır|Eklenen, kaldırılan ve sınırlandırılan iddiaları belgelere eşle|Dayanak alıntılarıyla düzeltme taslaklarını yaz; Her etki gerçek bir metin farkına dayanmalı|Eksik kopyaları yeniden uydurma, doğrulanamadı olarak işaretle",
  ),
  "debugging-case": guide(
    "Tekrarlanabilir hata incelemesi; Tekrar adımlarını, kanıtları, olası nedenleri ve en küçük düzeltmenin doğrulama planını içeren dosya.; Beklenen ve gözlenen davranış, temizlenmiş günlükler|İlgili dosyalar, ortam sürümleri ve hata zamanı; Kanıtlardan en küçük tekrar senaryosunu çıkar|Girdilerin hata veren kod yolundaki ilerleyişini izle|Olası nedenleri sırala ve her biri için ayırt edici kontrol belirle|En küçük düzeltmeyi ve gerileme senaryosunu öner; Gözlenen hataları sınanmamış varsayımlardan ayır|Çalıştırma kanıtı olmadan tekrar edildi veya test geçti deme",
  ),
  "performance-investigation": guide(
    "Performans darboğazı incelemesi; Başlangıç ölçümlerini, olası darboğazları, öncelikli deneyi ve geri dönüş eşiklerini içeren rapor.; İş yükü ve ortam bilgili süre ölçümleri veya profiller|Gecikme hedefi, trafik dağılımı ve kaynak sınırları; Soğuk başlangıçları, kararlı durumu ve uç değerleri ayır|Eşdeğer iş yüklerinde yüzdelikleri ve işlem hacmini karşılaştır|Ölçülen en büyük maliyeti bileşenine kadar izle|Bir değişiklik için ölçüm ve geri dönüş ölçütlerini yaz; Ortalamaları yüzdelik hedeflerle karşılaştırma|Örneklem sayısını ver ve ölçülmemiş hızlanmayı tahmin diye belirt",
  ),
  "security-threat-review": guide(
    "Güvenlik tehdit incelemesi; Güven sınırlarını kanıt, etki, önlem ve doğrulama adımlarıyla eşleştiren kapsamlı tehdit kaydı.; Mimari, ilgili kaynak kod ve veri hassasiyeti|Aktörler, açık arayüzler ve mevcut kontroller; Veri girişlerini ve güven sınırlarını çiz|Yetkilendirmeyi, girdi işlemeyi ve sır saklamayı incele|Kod veya tasarıma dayanan somut kötüye kullanım senaryoları yaz|Önlemleri ve güvenli doğrulama adımlarını önceliklendir; Doğrulanmış kusurlarla olası tehditleri ayır|Sömürü çalıştırma, sır ifşası veya uyumluluk belgesi üretme",
  ),
  "migration-rehearsal": guide(
    "Veri taşıma provası planı; Bağımlılık sırası, alan eşlemeleri, mutabakat kontrolleri ve geri dönüş kararlarını içeren taşıma listesi.; Kaynak ve hedef şemalar, anonim örnekler ve kısıtlar|Bakım aralığı, sorumlular ve geri dönüş koşulları; Türleri, boş değerleri, anahtarları ve uyumsuz değerleri karşılaştır|Kesin alan eşlemelerini ve istisna işlemlerini tanımla|Kayıt sayısı, toplamlar ve örnek kayıtlarla prova planla|Geçiş kapılarını ve geri dönüş tetiklerini sorumlularıyla yaz; Yalnızca satır sayısı veri doğruluğunu kanıtlamaz|Çalıştırma ve yıkıcı değişiklikler ayrı onay gerektirir",
  ),
  "sales-pipeline-audit": guide(
    "Satış fırsatları denetimi; Aşama toplamlarını, bekleyen fırsatları, eksik kanıtları ve sorumlu takiplerini içeren istisna raporu.; Aşama, tutar, sorumlu ve son etkinlik içeren fırsat verisi|Aşama tanımları, para birimi ve rapor tarihi; Eksik kimlikleri, tutarları ve geçersiz aşamaları incele|Fırsatları tekilleştir ve aşama ile sorumluya göre grupla|Yaşı hesapla, durmuş işleri ve dayanıksız kapanış tarihlerini işaretle|Fırsat başına kanıtla öncelikli takip taslağı yaz; Uyumsuz para birimlerini aynı toplamda birleştirme|Ağırlıklı fırsat toplamı senaryodur, gerçekleşmiş gelir değildir",
  ),
  "cohort-retention-review": guide(
    "Kohort elde tutma analizi; Uygun kullanıcıları, geri dönenleri, oranları ve gözlem sınırlarını gösteren kohort tablosu ve karar özeti.; Anonim kayıt ve geçerli etkinlik olayları|Kohort aralığı, saat dilimi ve elde tutma tanımı; Kullanıcıları tekilleştir ve geçersiz tarihleri ayıkla|Her kullanıcıyı kayıt kohortuna ata|Geçen dönem başına geri dönen benzersiz kullanıcıları say|Yalnızca tamamlanmış dönemleri karşılaştır ve segment farklarını açıkla; Geri dönen sayısı uygun kullanıcı sayısını aşamaz|Tamamlanmamış dönemleri sıfır yerine veri yok olarak göster",
  ),
  "funnel-dropoff-review": guide(
    "Dönüşüm hunisi kayıp analizi; Paydaları, en büyük kayıpları ve sınanabilir iyileştirme varsayımlarını gösteren aşamalı dönüşüm tablosu.; Anonim olay verisi ve sıralı huni adımları|Dönüşüm süresi, saat dilimi ve kimlik kuralları; Olay adlarını doğrula ve tekrarları ayıkla|Dönüşüm süresi içinde sıralı kullanıcı yollarını oluştur|Açık paydalarla aşama ve toplam dönüşümü hesapla|Büyük kayıpları bul ve her sorun için bir deney öner; Zorunlu önceki adımı olmayan kullanıcıyı sonraki adıma katma|İlişkiyi terk etmenin kanıtlanmış nedeni olarak sunma",
  ),
  "inventory-reorder-plan": guide(
    "Stok yenileme planı; Stok kodu başına karşılama süresi, tedarik talebi, eksik riski ve önerilen miktarı gösteren çalışma tablosu.; Stok, açık siparişler ve stok koduna göre talep geçmişi|Tedarik süresi, güvenlik stoğu, paket miktarı ve bütçe; Stok kodlarını eşleştir ve ayrılmış stoğu ayır|Günlük talebi tahmin et, mevsimselliği ve az veriyi işaretle|Tedarik talebi ve güvenlik stoğundan kullanılabilir arzı çıkar, sonucu en az sıfır al|Miktarları paket boyuna yuvarla ve nakit gereksinimini göster; Birimleri belirt ve yoldaki stoğu iki kez sayma|Öneriler taslaktır, sipariş verilmez",
  ),
  "client-proposal": guide(
    "Müşteri teklif taslağı; Sonuçları, kapsamı, kilometre taşlarını, varsayımları, fiyat dayanağını ve kabul ölçütlerini içeren teklif.; Müşteri sorunu, hedef kitle ve kararlaştırılmış gereksinimler|Kapasite, ticari kısıtlar ve onaylı kanıtlar; İhtiyaçları ölçülebilir sonuçlara dönüştür|Teslimleri, kapsam dışını ve müşteri bağımlılıklarını tanımla|İnceleme kapıları ve fiyat dayanağıyla aşamaları kur|Kısa teklifi ve açık karar listesini yaz; Yetkinlik, referans veya fiyat taahhüdü uydurma|Gönderim ve ticari kabul kullanıcıya aittir",
  ),
  "help-center-article": guide(
    "Yardım merkezi makalesi; Ön koşulları, numaralı adımları, beklenen sonuçları ve hata çözüm yollarını içeren görev odaklı makale.; Ürün davranışı ve doğrulanmış arayüz etiketleri veya görüntüler|Okuyucu rolü, izinler ve yaygın hata durumları; Tek bir kullanıcı görevini ve başarı sonucunu tanımla|Gerekli erişimi ve ön koşulları listele|Arayüz sırasına göre eylemleri ve beklenen geri bildirimi yaz|Belirtiye göre çözüm ve destek için bilgi paketini ekle; Her yönerge sağlanan ürün kanıtıyla eşleşmeli|Doğrulanmamış arayüz davranışını ürün incelemesine bırak",
  ),
  "onboarding-sequence": guide(
    "Kullanıcı başlangıç akışı; Her mesajı bir kullanıcı aşamasına, eyleme, tetikleyiciye ve başarı ölçüsüne bağlayan başlangıç paketi.; Hedef kitle, ilk başarı aşaması ve ürün yetenekleri|Kanallar, zamanlama kuralları ve onaylı üslup; İlk faydalı sonuca giden en kısa yolu belirle|Mesajları aşama ve uygunluk koşullarına eşle|Her mesajı tek açık eylem ve yardım yoluyla yaz|Durdurma koşullarını ve ölçüm planını ekle; Tamamlanan aşamalar için gereksiz mesajı engelle|Bu taslak kampanya kurmaz veya mesaj göndermez",
  ),
  "editorial-calendar": guide(
    "İçerik yayın takvimi; Okuyucu ihtiyaçları, kaynak gereksinimleri, sorumlular ve inceleme kapılarıyla tarihli içerik planı.; İçerik hedefleri, okuyucu soruları ve yayın kanalları|Plan dönemi, ekip kapasitesi ve onay gereksinimleri; Konuları farklı okuyucu ihtiyaçlarına göre grupla|Her konuya uygun biçim ve kanal seç|Üretim ve inceleme tarihlerini kapasiteye göre dağıt|Kanıt ihtiyacı ve başarı ölçüleri içeren içerik özetleri yaz; Saat dilimini belirt ve inceleme süresi ayır|Yayın editoryal onay bekler",
  ),
  "recurring-operations-review": guide(
    "Düzenli işlerin kontrolü; Sorumluları, vade kurallarını, tamamlanma kanıtını ve yükseltme eşiklerini içeren düzenli iş kaydı.; İş listesi, sıklık, sorumlular ve son tamamlanma kayıtları|Rapor tarihi, saat dilimi ve yükseltme politikası; Sıklıkları eşitle ve tamamlanma kanıtını tanımla|Vadesi gelen işleri tamamlanma kayıtlarıyla karşılaştır|Geciken işleri, eksik sorumluları ve engelleri belirle|İstisna özetini ve sonraki inceleme aralığını taslakla; Kanıtı olmayan işi tamamlanmış varsayma|Bu rehber zamanlayıcı veya düzenli görev kurmaz",
  ),
  "launch-coordination-plan": guide(
    "Lansman koordinasyon planı; Bağımlılıklar, sorumlular, devam veya dur kararları ve geri dönüş iletişimini içeren lansman listesi.; Lansman kapsamı, hedef tarih ve hazırlık kanıtları|Sorumlular, onay kapıları ve geri dönüş kısıtları; Lansman tarihinden bağımlılıklara doğru geriye planla|Her karar kapısına tek hesap veren sorumlu ata|Ölçülebilir hazırlık ve durma koşullarını tanımla|Lansman akışını ve olağan dışı durum iletişimini yaz; Kritik kanıt eksikliği devam önerisini engeller|Yayına alma ve dış duyurular açık onay gerektirir",
  ),
  "vendor-handoff-packet": guide(
    "Tedarikçi teslim paketi; Gerekli dosyaları, sürüm parmak izlerini, erişim koşullarını ve kabul sorumluluklarını içeren teslim manifestosu.; Kararlaştırılmış kapsam, dosyalar ve sözleşme gereksinimleri|Alıcı rolü, izinli veri ve kabul son tarihi; Her sözleşme çıktısını sağlanan dosyayla eşle|Dosya adlarını, sürümleri ve sağlanan içerik özetlerini kaydet|Erişim ön koşullarını yaz, gereksiz hassas bilgiyi çıkar|Teslim yönergelerini ve kabul listesini taslakla; Eksik dosyaları ve çözülmemiş erişimi açıkça belirt|Kullanıcı izni olmadan dosya yükleme veya paylaşma",
  ),
  "standard-operating-procedure": guide(
    "Standart işleyiş prosedürü; Tetikleyici, ön koşullar, sıralı eylemler, istisnalar ve tamamlanma kanıtıyla uygulanabilir prosedür taslağı.; Mevcut süreç, katılımcılar ve hata örnekleri|Yetki sınırları, gerekli kayıtlar ve yükseltme kişileri; Süreç sorumlusuyla başlangıç ve bitiş koşullarını belirle|Gözlenen işi beklenen sonuçlarla sıralı adımlara çevir|Karar dallarını, hata giderimini ve durma noktalarını ekle|Bir örneği adım adım değerlendir ve açıkları kaydet; Her kararın sorumlusu veya açık yükseltme yolu olmalı|Politika, yetki veya başarılı prova kanıtı uydurma",
  ),
};

export const advancedGuideLocales: Record<WorkspaceLocale, Translation> = {
  en,
  tr,
  de: advancedDe,
  ru: advancedRu,
  "zh-CN": advancedZhCN,
  "zh-TW": advancedZhTW,
  ar: advancedAr,
};
