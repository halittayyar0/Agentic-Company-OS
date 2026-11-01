import { useEffect, type RefObject } from "react";

export interface DeliveryReturnPoint {
  url: string;
  scroll: { node: HTMLElement; top: number; left: number }[];
}

/** Read-only navigation; keep the app's document or contained scroll owner. */
export default function ProjectDeliveryJump({
  origin,
}: {
  origin: RefObject<DeliveryReturnPoint | null>;
}) {
  useEffect(() => {
    const element = document.getElementById("project-delivery-link");
    if (!element) return;
    const focusResult = () => {
      const heading = document.getElementById("project-delivery-heading");
      heading?.scrollIntoView({ block: "start" });
      heading?.focus({ preventScroll: true });
    };
    const restoreOrigin = () => {
      const saved = origin.current;
      if (!saved) return;
      for (const { node, top, left } of saved.scroll)
        if (node.isConnected) node.scrollTo({ top, left, behavior: "instant" });
      element.focus({ preventScroll: true });
    };
    // This owner mounts after the task and selected language are available.
    // A poll that changes summary text leaves this mounted owner and focus alone.
    let frame: number | undefined;
    if (
      window.location.hash === "#project-delivery-heading" ||
      origin.current?.url === window.location.href
    ) {
      // AppShell places ordinary route focus on the first animation frame.
      // Restore the explicit result destination after that layout, once only.
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          const active = document.activeElement;
          if (
            !active ||
            active === document.body ||
            active.id === "main-content" ||
            active.id === "project-delivery-heading"
          ) {
            if (window.location.hash === "#project-delivery-heading")
              focusResult();
            else if (origin.current?.url === window.location.href)
              restoreOrigin();
          }
        });
      });
    }
    const restore = (event: HashChangeEvent) => {
      const saved = origin.current;
      if (!saved) return;
      const destination = new URL(saved.url);
      destination.hash = "project-delivery-heading";
      if (event.oldURL === saved.url && event.newURL === destination.href) {
        focusResult();
        return;
      }
      if (
        event.newURL !== saved.url ||
        new URL(event.oldURL).hash !== "#project-delivery-heading"
      )
        return;
      // Browser history restores the document, but not the desktop app's
      // contained scroller. Keep this return point in memory for this mount.
      restoreOrigin();
    };
    window.addEventListener("hashchange", restore);
    return () => {
      window.removeEventListener("hashchange", restore);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [origin]);
  return null;
}
