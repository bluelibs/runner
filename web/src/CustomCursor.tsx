import { useEffect } from "react";

const Cursor = () => {
  useEffect(() => {
    const cursor = document.querySelector(".cursor") as HTMLElement | null;
    if (!cursor) return;

    const clickableSelector =
      'a, button, [role="button"], [class*="cursor-pointer"], [data-cursor="clickable"]';

    // rAF-throttled movement using GPU-friendly transforms via CSS variables
    let x = 0;
    let y = 0;
    let rafId: number | null = null;

    const flush = () => {
      cursor.style.setProperty("--x", `${x}px`);
      cursor.style.setProperty("--y", `${y}px`);
      rafId = null;
    };

    const schedule = () => {
      if (rafId == null) rafId = requestAnimationFrame(flush);
    };

    const onPointerMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      schedule();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const addGlow = () => cursor.classList.add("glow");
    const removeGlow = () => cursor.classList.remove("glow");

    // Delegated handlers for dynamically added elements (eg. tabs)
    const delegatedOver = (e: Event) => {
      const target = e.target as Element | null;
      if (target && target.closest && target.closest(clickableSelector)) {
        addGlow();
      }
    };
    const delegatedOut = (e: PointerEvent) => {
      const from = e.target as Element | null;
      const to = (e.relatedTarget as Element | null) ?? null;
      const leavingClickable =
        from && from.closest && from.closest(clickableSelector);
      const enteringClickable =
        to && to.closest && to.closest(clickableSelector);
      if (leavingClickable && !enteringClickable) {
        removeGlow();
      }
    };
    document.addEventListener("pointerover", delegatedOver, { passive: true });
    document.addEventListener("pointerout", delegatedOut, { passive: true });

    // Initial position to avoid visual jump
    schedule();

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener(
        "pointerover",
        delegatedOver as EventListener,
      );
      document.removeEventListener("pointerout", delegatedOut as EventListener);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div className="cursor">
      <div className="cursor-dot"></div>
    </div>
  );
};

export default Cursor;
