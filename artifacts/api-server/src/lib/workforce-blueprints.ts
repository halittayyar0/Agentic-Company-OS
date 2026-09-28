import type { AgentPermissions } from "@workspace/db";
import {
  AGENT_TEMPLATES,
  type AgentTemplateDefinition,
} from "./agent-templates";
import {
  getLocalizedAgentTemplate,
  getLocalizedHandoffCopy,
} from "./agent-template-localization";
import type { WorkspaceLocale } from "./workspace-locale";

export type WorkforceOrchestration = "crew" | "flow";
export type WorkforceMemberLevel = "lead" | "specialist";
export type WorkforceHandoffMode = "ai" | "next" | "review";

export interface WorkforceBlueprintMember {
  key: string;
  name: string;
  role: string;
  department: string;
  templateKey: string;
  mission: string;
  level: WorkforceMemberLevel;
  reportsToKey: string | null;
  capabilities: string[];
}

export interface WorkforceBlueprintHandoff {
  fromKey: string;
  toKey: string;
  mode: WorkforceHandoffMode;
  instruction: string;
}

export interface WorkforceBlueprint {
  key: string;
  version: number;
  name: string;
  tagline: string;
  description: string;
  orchestration: WorkforceOrchestration;
  recommendedFor: string[];
  triggerLabels: string[];
  members: WorkforceBlueprintMember[];
  handoffs: WorkforceBlueprintHandoff[];
}

/**
 * Authored, versioned operating teams. These are deliberately data rather than
 * seed rows: listing the catalogue has no side effects and an install is one
 * auditable transaction.
 */
