import "./CircularText.css";

export function CircularText({ text, spinDuration = 20, onHover = "speedUp", className = "" }) {
  const letters = Array.from(text);
  const hoverDuration = onHover === "slowDown"
    ? spinDuration * 2
    : onHover === "speedUp"
      ? spinDuration / 4
      : onHover === "goBonkers"
        ? spinDuration / 20
        : spinDuration;
  const hoverScale = onHover === "goBonkers" ? 0.8 : 1;

  return (
    <div
      className={`circular-text is-hover-${onHover} ${className}`.trim()}
      style={{
        "--circular-text-duration": `${spinDuration}s`,
        "--circular-text-hover-duration": `${hoverDuration}s`,
        "--circular-text-hover-scale": hoverScale,
      }}
    >
      {letters.map((letter, index) => {
        const rotationDeg = (360 / letters.length) * index;
        const factor = Math.PI / letters.length;
        const x = factor * index;
        const y = factor * index;
        const transform = `rotateZ(${rotationDeg}deg) translate3d(${x}px, ${y}px, 0)`;

        return (
          <span key={`${letter}-${index}`} style={{ transform, WebkitTransform: transform }}>
            {letter}
          </span>
        );
      })}
    </div>
  );
}
