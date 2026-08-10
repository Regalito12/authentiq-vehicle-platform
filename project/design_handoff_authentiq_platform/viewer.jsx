// 360° Viewer using real photos + gallery + split variants

function Viewer360({ vehicle, selectedColor, variant = "rotate" }) {
  const { lang, t } = useT();
  const images = vehicle.images && vehicle.images.length ? vehicle.images : [vehicle.image];
  const [rotation, setRotation] = React.useState(0); // 0-359
  const [dragging, setDragging] = React.useState(false);
  const [mode, setMode] = React.useState("360"); // 360 | gallery | interior
  const [galleryIdx, setGalleryIdx] = React.useState(0);
  const viewerRef = React.useRef(null);
  const startRef = React.useRef({ x: 0, rot: 0 });

  const onDown = (e) => {
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    startRef.current = { x, rot: rotation };
    setDragging(true);
  };
  const onMove = (e) => {
    if (!dragging) return;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const delta = x - startRef.current.x;
    const rect = viewerRef.current.getBoundingClientRect();
    let rot = (startRef.current.rot + (delta / rect.width) * 360) % 360;
    if (rot < 0) rot += 360;
    setRotation(rot);
  };
  const onUp = () => setDragging(false);

  React.useEffect(() => {
    if (!dragging) return;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [dragging]);

  // Map rotation to which of the vehicle's real images to show + scale/flip effect
  // We treat rotation as a full 360° with images as keyframes
  const frameCount = Math.max(images.length, 1);
  const frameIdx = Math.floor((rotation / 360) * frameCount) % frameCount;
  const rotY = rotation;
  // Subtle scale to fake perspective as it rotates
  const scale = 0.94 + 0.06 * Math.abs(Math.cos((rotY * Math.PI) / 180));
  const flip = (rotY > 90 && rotY < 270);

  // SPLIT variant: two views side-by-side
  if (variant === "split") {
    return (
      <div className="viewer" ref={viewerRef} style={{display: "grid", gridTemplateColumns: "1fr 1fr"}}>
        <div className="viewer-canvas" style={{borderRight: "1px solid var(--line)"}}>
          <div className="frame active">
            <img src={images[0]} alt=""/>
          </div>
          <span className="mono" style={{position:"absolute",bottom:12,left:12,fontSize:10,color:"var(--bg)",textTransform:"uppercase",letterSpacing:"0.1em",textShadow:"0 1px 6px rgba(0,0,0,0.6)"}}>Exterior</span>
        </div>
        <div className="viewer-canvas">
          <div className="frame active">
            <img src={images[images.length - 1] || images[0]} alt=""/>
          </div>
          <span className="mono" style={{position:"absolute",bottom:12,left:12,fontSize:10,color:"var(--bg)",textTransform:"uppercase",letterSpacing:"0.1em",textShadow:"0 1px 6px rgba(0,0,0,0.6)"}}>{images.length > 1 ? (lang === "es" ? "Ángulo alterno" : "Alt angle") : "Interior"}</span>
        </div>
      </div>
    );
  }

  // GALLERY variant: browsable grid with main + thumbs
  if (variant === "gallery") {
    return (
      <div className="viewer" style={{cursor: "default"}}>
        <div style={{display: "grid", gridTemplateColumns: "3fr 1fr", height: "100%", gap: "2px", background: "var(--line)"}}>
          <div style={{background: "var(--bg-alt)", position: "relative", overflow: "hidden"}}>
            <img src={images[galleryIdx]} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
            <span className="mono" style={{position:"absolute",top:12,left:12,fontSize:10,padding:"4px 8px",background:"rgba(10,10,10,0.75)",color:"var(--bg)",textTransform:"uppercase",letterSpacing:"0.1em"}}>
              {String(galleryIdx + 1).padStart(2,"0")} / {String(images.length).padStart(2,"0")}
            </span>
          </div>
          <div style={{display: "grid", gridTemplateRows: `repeat(${Math.max(images.length,1)}, 1fr)`, gap: "2px"}}>
            {images.map((src, i) => (
              <div
                key={i}
                style={{
                  background: "var(--bg-alt)",
                  overflow: "hidden",
                  cursor: "pointer",
                  border: i === galleryIdx ? "2px solid var(--accent)" : "none",
                  boxSizing: "border-box",
                }}
                onClick={() => setGalleryIdx(i)}
              >
                <img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block",filter: i === galleryIdx ? "none" : "brightness(0.85)"}}/>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ROTATE (default): drag to rotate through real photos + subtle color tint overlay
  return (
    <div
      className={`viewer ${dragging ? "dragging" : ""}`}
      ref={viewerRef}
      onMouseDown={onDown}
      onTouchStart={onDown}
    >
      <div className="viewer-modes">
        <button className={mode === "360" ? "active" : ""} onClick={() => setMode("360")}>360°</button>
        <button className={mode === "gallery" ? "active" : ""} onClick={() => setMode("gallery")}>{t("detail.viewer.mode.gallery")}</button>
        <button className={mode === "interior" ? "active" : ""} onClick={() => setMode("interior")}>{t("detail.viewer.mode.interior")}</button>
      </div>

      <div className="viewer-canvas">
        {images.map((src, i) => (
          <div
            key={i}
            className={`frame ${i === frameIdx ? "active" : ""}`}
            style={{
              transform: `scale(${scale}) scaleX(${flip ? -1 : 1})`,
              transition: dragging ? "none" : "transform 300ms cubic-bezier(.22,.61,.36,1)",
            }}
          >
            <img src={mode === "interior" && vehicle.id === "porsche-911-gt3" ? "assets/porsche-interior.jpg" : src} alt=""/>
          </div>
        ))}

        {/* Color tint overlay — mixes selected color subtly with the photo */}
        <div
          className="viewer-tint active"
          style={{
            background: selectedColor,
            opacity: 0.22,
            display: mode === "interior" ? "none" : "block",
          }}
        />

        {/* Subtle vignette */}
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.15))",
          pointerEvents: "none",
        }}/>
      </div>

      <span className="viewer-hint mono">{t("detail.viewer.hint")} ↔</span>

      <div className="viewer-hud">
        <div className="viewer-badge">
          <span className="pulse"></span>
          <span>{t("detail.viewer.live")} · 360°</span>
        </div>
        <div className="viewer-rot-indicator" style={{background:"rgba(250,248,245,0.9)", padding:"6px 10px"}}>
          <span>{t("detail.viewer.rotation")}</span>
          <div className="viewer-progress">
            <div className="viewer-progress-fill" style={{width: `${(rotation / 360) * 100}%`}}></div>
          </div>
          <span className="mono">{String(Math.round(rotation)).padStart(3,"0")}°</span>
        </div>
      </div>
    </div>
  );
}

function ColorPicker({ vehicle, selected, onSelect }) {
  const { lang, t } = useT();
  const currentColor = vehicle.colors.find(c => c.hex === selected) || vehicle.colors[0];
  return (
    <div className="color-picker">
      <div className="color-picker-head">
        <div>
          <div className="label">{t("detail.color.title")}</div>
        </div>
        <div className="mono name">{currentColor.name[lang]}</div>
      </div>
      <div className="color-swatches">
        {vehicle.colors.map(c => (
          <button
            key={c.hex}
            className={`swatch ${selected === c.hex ? "active" : ""}`}
            style={{background: c.hex}}
            onClick={() => onSelect(c.hex)}
            aria-label={c.name[lang]}
          />
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { Viewer360, ColorPicker });
