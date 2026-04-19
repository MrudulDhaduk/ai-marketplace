import { useCallback } from "react";

export default function useTilt(ref, strength = 6) {
  const onMove = useCallback(
    (e) => {
      const el = ref.current;
      if (!el) return;
      const { left, top, width, height } = el.getBoundingClientRect();
      const x = ((e.clientX - left) / width - 0.5) * strength;
      const y = ((e.clientY - top) / height - 0.5) * strength;
      el.style.transform = `perspective(800px) rotateX(${-y}deg) rotateY(${x}deg) translateY(-4px)`;
      el.style.transition = "transform 0.08s ease";
    },
    [ref, strength],
  );

  const onLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "";
    el.style.transition = "transform 0.5s cubic-bezier(0.34,1.56,0.64,1)";
  }, [ref]);

  return { onMouseMove: onMove, onMouseLeave: onLeave };
}
