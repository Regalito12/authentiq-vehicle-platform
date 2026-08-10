// Chat panel + Offer modal (multiple variants of each)

function ChatPanel({ vehicle, onClose, variant = "panel" }) {
  const { lang, t } = useT();
  const [msgs, setMsgs] = React.useState([
    { role: "agent", text: t("chat.msg1"), time: "14:32" },
    { role: "user", text: t("chat.msg2"), time: "14:33" },
    { role: "agent", text: t("chat.msg3"), time: "14:33" },
  ]);
  const [input, setInput] = React.useState("");
  const [typing, setTyping] = React.useState(false);
  const scrollRef = React.useRef(null);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, typing]);

  const send = (txt) => {
    if (!txt.trim()) return;
    setMsgs(m => [...m, { role: "user", text: txt, time: nowTime() }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMsgs(m => [...m, { role: "agent", text: lang === "es"
        ? "Perfecto, déjame consultar la información y te confirmo en un momento."
        : "Great, let me check the info and get right back to you.", time: nowTime() }]);
    }, 1600);
  };

  const nowTime = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <div className="chat-agent">
          <div className="chat-avatar">CM<span className="status"></span></div>
          <div className="chat-agent-info">
            <div className="name">Camila Mendoza — {t("chat.title")}</div>
            <div className="role">● {t("chat.role")}</div>
          </div>
        </div>
        <button className="modal-close" onClick={onClose} style={{position:"relative"}}></button>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        <div className="chat-context">
          <div className="thumb" style={{background: vehicle.color}}>
            <div style={{transform: "scale(0.9)"}}>
              <Silhouette type={vehicle.type} color="#f2eee7" accent="#c8a24b"/>
            </div>
          </div>
          <div className="info">
            <b>{vehicle.name[lang]}</b>
            <span>{t("chat.context.about")} · ${vehicle.price.toLocaleString()}</span>
          </div>
        </div>

        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text}
            <span className="time mono">{m.time}</span>
          </div>
        ))}

        {typing && (
          <div className="typing">
            <span></span><span></span><span></span>
          </div>
        )}
      </div>

      <div className="chat-quick">
        {["chat.quick.availability", "chat.quick.testdrive", "chat.quick.finance", "chat.quick.trade"].map(k => (
          <button key={k} onClick={() => send(t(k))}>{t(k)}</button>
        ))}
      </div>

      <div className="chat-input">
        <input
          type="text"
          placeholder={t("chat.placeholder")}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send(input)}
        />
        <button className="chat-send" onClick={() => send(input)}>→</button>
      </div>
    </div>
  );
}

function ChatBubble({ onClick }) {
  return (
    <button className="chat-bubble-btn" onClick={onClick} aria-label="Open chat">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 6 L20 6 L20 16 L14 16 L11 19 L11 16 L4 16 Z"/>
      </svg>
      <span className="notif"></span>
    </button>
  );
}

// ============ OFFER MODAL — 3 variants ============

