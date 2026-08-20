import { motion, useReducedMotion } from "motion/react";

function formatNumberParts(number, { decimalPlaces = 0, decimalSeparator = ".", thousandSeparator = "" } = {}) {
  const safeNumber = Number.isFinite(Number(number)) ? Number(number) : 0;
  const fixed = Math.abs(safeNumber).toFixed(Math.max(0, decimalPlaces));
  const [integer, decimal] = fixed.split(".");
  const grouped = thousandSeparator ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator) : integer;
  const prefix = safeNumber < 0 ? "-" : "";
  return `${prefix}${grouped}${decimal ? `${decimalSeparator}${decimal}` : ""}`;
}

function SlidingDigit({ digit, transition, reduceMotion, initiallyStable }) {
  if (!/\d/.test(digit)) return <span className="sliding-number-separator">{digit}</span>;
  const target = Number(digit);
  return (
    <span className="sliding-number-column" aria-hidden="true">
      <motion.span className="sliding-number-track" initial={initiallyStable ? false : { y: 0 }} animate={{ y: reduceMotion ? 0 : `-${target}em` }} transition={reduceMotion ? { duration: 0 } : transition}>
        {Array.from({ length: 10 }, (_, index) => <span className="sliding-number-glyph" key={index}>{index}</span>)}
      </motion.span>
    </span>
  );
}

/** Local Animate UI-compatible component adapted to the project's Motion + CSS stack. */
export function SlidingNumber({ number, decimalPlaces = 0, decimalSeparator = ".", thousandSeparator = "", transition = { type: "spring", stiffness: 200, damping: 20, mass: 0.4 }, initiallyStable = false, className = "", ...props }) {
  const reduceMotion = useReducedMotion();
  const formatted = formatNumberParts(number, { decimalPlaces, decimalSeparator, thousandSeparator });
  return <span {...props} className={`sliding-number ${className}`.trim()} role="text" aria-label={formatted}>{Array.from(formatted, (character, index) => <SlidingDigit digit={character} transition={transition} reduceMotion={reduceMotion} initiallyStable={initiallyStable} key={`${index}-${character}`} />)}</span>;
}

