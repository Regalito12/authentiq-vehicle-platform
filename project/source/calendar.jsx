// Calendar modal for booking test drives

function Calendar({ vehicle, onClose, onConfirm }) {
  const { lang, t } = useT();
  const [monthOffset, setMonthOffset] = React.useState(0);
  const [selected, setSelected] = React.useState(null); // Date
  const [slot, setSlot] = React.useState(null);

  const today = new Date();
  const year = today.getFullYear();
  const monthIdx = today.getMonth() + monthOffset;
  const monthDate = new Date(year, monthIdx, 1);
  const monthName = monthDate.toLocaleDateString(lang === "es" ? "es-ES" : "en-US", { month: "long", year: "numeric" });

  // Build grid (Monday-first)
  const firstDay = new Date(year, monthIdx, 1);
  const lastDay = new Date(year, monthIdx + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDow = (firstDay.getDay() + 6) % 7; // Mon=0
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, monthIdx, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const dayLabels = ["cal.day.mon","cal.day.tue","cal.day.wed","cal.day.thu","cal.day.fri","cal.day.sat","cal.day.sun"];

  const isPast = (d) => {
    if (!d) return true;
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return d < t0;
  };
  const isToday = (d) => d && d.toDateString() === today.toDateString();
  const isSunday = (d) => d && d.getDay() === 0;

  // Fake slot count per day (deterministic)
  const slotCount = (d) => {
    if (!d || isPast(d) || isSunday(d)) return 0;
    return ((d.getDate() * 7) % 6) + 2;
  };

  // Time slots for selected day
  const timeSlots = ["09:30", "10:15", "11:00", "12:00", "13:30", "14:15", "15:00", "16:30"];
  const takenSlots = selected ? [(selected.getDate() % 8), ((selected.getDate() * 3) % 8)] : [];

  const dateStr = selected
    ? selected.toLocaleDateString(lang === "es" ? "es-ES" : "en-US", { weekday: "long", day: "numeric", month: "long" })
    : "";

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{t("cal.title")}</h2>
            <div className="sub">{t("cal.sub")} · {vehicle.name[lang]}</div>
          </div>
          <button className="modal-close" onClick={onClose} style={{position:"relative"}}></button>
        </div>
        <div className="modal-body">
          <div className="cal-head">
            <div className="cal-month">
              {monthName.charAt(0).toUpperCase() + monthName.slice(1)}
              <span className="mono">{String(monthIdx + 1).padStart(2,"0")} / {year}</span>
            </div>
            <div className="cal-nav">
              <button onClick={() => setMonthOffset(m => Math.max(0, m-1))} disabled={monthOffset === 0}>‹</button>
              <button onClick={() => setMonthOffset(m => m+1)}>›</button>
            </div>
          </div>

          <div className="cal-week">
            {dayLabels.map(k => <div key={k} className="cal-daylabel">{t(k)}</div>)}
          </div>

          <div className="cal-grid">
            {cells.map((d, i) => {
              const disabled = !d || isPast(d) || isSunday(d);
              const isSel = selected && d && d.toDateString() === selected.toDateString();
              const count = slotCount(d);
              return (
                <div
                  key={i}
                  className={`cal-cell ${disabled ? "disabled" : ""} ${isToday(d) ? "today" : ""} ${isSel ? "selected" : ""}`}
                  onClick={() => !disabled && setSelected(d)}
                  style={{visibility: d ? "visible" : "hidden"}}
                >
                  <span className="day">{d ? d.getDate() : ""}</span>
                  {d && !disabled && (
                    <span className="slots">{count} {count === 1 ? t("cal.slot") : t("cal.slots")}</span>
                  )}
                </div>
              );
            })}
          </div>

          {selected && (
            <div className="cal-slots">
              <div className="cal-slots-head">
                <span>{t("cal.available")} — <span style={{color:"var(--ink)"}}>{dateStr}</span></span>
                <span className="mono">{timeSlots.length - takenSlots.length} / {timeSlots.length}</span>
              </div>
              <div className="slots-grid">
                {timeSlots.map((s, i) => (
                  <button
                    key={s}
                    className={`slot-btn ${slot === s ? "selected" : ""} ${takenSlots.includes(i) ? "taken" : ""}`}
                    onClick={() => !takenSlots.includes(i) && setSlot(s)}
                    disabled={takenSlots.includes(i)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="cal-actions">
            <div className="cal-summary">
              {selected && slot ? (
                <>{t("cal.summary")} <span className="highlight">{dateStr} · {slot}</span></>
              ) : (
                t("cal.select_date")
              )}
            </div>
            <div style={{display:"flex", gap: 8}}>
              <button className="btn ghost small" onClick={onClose}>{t("cal.cancel")}</button>
              <button className="btn small" disabled={!selected || !slot} onClick={() => onConfirm({date: selected, time: slot})} style={{opacity: (!selected || !slot) ? 0.4 : 1}}>
                {t("cal.confirm")} <span className="arrow"></span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Calendar });
