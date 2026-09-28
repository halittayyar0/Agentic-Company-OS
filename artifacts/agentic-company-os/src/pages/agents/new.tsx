import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod/v4-mini";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetOrgSummaryQueryKey,
  getListAgentsQueryKey,
  getListAgentTemplatesQueryKey,
  useCreateAgent,
  useListAgentTemplates,
  useListAgents,
  type AgentPermissions,
  type AgentTemplate,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChartNoAxesCombined,
  Workflow,
  Paintbrush,
  ShieldCheck,
  LoaderCircle,
  ChevronDown,
} from "lucide-react";
import { AgentModelPicker } from "@/components/agent/agent-model-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ValidatedForm } from "@/components/ui/validated-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useLocale } from "@/components/i18n/locale-provider";
import { LanguageSelect } from "@/components/i18n/language-select";
import { Skeleton } from "@/components/ui/skeleton";
import { directionForLocale, type Locale } from "@/lib/i18n";
import {
  loadNewAgentCopy,
  expertTemplateName,
  type NewAgentCopy,
} from "@/lib/new-agent-copy";
import {
  loadAgentDirectoryCopy,
  directoryDepartment,
  type AgentDirectoryCopy,
  type DirectoryRole,
} from "@/lib/agent-directory-copy";
import { cn } from "@/lib/utils";

const makeSchema = (copy: NewAgentCopy) =>
  z
    .object({
      name: z
        .string()
        .check(
          z.trim(),
          z.minLength(2, copy.validation.nameShort),
          z.maxLength(80, copy.validation.nameLong),
        ),
      role: z
        .string()
        .check(
          z.trim(),
          z.minLength(2, copy.validation.roleShort),
          z.maxLength(120, copy.validation.roleLong),
        ),
      department: z
        .string()
        .check(z.trim(), z.maxLength(120, copy.validation.departmentLong)),
      parentAgentId: z.string(),
      templateKey: z.string(),
      isCustom: z.boolean(),
      systemPrompt: z
        .string()
        .check(z.maxLength(65536, copy.validation.promptLong)),
      modelMode: z.enum(["auto", "manual"]),
      modelId: z.string(),
    })
    .check((context) => {
      const values = context.value;
      if (!values.isCustom && !values.templateKey)
        context.issues.push({
          code: "custom",
          input: values,
          path: ["templateKey"],
          message: copy.validation.template,
        });
      if (values.isCustom && values.systemPrompt.trim().length < 20)
        context.issues.push({
          code: "custom",
          input: values,
          path: ["systemPrompt"],
          message: copy.validation.promptShort,
        });
      if (values.modelMode === "manual" && !values.modelId)
        context.issues.push({
          code: "custom",
          input: values,
          path: ["modelId"],
          message: copy.validation.model,
        });
    });
type Values = z.infer<ReturnType<typeof makeSchema>>;
const DEFAULT_PERMISSIONS: AgentPermissions = {
  canCreateSubAgents: false,
  canDelegate: false,
  canSpend: false,
  canDelete: false,
  canPublish: false,
  canContactExternal: false,
  canBrowse: true,
  canUseTerminal: true,
  canUseSudo: false,
};
const SPECIALISTS = [
  { key: "ux_designer", icon: Paintbrush },
  { key: "quality_engineer", icon: ShieldCheck },
  { key: "data_analyst", icon: ChartNoAxesCombined },
  { key: "automation_specialist", icon: Workflow },
];
const PERMISSIONS = [
  "canBrowse",
  "canUseTerminal",
  "canDelegate",
  "canCreateSubAgents",
  "canSpend",
  "canDelete",
  "canPublish",
  "canContactExternal",
] as const;

