import { useCallback, useMemo } from "react";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function useBorderGlow({ edgeSensitivity = 30 } = {}) {
  const resolvedEdgeSensitivity = useMemo(() => clamp(edgeSensitivity, 0, 100), [edgeSensitivity]);

  const handlePointerMove = useCallback((event) => {
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const y = clamp(event.clientY - rect.top, 0, rect.height);
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const deltaX = x - centerX;
    const deltaY = y - centerY;
    const scaleX = deltaX === 0 ? Infinity : centerX / Math.abs(deltaX);
    const scaleY = deltaY === 0 ? Infinity : centerY / Math.abs(deltaY);
    const edgeProximity = clamp(1 / Math.min(scaleX, scaleY), 0, 1) * 100;
    const opacity = clamp((edgeProximity - resolvedEdgeSensitivity) / (100 - resolvedEdgeSensitivity), 0, 1);
    const radians = deltaX === 0 && deltaY === 0 ? 0 : Math.atan2(deltaY, deltaX);
    const angle = ((radians * 180) / Math.PI + 90 + 360) % 360;

    element.classList.add("is-border-glow-active");
    element.style.setProperty("--border-glow-x", `${((x / rect.width) * 100).toFixed(2)}%`);
    element.style.setProperty("--border-glow-y", `${((y / rect.height) * 100).toFixed(2)}%`);
    element.style.setProperty("--edge-proximity", edgeProximity.toFixed(3));
    element.style.setProperty("--cursor-angle", `${angle.toFixed(3)}deg`);
    element.style.setProperty("--border-glow-opacity", opacity.toFixed(3));
  }, [resolvedEdgeSensitivity]);

  const handlePointerLeave = useCallback((event) => {
    const element = event.currentTarget;
    element.classList.remove("is-border-glow-active");
    element.style.setProperty("--edge-proximity", "0");
    element.style.setProperty("--border-glow-opacity", "0");
  }, []);

  return {
    onPointerMove: handlePointerMove,
    onPointerLeave: handlePointerLeave,
  };
}

export function BorderGlow({
  as: Tag = "div",
  children,
  className = "",
  edgeSensitivity = 30,
  onPointerMove,
  onPointerLeave,
  ...props
}) {
  const glowHandlers = useBorderGlow({ edgeSensitivity });

  const handlePointerMove = useCallback((event) => {
    glowHandlers.onPointerMove(event);
    onPointerMove?.(event);
  }, [glowHandlers, onPointerMove]);

  const handlePointerLeave = useCallback((event) => {
    glowHandlers.onPointerLeave(event);
    onPointerLeave?.(event);
  }, [glowHandlers, onPointerLeave]);

  return (
    <Tag
      className={`border-glow ${className}`.trim()}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      {...props}
    >
      {children}
    </Tag>
  );
}
