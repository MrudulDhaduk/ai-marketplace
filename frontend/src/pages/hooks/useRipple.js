import { useEffect } from "react";

export default function useRipple(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handler = (e) => {
      const target = e.target.closest("[data-ripple]");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.6;
      const wave = document.createElement("span");
      wave.className = "dd-ripple";
      wave.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px`;
      target.appendChild(wave);
      wave.addEventListener("animationend", () => wave.remove(), {
        once: true,
      });
    };

    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [ref]);
}
