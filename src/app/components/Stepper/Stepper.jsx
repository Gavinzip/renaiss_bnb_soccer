import { Children, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import "./Stepper.css";

export function Step({ children }) {
  return children;
}

export default function Stepper({
  children,
  initialStep = 1,
  onStepChange = () => {},
  onFinalStepCompleted = () => {},
  stepCircleContainerClassName = "",
  stepContainerClassName = "",
  contentClassName = "",
  footerClassName = "",
  backButtonProps = {},
  nextButtonProps = {},
  backButtonText = "Back",
  nextButtonText = "Continue",
  disableStepIndicators = false,
  renderStepIndicator,
}) {
  const steps = useMemo(() => Children.toArray(children).filter(Boolean), [children]);
  const [currentStep, setCurrentStep] = useState(() => Math.min(Math.max(initialStep, 1), Math.max(steps.length, 1)));
  const totalSteps = steps.length;
  const isFirstStep = currentStep <= 1;
  const isFinalStep = currentStep >= totalSteps;

  useEffect(() => {
    setCurrentStep(Math.min(Math.max(initialStep, 1), Math.max(totalSteps, 1)));
  }, [initialStep, totalSteps]);

  useEffect(() => {
    onStepChange(currentStep);
  }, [currentStep, onStepChange]);

  function goToStep(step) {
    const nextStep = Math.min(Math.max(step, 1), totalSteps);
    setCurrentStep(nextStep);
  }

  function handleNext() {
    if (isFinalStep) {
      onFinalStepCompleted();
      return;
    }
    goToStep(currentStep + 1);
  }

  function handleBack() {
    if (isFirstStep) return;
    goToStep(currentStep - 1);
  }

  if (totalSteps === 0) return null;

  return (
    <section
      className={["rb-stepper", stepCircleContainerClassName].filter(Boolean).join(" ")}
      style={{ "--step-count": totalSteps }}
    >
      <ol className={["rb-stepper__steps", stepContainerClassName].filter(Boolean).join(" ")}>
        {steps.map((_, index) => {
          const stepNumber = index + 1;
          const state = stepNumber === currentStep ? "active" : stepNumber < currentStep ? "complete" : "pending";
          return (
            <li className={`rb-stepper__item is-${state}`} key={stepNumber}>
              <button
                type="button"
                disabled={disableStepIndicators}
                aria-current={stepNumber === currentStep ? "step" : undefined}
                onClick={() => goToStep(stepNumber)}
              >
                {renderStepIndicator
                  ? renderStepIndicator({ step: stepNumber, currentStep, state })
                  : <span>{stepNumber}</span>}
              </button>
              {stepNumber < totalSteps ? <i aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>

      <div className={["rb-stepper__content", contentClassName].filter(Boolean).join(" ")}>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            {steps[currentStep - 1]}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className={["rb-stepper__footer", footerClassName].filter(Boolean).join(" ")}>
        <button
          type="button"
          {...backButtonProps}
          disabled={isFirstStep || backButtonProps.disabled}
          onClick={(event) => {
            backButtonProps.onClick?.(event);
            if (!event.defaultPrevented) handleBack();
          }}
        >
          {backButtonText}
        </button>
        <button
          type="button"
          {...nextButtonProps}
          onClick={(event) => {
            nextButtonProps.onClick?.(event);
            if (!event.defaultPrevented) handleNext();
          }}
        >
          {nextButtonText}
        </button>
      </footer>
    </section>
  );
}
