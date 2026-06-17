import { useEffect, useRef, useState } from "react";

export function CountUp({ value, duration = 520, className = "", formatter }) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValue = useRef(value);

  useEffect(() => {
    const from = previousValue.current;
    const to = value;
    previousValue.current = value;

    if (from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayValue(to);
      return undefined;
    }

    let raf = 0;
    const startedAt = performance.now();

    const tick = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(from + (to - from) * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, value]);

  const formatted = formatter ? formatter(displayValue) : displayValue.toLocaleString("en-US");

  return <span className={className}>{formatted}</span>;
}