export const WORKFORCE_BLUEPRINTS = [
  {
    key: "product-shipping-crew",
    version: 1,
    name: "Ürün Teslim Ekibi",
    tagline: "Problemi doğrula, ürünü çıkar, sonucu kanıtla.",
    description:
      "Keşiften teknik teslimata kadar ürün kararlarını tek sorumlu lider altında araştırma, uygulama ve kalite kanıtıyla ilerleten çapraz fonksiyonlu ekip.",
    orchestration: "crew",
    recommendedFor: [
      "Yeni özellik veya ürün hattı",
      "Belirsiz müşteri problemi",
      "Araştırma, geliştirme ve QA gerektiren teslimat",
    ],
    triggerLabels: ["ürün", "özellik", "MVP", "lansman", "teslimat"],
    members: [
      {
        key: "product-lead",
        name: "Ürün Orkestratörü",
        role: "Product Delivery Lead",
        department: "product",
        templateKey: "product_director",
        mission:
          "İş sonucunu ve kullanıcı problemini ölçülebilir kabul kriterlerine çevir; keşif, mühendislik ve kalite akışını tek teslim planında yönet.",
        level: "lead",
        reportsToKey: null,
        capabilities: [
          "Problem çerçeveleme",
          "Teslim planı",
          "Bağımlılık yönetimi",
          "Sonuç incelemesi",
        ],
      },
      {
        key: "discovery-researcher",
        name: "Keşif Araştırmacısı",
        role: "Product Discovery Researcher",
        department: "research",
        templateKey: "specialist",
        mission:
          "Hedef kullanıcının işini, mevcut alternatifleri ve kritik varsayımları güncel kaynak ve izlenebilir kanıtla doğrula.",
        level: "specialist",
        reportsToKey: "product-lead",
        capabilities: [
          "Kullanıcı araştırması",
          "Rakip taraması",
          "Kanıt matrisi",
        ],
      },
      {
        key: "delivery-engineer",
        name: "Teslim Mühendisi",
        role: "Product Delivery Engineer",
        department: "engineering",
        templateKey: "specialist",
        mission:
          "Onaylı kapsamı mevcut mimariyle uyumlu, güvenli ve test edilebilir en küçük üretim değişikliğine dönüştür.",
        level: "specialist",
        reportsToKey: "product-lead",
        capabilities: [
          "Teknik tasarım",
          "Uygulama",
          "Test otomasyonu",
          "Yayın hazırlığı",
        ],
      },
      {
        key: "quality-reviewer",
        name: "Kalite Hakemi",
        role: "Product Quality Reviewer",
        department: "quality",
        templateKey: "specialist",
        mission:
          "Teslimatı gereksinim, erişilebilirlik, hata davranışı ve kanıt yeterliliği bakımından bağımsız olarak incele; açıkları somut düzeltme isteğine çevir.",
        level: "specialist",
        reportsToKey: "product-lead",
        capabilities: ["Kabul testi", "Uç durum incelemesi", "Kanıt denetimi"],
      },
    ],
    handoffs: [
      {
        fromKey: "discovery-researcher",
        toKey: "product-lead",
        mode: "review",
        instruction:
          "Problem kanıtını, belirsizlikleri ve önerilen kapsamı liderin kararına sun.",
      },
      {
        fromKey: "product-lead",
        toKey: "delivery-engineer",
        mode: "ai",
        instruction:
          "Onaylanan kapsamı, kabul kriterlerini ve kanıt beklentisini uygulama brief'i olarak aktar.",
      },
      {
        fromKey: "delivery-engineer",
        toKey: "quality-reviewer",
        mode: "next",
        instruction:
          "Uygulama artefaktını ve çalıştırılan kontrolleri bağımsız kalite kapısına devret.",
      },
      {
        fromKey: "quality-reviewer",
        toKey: "product-lead",
        mode: "review",
        instruction:
          "Geçen kontrolleri, açıkları ve yayın tavsiyesini karar için raporla.",
      },
    ],
  },
  {
    key: "go-to-market-crew",
    version: 1,
    name: "Pazara Çıkış Ekibi",
    tagline: "Doğru hesaba, kanıtlı mesajla, ölçülebilir talep.",
    description:
      "ICP araştırmasını konumlandırma, içerik ve satış aktivasyonuna bağlayan; taslağı gerçek temas veya gelir gibi saymayan sonuç odaklı büyüme ekibi.",
    orchestration: "crew",
    recommendedFor: [
      "Yeni ürün veya pazar lansmanı",
      "B2B talep üretimi",
      "Mesaj ve kanal doğrulama",
    ],
    triggerLabels: ["büyüme", "satış", "kampanya", "GTM", "pipeline"],
    members: [
      {
        key: "gtm-lead",
        name: "GTM Orkestratörü",
        role: "Go-to-Market Lead",
        department: "marketing",
        templateKey: "marketing_director",
        mission:
          "ICP, teklif, kanal ve satış hareketini tek ölçüm planında birleştir; ekip çıktılarının nitelikli talep sonucuna bağlanmasını sağla.",
        level: "lead",
        reportsToKey: null,
        capabilities: [
          "GTM stratejisi",
          "Mesaj hiyerarşisi",
          "Kanal portföyü",
          "Deney yönetimi",
        ],
      },
      {
        key: "market-analyst",
        name: "Pazar Analisti",
        role: "Market Intelligence Analyst",
        department: "research",
        templateKey: "specialist",
        mission:
          "ICP hesaplarını, satın alma tetikleyicilerini, alternatifleri ve farklılaştırıcı kanıtı birincil kaynaklarla haritala.",
        level: "specialist",
        reportsToKey: "gtm-lead",
        capabilities: ["ICP araştırması", "Hesap sinyalleri", "Rakip kanıtı"],
      },
      {
        key: "campaign-builder",
        name: "Kampanya Mimarı",
        role: "Campaign and Content Builder",
        department: "content",
        templateKey: "specialist",
        mission:
          "Doğrulanmış mesajı kanala uygun, kaynaklı ve ölçülebilir kampanya artefaktlarına dönüştür; iddia ve kanıt bağını koru.",
        level: "specialist",
        reportsToKey: "gtm-lead",
        capabilities: ["Kampanya brief'i", "İçerik üretimi", "Kanal uyarlama"],
      },
      {
        key: "revenue-operator",
        name: "Gelir Operatörü",
        role: "Revenue Activation Specialist",
        department: "sales",
        templateKey: "specialist",
        mission:
          "Öncelikli hesapları nitelendir, kişiselleştirilmiş erişim taslaklarını hazırla ve her ilerlemeyi kanıtlı satış aşamasıyla kaydet.",
        level: "specialist",
        reportsToKey: "gtm-lead",
        capabilities: [
          "Hesap önceliği",
          "Erişim taslağı",
          "Fırsat nitelendirme",
          "Pipeline kanıtı",
        ],
      },
    ],
    handoffs: [
      {
        fromKey: "market-analyst",
        toKey: "gtm-lead",
        mode: "review",
        instruction:
          "ICP ve farklılaştırma kanıtını mesaj kararı için liderin incelemesine sun.",
      },
      {
        fromKey: "gtm-lead",
        toKey: "campaign-builder",
        mode: "ai",
        instruction:
          "Onaylı segment, teklif, iddia sınırları ve kanal ölçümünü üretim brief'i olarak aktar.",
      },
      {
        fromKey: "campaign-builder",
        toKey: "revenue-operator",
        mode: "next",
        instruction:
          "Onaylı mesaj ve kanıt paketini hesap bazlı aktivasyona devret; gönderim gerektiren eylemleri kullanıcı kontrolünde tut.",
      },
      {
        fromKey: "revenue-operator",
        toKey: "gtm-lead",
        mode: "review",
        instruction:
          "Gerçekleşen temas ve pipeline kanıtını taslak/aktivite metriklerinden ayrı raporla.",
      },
    ],
  },
  {
    key: "incident-command-flow",
    version: 1,
    name: "Olay Komuta Akışı",
    tagline: "Etkisini sınırla, nedeni kanıtla, güvenle toparla.",
    description:
      "Operasyonel veya teknik olayı sırayla triyaj, araştırma, iyileştirme doğrulaması ve paydaş iletişiminden geçiren kontrollü müdahale akışı.",
    orchestration: "flow",
    recommendedFor: [
      "Üretim olayı veya hizmet kesintisi",
      "Güvenlik şüphesi",
      "Tekrarlayan operasyon hatası",
    ],
    triggerLabels: ["olay", "kesinti", "hata", "güvenlik", "SLA"],
    members: [
      {
        key: "incident-lead",
        name: "Olay Komutanı",
        role: "Incident Commander",
        department: "operations",
        templateKey: "operations_director",
        mission:
          "Etkiden geri kazanıma kadar tek olay kaydını yönet; önceliği müşteri etkisi, güvenlik ve geri döndürülebilirlik üzerinden belirle.",
        level: "lead",
        reportsToKey: null,
        capabilities: [
          "Triyaj",
          "Olay zaman çizelgesi",
          "Karar ve sahiplik",
          "Geri kazanım kapısı",
        ],
      },
      {
        key: "systems-investigator",
        name: "Sistem Araştırmacısı",
        role: "Systems Investigator",
        department: "engineering",
        templateKey: "specialist",
        mission:
          "Belirtiyi yeniden üretilebilir kanıta dönüştür; log, değişiklik ve bağımlılık izinden en güçlü kök neden hipotezlerini sınayarak daralt.",
        level: "specialist",
        reportsToKey: "incident-lead",
        capabilities: ["Teknik triyaj", "Log analizi", "Kök neden hipotezi"],
      },
      {
        key: "risk-reviewer",
        name: "Risk Hakemi",
        role: "Safety and Recovery Reviewer",
        department: "risk",
        templateKey: "specialist",
        mission:
          "Önerilen düzeltmeyi güvenlik, veri bütünlüğü, geri alma ve tekrar riski bakımından bağımsız olarak doğrula.",
        level: "specialist",
        reportsToKey: "incident-lead",
        capabilities: [
          "Risk değerlendirmesi",
          "Rollback kontrolü",
          "Kurtarma doğrulaması",
        ],
      },
      {
        key: "stakeholder-reporter",
        name: "Paydaş Raportörü",
        role: "Incident Communications Specialist",
        department: "customer_support",
        templateKey: "specialist",
        mission:
          "Doğrulanmış olay gerçeğini etki, mevcut durum, sonraki güncelleme ve gerekli kullanıcı eylemiyle açık iletişim taslağına dönüştür.",
        level: "specialist",
        reportsToKey: "incident-lead",
        capabilities: [
          "Durum özeti",
          "Müşteri iletişimi taslağı",
          "Postmortem anlatısı",
        ],
      },
    ],
    handoffs: [
      {
        fromKey: "incident-lead",
        toKey: "systems-investigator",
        mode: "next",
        instruction:
          "Etkisi sınırlandırılmış olay bağlamını, zaman çizgisini ve güvenli araştırma sınırlarını aktar.",
      },
      {
        fromKey: "systems-investigator",
        toKey: "risk-reviewer",
        mode: "review",
        instruction:
          "Kök neden kanıtını, önerilen düzeltmeyi ve geri alma planını bağımsız incelemeye sun.",
      },
      {
        fromKey: "risk-reviewer",
        toKey: "incident-lead",
        mode: "review",
        instruction:
          "Kurtarma önerisini geçen kontroller, açık riskler ve geri alma koşullarıyla komutana döndür.",
      },
      {
        fromKey: "incident-lead",
        toKey: "stakeholder-reporter",
        mode: "ai",
        instruction:
          "Yalnızca doğrulanmış olay zaman çizelgesi ve onaylı durumla paydaş iletişim taslağı oluşturmasını iste.",
      },
    ],
  },
] satisfies WorkforceBlueprint[];

