// Btn — mono-uppercase button with growing arrow
// Variants: primary (default, ink bg) | ghost | small size
function Btn({ children, variant = "primary", size = "md", arrow = true, onClick, style }) {
  const isGhost = variant === "ghost";
  const isSmall = size === "sm";
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: isSmall ? "10px 16px" : "14px 22px",
    border: "1px solid var(--ink)",
    background: isGhost ? "transparent" : "var(--ink)",
    color: isGhost ? "var(--ink)" : "var(--bg)",
    fontFamily: "var(--f-mono)",
    fontSize: isSmall ? 10 : 11,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    cursor: "pointer",
    transition: "all 250ms var(--ease)",
    ...style,
  };
  const [hover, setHover] = React.useState(false);
  const arrowStyle = {
    width: hover ? 22 : 14,
    height: 1,
    background: "currentColor",
    position: "relative",
    transition: "width 250ms var(--ease)",
  };
  const arrowHead = {
    content: "",
    position: "absolute",
    right: 0,
    top: -3,
    width: 6,
    height: 6,
    borderTop: "1px solid currentColor",
    borderRight: "1px solid currentColor",
    transform: "rotate(45deg)",
  };
  // Hover fill: ghost -> fills ink; primary -> fills accent
  const hoverStyle = hover
    ? isGhost
      ? { background: "var(--ink)", color: "var(--bg)" }
      : { background: "var(--accent)", borderColor: "var(--accent)", color: "var(--ink)" }
    : {};
  return (
    <button
      style={{ ...base, ...hoverStyle }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    >
      {children}
      {arrow && (
        <span style={arrowStyle}>
          <span style={arrowHead}></span>
        </span>
      )}
    </button>
  );
}

Object.assign(window, { Btn });
