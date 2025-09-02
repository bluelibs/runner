import { useEffect } from "react";

const Cursor = () => {
  useEffect(() => {
    const cursor = document.querySelector(".cursor");
    const clickableSelector =
      'a, button, [role="button"], [class*="cursor-pointer"], [data-cursor="clickable"]';
    const clickable = document.querySelectorAll(clickableSelector);

    const moveCursor = (e: MouseEvent) => {
      (cursor as HTMLElement)!.style.left = `${e.clientX}px`;
      (cursor as HTMLElement)!.style.top = `${e.clientY}px`;
    };

    const addGlow = () => cursor!.classList.add("glow");
    const removeGlow = () => cursor!.classList.remove("glow");

    window.addEventListener("mousemove", moveCursor);

    clickable.forEach((el) => {
      el.addEventListener("mouseover", addGlow);
      el.addEventListener("mouseleave", removeGlow);
    });

    // Delegated handlers for dynamically added elements (eg. Benchmarks tabs)
    const delegatedOver = (e: MouseEvent) => {
      const target = e?.target as Element | null;
      if (target && target.closest && target.closest(clickableSelector)) {
        addGlow();
      }
    };
    const delegatedOut = (e: MouseEvent) => {
      const from = e?.target as Element | null;
      const to = e?.relatedTarget as Element | null;
      const leavingClickable =
        from && from.closest && from.closest(clickableSelector);
      const enteringClickable =
        to &&
        (to as unknown as Element).closest &&
        (to as unknown as Element).closest(clickableSelector);
      if (leavingClickable && !enteringClickable) {
        removeGlow();
      }
    };
    document.addEventListener("pointerover", delegatedOver);
    document.addEventListener("pointerout", delegatedOut);

    return () => {
      window.removeEventListener("mousemove", moveCursor);
      clickable.forEach((el) => {
        el.removeEventListener("mouseover", addGlow);
        el.removeEventListener("mouseleave", removeGlow);
      });
      document.removeEventListener("pointerover", delegatedOver);
      document.removeEventListener("pointerout", delegatedOut);
    };
  }, []);

  return (
    <div className="cursor">
      <div className="cursor-dot"></div>
    </div>
  );
};

export default Cursor;
