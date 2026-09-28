import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Agent } from "@workspace/api-client-react";
import { AgentAvatar } from "./agent-avatar";
import { Button } from "@/components/ui/button";
import { avatarFileError, prepareAvatarImage } from "@/lib/avatar-image";
import type { ExpertDetailCopy } from "@/lib/expert-detail-copy";

export function AgentAvatarEditor({
  agent,
  c,
  blocked,
  busy,
  reviewEpoch,
  save,
}: {
  agent: Agent;
  c: ExpertDetailCopy;
  blocked: boolean;
  busy: boolean;
  reviewEpoch: number;
  save: (image: string | null, expected: string) => Promise<Agent | null>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [draft, setDraft] = useState<string | null | undefined>(undefined);
  const [baseline, setBaseline] = useState(agent.avatarVersion);
  const [version, setVersion] = useState(agent.configVersion);
  const [filename, setFilename] = useState<string | null>(null);
  const [error, setError] = useState<
    "avatarFileError" | "avatarPrepareError" | null
  >(null);
  const [processing, setProcessing] = useState(false);
  const dirty = draft !== undefined;
  const custom = draft === undefined ? !!agent.avatarVersion : !!draft;
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!dirty && !processing) {
      setBaseline(agent.avatarVersion);
      setVersion(agent.configVersion);
    }
  }, [agent.avatarVersion, agent.configVersion, dirty, processing]);
  useEffect(() => {
    setVersion(agent.configVersion);
  }, [reviewEpoch]);
  async function select(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy || processing) return;
    if (avatarFileError(file)) {
      setError("avatarFileError");
      return;
    }
    const current = ++generation.current;
    setError(null);
    setProcessing(true);
    if (!dirty) {
      setBaseline(agent.avatarVersion);
      setVersion(agent.configVersion);
    }
    try {
      const prepared = await prepareAvatarImage(file);
      if (generation.current !== current) return;
      setDraft(prepared);
      setFilename(file.name);
    } catch {
      if (generation.current === current) setError("avatarPrepareError");
    } finally {
      if (generation.current === current) setProcessing(false);
    }
  }
  function discard() {
    setDraft(undefined);
    setFilename(null);
    setError(null);
    setBaseline(agent.avatarVersion);
    setVersion(agent.configVersion);
  }
  return (
    <section
      aria-labelledby="expert-portrait"
      className="min-w-0 space-y-4 rounded-panel border bg-card p-4 sm:p-5"
    >
      <h2 id="expert-portrait" className="text-lg font-semibold">
        {c.avatar}
      </h2>
      <div className="flex flex-wrap items-center gap-4">
        <AgentAvatar agent={agent} imageSrc={draft} size="xl" />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium">
            {custom ? c.avatarCustom : c.avatarBuiltin}
          </p>
          {dirty && (
            <p role="status" className="text-sm text-muted-foreground">
              {c.preview}
            </p>
          )}
          {filename && (
            <p dir="auto" className="break-all text-xs">
              {filename}
            </p>
          )}
        </div>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{c.avatarHelp}</p>
      {dirty && baseline !== agent.avatarVersion && (
        <p role="alert" className="text-sm">
          {c.avatarChanged}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {c[error]}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        tabIndex={-1}
        aria-label={c.chooseImage}
        disabled={processing || busy}
        onChange={(event) => void select(event)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={processing || busy}
          onClick={() => input.current?.click()}
        >
          {processing ? c.processing : c.chooseImage}
        </Button>
        {custom && (
          <Button
            variant="outline"
            disabled={processing || busy}
            onClick={() => {
              if (!dirty) {
                setBaseline(agent.avatarVersion);
                setVersion(agent.configVersion);
              }
              setDraft(null);
              setFilename(null);
              setError(null);
            }}
          >
            {c.resetAvatar}
          </Button>
        )}
        {dirty && (
          <>
            <Button
              disabled={blocked || processing || !version}
              onClick={async () => {
                if (draft === undefined || !version) return;
                const saved = await save(draft, version);
                if (saved) {
                  setDraft(undefined);
                  setFilename(null);
                  setError(null);
                  setBaseline(saved.avatarVersion);
                  setVersion(saved.configVersion);
                }
              }}
            >
              {c.saveAvatar}
            </Button>
            <Button
              variant="outline"
              disabled={busy || processing}
              onClick={discard}
            >
              {c.cancel}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
