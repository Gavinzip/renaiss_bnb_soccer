import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import "./ElasticSlider.css";

const MAX_OVERFLOW = 50;

function decay(value, max) {
  if (max === 0) return 0;

  const entry = value / max;
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5);
  return sigmoid * max;
}

function clampValue(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(Math.max(numeric, min), max);
}

function snapValue(value, min, stepSize) {
  if (!Number.isFinite(stepSize) || stepSize <= 0) return value;
  return min + Math.round((value - min) / stepSize) * stepSize;
}

export default function ElasticSlider({
  value,
  defaultValue = 50,
  startingValue = 0,
  maxValue = 100,
  className = "",
  isStepped = false,
  stepSize = 1,
  leftIcon = <>-</>,
  rightIcon = <>+</>,
  disabled = false,
  ariaLabel,
  showValue = true,
  valueFormatter = Math.round,
  onChange,
}) {
  const min = Number.isFinite(Number(startingValue)) ? Number(startingValue) : 0;
  const max = Math.max(min, Number.isFinite(Number(maxValue)) ? Number(maxValue) : min);
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(() => clampValue(defaultValue, min, max));
  const currentValue = clampValue(controlled ? value : internalValue, min, max);

  useEffect(() => {
    if (!controlled) setInternalValue(clampValue(defaultValue, min, max));
  }, [controlled, defaultValue, min, max]);

  function commitValue(nextValue) {
    const steppedValue = isStepped ? snapValue(nextValue, min, stepSize) : nextValue;
    const clampedValue = clampValue(steppedValue, min, max);
    if (!controlled) setInternalValue(clampedValue);
    onChange?.(clampedValue);
  }

  return (
    <div className={[
      "elastic-slider-container",
      disabled ? "is-disabled" : "",
      className,
    ].filter(Boolean).join(" ")}
    >
      <Slider
        value={currentValue}
        startingValue={min}
        maxValue={max}
        disabled={disabled}
        isStepped={isStepped}
        stepSize={stepSize}
        leftIcon={leftIcon}
        rightIcon={rightIcon}
        ariaLabel={ariaLabel}
        showValue={showValue}
        valueFormatter={valueFormatter}
        onChange={commitValue}
      />
    </div>
  );
}

function Slider({
  value,
  startingValue,
  maxValue,
  disabled,
  isStepped,
  stepSize,
  leftIcon,
  rightIcon,
  ariaLabel,
  showValue,
  valueFormatter,
  onChange,
}) {
  const sliderRef = useRef(null);
  const [region, setRegion] = useState("middle");
  const clientX = useMotionValue(0);
  const overflow = useMotionValue(0);
  const scale = useMotionValue(1);

  useMotionValueEvent(clientX, "change", (latest) => {
    if (!sliderRef.current) return;

    const { left, right } = sliderRef.current.getBoundingClientRect();
    let overflowValue = 0;

    if (latest < left) {
      setRegion("left");
      overflowValue = left - latest;
    } else if (latest > right) {
      setRegion("right");
      overflowValue = latest - right;
    } else {
      setRegion("middle");
    }

    overflow.jump(decay(overflowValue, MAX_OVERFLOW));
  });

  useEffect(() => {
    if (!disabled) return;
    animate(scale, 1, { duration: 0.18 });
    animate(overflow, 0, { type: "spring", bounce: 0.35 });
    setRegion("middle");
  }, [disabled, overflow, scale]);

  const updateFromClientX = (clientXValue) => {
    if (disabled || !sliderRef.current) return;
    const { left, width } = sliderRef.current.getBoundingClientRect();
    const range = maxValue - startingValue;
    let nextValue = startingValue + ((clientXValue - left) / width) * range;

    if (isStepped) {
      nextValue = snapValue(nextValue, startingValue, stepSize);
    }

    onChange(nextValue);
    clientX.jump(clientXValue);
  };

  const handlePointerMove = (event) => {
    if (event.buttons <= 0) return;
    updateFromClientX(event.clientX);
  };

  const handlePointerDown = (event) => {
    if (disabled) return;
    updateFromClientX(event.clientX);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerUp = () => {
    animate(overflow, 0, { type: "spring", bounce: 0.5 });
  };

  const handleKeyDown = (event) => {
    if (disabled) return;

    const step = Number.isFinite(stepSize) && stepSize > 0 ? stepSize : 1;
    const keyDelta = {
      ArrowLeft: -step,
      ArrowDown: -step,
      ArrowRight: step,
      ArrowUp: step,
      PageDown: -step * 10,
      PageUp: step * 10,
    }[event.key];

    if (event.key === "Home") {
      event.preventDefault();
      onChange(startingValue);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      onChange(maxValue);
      return;
    }

    if (keyDelta === undefined) return;
    event.preventDefault();
    onChange(value + keyDelta);
  };

  const rangePercentage = (() => {
    const totalRange = maxValue - startingValue;
    if (totalRange === 0) return 0;
    return ((value - startingValue) / totalRange) * 100;
  })();

  return (
    <>
      <motion.div
        onHoverStart={() => {
          if (!disabled) animate(scale, 1.2);
        }}
        onHoverEnd={() => animate(scale, 1)}
        onTouchStart={() => {
          if (!disabled) animate(scale, 1.2);
        }}
        onTouchEnd={() => animate(scale, 1)}
        style={{
          scale,
          opacity: useTransform(scale, [1, 1.2], [0.7, 1]),
        }}
        className="elastic-slider-wrapper"
      >
        <motion.div
          className="elastic-slider-icon"
          animate={{
            scale: region === "left" ? [1, 1.4, 1] : 1,
            transition: { duration: 0.25 },
          }}
          style={{
            x: useTransform(() => (region === "left" ? -overflow.get() / scale.get() : 0)),
          }}
        >
          {leftIcon}
        </motion.div>

        <div
          ref={sliderRef}
          className="elastic-slider-root"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={ariaLabel}
          aria-disabled={disabled}
          aria-valuemin={startingValue}
          aria-valuemax={maxValue}
          aria-valuenow={Math.round(value)}
          aria-valuetext={String(valueFormatter(value))}
          onKeyDown={handleKeyDown}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
        >
          <motion.div
            style={{
              scaleX: useTransform(() => {
                if (!sliderRef.current) return 1;
                const { width } = sliderRef.current.getBoundingClientRect();
                return 1 + overflow.get() / width;
              }),
              scaleY: useTransform(overflow, [0, MAX_OVERFLOW], [1, 0.8]),
              transformOrigin: useTransform(() => {
                if (!sliderRef.current) return "left";
                const { left, width } = sliderRef.current.getBoundingClientRect();
                return clientX.get() < left + width / 2 ? "right" : "left";
              }),
              height: useTransform(scale, [1, 1.2], [6, 12]),
              marginTop: useTransform(scale, [1, 1.2], [0, -3]),
              marginBottom: useTransform(scale, [1, 1.2], [0, -3]),
            }}
            className="elastic-slider-track-wrapper"
          >
            <div className="elastic-slider-track">
              <div className="elastic-slider-range" style={{ width: `${rangePercentage}%` }} />
            </div>
          </motion.div>
        </div>

        <motion.div
          className="elastic-slider-icon"
          animate={{
            scale: region === "right" ? [1, 1.4, 1] : 1,
            transition: { duration: 0.25 },
          }}
          style={{
            x: useTransform(() => (region === "right" ? overflow.get() / scale.get() : 0)),
          }}
        >
          {rightIcon}
        </motion.div>
      </motion.div>
      {showValue ? (
        <p className="elastic-slider-value">{valueFormatter(value)}</p>
      ) : null}
    </>
  );
}
