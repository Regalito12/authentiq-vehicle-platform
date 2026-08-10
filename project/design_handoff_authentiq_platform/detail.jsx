// Vehicle detail screen — with history strip, live views, real map

// More realistic Polanco/CDMX map: real street grid pattern + labeled dealer
function RealisticMap({ vehicle }) {
  const { lang } = useT();
  // Approximate lat/lng of Polanco — we draw a symbolic but structured street layout
  return (
    <svg viewBox="0 0 500 340" xmlns="http://www.w3.org/2000/svg" style={{width: "100%", height: "100%", display: "block"}} preserveAspectRatio="xMidYMid slice">
      {/* Base */}
      <rect width="500" height="340" fill="#0e0d0a"/>

      {/* Park (Parque Lincoln — abstracted) */}
      <path d="M 100 60 L 200 55 L 210 130 L 105 135 Z" fill="#1a2418" opacity="0.9"/>
      <path d="M 100 60 L 200 55 L 210 130 L 105 135 Z" fill="none" stroke="#26311f" strokeWidth="0.5"/>
      <text x="150" y="98" fontFamily="ui-monospace, monospace" fontSize="7" fill="#4a5442" textAnchor="middle" letterSpacing="1">PARQUE</text>
      <text x="150" y="107" fontFamily="ui-monospace, monospace" fontSize="7" fill="#4a5442" textAnchor="middle" letterSpacing="1">LINCOLN</text>

      {/* Building blocks — real Polanco grid pattern */}
      <g fill="#1a1712">
        {/* North blocks */}
        <rect x="220" y="55" width="55" height="35"/>
        <rect x="285" y="55" width="60" height="35"/>
        <rect x="355" y="55" width="55" height="35"/>
        <rect x="420" y="55" width="60" height="35"/>
        {/* Row 2 */}
        <rect x="220" y="100" width="55" height="30"/>
        <rect x="285" y="100" width="60" height="30"/>
        <rect x="355" y="100" width="55" height="30"/>
        <rect x="420" y="100" width="60" height="30"/>
        {/* Row 3 */}
        <rect x="20" y="150" width="70" height="35"/>
        <rect x="100" y="150" width="55" height="35"/>
        <rect x="165" y="150" width="55" height="35"/>
        <rect x="230" y="150" width="55" height="35"/>
        <rect x="295" y="150" width="60" height="35"/>
        <rect x="365" y="150" width="55" height="35"/>
        <rect x="430" y="150" width="55" height="35"/>
        {/* Row 4 */}
        <rect x="20" y="195" width="70" height="35"/>
        <rect x="100" y="195" width="55" height="35"/>
        <rect x="165" y="195" width="55" height="35"/>
        <rect x="230" y="195" width="55" height="35"/>
        <rect x="295" y="195" width="60" height="35"/>
        <rect x="365" y="195" width="55" height="35"/>
        <rect x="430" y="195" width="55" height="35"/>
        {/* Row 5 */}
        <rect x="20" y="240" width="70" height="35"/>
        <rect x="100" y="240" width="55" height="35"/>
        <rect x="165" y="240" width="55" height="35"/>
        <rect x="230" y="240" width="55" height="35"/>
        <rect x="295" y="240" width="60" height="35"/>
        <rect x="365" y="240" width="55" height="35"/>
        <rect x="430" y="240" width="55" height="35"/>
        {/* Row 6 - south blocks */}
        <rect x="20" y="285" width="70" height="35"/>
        <rect x="100" y="285" width="55" height="35"/>
        <rect x="165" y="285" width="55" height="35"/>
        <rect x="230" y="285" width="60" height="35"/>
        <rect x="300" y="285" width="60" height="35"/>
        <rect x="370" y="285" width="55" height="35"/>
        <rect x="435" y="285" width="55" height="35"/>
      </g>

      {/* Roads (light color between blocks) */}
      <g stroke="#2a251d" strokeWidth="7" fill="none" opacity="0.85">
        {/* Masaryk — the big avenue */}
        <path d="M 0 140 L 500 138"/>
        {/* Ejército */}
        <path d="M 0 275 L 500 272"/>
        {/* Verticals */}
        <path d="M 92 0 L 95 340"/>
        <path d="M 355 0 L 358 340"/>
      </g>

      {/* Minor roads */}
      <g stroke="#221e17" strokeWidth="3" fill="none">
        <path d="M 0 92 L 500 90"/>
        <path d="M 0 187 L 500 185"/>
        <path d="M 0 232 L 500 230"/>
        <path d="M 157 0 L 160 340"/>
        <path d="M 220 0 L 223 340"/>
        <path d="M 285 0 L 288 340"/>
        <path d="M 420 0 L 423 340"/>
      </g>

      {/* Masaryk label */}
      <text x="14" y="134" fontFamily="ui-monospace, monospace" fontSize="8" fill="#5a5445" letterSpacing="1.5">AV. MASARYK</text>
      <text x="14" y="269" fontFamily="ui-monospace, monospace" fontSize="7" fill="#3d382e" letterSpacing="1">EJERCITO NACIONAL</text>

      {/* Route from user to dealer */}
      <path
        d="M 40 310 L 92 310 L 92 220 L 260 218 L 260 140 L 305 140"
        stroke="#c8a24b"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="5 4"
      />

      {/* Origin */}
      <g transform="translate(40, 310)">
        <circle r="14" fill="#f2eee7" opacity="0.15"/>
        <circle r="6" fill="#f2eee7"/>
        <circle r="3" fill="#0e0d0a"/>
      </g>

      {/* Destination */}
      <g transform="translate(305, 140)">
        <circle r="24" fill="#c8a24b" opacity="0.12"/>
        <circle r="14" fill="#c8a24b" opacity="0.22"/>
        <circle r="7" fill="#c8a24b"/>
        <path d="M 0 -22 L 3 -8 L 0 -12 L -3 -8 Z" fill="#c8a24b"/>
      </g>

      {/* Labels */}
      <g fontFamily="ui-monospace, monospace" letterSpacing="0.5">
        <text x="50" y="328" fontSize="9" fill="#f2eee7" fontWeight="500">TÚ</text>
        <text x="50" y="337" fontSize="6" fill="#8a857c">HOME · CDMX</text>

        <text x="317" y="130" fontSize="9" fill="#c8a24b" fontWeight="500">{vehicle.location.dealer.split(" ").slice(-1)[0].toUpperCase()}</text>
        <text x="317" y="139" fontSize="6" fill="#8a857c">{vehicle.location.dealer.split(" ").slice(0,-1).join(" ").toUpperCase()}</text>
      </g>

      {/* City badge */}
      <g transform="translate(12, 20)">
        <text fontFamily="ui-monospace, monospace" fontSize="8" fill="#5a5445" letterSpacing="2">CIUDAD DE MÉXICO · {vehicle.location.lat.toFixed(4)}° N</text>
      </g>

      {/* Compass */}
      <g transform="translate(465, 30)">
        <circle cx="0" cy="0" r="15" fill="rgba(10,10,10,0.5)" stroke="#5a5445" strokeWidth="0.5"/>
        <path d="M 0 -10 L 3 0 L 0 -3 L -3 0 Z" fill="#c8a24b"/>
        <text y="-19" fontFamily="ui-monospace, monospace" fontSize="9" fill="#8a857c" textAnchor="middle">N</text>
      </g>

      {/* Scale */}
      <g transform="translate(420, 320)">
        <line x1="0" y1="0" x2="40" y2="0" stroke="#8a857c" strokeWidth="1"/>
        <line x1="0" y1="-3" x2="0" y2="3" stroke="#8a857c" strokeWidth="1"/>
        <line x1="20" y1="-2" x2="20" y2="2" stroke="#8a857c" strokeWidth="1"/>
        <line x1="40" y1="-3" x2="40" y2="3" stroke="#8a857c" strokeWidth="1"/>
        <text x="20" y="15" fontFamily="ui-monospace, monospace" fontSize="7" fill="#8a857c" textAnchor="middle">500 m</text>
      </g>

      {/* ETA badge */}
      <g transform="translate(360, 195)">
        <rect x="-40" y="-12" width="80" height="24" fill="rgba(10,10,10,0.85)" stroke="#c8a24b" strokeWidth="0.5"/>
        <text fontFamily="ui-monospace, monospace" fontSize="9" fill="#c8a24b" textAnchor="middle" y="-1">12 MIN</text>
        <text fontFamily="ui-monospace, monospace" fontSize="6" fill="#8a857c" textAnchor="middle" y="8">EN AUTO</text>
      </g>
    </svg>
  );
}

