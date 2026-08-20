import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

export function TextReveal({ children, className = "", delay = 0 }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 10, filter: "blur(5px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.42, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.span>
  );
}

export function BlurFade({ children, className = "", delay = 0, duration = 0.48, y = 12, inView = true }) {
  const reduceMotion = useReducedMotion();
  return <motion.div className={className} initial={reduceMotion ? false : { opacity: 0, y, filter: "blur(7px)" }} {...(inView ? { whileInView: { opacity: 1, y: 0, filter: "blur(0px)" }, viewport: { once: true, amount: 0.12 } } : { animate: { opacity: 1, y: 0, filter: "blur(0px)" } })} transition={reduceMotion ? { duration: 0 } : { duration, delay, ease: [0.22, 1, 0.36, 1] }}>{children}</motion.div>;
}

export function AnimatedList({ items = [], renderItem, getKey = (item, index) => item?.id ?? index, className = "", itemClassName = "" }) {
  const reduceMotion = useReducedMotion();
  return <motion.div className={`animated-list ${className}`.trim()} layout><AnimatePresence initial={false} mode="popLayout">{items.map((item, index) => <motion.div className={itemClassName} key={getKey(item, index)} layout initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -8 }} transition={reduceMotion ? { duration: 0 } : { duration: 0.28, delay: Math.min(index * 0.035, 0.14), ease: [0.22, 1, 0.36, 1] }}>{renderItem(item, index)}</motion.div>)}</AnimatePresence></motion.div>;
}

export function ProgressiveBlur({ children, className = "", direction = "horizontal" }) {
  return <div className={`progressive-blur progressive-blur-${direction} ${className}`.trim()}>{children}</div>;
}

export function AnimatedNumber({ value, suffix = "", duration = 850, format = (number) => number.toLocaleString("en-US") }) {
  const reduceMotion = useReducedMotion();
  const target = Number(value) || 0;
  const [current, setCurrent] = useState(reduceMotion ? target : 0);

  useEffect(() => {
    if (reduceMotion) {
      setCurrent(target);
      return undefined;
    }
    let frame;
    const startedAt = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, reduceMotion, target]);

  return <span className="motion-animated-number" aria-label={`${target}${suffix}`}>{format(current)}{suffix}</span>;
}

export function Disclosure({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const reduceMotion = useReducedMotion();
  return (
    <div className={`motion-disclosure${open ? " is-open" : ""}`}>
      <button type="button" className="motion-disclosure-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>{title}</span>
        <span aria-hidden="true" className="motion-disclosure-icon">+</span>
      </button>
      <motion.div
        className="motion-disclosure-panel"
        initial={false}
        animate={open ? { gridTemplateRows: "1fr", opacity: 1 } : { gridTemplateRows: "0fr", opacity: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="motion-disclosure-content">{children}</div>
      </motion.div>
    </div>
  );
}
