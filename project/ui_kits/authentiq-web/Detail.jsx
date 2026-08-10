function Detail({ vehicle, onBack }) {
  const [colorIdx, setColorIdx] = React.useState(0);
  const [imgIdx, setImgIdx] = React.useState(0);
  const [liveCount, setLiveCount] = React.useState(vehicle.views);
  React.useEffect(() => {
    const id = setInterval(() => setLiveCount(c => c + Math.floor(Math.random()*3) - 1), 4000);
    return () => clearInterval(id);
  }, []);
  const color = vehicle.colors[colorIdx];
  const italicWord = vehicle.model.split(" ").pop();
  const beforeItalic = vehicle.model.slice(0, vehicle.model.length - italicWord.length).trim();

  const historyItems = vehicle.kind === "used"
    ? [
        { v: "1", k: "Dueños" },
        { v: "Al día", k: "Servicio" },
        { v: "Verificado", k: "Sin siniestros" },
        { v: "150 pts", k: "Certificación" },
      ]
    : [
        { v: "4 años", k: "Garantía" },
        { v: "60,000 km", k: "Servicio incluido" },
        { v: "24/7", k: "Asistencia" },
        { v: "Directo", k: "Origen fábrica" },
      ];

  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <div className="detail-breadcrumb">
            <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",font:"inherit",color:"inherit",padding:0}}>Catálogo</button>
            <span className="sep">/</span>{vehicle.kind === "new" ? "Nuevos" : "Seminuevos"}
            <span className="sep">/</span>{vehicle.brand}
          </div>
          <h1 className="detail-title">
            {beforeItalic ? <>{beforeItalic} </> : null}<span className="italic">{italicWord}</span>
          </h1>
          <div style={{marginTop: 12, fontFamily:"var(--f-mono)", fontSize:12, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.05em"}}>
            {vehicle.tagline}
          </div>
          <div style={{marginTop: 16}}>
            <div className="live-count">{liveCount} viendo ahora</div>
          </div>
        </div>
        <div className="detail-price-block">
          <div className="label">Precio de venta</div>
          <div className="detail-price">
            <span style={{fontSize: 14, color: "var(--muted)", marginRight: 6}}>USD</span>
            ${vehicle.price.toLocaleString()}
          </div>
          <div style={{marginTop: 8, fontFamily:"var(--f-mono)", fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.08em"}}>
            o desde ${Math.round(vehicle.price/60).toLocaleString()}/mes
          </div>
        </div>
      </div>

      <div className="detail-main">
        {/* LEFT — gallery viewer */}
        <div>
          <div className="viewer" style={{position:"relative"}}>
            <div style={{position:"absolute", inset:0, background:"var(--bg-alt)"}}>
              <img
                src={vehicle.images[imgIdx]}
                alt=""
                style={{width:"100%", height:"100%", objectFit:"cover", display:"block"}}
              />
            </div>
            {/* Color tint overlay */}
            <div style={{
              position:"absolute", inset:0,
              background: color.hex,
              mixBlendMode:"multiply",
              opacity: 0.22,
              pointerEvents:"none",
            }} />
            <div className="viewer-modes">
              <button className="active">Galería</button>
              <button>360°</button>
              <button>Interior</button>
            </div>
            <div className="viewer-hud">
              <div className="viewer-badge"><span className="pulse"></span>En vivo</div>
              <div className="viewer-rot-indicator">
                <span>{String(imgIdx+1).padStart(2,"0")} / {String(vehicle.images.length).padStart(2,"0")}</span>
              </div>
            </div>
          </div>

          {/* Thumbnail strip */}
          <div style={{display:"grid", gridTemplateColumns:`repeat(${vehicle.images.length}, 1fr)`, gap: 6, marginTop: 6}}>
            {vehicle.images.map((src, i) => (
              <button
                key={i}
                onClick={() => setImgIdx(i)}
                style={{
                  aspectRatio: "4/3",
                  border: i === imgIdx ? "2px solid var(--accent)" : "1px solid var(--line-2)",
                  padding: 0,
                  background: "var(--bg-alt)",
                  cursor: "pointer",
                  overflow: "hidden",
                }}
              >
                <img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block",filter: i===imgIdx ? "none" : "brightness(0.85)"}}/>
              </button>
            ))}
          </div>

          {/* Color picker */}
          <div className="color-picker">
            <div className="color-picker-head">
              <span className="label">Color exterior</span>
              <span className="name">{color.name}</span>
            </div>
            <div className="color-swatches">
              {vehicle.colors.map((c, i) => (
                <div
                  key={i}
                  className={"swatch" + (i === colorIdx ? " active" : "")}
                  style={{background: c.hex}}
                  onClick={() => setColorIdx(i)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — specs & actions */}
        <div className="detail-side">
          <div className="side-block">
            <h3><span>Especificaciones</span><span className="idx">01</span></h3>
            {Object.entries(vehicle.specs).map(([k,v]) => (
              <div key={k} className="spec-row">
                <span className="k">{k}</span>
                <span className="v">{v}</span>
              </div>
            ))}
            <div className="history-bar">
              {historyItems.map((it, i) => (
                <div key={i} className="history-item">
                  <div className="icon">✓</div>
                  <div className="v">{it.v}</div>
                  <div className="k">{it.k}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="side-block">
            <h3><span>Acciones</span><span className="idx">02</span></h3>
            <div className="actions-grid">
              <button className="action-btn primary">
                <div className="action-icon">→</div>
                <div className="action-title">Test drive</div>
                <div className="action-sub">Reservar cita</div>
              </button>
              <button className="action-btn">
                <div className="action-icon">01</div>
                <div className="action-title">Chat en vivo</div>
                <div className="action-sub">Asesor disponible</div>
              </button>
              <button className="action-btn">
                <div className="action-icon">02</div>
                <div className="action-title">Hacer oferta</div>
                <div className="action-sub">Enviar propuesta</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Detail });
