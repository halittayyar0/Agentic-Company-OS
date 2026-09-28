import type { ComponentType, ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/components/i18n/locale-provider";

export type WorkbenchTab =
  "workspace" | "plan" | "meetings" | "team" | "evidence";
export function useWorkbenchView(
  root: boolean,
): [WorkbenchTab, (view: string) => void] {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const requested = new URLSearchParams(search).get("view");
  const allowed = [
    "workspace",
    "plan",
    "team",
    "evidence",
    ...(root ? ["meetings"] : []),
  ];
  const view: WorkbenchTab = allowed.includes(requested ?? "")
    ? (requested as WorkbenchTab)
    : "workspace";
  return [
    view,
    (next) => {
      if (!allowed.includes(next) || next === view) return;
      const params = new URLSearchParams(search);
      params.set("view", next);
      navigate(`${path}?${params.toString()}${window.location.hash}`);
    },
  ];
}

export function ProjectWorkbenchTabs({
  value,
  onChange,
  label,
  tabs,
  children,
}: {
  value: WorkbenchTab;
  onChange: (view: string) => void;
  label: string;
  tabs: {
    id: WorkbenchTab;
    label: string;
    icon: ComponentType<{ size?: string | number; className?: string }>;
  }[];
  children: ReactNode;
}) {
  const { locale } = useLocale();
  return (
    <Tabs
      dir={locale === "ar" ? "rtl" : "ltr"}
      value={value}
      onValueChange={onChange}
      className="min-w-0"
    >
      <header className="border-b border-border/60 p-2">
        <TabsList
          aria-label={label}
          tabIndex={-1}
          className="scrollbar-slim flex h-auto min-w-0 justify-start gap-1 overflow-x-auto bg-transparent p-0 pb-1"
        >
          {tabs.map(({ id, label: name, icon: Icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              id={`project-workbench-tab-${id}`}
              aria-controls={`project-workbench-${id}`}
              tabIndex={value === id ? 0 : -1}
              className="min-h-11 max-w-full shrink-0 gap-1.5 whitespace-normal rounded-xl px-3 text-xs"
              onFocus={(event) =>
                event.currentTarget.scrollIntoView({
                  block: "nearest",
                  inline: "nearest",
                })
              }
            >
              <Icon size={14} aria-hidden />
              {name}
            </TabsTrigger>
          ))}
        </TabsList>
      </header>
      <div className="min-w-0 bg-background/35 p-[12px] sm:p-5">{children}</div>
    </Tabs>
  );
}
