import * as React from "react";
import { type DialogProps } from "@radix-ui/react-dialog";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useUiText } from "@/components/i18n/locale-provider";
import { cn } from "@/lib/utils";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
      className,
    )}
    {...props}
  />
));
if (import.meta.env.DEV) Command.displayName = CommandPrimitive.displayName;

type CommandDialogProps = DialogProps &
  Pick<
    React.ComponentPropsWithoutRef<typeof DialogContent>,
    "onOpenAutoFocus" | "onCloseAutoFocus"
  >;

const CommandDialog = ({
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: CommandDialogProps) => {
  const t = useUiText();
  return (
    <Dialog {...props}>
      <DialogContent
        className="flex flex-col overflow-hidden p-0"
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogTitle className="sr-only">{t("search")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("commandDescription")}
        </DialogDescription>
        <Command
          label={t("searchPagesAndExperts")}
          className="min-h-0 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-[12px] [&_[cmdk-item]]:py-[12px] [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
};

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div
    className="flex shrink-0 items-center border-b ps-[12px] pe-[56px]"
    cmdk-input-wrapper=""
  >
    <Search className="me-[8px] size-[20px] shrink-0 opacity-50" aria-hidden />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex h-10 min-w-0 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  </div>
));

if (import.meta.env.DEV)
  CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => {
  const listRef =
    React.useRef<React.ElementRef<typeof CommandPrimitive.List>>(null);
  React.useImperativeHandle(ref, () => listRef.current!);
  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // Keep the selected result visible when a phone keyboard reduces the list.
    // Scroll only the result list, preserving the input and dialog position.
    const observer = new ResizeObserver(() => {
      const selected = list.querySelector<HTMLElement>(
        '[cmdk-item][data-selected="true"]',
      );
      if (!selected) return;
      const viewport = list.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      if (item.top < viewport.top) list.scrollTop += item.top - viewport.top;
      else if (item.bottom > viewport.bottom)
        list.scrollTop += item.bottom - viewport.bottom;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);
  return (
    <CommandPrimitive.List
      ref={listRef}
      className={cn(
        "min-h-0 max-h-[300px] overflow-y-auto overflow-x-hidden",
        className,
      )}
      {...props}
    />
  );
});

if (import.meta.env.DEV)
  CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-6 text-center text-sm"
    {...props}
  />
));

if (import.meta.env.DEV)
  CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
      className,
    )}
    {...props}
  />
));

if (import.meta.env.DEV)
  CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 h-px bg-border", className)}
    {...props}
  />
));
if (import.meta.env.DEV)
  CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
));

if (import.meta.env.DEV)
  CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ms-auto text-xs tracking-widest text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
};
if (import.meta.env.DEV) CommandShortcut.displayName = "CommandShortcut";

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