export default function NewAgent() {
  const { locale, setLocale, t } = useLocale();
  const copyQuery = useQuery({
    queryKey: ["new-agent-copy", locale],
    queryFn: async () => {
      const [copy, directory] = await Promise.all([
        loadNewAgentCopy(locale),
        loadAgentDirectoryCopy(locale),
      ]);
      return { copy, directory };
    },
    staleTime: Infinity,
    retry: false,
  });
  const retainedCopy = useRef<typeof copyQuery.data>(undefined);
  const retainedLocale = useRef(locale);
  if (copyQuery.data) {
    retainedCopy.current = copyQuery.data;
    retainedLocale.current = locale;
  }
  const content = copyQuery.data ?? retainedCopy.current;
  if (copyQuery.isError && !content)
    return (
      <div
        role="alert"
        className="mx-auto max-w-5xl rounded-panel border border-attention/25 bg-attention/5 p-6 text-center"
      >
        <h1 className="text-sm font-semibold">{t("newAgentCopyError")}</h1>
        <Button
          type="button"
          variant="outline"
          className="mt-4 min-h-11"
          onClick={() => window.location.reload()}
        >
          {t("checkAgain")}
        </Button>
      </div>
    );
  if (!content)
    return (
      <div
        role="status"
        aria-label={t("loadingScreen")}
        className="mx-auto max-w-5xl"
      >
        <Skeleton className="h-72 rounded-panel" />
      </div>
    );
  return (
    <>
      {!copyQuery.data && (
        <div
          role={copyQuery.isError ? "alert" : "status"}
          className="mx-auto mb-4 max-w-5xl rounded-panel border p-4 text-sm"
        >
          {copyQuery.isError ? t("newAgentCopyError") : t("loadingScreen")}
          {copyQuery.isError && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setLocale(retainedLocale.current)}
            >
              {t("close")}
            </Button>
          )}
        </div>
      )}
      <NewAgentForm
        copy={content.copy}
        directory={content.directory}
        locale={locale}
        languageReady={!!copyQuery.data}
      />
    </>
  );
}