const templateByKey = new Map(
  AGENT_TEMPLATES.map((template) => [template.key, template]),
);

function assertValidBlueprint(blueprint: WorkforceBlueprint): void {
  const memberKeys = new Set<string>();
  let rootCount = 0;

  for (const member of blueprint.members) {
    if (memberKeys.has(member.key)) {
      throw new Error(
        `Workforce blueprint ${blueprint.key} has duplicate member ${member.key}`,
      );
    }
    memberKeys.add(member.key);
    if (member.reportsToKey === null) rootCount += 1;

    const template = templateByKey.get(member.templateKey);
    if (!template || template.key === "ceo") {
      throw new Error(
        `Workforce blueprint ${blueprint.key} has unsafe template ${member.templateKey}`,
      );
    }
    if (template.defaultPermissions.canUseSudo) {
      throw new Error(
        `Workforce blueprint ${blueprint.key} cannot grant sudo authority`,
      );
    }
  }

  if (rootCount !== 1) {
    throw new Error(
      `Workforce blueprint ${blueprint.key} must have exactly one root member`,
    );
  }
  for (const member of blueprint.members) {
    if (member.reportsToKey !== null && !memberKeys.has(member.reportsToKey)) {
      throw new Error(
        `Workforce blueprint ${blueprint.key} has unknown manager ${member.reportsToKey}`,
      );
    }
  }
  for (const handoff of blueprint.handoffs) {
    if (!memberKeys.has(handoff.fromKey) || !memberKeys.has(handoff.toKey)) {
      throw new Error(
        `Workforce blueprint ${blueprint.key} has an invalid handoff`,
      );
    }
  }
}

