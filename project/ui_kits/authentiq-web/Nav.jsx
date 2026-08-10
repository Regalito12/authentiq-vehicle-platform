function Nav({ current, onNav }) {
  const links = [
    { id: "home",   label: "Modelos" },
    { id: "new",    label: "Nuevos" },
    { id: "used",   label: "Seminuevos" },
    { id: "dealer", label: "Concesionarios" },
    { id: "about",  label: "Nosotros" },
  ];
  const [mode, setMode] = React.useState("buyer");
  const [lang, setLang] = React.useState("es");
  return (
    <nav className="nav">
      <div className="logo">AUTHENTIQ</div>
      <div className="nav-links">
        {links.map(l => (
          <button
            key={l.id}
            className={current === l.id ? "active" : ""}
            onClick={() => onNav(l.id)}
          >{l.label}</button>
        ))}
      </div>
      <div className="nav-right">
        <div className="mode-toggle">
          <button className={mode==="buyer"?"active":""} onClick={()=>setMode("buyer")}>Comprador</button>
          <button className={mode==="dealer"?"active":""} onClick={()=>setMode("dealer")}>Dealer</button>
        </div>
        <button className="lang-toggle" onClick={()=>setLang(l=>l==="es"?"en":"es")}>
          {lang.toUpperCase()}
        </button>
      </div>
    </nav>
  );
}

Object.assign(window, { Nav });
