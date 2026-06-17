import { useCallback, useRef } from "react";

export function Magnet({
  as: Tag = "span",
  children,
  className = "",
  strength = 18,
  disabled = false,
  motionDisabled,
  onPointerMove,
  onPointerLeave,
  ...props
}) {
  const elementRef = useRef(null);
  const shouldDisableMotion = motionDisabled ?? disabled;
  const forwardedProps = Tag === "button" ? { disabled, ...props } : props;

  const handlePointerMove = useCallback((event) => {
    const element = elementRef.current;
    onPointerMove?.(event);
    if (!element || shouldDisableMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const deltaX = (event.clientX - centerX) / strength;
    const deltaY = (event.clientY - centerY) / strength;
    element.style.setProperty("--magnet-x", `${deltaX.toFixed(2)}px`);
    element.style.setProperty("--magnet-y", `${deltaY.toFixed(2)}px`);
  }, [onPointerMove, shouldDisableMotion, strength]);

  const handlePointerLeave = useCallback((event) => {
    const element = elementRef.current;
    if (element) {
      element.style.setProperty("--magnet-x", "0px");
      element.style.setProperty("--magnet-y", "0px");
    }
    onPointerLeave?.(event);
  }, [onPointerLeave]);

  return (
    <Tag
      ref={elementRef}
      className={`magnet ${className}`.trim()}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      {...forwardedProps}
    >
      {children}
    </Tag>
  );
}
