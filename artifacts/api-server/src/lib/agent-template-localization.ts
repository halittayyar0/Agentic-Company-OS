import {
  AGENT_TEMPLATES,
  type AgentTemplateDefinition,
} from "./agent-templates";
import {
  AGENT_TEMPLATE_KEYS,
  type AgentTemplateKey,
  type HandoffCopy,
} from "./agent-template-copy";
import { isWorkspaceLocale, type WorkspaceLocale } from "./workspace-locale";
import en from "./agent-template-locales/en";
import de from "./agent-template-locales/de";
import ru from "./agent-template-locales/ru";
import zhCN from "./agent-template-locales/zh-CN";
import zhTW from "./agent-template-locales/zh-TW";
import ar from "./agent-template-locales/ar";

const catalogs = { en, de, ru, "zh-CN": zhCN, "zh-TW": zhTW, ar };
const specialistKeys = new Set<AgentTemplateKey>([
  "specialist",
  "ux_designer",
  "quality_engineer",
  "data_analyst",
  "automation_specialist",
]);
function validLocale(locale: WorkspaceLocale): void {
  if (!isWorkspaceLocale(locale))
    throw new Error("Unsupported authored instruction locale");
}

export function getLocalizedAgentTemplates(
  locale: WorkspaceLocale,
): AgentTemplateDefinition[] {
  validLocale(locale);
  if (locale === "tr") return structuredClone(AGENT_TEMPLATES);
  const catalog = catalogs[locale];
  return AGENT_TEMPLATES.map((source) => {
    if (!AGENT_TEMPLATE_KEYS.includes(source.key as AgentTemplateKey))
      throw new Error("Missing authored instruction identity");
    const key = source.key as AgentTemplateKey;
    const copy = catalog.templates[key];
    if (!copy) throw new Error("Missing authored instruction translation");
    return {
      ...structuredClone(source),
      name: copy.name,
      defaultRole: copy.defaultRole,
      description: copy.description,
      defaultSystemPrompt: `${copy.body}\n\n${specialistKeys.has(key) ? catalog.specialistRules : catalog.managerRules}`,
    };
  });
}
export function getLocalizedAgentTemplate(
  key: string,
  locale: WorkspaceLocale,
): AgentTemplateDefinition | undefined {
  return getLocalizedAgentTemplates(locale).find(
    (template) => template.key === key,
  );
}

const turkishHandoff: HandoffCopy = {
  installedByManager: "kurulumu yapan yönetici",
  outgoingReview:
    "Giden devir sözleşmesi: artefaktı, kabul kriterlerini, doğrulama kanıtını ve açık riskleri paketle; alıcı incelemesi geçmeden işi kabul edilmiş sayma.",
  outgoing:
    "Giden devir sözleşmesi: sonucu, kapsamı, bağımlılıkları, gerekli artefaktları, kanıtı ve beklenen sonraki eylemi eksiksiz aktar.",
  incomingReview:
    "Gelen kabul sözleşmesi: iddiayı teslim edenin özetine güvenerek onaylama; kanıtı ve kabul kriterlerini bağımsız inceleyip geçti veya somut düzeltme gerekiyor kararı ver.",
  incoming:
    "Gelen kabul sözleşmesi: devrin beklenen sonuç, kapsam, bağımlılık, kabul kriteri ve kanıt alanlarını doğrula; eksik devri sessizce sahiplenme, net açıkla geri gönder.",
  outgoingDirection: "Giden",
  incomingDirection: "Gelen",
  heading: "Hazır ekip çalışma sözleşmesi",
  team: "Ekip",
  role: "Rolün",
  reportsTo: "Raporladığın rol",
  mission: "Özel misyonun",
  capabilities: "Kabiliyet odağın",
  noHandoff: "Tanımlı özel devir yok.",
  flowRule:
    "Akış kuralı: Bir sonraki aşamayı yalnız önceki devir sözleşmesi karşılandığında başlat; başarısız incelemeyi düzeltme için önceki sahibine döndür.",
  teamRule:
    "Ekip kuralı: Bağımsız işleri paralel yürütebilirsin; bağımlı çıktıları tanımlı devir ve inceleme kapıları kapanmadan birleştirme.",
  finalRule:
    "Bu ekip sözleşmesini temel rol kurallarınla birlikte uygula. Devir, araç çağrısı veya taslak üretimini sonuç sayma; tamamlanmayı kabul kriteri ve kanıtla göster. İnsan onayı gerektiren dış iletişim, yayın, harcama, silme ve ayrıcalıklı sistem işlemlerini kendin sonuçlandırma.",
  modes: { ai: "ai", next: "next", review: "review" },
  orchestrations: { flow: "flow", team: "crew" },
};
export function getLocalizedHandoffCopy(locale: WorkspaceLocale): HandoffCopy {
  validLocale(locale);
  return structuredClone(
    locale === "tr" ? turkishHandoff : catalogs[locale].handoff,
  );
}