function OfferModal({ vehicle, onClose, onSubmit, variant = "slider" }) {
  const { lang, t } = useT();
  const asking = vehicle.price;
  const [offer, setOffer] = React.useState(Math.round(asking * 0.93));
  const [payment, setPayment] = React.useState("cash");
  const [tradein, setTradein] = React.useState("no");
  const [message, setMessage] = React.useState("");
  const trackRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(false);

  const min = Math.round(asking * 0.7);
  const max = Math.round(asking * 1.1);
  const pct = ((offer - min) / (max - min)) * 100;
  const askingPct = ((asking - min) / (max - min)) * 100;
  const diff = offer - asking;
  const diffPct = ((offer - asking) / asking * 100);

  const onDown = () => setDragging(true);
  const onUp = () => setDragging(false);
  const onMove = (e) => {
    if (!dragging || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    setOffer(Math.round(min + ratio * (max - min)));
  };

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

  const priceClass = diff < 0 ? "below" : diff > 0 ? "above" : "";

  // AUCTION VARIANT — history
  const auctionHistory = [
    { by: "Buyer 4A2F", amount: Math.round(asking * 0.86), time: "hace 2h" },
    { by: "Buyer 9C71", amount: Math.round(asking * 0.89), time: "hace 1h" },
    { by: "Buyer 8B0E", amount: Math.round(asking * 0.91), time: "hace 22 min" },
  ];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{t("offer.title")}</h2>
            <div className="sub">{t("offer.sub")} · {vehicle.name[lang]}</div>
          </div>
          <button className="modal-close" onClick={onClose} style={{position:"relative"}}></button>
        </div>

        <div className="modal-body">
          {/* Price display */}
          <div className="offer-price-display">
            <div className="offer-price-label">{t("offer.your_offer")}</div>
            <div className={`offer-price ${priceClass}`}>
              <span className="currency">$</span>
              <span className="amount">{offer.toLocaleString()}</span>
            </div>
            <div className="offer-diff">
              {diff === 0 ? (
                <span>= {t("offer.diff.match")}</span>
              ) : diff < 0 ? (
                <>
                  <span className="neg">−${Math.abs(diff).toLocaleString()} ({diffPct.toFixed(1)}%)</span>{" "}
                  {t("offer.diff.below")} · {t("offer.asking")} <span className="mono">${asking.toLocaleString()}</span>
                </>
              ) : (
                <>
                  <span className="pos">+${diff.toLocaleString()} ({diffPct.toFixed(1)}%)</span>{" "}
                  {t("offer.diff.above")} · {t("offer.asking")} <span className="mono">${asking.toLocaleString()}</span>
                </>
              )}
            </div>
          </div>

          {/* VARIANT: SLIDER */}
          {variant === "slider" && (
            <div className="offer-slider-wrap">
              <div className="offer-slider" ref={trackRef}>
                <div className="offer-track">
                  <div className="offer-track-fill" style={{width: `${pct}%`}}></div>
                </div>
                <div className="offer-track-marker" style={{left: `${askingPct}%`}}></div>
                <div
                  className="offer-thumb"
                  style={{left: `${pct}%`}}
                  onMouseDown={onDown}
                  onTouchStart={onDown}
                ></div>
              </div>
              <div style={{display:"flex", justifyContent:"space-between", fontFamily:"var(--f-mono)", fontSize:10, color:"var(--muted)", letterSpacing:"0.05em"}}>
                <span>${min.toLocaleString()}</span>
                <span>${max.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* VARIANT: FORM (numeric input, big) */}
          {variant === "form" && (
            <div style={{padding: "24px 0", borderBottom: "1px solid var(--line)"}}>
              <label className="mono" style={{display:"block", fontSize:10, color:"var(--muted)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom: 8}}>
                {t("offer.your_offer")} (USD)
              </label>
              <input
                type="number"
                className="offer-input"
                value={offer}
                onChange={e => setOffer(Number(e.target.value) || 0)}
                min={min}
                max={max}
                step={100}
              />
              <div style={{display:"flex", gap:8, marginTop: 12}}>
                {[0.9, 0.95, 1.0].map(m => (
                  <button
                    key={m}
                    className="btn ghost small"
                    onClick={() => setOffer(Math.round(asking * m))}
                    style={{flex: 1}}
                  >
                    {(m * 100).toFixed(0)}% · ${Math.round(asking * m).toLocaleString()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* VARIANT: AUCTION */}
          {variant === "auction" && (
            <div style={{padding: "24px 0", borderBottom: "1px solid var(--line)"}}>
              <div style={{display:"flex", justifyContent:"space-between", marginBottom: 12}}>
                <span className="mono" style={{fontSize:11, textTransform:"uppercase", letterSpacing:"0.08em", color:"var(--muted)"}}>
                  {lang === "es" ? "Ofertas activas" : "Active bids"} · {auctionHistory.length}
                </span>
                <span className="mono" style={{fontSize:11, color: "var(--accent)"}}>
                  {lang === "es" ? "Más alta" : "Highest"}: ${auctionHistory[auctionHistory.length-1].amount.toLocaleString()}
                </span>
              </div>
              <div style={{border:"1px solid var(--line)", marginBottom: 16}}>
                {auctionHistory.map((b, i) => (
                  <div key={i} style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", padding: "10px 14px", borderBottom: i < auctionHistory.length - 1 ? "1px solid var(--line-2)" : "none", fontFamily:"var(--f-mono)", fontSize:11}}>
                    <span style={{color:"var(--muted)"}}>{b.by}</span>
                    <span style={{textAlign:"center"}}>${b.amount.toLocaleString()}</span>
                    <span style={{color:"var(--muted)", textAlign:"right", textTransform:"uppercase", letterSpacing:"0.05em", fontSize:10}}>{b.time}</span>
                  </div>
                ))}
              </div>
              <input
                type="number"
                className="offer-input"
                value={offer}
                onChange={e => setOffer(Number(e.target.value) || 0)}
              />
            </div>
          )}

          {/* Terms */}
          <div className="offer-terms">
            <div className="term-row">
              <label>{t("offer.term.payment")}</label>
              <select value={payment} onChange={e => setPayment(e.target.value)}>
                <option value="cash">{t("offer.payment.cash")}</option>
                <option value="finance">{t("offer.payment.finance")}</option>
                <option value="lease">{t("offer.payment.lease")}</option>
              </select>
            </div>
            <div className="term-row">
              <label>{t("offer.term.tradein")}</label>
              <select value={tradein} onChange={e => setTradein(e.target.value)}>
                <option value="no">{t("offer.tradein.no")}</option>
                <option value="yes">{t("offer.tradein.yes")}</option>
              </select>
            </div>
            <div className="term-row">
              <label>{t("offer.term.message")}</label>
              <textarea
                placeholder={t("offer.message.ph")}
                value={message}
                onChange={e => setMessage(e.target.value)}
              />
            </div>
          </div>

          <div className="offer-actions">
            <button className="btn ghost small" onClick={onClose}>{t("offer.discard")}</button>
            <button className="btn small" onClick={() => onSubmit({ offer, payment, tradein, message })}>
              {t("offer.submit")} <span className="arrow"></span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ChatPanel, ChatBubble, OfferModal });
