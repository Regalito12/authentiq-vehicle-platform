import { motion } from "motion/react";

export function AnimatedThemeTogglerStarDemo({ theme, onToggle }) {
  const isDark = theme === "dark";

  return (
    <motion.button
      className="animated-theme-toggler-star"
      type="button"
      aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      aria-pressed={isDark}
      onClick={onToggle}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 420, damping: 24 }}
    >
      <motion.span
        className="animated-theme-toggler-star-core"
        animate={{ rotate: isDark ? 180 : 0, scale: isDark ? 0.82 : 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" role="presentation">
          <path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z" />
          <path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" />
        </svg>
      </motion.span>
      <span className="animated-theme-toggler-label">{isDark ? "Claro" : "Oscuro"}</span>
    </motion.button>
  );
}
