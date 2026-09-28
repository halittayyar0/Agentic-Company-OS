import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className,
    )}
    {...props}
  />
));
if (import.meta.env.DEV) TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
      className,
    )}
    {...props}
  />
));
if (import.meta.env.DEV)
  TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
if (import.meta.env.DEV)
  TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };

// Reveal selections without moving the route vertically or taking focus.
export function useVisibleTab(value: string, ready = true) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const strip = ref.current;
    if (!ready || !strip) return;
    const reveal = () => {
      const selected =
        strip.querySelector<HTMLElement>('[role="tab"]:focus') ??
        strip.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (!selected) return;
      const item = selected.getBoundingClientRect();
      const viewport = strip.getBoundingClientRect();
      const offset =
        item.left < viewport.left
          ? item.left - viewport.left
          : item.right > viewport.right
            ? item.right - viewport.right
            : 0;
      if (offset) strip.scrollBy({ left: offset, behavior: "instant" });
    };
    reveal();
    strip.addEventListener("focusin", reveal);
    const observer = new ResizeObserver(reveal);
    observer.observe(strip);
    const list = strip.querySelector('[role="tablist"]');
    if (list) observer.observe(list);
    return () => {
      observer.disconnect();
      strip.removeEventListener("focusin", reveal);
    };
  }, [value, ready]);
  return ref;
}
