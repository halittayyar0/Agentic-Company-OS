import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { Agent } from "@workspace/api-client-react";
import { AtSign, Send, X } from "lucide-react";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CompanyChannelMember } from "@/lib/company-room";
import type { CompanyRoomCopy } from "@/lib/company-room-copy";
import { mentionPattern } from "@/lib/company-room-send";
import { useLocale } from "@/components/i18n/locale-provider";
import { cn } from "@/lib/utils";

type Mention = { id: number; name: string };
export function CompanyRoomComposer({
  value,
  onChange,
  members,
  agentsById,
  onSubmit,
  pending,
  disabled = false,
  compact = false,
  textareaRef,
  copy: c,
}: {
  value: string;
  onChange: (value: string) => void;
  members: CompanyChannelMember[];
  agentsById: ReadonlyMap<number, Agent>;
  onSubmit: (content: string, mentionedAgentIds: number[]) => void;
  pending: boolean;
  disabled?: boolean;
  compact?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  copy: CompanyRoomCopy;
}) {
  const { locale } = useLocale();
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = textareaRef ?? fallbackRef;
  const listId = useId();
  const [selected, setSelected] = useState<Mention[]>([]);
  const [context, setContext] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const [active, setActive] = useState(0);
  const frozen = disabled || pending;
  const invalid = selected.some(
    (item) =>
      !members.some(
        (member) =>
          member.agentId === item.id &&
          member.isActive &&
          member.name === item.name,
      ),
  );
  const suggestions = useMemo(() => {
    if (!context) return [];
    const normalize = (text: string) =>
      text.toLocaleLowerCase(locale).normalize("NFKD").replace(/\p{M}/gu, "");
    return members
      .filter(
        (member) =>
          member.isActive &&
          !selected.some((item) => item.id === member.agentId) &&
          normalize(member.name + " " + member.role).includes(
            normalize(context.query),
          ),
      )
      .slice(0, 8);
  }, [context, members, selected, locale]);
  useEffect(() => {
    if (!value) {
      setSelected([]);
      setContext(null);
    }
  }, [value]);
  useEffect(() => setActive(0), [context?.query, suggestions.length]);
  function sync(next: string, caret: number) {
    const text = next.slice(0, caret);
    const match = /(?:^|\s)@([^@\s]*)$/u.exec(text);
    setContext(
      match ? { start: text.lastIndexOf("@"), query: match[1] } : null,
    );
    setSelected((previous) =>
      previous.filter((item) => mentionPattern(item.name).test(next)),
    );
  }
  function insert(member: CompanyChannelMember) {
    if (!context || frozen) return;
    const caret = inputRef.current?.selectionStart ?? value.length;
    const token = "@" + member.name + " ";
    onChange(value.slice(0, context.start) + token + value.slice(caret));
    const nextCaret = context.start + token.length;
    setSelected((previous) =>
      previous.some((item) => item.id === member.agentId)
        ? previous
        : [...previous, { id: member.agentId, name: member.name }],
    );
    setContext(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }
  function remove(item: Mention) {
    if (frozen) return;
    setSelected((previous) =>
      previous.filter((candidate) => candidate.id !== item.id),
    );
    onChange(value.replace(mentionPattern(item.name, true), "$1"));
    inputRef.current?.focus();
  }
  function submit() {
    if (frozen || invalid || !value.trim()) return;
    onSubmit(
      value.trim(),
      selected.map((item) => item.id),
    );
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
      return;
    if (context && suggestions.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive(
          (previous) =>
            (previous +
              (event.key === "ArrowDown" ? 1 : -1) +
              suggestions.length) %
            suggestions.length,
        );
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        insert(suggestions[active % suggestions.length]);
        return;
      }
    }
    if (event.key === "Escape" && context) {
      event.preventDefault();
      setContext(null);
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  }
  return (
    <div className="min-w-0">
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {selected.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={frozen}
              onClick={() => remove(item)}
              aria-label={c.removeMention + ": " + item.name}
              className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-3 py-2 text-xs text-primary disabled:opacity-50"
            >
              <bdi className="break-all">@{item.name}</bdi>
              <X size={14} aria-hidden />
            </button>
          ))}
        </div>
      )}
      <div className="relative min-w-0 rounded-xl border bg-card p-2 focus-within:ring-2 focus-within:ring-ring">
        {context && !frozen && (
          <div
            id={listId}
            role="listbox"
            aria-label={c.mentionMembers}
            className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-52 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg"
          >
            {suggestions.length ? (
              suggestions.map((member, index) => {
                const agent = agentsById.get(member.agentId);
                return (
                  <button
                    key={member.agentId}
                    id={listId + "-" + index}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === active % suggestions.length}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insert(member)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 rounded-lg p-2 text-start",
                      index === active % suggestions.length
                        ? "bg-accent"
                        : "hover:bg-accent",
                    )}
                  >
                    {agent && <AgentAvatar agent={agent} size="xs" />}
                    <span className="min-w-0 flex-1">
                      <bdi className="block truncate text-sm font-medium">
                        {member.name}
                      </bdi>
                      <bdi className="block truncate text-xs text-muted-foreground">
                        {member.role}
                      </bdi>
                    </span>
                    <AtSign size={14} aria-hidden />
                  </button>
                );
              })
            ) : (
              <p role="status" className="p-3 text-sm">
                {c.noMatches}
              </p>
            )}
          </div>
        )}
        <label htmlFor={listId + "-input"} className="sr-only">
          {c.compose}
        </label>
        <Textarea
          id={listId + "-input"}
          ref={inputRef}
          value={value}
          dir="auto"
          disabled={frozen}
          maxLength={4000}
          rows={compact ? 2 : 3}
          aria-controls={context ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            context && suggestions.length
              ? listId + "-" + (active % suggestions.length)
              : undefined
          }
          aria-describedby={listId + "-help"}
          placeholder={c.placeholder}
          onKeyDown={keyDown}
          onChange={(event) => {
            onChange(event.target.value);
            sync(
              event.target.value,
              event.target.selectionStart ?? event.target.value.length,
            );
          }}
          onClick={(event) =>
            sync(
              event.currentTarget.value,
              event.currentTarget.selectionStart ??
                event.currentTarget.value.length,
            )
          }
          className="min-h-24 w-full resize-y border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <kbd dir="ltr" className="px-2 text-xs text-muted-foreground">
            Ctrl / ⌘ + Enter
          </kbd>
          <Button
            type="button"
            onClick={submit}
            disabled={frozen || invalid || !value.trim()}
            className="min-h-11 gap-2"
            aria-label={c.send}
          >
            <Send size={16} aria-hidden />
            <span>{c.send}</span>
          </Button>
        </div>
      </div>
      <p
        id={listId + "-help"}
        className="mt-2 text-xs leading-5 text-muted-foreground"
      >
        {selected.length ? c.mentionedHelp : c.ambientHelp}
      </p>
      {invalid && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {c.invalidMention}
        </p>
      )}
    </div>
  );
}
