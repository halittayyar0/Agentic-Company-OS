import { useRef } from "react";
import { Search, X } from "lucide-react";
import { Input } from "./input";
import { cn } from "@/lib/utils";
import { useUiText } from "@/components/i18n/locale-provider";

export function SearchInput({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const t = useUiText();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={placeholder}
        className="h-11 ps-10 pe-12 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value ? (
        <button
          type="button"
          aria-label={t("clearSearch")}
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
          className="absolute inset-y-0 end-0 flex w-11 cursor-pointer items-center justify-center rounded-e-control text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