function LocationMap({ vehicle }) {
  const { lang, t } = useT();
  return (
    <div className="location-block">
      <div className="location-info">
        <div>
          <h3>{t("location.title")}</h3>
          <div className="location-name">{vehicle.location.dealer}</div>
          <div className="location-addr mono">
            {vehicle.location.address.split("\n").map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
        <div className="location-meta">
          <div>
            <div className="k">{t("location.distance")}</div>
            <div className="v mono">{vehicle.location.distance}</div>
          </div>
          <div>
            <div className="k">{t("location.hours")}</div>
            <div className="v mono">{t("location.hours.val")}</div>
          </div>
          <div>
            <div className="k">{t("location.stock")}</div>
            <div className="v mono">● {vehicle.stock} {lang === "es" ? "en showroom" : "in showroom"}</div>
          </div>
          <div>
            <div className="k">{t("location.contact")}</div>
            <div className="v mono">{vehicle.location.phone}</div>
          </div>
        </div>
      </div>
      <div className="location-map">
        <RealisticMap vehicle={vehicle}/>
      </div>
    </div>
  );
}

function HistoryStrip({ vehicle }) {
  const { lang } = useT();
  const items = vehicle.kind === "used"
    ? [
      { icon: "✓", k: lang === "es" ? "Dueños" : "Owners", v: "1" },
      { icon: "✓", k: lang === "es" ? "Servicio" : "Service", v: lang === "es" ? "Al día" : "Up to date" },
      { icon: "✓", k: lang === "es" ? "Sin siniestros" : "No accidents", v: lang === "es" ? "Verificado" : "Verified" },
      { icon: "✓", k: lang === "es" ? "Certificación" : "Certification", v: lang === "es" ? "150 pts" : "150 pts" },
    ]
    : [
      { icon: "✓", k: lang === "es" ? "Garantía" : "Warranty", v: "4 años" },
      { icon: "✓", k: lang === "es" ? "Servicio incluido" : "Service incl.", v: "60,000 km" },
      { icon: "✓", k: lang === "es" ? "Asistencia" : "Assistance", v: "24/7" },
      { icon: "✓", k: lang === "es" ? "Origen" : "Origin", v: lang === "es" ? "Directo fábrica" : "Direct factory" },
    ];
  return (
    <div className="history-bar">
      {items.map((it, i) => (
        <div key={i} className="history-item">
          <div className="icon">{it.icon}</div>
          <div className="v">{it.v}</div>
          <div className="k">{it.k}</div>
        </div>
      ))}
    </div>
  );
}

function VehicleDetail({ vehicle, onBack, onOpenModal, viewerVariant }) {
  const { lang, t } = useT();
  const [selectedColor, setSelectedColor] = React.useState(vehicle.color);
  const [liveCount, setLiveCount] = React.useState(vehicle.views);

  // Simulate live view count fluctuation
  React.useEffect(() => {
    const iv = setInterval(() => {
      setLiveCount(c => c + Math.floor(Math.random() * 3) - 1);
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  const nameParts = vehicle.name[lang].split(" ");
  const firstPart = nameParts.slice(0, Math.ceil(nameParts.length / 2)).join(" ");
  const lastPart = nameParts.slice(Math.ceil(nameParts.length / 2)).join(" ");

  return (
    <div className="screen active" data-screen-label="02 Detail">
      <div className="detail">
        {/* Head */}
        <div className="detail-head">
          <div>
            <div className="detail-breadcrumb">
              <span onClick={onBack} style={{cursor:"pointer"}}>{t("detail.crumb.catalog")}</span>
              <span className="sep">/</span>
              <span>{vehicle.brand}</span>
              <span className="sep">/</span>
              <span>{vehicle.model}</span>
            </div>
            <h1 className="detail-title">
              {firstPart} <span className="italic">{lastPart}</span>
            </h1>
            <div style={{marginTop: 14, display: "flex", gap: 12, alignItems: "center"}}>
              <span className="mono" style={{fontSize: 12, color: "var(--muted)", letterSpacing: "0.05em"}}>
                {vehicle.tagline[lang]}
              </span>
              <span className="live-count">
                {liveCount} {lang === "es" ? "personas viendo ahora" : "people viewing now"}
              </span>
            </div>
          </div>
          <div className="detail-price-block">
            <div className="label">{t("detail.price.asking")}</div>
            <div className="detail-price mono">${vehicle.price.toLocaleString()}<span style={{fontSize:14,color:"var(--muted)",marginLeft:4}}>{vehicle.priceLabel[lang]}</span></div>
            <div className="mono" style={{fontSize: 10, color: "var(--muted)", marginTop: 6, letterSpacing: "0.08em", textTransform: "uppercase"}}>
              {lang === "es" ? "· o desde " : "· from "}${Math.round(vehicle.price / 60).toLocaleString()}/mes
            </div>
          </div>
        </div>

        {/* Main grid */}
        <div className="detail-main">
          <div>
            <Viewer360 vehicle={vehicle} selectedColor={selectedColor} variant={viewerVariant}/>
            <ColorPicker vehicle={vehicle} selected={selectedColor} onSelect={setSelectedColor}/>
          </div>

          <div className="detail-side">
            {/* Specs */}
            <div className="side-block">
              <h3>
                <span>{t("detail.specs")}</span>
                <span className="idx mono">01</span>
              </h3>
              {Object.entries(vehicle.specs).map(([k, v]) => (
                <div key={k} className="spec-row">
                  <span className="k">{t(`detail.specs.${k}`)}</span>
                  <span className="v">{v}</span>
                </div>
              ))}
              <HistoryStrip vehicle={vehicle}/>
            </div>

            {/* Actions */}
            <div className="side-block">
              <h3>
                <span>{t("detail.actions")}</span>
                <span className="idx mono">02</span>
              </h3>
              <div className="actions-grid">
                <button className="action-btn primary" onClick={() => onOpenModal("calendar")}>
                  <span className="action-icon">→</span>
                  <span className="action-title">{t("detail.action.testdrive")}</span>
                  <span className="action-sub">{t("detail.action.testdrive.sub")}</span>
                </button>
                <button className="action-btn" onClick={() => onOpenModal("chat")}>
                  <span className="action-icon">◐</span>
                  <span className="action-title">{t("detail.action.chat")}</span>
                  <span className="action-sub">{t("detail.action.chat.sub")}</span>
                </button>
                <button className="action-btn" onClick={() => onOpenModal("offer")}>
                  <span className="action-icon">$</span>
                  <span className="action-title">{t("detail.action.offer")}</span>
                  <span className="action-sub">{t("detail.action.offer.sub")}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Location */}
        <LocationMap vehicle={vehicle}/>
      </div>
    </div>
  );
}

Object.assign(window, { VehicleDetail, LocationMap, RealisticMap, HistoryStrip });
