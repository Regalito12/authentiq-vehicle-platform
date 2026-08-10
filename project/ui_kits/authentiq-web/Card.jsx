function Card({ vehicle, onOpen }) {
  const [hover, setHover] = React.useState(false);
  const isCertified = vehicle.tag === "Certificado";
  const tagCls = isCertified ? "card-tag used" : (vehicle.kind === "new" ? "card-tag new" : "card-tag");
  const price = "$" + vehicle.price.toLocaleString();
  return (
    <div
      className="card"
      style={{ transform: hover ? "translateY(-4px)" : "none", transition: "transform 400ms var(--ease)", cursor: "pointer" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onOpen(vehicle)}
    >
      <div className="card-img">
        <img
          src={vehicle.image}
          alt={vehicle.model}
          style={{ transform: hover ? "scale(1.04)" : "none", transition: "transform 700ms var(--ease)" }}
        />
        <span className={tagCls}>{vehicle.tag}</span>
      </div>
      <div className="card-info">
        <div>
          <div className="card-title">{vehicle.brand} {vehicle.model}</div>
          <div className="card-sub">{vehicle.year} · {vehicle.specs["Potencia"] || vehicle.specs["Motor"]}</div>
        </div>
        <div className="card-price">
          <span className="label">Desde</span>
          {price}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Card });
