import { LanguagePackStatus } from "@/components/i18n/language-pack-status";
import { lazy, Suspense, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetCapabilityCatalog,
  type BuiltinSkill,
  type CapabilityLibraryCopy,
} from "@workspace/api-client-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { buildSkillDraft } from "@/lib/skill-draft";
const ExtensionLibrary = lazy(() =>
  import("@/components/extension-library").then((module) => ({
    default: module.ExtensionLibrary,
  })),
);
const LocalUtilityWorkbench = lazy(() =>
  import("@/components/local-utility-workbench").then((module) => ({
    default: module.LocalUtilityWorkbench,
  })),
);

export default function SkillsPage() {
  const { locale, t } = useLocale();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const catalog = useGetCapabilityCatalog(
    { locale },
    {
      query: {
        queryKey: ["capability-catalog", locale],
        retry: false,
        staleTime: Infinity,
      },
    },
  );
  const data = catalog.data;
  const normalizedQuery = query.normalize("NFKC").trim();
  const needle = normalizedQuery.toLocaleLowerCase(locale);
  const filtered =
    data?.skills.filter(
      (skill) =>
        (!group || skill.group === group) &&
        (skill.id.toLowerCase().includes(normalizedQuery.toLowerCase()) ||
          `${skill.title} ${skill.deliverable} ${skill.groupTitle}`
            .normalize("NFKC")
            .toLocaleLowerCase(locale)
            .includes(needle)),
    ) ?? [];
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 pb-16 [overflow-wrap:anywhere]">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("skillsLibrary")}
        </h1>
        {data && (
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            {data.copy.intro}
          </p>
        )}
      </header>
      <Suspense fallback={<LanguagePackStatus error={false} />}>
        <LocalUtilityWorkbench />
      </Suspense>
      <Suspense fallback={<LanguagePackStatus error={false} />}>
        <ExtensionLibrary />
      </Suspense>
      {catalog.isError ? (
        <div
          role="alert"
          className="rounded-panel border border-border bg-card p-6"
        >
          <p>{t("skillsLoadError")}</p>
          <Button
            type="button"
            className="mt-4 min-h-11"
            variant="outline"
            onClick={() => void catalog.refetch()}
          >
            {t("checkAgain")}
          </Button>
        </div>
      ) : !data ? (
        <p role="status">{t("loadingScreen")}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <label className="space-y-2 text-sm font-medium">
              <span>{data.copy.search}</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-border bg-card px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>
            <label className="space-y-2 text-sm font-medium">
              <span>{data.copy.all}</span>
              <select
                value={group}
                onChange={(event) => setGroup(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-border bg-card px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <option value="">{data.copy.all}</option>
                {data.groups.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <section aria-labelledby="skill-list-title" className="space-y-4">
            <h2 id="skill-list-title" className="text-lg font-semibold">
              {data.copy.skills}{" "}
              <span
                role="status"
                aria-live="polite"
                className="text-sm font-normal text-muted-foreground"
              >
                ({filtered.length.toLocaleString(locale)})
              </span>
            </h2>
            {!filtered.length && (
              <p
                role="status"
                className="rounded-panel border border-border p-6 text-muted-foreground"
              >
                {data.copy.empty}
              </p>
            )}
            <div className="divide-y divide-border rounded-panel border border-border bg-card">
              {filtered.map((skill) => (
                <SkillRow key={skill.id} skill={skill} copy={data.copy} />
              ))}
            </div>
          </section>
          <section aria-labelledby="skill-tools-title" className="space-y-4">
            <h2 id="skill-tools-title" className="text-lg font-semibold">
              {data.copy.tools} ({data.tools.length.toLocaleString(locale)})
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {data.copy.toolBoundary}
            </p>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
              {data.tools.map((tool) => (
                <div
                  key={tool.name}
                  className="min-w-0 border-s-2 border-border ps-4"
                >
                  <dt className="font-medium">{tool.title}</dt>
                  <dd className="mt-1 text-sm leading-6 text-muted-foreground">
                    {tool.description}
                    <code dir="ltr" className="mt-1 block break-all text-xs">
                      {tool.name}
                    </code>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}
    </div>
  );
}

function SkillRow({
  skill,
  copy,
}: {
  skill: BuiltinSkill;
  copy: CapabilityLibraryCopy;
}) {
  const [, navigate] = useLocation();
  return (
    <details data-skill-id={skill.id} className="group min-w-0">
      <summary className="min-h-11 cursor-pointer rounded-xl px-[20px] py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-5">
        <span className="font-semibold">{skill.title}</span>
        <span className="mt-1 block break-words text-sm text-muted-foreground sm:ms-3 sm:mt-0 sm:inline">
          {skill.groupTitle}
        </span>
      </summary>
      <div className="space-y-5 px-[20px] pb-6 text-sm leading-6 sm:px-5">
        <p className="max-w-3xl text-base leading-7">{skill.deliverable}</p>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <h3 className="font-semibold">{copy.inputs}</h3>
            <ul className="mt-2 list-disc space-y-1 ps-5">
              {skill.inputs.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-semibold">{copy.requirements}</h3>
            {skill.permissions.map((permission) => (
              <p key={permission}>
                {permission === "canBrowse" ? copy.browser : copy.files}
              </p>
            ))}
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
              {skill.tools.map((tool) => (
                <bdi key={tool} className="break-all font-mono text-xs">
                  {tool}
                </bdi>
              ))}
            </p>
          </div>
        </div>
        <div>
          <h3 className="font-semibold">{copy.steps}</h3>
          <ol className="mt-2 list-decimal space-y-2 ps-5">
            {skill.steps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </div>
        <div>
          <h3 className="font-semibold">{copy.checks}</h3>
          <ul className="mt-2 list-disc space-y-1 ps-5">
            {skill.checks.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <p className="max-w-3xl text-muted-foreground">{copy.boundary}</p>
        <Button
          type="button"
          className="min-h-11 max-w-full whitespace-normal"
          onClick={() =>
            navigate("/projects/new", {
              state: { acosSkillDraft: buildSkillDraft(skill, copy) },
            })
          }
        >
          {copy.use}
        </Button>
      </div>
    </details>
  );
}