for (const blueprint of WORKFORCE_BLUEPRINTS) {
  assertValidBlueprint(blueprint);
}

export function getWorkforceBlueprint(
  key: string,
): WorkforceBlueprint | undefined {
  return WORKFORCE_BLUEPRINTS.find((blueprint) => blueprint.key === key);
}

export function getBlueprintMemberTemplate(
  member: WorkforceBlueprintMember,
): AgentTemplateDefinition {
  const template = templateByKey.get(member.templateKey);
  if (!template || template.key === "ceo") {
    throw new Error(`Unsafe or missing agent template ${member.templateKey}`);
  }
  return template;
}

/** Restrict a stock template to its reporting manager's actual authority. */
export function boundedBlueprintPermissions(
  templatePermissions: AgentPermissions,
  managerPermissions: AgentPermissions,
): AgentPermissions {
  return {
    canCreateSubAgents:
      templatePermissions.canCreateSubAgents &&
      managerPermissions.canCreateSubAgents,
    canDelegate:
      templatePermissions.canDelegate && managerPermissions.canDelegate,
    canSpend: templatePermissions.canSpend && managerPermissions.canSpend,
    canDelete: templatePermissions.canDelete && managerPermissions.canDelete,
    canPublish: templatePermissions.canPublish && managerPermissions.canPublish,
    canContactExternal:
      templatePermissions.canContactExternal &&
      managerPermissions.canContactExternal,
    canBrowse: templatePermissions.canBrowse && managerPermissions.canBrowse,
    canUseTerminal:
      templatePermissions.canUseTerminal && managerPermissions.canUseTerminal,
    // Blueprint installation is never a sudo-authority creation path, even
    // when the reporting manager is the server-managed root CEO.
    canUseSudo: false,
  };
}

export function blueprintSystemPrompt(
  blueprint: WorkforceBlueprint,
  member: WorkforceBlueprintMember,
  template: AgentTemplateDefinition,
  locale: WorkspaceLocale = "tr",
): string {
  const copy = getLocalizedHandoffCopy(locale);
  const localizedTemplate = getLocalizedAgentTemplate(template.key, locale);
  if (!localizedTemplate) throw new Error("Missing workforce role template");
  const reportsTo = member.reportsToKey
    ? (blueprint.members.find(
        (candidate) => candidate.key === member.reportsToKey,
      )?.role ?? member.reportsToKey)
    : copy.installedByManager;
  const relevantHandoffs = blueprint.handoffs
    .filter(
      (handoff) =>
        handoff.fromKey === member.key || handoff.toKey === member.key,
    )
    .map((handoff) => {
      const outgoing = handoff.fromKey === member.key;
      const contract = outgoing
        ? handoff.mode === "review"
          ? copy.outgoingReview
          : copy.outgoing
        : handoff.mode === "review"
          ? copy.incomingReview
          : copy.incoming;
      const direction = outgoing
        ? copy.outgoingDirection
        : copy.incomingDirection;
      return `- ${direction} ${copy.modes[handoff.mode]}: ${handoff.instruction} ${contract}`;
    });

  return `${localizedTemplate.defaultSystemPrompt}

${copy.heading}:
- ${copy.team}: ${blueprint.name} (v${blueprint.version}, ${blueprint.orchestration === "flow" ? copy.orchestrations.flow : copy.orchestrations.team})
- ${copy.role}: ${member.role}
- ${copy.reportsTo}: ${reportsTo}
- ${copy.mission}: ${member.mission}
- ${copy.capabilities}: ${member.capabilities.join(", ")}
${relevantHandoffs.length > 0 ? relevantHandoffs.join("\n") : `- ${copy.noHandoff}`}

${blueprint.orchestration === "flow" ? copy.flowRule : copy.teamRule}

${copy.finalRule}`;
}
