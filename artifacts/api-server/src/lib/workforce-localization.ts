import type { WorkforceBlueprint } from "./workforce-blueprints";
import type { WorkspaceLocale } from "./workspace-locale";
import en from "./workforce-locales/en";
import de from "./workforce-locales/de";
import ru from "./workforce-locales/ru";
import zhCN from "./workforce-locales/zh-CN";
import zhTW from "./workforce-locales/zh-TW";
import ar from "./workforce-locales/ar";

const activityCopy: Record<WorkspaceLocale, [string, string]> = {
  tr: [
    "{team} hazır ekibi için kök görev oluşturuldu.",
    "{manager}, {member} rolünü {team} ekibine ekledi.",
  ],
  en: [
    "Created a root task for {team}.",
    "{manager} added {member} to {team}.",
  ],
  de: [
    "Ein Hauptauftrag für {team} wurde erstellt.",
    "{manager} hat {member} zu {team} hinzugefügt.",
  ],
  ru: [
    "Создана основная задача для команды «{team}».",
    "{manager} добавил(а) специалиста «{member}» в команду «{team}».",
  ],
  "zh-CN": ["已为{team}创建根任务。", "{manager}已将{member}加入{team}。"],
  "zh-TW": ["已為{team}建立根任務。", "{manager}已將{member}加入{team}。"],
  ar: [
    "تم إنشاء مهمة رئيسية لفريق {team}.",
    "أضاف {manager} الخبير {member} إلى فريق {team}.",
  ],
};
export function workforceActivitySummary(
  locale: WorkspaceLocale,
  event: "task_created" | "subagent_created",
  values: Record<string, string>,
): string {
  return activityCopy[locale][event === "task_created" ? 0 : 1].replace(
    /\{(\w+)\}/g,
    (_, key: string) => values[key] ?? key,
  );
}

type MemberCopy = Pick<
  WorkforceBlueprint["members"][number],
  "name" | "role" | "mission" | "capabilities"
>;
type BlueprintCopy = Pick<
  WorkforceBlueprint,
  "name" | "tagline" | "description" | "recommendedFor" | "triggerLabels"
> & {
  members: Record<string, MemberCopy>;
  handoffs: Record<string, string>;
};
export type WorkforceCatalogCopy = Record<
  "product-shipping-crew" | "go-to-market-crew" | "incident-command-flow",
  BlueprintCopy
>;
const catalogs: Record<Exclude<WorkspaceLocale, "tr">, WorkforceCatalogCopy> = {
  en,
  de,
  ru,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ar,
};

/** Only authored copy changes. Identity, hierarchy and permission templates remain canonical. */
export function localizeWorkforceBlueprint(
  blueprint: WorkforceBlueprint,
  locale: WorkspaceLocale,
): WorkforceBlueprint {
  if (locale === "tr") return blueprint;
  const copy = catalogs[locale][blueprint.key as keyof WorkforceCatalogCopy];
  if (!copy)
    throw new Error(
      `Missing workforce translation: ${locale}/${blueprint.key}`,
    );
  return {
    ...blueprint,
    name: copy.name,
    tagline: copy.tagline,
    description: copy.description,
    recommendedFor: [...copy.recommendedFor],
    triggerLabels: [...copy.triggerLabels],
    members: blueprint.members.map((member) => {
      const text = copy.members[member.key];
      if (!text)
        throw new Error(
          `Missing workforce member translation: ${locale}/${member.key}`,
        );
      return {
        ...member,
        name: text.name,
        role: text.role,
        mission: text.mission,
        capabilities: [...text.capabilities],
      };
    }),
    handoffs: blueprint.handoffs.map((handoff) => {
      const instruction =
        copy.handoffs[`${handoff.fromKey}/${handoff.toKey}/${handoff.mode}`];
      if (!instruction)
        throw new Error(
          `Missing workforce handoff translation: ${locale}/${blueprint.key}`,
        );
      return { ...handoff, instruction };
    }),
  };
}
