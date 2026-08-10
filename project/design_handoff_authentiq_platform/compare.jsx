// Side-by-side vehicle comparator

function CompareModal({ vehicles, allVehicles, onClose, onAdd, onRemove }) {
  const { lang, t } = useT();
  const maxSlots = 3;
  const filled = vehicles;
  const empty = maxSlots - filled.length;

  // Extract numeric power for "best" highlight
  const powerNum = (v) => parseInt(v.specs.power) || 0;
  const accelNum = (v) => parseFloat(v.specs.accel) || 99;
  const priceNum = (v) => v.price;
  const topspeedNum = (v) => parseInt(v.specs.topspeed) || 0;

  const bestOf = (key, fn, dir = "max") => {
    if (filled.length === 0) return null;
    const values = filled.map(fn);
    return dir === "max" ? Math.max(...values) : Math.min(...values);
  };

  const bestPower = bestOf("power", powerNum, "max");
  const bestAccel = bestOf("accel", accelNum, "min");
  const bestPrice = bestOf("price", priceNum, "min");
  const bestSpeed = bestOf("topspeed", topspeedNum, "max");

  const specRows = [
    { k: t("detail.specs.engine"), get: v => v.specs.engine, best: null },
    { k: t("detail.specs.power"), get: v => v.specs.power, best: v => powerNum(v) === bestPower },
    { k: t("detail.specs.torque"), get: v => v.specs.torque, best: null },
    { k: t("detail.specs.accel"), get: v => v.specs.accel, best: v => accelNum(v) === bestAccel },
    { k: t("detail.specs.topspeed"), get: v => v.specs.topspeed, best: v => topspeedNum(v) === bestSpeed },
    { k: t("detail.specs.transmission"), get: v => v.specs.transmission, best: null },
    { k: t("detail.specs.drive"), get: v => v.specs.drive, best: null },
    { k: t("detail.specs.year"), get: v => v.specs.year, best: null },
    { k: t("detail.specs.kms"), get: v => v.specs.kms, best: null },
    { k: lang === "es" ? "Precio" : "Price", get: v => "$" + v.price.toLocaleString(), best: v => priceNum(v) === bestPrice },
    { k: lang === "es" ? "Concesionario" : "Dealer", get: v => v.location.dealer, best: null },
  ];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal compare-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{lang === "es" ? "Comparador de vehículos" : "Vehicle comparator"}</h2>
            <div className="sub">{lang === "es" ? `Compara hasta ${maxSlots} vehículos lado a lado` : `Compare up to ${maxSlots} vehicles side by side`}</div>
          </div>
          <button className="modal-close" onClick={onClose} style={{position:"relative"}}></button>
        </div>
        <div className="modal-body">
          {/* Slot picker */}
          <div className="compare-picker">
            {filled.map(v => (
              <div key={v.id} className="compare-slot filled">
                <div className="compare-slot-img">
                  <img src={v.image} alt={v.name[lang]}/>
                </div>
                <div className="compare-slot-info">
                  <div className="n">{v.name[lang]}</div>
                  <div className="p">${v.price.toLocaleString()} · {v.specs.year}</div>
                </div>
                <button className="compare-slot-remove" onClick={() => onRemove(v.id)}>×</button>
              </div>
            ))}
            {[...Array(empty)].map((_, i) => (
              <div key={`e${i}`} className="compare-slot">
                <div style={{fontSize: 24, color: "var(--line)"}}>+</div>
                <div>{lang === "es" ? "Añadir vehículo" : "Add vehicle"}</div>
              </div>
            ))}
          </div>

          {/* Available to add */}
          {filled.length < maxSlots && (
            <div className="compare-picker-list">
              {allVehicles.map(v => {
                const already = filled.find(f => f.id === v.id);
                return (
                  <button
                    key={v.id}
                    onClick={() => !already && onAdd(v.id)}
                    disabled={!!already}
                  >
                    <img src={v.image} alt=""/>
                    <div style={{overflow: "hidden"}}>
                      <div className="cn">{v.name[lang]}</div>
                      <div className="cp">${v.price.toLocaleString()}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Compare table */}
          {filled.length >= 2 ? (
            <div className="compare-table">
              <div className="compare-row head">
                <div className="k">{lang === "es" ? "Vehículo" : "Vehicle"}</div>
                {filled.map(v => (
                  <div key={v.id} className="v">
                    <span>{v.name[lang]}</span>
                    <span className="sub">{v.specs.year} · {v.kind === "new" ? t("catalog.tag.new") : t("catalog.tag.certified")}</span>
                  </div>
                ))}
                {[...Array(maxSlots - filled.length)].map((_, i) => (
                  <div key={`h${i}`} className="v" style={{opacity: 0.3}}>—</div>
                ))}
              </div>
              {specRows.map((row, i) => (
                <div key={i} className="compare-row">
                  <div className="k">{row.k}</div>
                  {filled.map(v => (
                    <div key={v.id} className={`v ${row.best && row.best(v) ? "best" : ""}`}>
                      {row.get(v)}
                    </div>
                  ))}
                  {[...Array(maxSlots - filled.length)].map((_, i) => (
                    <div key={`e${i}`} className="v" style={{opacity: 0.3}}>—</div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              padding: "40px 20px",
              textAlign: "center",
              fontFamily: "var(--f-mono)",
              fontSize: 12,
              color: "var(--muted)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              border: "1px dashed var(--line)"
            }}>
              {lang === "es"
                ? `Añade al menos 2 vehículos para comparar (${filled.length}/${maxSlots})`
                : `Add at least 2 vehicles to compare (${filled.length}/${maxSlots})`}
            </div>
          )}

          <div style={{marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 8}}>
            <button className="btn ghost small" onClick={onClose}>{lang === "es" ? "Cerrar" : "Close"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CompareModal });
