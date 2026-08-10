// Top nav + Home screen — with real images

function Nav({ current, onNav, mode, setMode }) {
  const { lang, setLang, t } = useT();
  return (
    <nav className="nav">
      <div className="logo">AUTHENTIQ</div>

      <div className="nav-links">
        <button className={current === "home" ? "active" : ""} onClick={() => onNav("home")}>{t("nav.models")}</button>
        <button onClick={() => onNav("home")}>{t("nav.new")}</button>
        <button onClick={() => onNav("home")}>{t("nav.used")}</button>
        <button onClick={() => onNav("home")}>{t("nav.dealers")}</button>
        <button onClick={() => onNav("home")}>{t("nav.about")}</button>
      </div>

      <div className="nav-right">
        <div className="mode-toggle">
          <button className={mode === "buyer" ? "active" : ""} onClick={() => setMode("buyer")}>{t("mode.buyer")}</button>
          <button className={mode === "dealer" ? "active" : ""} onClick={() => setMode("dealer")}>{t("mode.dealer")}</button>
        </div>
        <button className="lang-toggle" onClick={() => setLang(lang === "es" ? "en" : "es")}>
          {lang === "es" ? "ES / EN" : "EN / ES"}
        </button>
      </div>
    </nav>
  );
}

function Home({ onSelectVehicle, compareIds = [], onToggleCompare = () => {} }) {
  const { lang, t } = useT();
  const [filter, setFilter] = React.useState("all");
  const hero = VEHICLES[0]; // 911 GT3

  const filtered = VEHICLES.filter(v => {
    if (filter === "all") return true;
    if (filter === "new" || filter === "used") return v.kind === filter;
    if (filter === "sport") return v.type === "sports";
    if (filter === "suv") return v.type === "suv";
    return true;
  });

  return (
    <div className="screen active" data-screen-label="01 Home">
      {/* HERO */}
      <section className="hero">
        <div className="hero-bg">
          <img src="assets/hero-highway.jpg" alt=""/>
        </div>

        <div className="hero-meta">
          <div className="stamp">
            <span className="dot"></span>
            <span>{t("hero.eyebrow")}</span>
          </div>
          <div>№ 001 / 008</div>
        </div>

        <h1 className="hero-title">
          <span className="thin">{t("hero.title.line1")}</span> {t("hero.title.line2")}<br/>
          <span className="accent">{t("hero.title.line3")}</span>
        </h1>

        <div className="hero-vehicle">
          <img src={hero.image} alt={hero.name[lang]}/>
        </div>

        <div className="hero-bottom">
          <p className="hero-copy">{t("hero.copy")}</p>
          <div className="hero-cta">
            <button className="btn" onClick={() => onSelectVehicle(hero)}>
              {t("hero.cta.explore")} <span className="arrow"></span>
            </button>
            <button className="btn ghost" onClick={() => onSelectVehicle(hero)}>
              {t("hero.cta.book")}
            </button>
          </div>
          <div className="hero-index">
            <span className="big mono">{String(VEHICLES.length).padStart(2,"0")}</span>
            <span>{lang === "es" ? "modelos disponibles" : "models available"}</span>
          </div>
        </div>
      </section>

      {/* CATALOG */}
      <section className="catalog">
        <div className="catalog-head">
          <h2>{t("catalog.title")}</h2>
          <div className="filter-row">
            {["all", "new", "used", "sport", "suv"].map(f => (
              <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                {t(`catalog.filter.${f}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="catalog-grid">
          {filtered.map(v => {
            const inCompare = compareIds.includes(v.id);
            return (
              <div key={v.id} className="card" onClick={() => onSelectVehicle(v)}>
                <div className="card-img">
                  <img src={v.image} alt={v.name[lang]}/>
                  <span className={`card-tag ${v.kind}`}>
                    {v.kind === "new" ? t("catalog.tag.new") : t("catalog.tag.certified")}
                  </span>
                  <div className="card-meta">
                    <span className="views">{v.views} {lang === "es" ? "vistas hoy" : "views today"}</span>
                    <span>{v.stock} {lang === "es" ? "disp." : "avail."}</span>
                  </div>
                </div>
                <div className="card-info">
                  <div>
                    <div className="card-title">{v.name[lang]}</div>
                    <div className="card-sub">{v.specs.year} · {v.specs.power.split(" ").slice(0,2).join(" ")}</div>
                  </div>
                  <div className="card-price">
                    <span className="label">{t("catalog.price.from")}</span>
                    ${v.price.toLocaleString()}
                  </div>
                </div>
                <button
                  className="btn ghost small"
                  style={{marginTop: 12, width: "100%", justifyContent: "center"}}
                  onClick={(e) => { e.stopPropagation(); onToggleCompare(v.id); }}
                >
                  {inCompare
                    ? (lang === "es" ? "✓ En comparador" : "✓ In compare")
                    : (lang === "es" ? "+ Comparar" : "+ Compare")}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* REVIEWS */}
      <section className="reviews-section">
        <div className="reviews-head">
          <h2>
            {lang === "es" ? "Clientes que" : "Clients who"}
            <br/>
            <span className="italic">{lang === "es" ? "confían." : "trust."}</span>
          </h2>
          <div className="reviews-summary">
            <div className="big mono">4.9<span className="out">/5</span></div>
            <div className="stars">★★★★★</div>
            <div className="label">
              {lang === "es" ? "· 1,247 reseñas verificadas" : "· 1,247 verified reviews"}
            </div>
          </div>
        </div>

        <div className="reviews-grid">
          {REVIEWS.map(r => (
            <div key={r.id} className="review-card">
              <div className="review-stars">{"★".repeat(r.rating)}</div>
              <p className="review-text">"{r.text[lang]}"</p>
              <div className="review-vehicle">— {r.vehicle}</div>
              <div className="review-author">
                <div className="review-avatar">
                  <img src={r.avatar} alt={r.name}/>
                </div>
                <div>
                  <div className="name">{r.name}</div>
                  <div className="role">{r.role[lang]}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

Object.assign(window, { Nav, Home });
