function Home({ onOpen }) {
  const [filter, setFilter] = React.useState("all");
  const filters = [
    { id: "all",   label: "Todos" },
    { id: "new",   label: "Nuevos" },
    { id: "used",  label: "Seminuevos" },
    { id: "sport", label: "Deportivos" },
    { id: "suv",   label: "SUV" },
  ];
  const filtered = CATALOG.filter(v => {
    if (filter === "all") return true;
    if (filter === "new" || filter === "used") return v.kind === filter;
    return true;
  });

  // Live count animation for hero
  const [views, setViews] = React.useState(1247);
  React.useEffect(() => {
    const id = setInterval(() => setViews(v => v + Math.floor(Math.random()*3) - 1), 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      {/* HERO */}
      <section className="hero">
        <div className="hero-bg">
          <img src="../../assets/hero-highway.jpg" alt="" />
        </div>
        <div className="hero-meta">
          <div className="stamp"><span className="dot"></span>Ed. 2026 — Colección de otoño</div>
          <div>№ 001 / 008</div>
        </div>
        <h1 className="hero-title">
          <span className="thin">Conducir</span> es<br />
          <span className="accent">elegir.</span>
        </h1>
        <div className="hero-vehicle" style={{width: "48%", maxWidth: 760, right: 40, top: "58%"}}>
          <img src="../../assets/porsche-911-st.jpg" alt="" style={{filter:"drop-shadow(0 30px 60px rgba(10,10,10,0.35))", objectFit:"cover"}} />
        </div>
        <div className="hero-bottom">
          <p className="hero-copy">
            Una plataforma para descubrir, configurar y adquirir vehículos con la misma precisión con la que fueron diseñados. Cada modelo, verificado. Cada oferta, transparente.
          </p>
          <div className="hero-cta">
            <Btn onClick={() => window.scrollTo({top: 900, behavior: "smooth"})}>Explorar catálogo</Btn>
            <Btn variant="ghost">Agendar visita</Btn>
          </div>
          <div className="hero-index">
            <span className="big">{filtered.length.toString().padStart(2,"0")}</span>
            modelos disponibles
          </div>
        </div>
      </section>

      {/* CATALOG */}
      <section className="catalog">
        <div className="catalog-head">
          <h2>Catálogo activo</h2>
          <div className="filter-row">
            {filters.map(f => (
              <button
                key={f.id}
                className={filter === f.id ? "active" : ""}
                onClick={() => setFilter(f.id)}
              >{f.label}</button>
            ))}
          </div>
        </div>
        <div className="catalog-grid">
          {filtered.map(v => (
            <Card key={v.id} vehicle={v} onOpen={onOpen} />
          ))}
        </div>
      </section>

      {/* REVIEWS */}
      <section className="reviews-section">
        <div className="reviews-head">
          <h2>Clientes que <span className="italic">confían.</span></h2>
          <div className="reviews-summary">
            <div className="big">4.9<span className="out">/5</span></div>
            <div className="stars">★★★★★</div>
            <div className="label">· {views.toLocaleString()} reseñas verificadas</div>
          </div>
        </div>
        <div className="reviews-grid">
          {REVIEWS.map(r => <ReviewCard key={r.id} review={r} />)}
        </div>
      </section>
    </div>
  );
}

Object.assign(window, { Home });
