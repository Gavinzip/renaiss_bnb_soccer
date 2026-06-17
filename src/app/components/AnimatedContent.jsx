import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";

export function AnimatedContent({
  children,
  className = "",
  distance = 18,
  direction = "vertical",
  reverse = false,
  duration = 0.48,
  delay = 0,
  scale = 0.98,
  animateOpacity = true,
  as: Tag = "div",
  ...props
}) {
  const elementRef = useRef(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      gsap.set(element, { clearProps: "all" });
      return undefined;
    }

    const axis = direction === "horizontal" ? "x" : "y";
    const signedDistance = reverse ? -distance : distance;
    const context = gsap.context(() => {
      gsap.fromTo(
        element,
        {
          [axis]: signedDistance,
          opacity: animateOpacity ? 0 : 1,
          scale,
          filter: "blur(3px)",
        },
        {
          [axis]: 0,
          opacity: 1,
          scale: 1,
          filter: "blur(0px)",
          duration,
          delay,
          ease: "power3.out",
          clearProps: "transform,filter",
        },
      );
    }, element);

    return () => context.revert();
  }, [animateOpacity, delay, direction, distance, duration, reverse, scale]);

  return (
    <Tag ref={elementRef} className={`animated-content ${className}`.trim()} {...props}>
      {children}
    </Tag>
  );
}