function NewAgentForm({
  copy,
  directory,
  locale,
  languageReady,
}: {
  copy: NewAgentCopy;
  directory: AgentDirectoryCopy;
  locale: Locale;
  languageReady: boolean;
}) {
  const [, navigate] = useLocation();
  const [params] = useSearchParams();
  const initialTemplate = useRef(params.get("template"));
  const initialized = useRef(false);
  const advancedSettings = useRef<HTMLDetailsElement>(null);
  const appliedIdentity = useRef({ name: "", role: "", department: "" });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const templatesQuery = useListAgentTemplates(
    { locale },
    {
      query: {
        queryKey: getListAgentTemplatesQueryKey({ locale }),
        enabled: languageReady,
        retry: false,
      },
    },
  );
  const agentsQuery = useListAgents(
    { includeInactive: false },
    { query: { queryKey: getListAgentsQueryKey({ includeInactive: false }) } },
  );
  const createAgent = useCreateAgent();
  const [permissions, setPermissions] = useState(DEFAULT_PERMISSIONS);
  const [failure, setFailure] = useState(false);
  const [manualModelReady, setManualModelReady] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(makeSchema(copy)),
    defaultValues: {
      name: "",
      role: "",
      department: "",
      parentAgentId: "none",
      templateKey: "",
      isCustom: false,
      systemPrompt: "",
      modelMode: "auto",
      modelId: "",
    },
  });
  const values = form.watch();
  const templates = (templatesQuery.data ?? []).filter(
    (template) => template.key !== "ceo",
  );
  const selected = templates.find(
    (template) => template.key === values.templateKey,
  );
  const busy =
    createAgent.isPending || form.formState.isSubmitting || !languageReady;
  const catalogAvailable =
    languageReady && templatesQuery.isSuccess && !templatesQuery.isFetching;
  const catalogReady = catalogAvailable && !!selected;
  const pickTemplate = (template: AgentTemplate) => {
    form.setValue("templateKey", template.key, { shouldDirty: true });
    form.setValue("isCustom", false);
    const defaults = {
      name: expertTemplateName(template, copy),
      role:
        locale === "tr"
          ? template.defaultRole
          : expertTemplateName(template, copy),
      department: directoryDepartment(template.department, directory),
    };
    for (const key of ["name", "role", "department"] as const) {
      const current = form.getValues(key);
      if (!current || current === appliedIdentity.current[key]) {
        form.setValue(key, defaults[key], { shouldDirty: true });
      }
    }
    appliedIdentity.current = defaults;
    form.setValue("systemPrompt", template.defaultSystemPrompt);
    form.clearErrors();
    setPermissions({ ...template.defaultPermissions, canUseSudo: false });
    setFailure(false);
  };
  useEffect(() => {
    if (initialized.current || !templatesQuery.data) return;
    initialized.current = true;
    if (form.getValues("isCustom")) return;
    const initial = templatesQuery.data.find(
      (template) =>
        template.key === initialTemplate.current && template.key !== "ceo",
    );
    if (initial) pickTemplate(initial);
  }, [templatesQuery.data]);
  useEffect(() => {
    if (catalogReady && selected && !values.isCustom)
      form.setValue("systemPrompt", selected.defaultSystemPrompt);
  }, [catalogReady, selected, values.isCustom, form]);

  const submit = async (input: Values) => {
    if (createAgent.isPending || !languageReady) return;
    if (!input.isCustom && !catalogReady) {
      form.setError(
        "templateKey",
        { type: "validate", message: copy.templatesError },
        { shouldFocus: true },
      );
      return;
    }
    if (input.modelMode === "manual" && !manualModelReady) {
      if (advancedSettings.current) advancedSettings.current.open = true;
      form.setError(
        "modelId",
        { type: "validate", message: copy.validation.model },
        { shouldFocus: true },
      );
      return;
    }
    setFailure(false);
    try {
      await createAgent.mutateAsync({
        data: {
          locale,
          name: input.name,
          role: input.role,
          department:
            (input.department === appliedIdentity.current.department
              ? selected?.department
              : input.department) || undefined,
          parentAgentId:
            input.parentAgentId === "none"
              ? undefined
              : Number(input.parentAgentId),
          templateKey: input.isCustom ? undefined : input.templateKey,
          systemPrompt: input.isCustom ? input.systemPrompt : undefined,
          modelMode: input.modelMode,
          modelId: input.modelMode === "manual" ? input.modelId : undefined,
          permissions: { ...permissions, canUseSudo: false },
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetOrgSummaryQueryKey() }),
      ]);
      toast({
        title: copy.saved,
        description: copy.savedDescription,
      });
      navigate("/agents");
    } catch {
      setFailure(true);
    }
  };

  return (
    <div className="mx-auto max-w-5xl pb-8 [overflow-wrap:anywhere]">
      <Link
        href="/agents"
        className="inline-flex min-h-11 items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {copy.back}
      </Link>
      <header className="mb-7 mt-3">
        <div className="mb-4 flex justify-end">
          <LanguageSelect disabled={createAgent.isPending} />
        </div>
        <p className="text-xs font-medium text-primary">{copy.eyebrow}</p>
        <h1 className="editorial-display mt-3 text-4xl">{copy.title}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          {copy.description}
        </p>
      </header>
      <ValidatedForm
        form={form}
        onSubmit={submit}
        onInvalid={(errors) => {
          const invalidField = errors.systemPrompt
            ? "systemPrompt"
            : errors.modelId
              ? "modelId"
              : null;
          if (invalidField && advancedSettings.current) {
            advancedSettings.current.open = true;
            const firstInvalid = Object.keys(errors)[0];
            if (firstInvalid === "systemPrompt" || firstInvalid === "modelId") {
              window.requestAnimationFrame(() => form.setFocus(firstInvalid));
            }
          }
        }}
        className="space-y-6"
        aria-busy={busy}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-6">
          <section
            className="rounded-panel border border-border bg-card px-[20px] py-5 sm:p-6"
            aria-labelledby="expert-specialty-heading"
          >
            <h2
              id="expert-specialty-heading"
              className="text-base font-semibold"
            >
              {copy.specialtyHeading}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {copy.recommended}
            </p>
            {templatesQuery.isPending ? (
              <p
                role="status"
                className="py-10 text-center text-sm text-muted-foreground"
              >
                {copy.templatesLoading}
              </p>
            ) : templatesQuery.isError ? (
              <div
                role="alert"
                className="my-4 rounded-control border border-destructive/25 p-4 text-sm"
              >
                {copy.templatesError}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ms-3 min-h-11 md:min-h-8"
                  onClick={() => void templatesQuery.refetch()}
                >
                  {copy.retry}
                </Button>
              </div>
            ) : templates.length === 0 ? (
              <p role="status" className="py-6 text-sm text-muted-foreground">
                {copy.templatesEmpty}
              </p>
            ) : (
              <div
                className="mt-4 grid gap-3 sm:grid-cols-2"
                role="group"
                aria-label={copy.recommendedAria}
              >
                {SPECIALISTS.map(({ key, icon: Icon }) => {
                  const template = templates.find((item) => item.key === key);
                  if (!template) return null;
                  const active = values.templateKey === key && !values.isCustom;
                  return (
                    <button
                      type="button"
                      key={key}
                      aria-pressed={active}
                      onClick={() => pickTemplate(template)}
                      className={cn(
                        "cursor-pointer min-w-0 break-words rounded-control border p-4 text-start transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50",
                        active
                          ? "border-primary bg-primary/5"
                          : "border-border bg-background/40",
                      )}
                    >
                      <span className="flex items-center justify-between">
                        <Icon className="size-5 text-primary" aria-hidden />
                        {active ? (
                          <Check className="size-4 text-primary" aria-hidden />
                        ) : null}
                      </span>
                      <span className="mt-3 block text-sm font-semibold">
                        {expertTemplateName(template, copy)}
                      </span>
                      <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">
                        {template.key === "specialist"
                          ? copy.specialistSummary
                          : (directory.summaries[
                              template.key as DirectoryRole
                            ] ?? template.description)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <FormField
              control={form.control}
              name="templateKey"
              render={({ field }) => (
                <FormItem className="mt-5">
                  <FormLabel>{copy.allTemplates}</FormLabel>
                  <Select
                    dir={directionForLocale(locale)}
                    value={field.value}
                    onValueChange={(key) => {
                      const template = templates.find(
                        (item) => item.key === key,
                      );
                      if (template) pickTemplate(template);
                    }}
                    disabled={
                      busy ||
                      values.isCustom ||
                      templatesQuery.isPending ||
                      templates.length === 0
                    }
                  >
                    <FormControl>
                      <SelectTrigger ref={field.ref} className="min-h-11">
                        <SelectValue placeholder={copy.chooseTemplate} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {templates.map((template) => (
                        <SelectItem key={template.key} value={template.key}>
                          <bdi>{expertTemplateName(template, copy)}</bdi> ·{" "}
                          {directoryDepartment(template.department, directory)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>
          <section
            className="rounded-panel border border-border bg-card px-[20px] py-5 sm:p-6"
            aria-labelledby="expert-identity-heading"
          >
            <h2
              id="expert-identity-heading"
              className="mb-5 text-base font-semibold"
            >
              {copy.identityHeading}
            </h2>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{copy.name}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={80}
                        placeholder={copy.namePlaceholder}
                        className="h-11"
                      />
                    </FormControl>
                    <FormDescription>{copy.nameHelp}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{copy.role}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={120}
                        placeholder={copy.rolePlaceholder}
                        className="h-11"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{copy.department}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={120}
                        placeholder={copy.departmentPlaceholder}
                        className="h-11"
                      />
                    </FormControl>
                    <FormDescription>{copy.departmentHelp}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="parentAgentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{copy.parent}</FormLabel>
                    <Select
                      dir={directionForLocale(locale)}
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={busy}
                    >
                      <FormControl>
                        <SelectTrigger className="min-h-11">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">{copy.parentNone}</SelectItem>
                        {(agentsQuery.data ?? []).map((agent) => (
                          <SelectItem key={agent.id} value={String(agent.id)}>
                            <bdi>{agent.name}</bdi>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {agentsQuery.isPending ? (
                      <p
                        role="status"
                        className="text-xs text-muted-foreground"
                      >
                        {copy.teamLoading}
                      </p>
                    ) : agentsQuery.isError ? (
                      <p
                        role="status"
                        className="text-xs text-attention-foreground"
                      >
                        {copy.teamError}
                      </p>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </section>
          <details
            ref={advancedSettings}
            className="group rounded-panel border border-border bg-card"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-[12px] px-[20px] py-5 sm:gap-3 sm:p-6">
              <span className="min-w-0">
                <span className="text-sm font-semibold">{copy.advanced}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {copy.advancedHelp}
                </span>
              </span>
              <ChevronDown
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="space-y-6 border-t border-border px-[20px] py-5 sm:p-6">
              <FormField
                control={form.control}
                name="modelMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{copy.modelMode}</FormLabel>
                    <Select
                      dir={directionForLocale(locale)}
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={busy}
                    >
                      <FormControl>
                        <SelectTrigger className="h-auto min-h-11 whitespace-normal max-sm:gap-[8px] max-sm:px-[12px] [&>span]:line-clamp-none [&>span]:text-start">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="auto">{copy.modelAuto}</SelectItem>
                        <SelectItem value="manual">
                          {copy.modelManual}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>{copy.modelHelp}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {values.modelMode === "manual" ? (
                <FormField
                  control={form.control}
                  name="modelId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{copy.fixedModel}</FormLabel>
                      <FormControl>
                        <div
                          ref={field.ref}
                          tabIndex={-1}
                          role="group"
                          aria-label={copy.fixedModel}
                          className="rounded-control"
                        >
                          <AgentModelPicker
                            value={field.value}
                            onChange={field.onChange}
                            onAvailabilityChange={setManualModelReady}
                            copy={copy.model}
                            retryLabel={copy.retry}
                            locale={locale}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
              <FormField
                control={form.control}
                name="isCustom"
                render={({ field }) => (
                  <FormItem className="flex min-h-11 flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <FormLabel>{copy.custom}</FormLabel>
                      <FormDescription>{copy.customHelp}</FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              {values.isCustom ? (
                <FormField
                  control={form.control}
                  name="systemPrompt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{copy.prompt}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={6}
                          maxLength={65536}
                          placeholder={copy.promptPlaceholder}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : selected ? (
                <details className="rounded-control border border-border p-4">
                  <summary className="min-h-11 cursor-pointer text-sm font-medium">
                    {copy.promptReview}
                  </summary>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {copy.promptSource}
                  </p>
                  <p
                    dir="auto"
                    className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground"
                  >
                    {selected.defaultSystemPrompt}
                  </p>
                </details>
              ) : null}
              <section aria-label={copy.permissionsAria}>
                <h3 className="text-sm font-semibold">
                  {copy.permissionsHeading}
                </h3>
                <p className="mb-4 mt-1 text-xs leading-5 text-muted-foreground">
                  {copy.permissionsHelp}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {PERMISSIONS.map((key) => (
                    <label
                      key={key}
                      className="flex min-h-11 min-w-0 cursor-pointer flex-wrap items-center justify-between gap-4 rounded-control border border-border p-3 text-xs"
                    >
                      <span>{copy.permissions[key]}</span>
                      <Switch
                        checked={permissions[key]}
                        onCheckedChange={(checked) =>
                          setPermissions((current) => ({
                            ...current,
                            [key]: checked,
                          }))
                        }
                        aria-label={copy.permissions[key]}
                      />
                    </label>
                  ))}
                </div>
              </section>
            </div>
          </details>
        </fieldset>
        {failure ? (
          <p
            role="alert"
            className="rounded-control border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {copy.saveFailed}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-border bg-card p-4">
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">
            {values.isCustom ? (
              copy.customSummary
            ) : selected ? (
              <>
                <bdi>{expertTemplateName(selected, copy)}</bdi> ·{" "}
                {values.modelMode === "auto"
                  ? copy.autoSummary
                  : copy.fixedModel}
              </>
            ) : (
              copy.startHint
            )}
          </p>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              disabled={busy}
              onClick={() => navigate("/agents")}
            >
              {copy.cancel}
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                (!values.isCustom &&
                  (!catalogAvailable || (!!values.templateKey && !selected)))
              }
              aria-busy={busy}
              className="min-h-11 min-w-[min(9rem,100%)]"
            >
              {busy ? (
                <LoaderCircle
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <ArrowRight className="rtl:rotate-180" aria-hidden />
              )}
              {busy ? copy.submitting : copy.submit}
            </Button>
          </div>
        </div>
      </ValidatedForm>
    </div>
  );
}
