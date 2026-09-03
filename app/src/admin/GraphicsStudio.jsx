import { useEffect, useMemo, useRef, useState } from "react";
import { generateQRCodeSVG } from "../utils/qr.js";
import { formatPrice, publicVehiclePath, slugify } from "./format.js";
import { USD_TO_DOP_RATE } from "../utils/exchange.js";

// Piezas gráficas del concesionario: la ficha imprimible que se pega en el
// cristal del vehículo y los flyers para redes. Están juntos porque comparten
// el mismo trabajo -- componer una imagen a partir de un vehículo y la marca --
// y separados del backoffice porque no tocan datos ni permisos.

export function WindowStickerModal({ vehicle, organization, settings, onClose }) {
  if (!vehicle) return null;
  const slug = organization?.slug || "zevroa";
  const customDomain = organization?.customDomain;
  const normalizedCustomDomain = String(customDomain || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  const customDomainReady = Boolean(normalizedCustomDomain && window.location.hostname.toLowerCase() === normalizedCustomDomain);
  const path = publicVehiclePath(vehicle);
  const publicUrl = useMemo(() => {
    if (customDomainReady) return `https://${normalizedCustomDomain}${path}`;
    return `${window.location.origin}${path}?dealer=${slug}`;
  }, [customDomainReady, normalizedCustomDomain, path, slug]);

  const qrSvg = useMemo(() => generateQRCodeSVG(publicUrl, 160), [publicUrl]);

  const numPrice = Number(vehicle.priceUsd) || 0;
  const downPayment = Math.round(numPrice * 0.2);
  const loanAmount = Math.max(numPrice - downPayment, 0);
  const estRate = 0.095 / 12;
  const estMonthly = loanAmount ? Math.round((loanAmount * estRate * Math.pow(1 + estRate, 60)) / (Math.pow(1 + estRate, 60) - 1)) : 0;

  return (
    <div className="sticker-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sticker-modal-container" role="dialog" aria-modal="true" aria-label="Cartel de Vitrina">
        <div className="sticker-toolbar">
          <div>
            <strong style={{ fontSize: "14px" }}>Cartel de Vitrina / Parabrisas (Hoja de Exhibición)</strong>
            <small style={{ display: "block", color: "#aaa" }}>Listo para imprimir y colocar en el vehículo físico</small>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button className="primary-action" type="button" onClick={() => window.print()}>
              🖨️ Imprimir Cartel
            </button>
            <button className="secondary-action" type="button" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>

        <div className="sticker-sheet">
          <div className="sticker-header">
            <div className="sticker-dealer-info">
              <h2>{settings?.businessName || organization?.name || "ZEVROA MOTORS"}</h2>
              <p>{settings?.address || "Concesionario Autorizado"} {settings?.phone ? `· Tel: ${settings.phone}` : ""}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className="eyebrow" style={{ color: "#888" }}>STOCK #{vehicle.stockNumber || "DISPONIBLE"}</span>
              <strong style={{ display: "block", fontSize: "16px", color: "#000" }}>{vehicle.warranty || "Garantía Incluida"}</strong>
            </div>
          </div>

          <div className="sticker-vehicle-title">
            <div>
              <h1>{vehicle.brand} {vehicle.model}</h1>
              <p style={{ margin: "4px 0 0", color: "#555", fontSize: "16px" }}>{vehicle.variant || "Configuración Premium"}</p>
            </div>
            <span>{vehicle.year} · {vehicle.condition === "new" ? "NUEVO" : "CERTIFICADO"}</span>
          </div>

          <div className="sticker-price-bar">
            <div>
              <small>PRECIO DE VENTA SUGERIDO</small>
              <strong>{formatPrice(vehicle.priceUsd)}</strong>
            </div>
            {estMonthly > 0 && (
              <div style={{ textAlign: "right" }}>
                <small>FINANCIAMIENTO DESDE (20% INICIAL)</small>
                <div style={{ fontSize: "20px", fontWeight: "700", color: "#b28b37" }}>
                  {formatPrice(estMonthly)} / mes (60 meses)
                </div>
              </div>
            )}
          </div>

          <div className="sticker-specs-grid">
            <div className="sticker-spec-item">
              <small>KILOMETRAJE</small>
              <strong>{Number(vehicle.mileageKm).toLocaleString("en-US")} km</strong>
            </div>
            <div className="sticker-spec-item">
              <small>MOTOR</small>
              <strong>{vehicle.engine || "N/D"}</strong>
            </div>
            <div className="sticker-spec-item">
              <small>POTENCIA</small>
              <strong>{vehicle.power || "N/D"}</strong>
            </div>
            <div className="sticker-spec-item">
              <small>TRANSMISIÓN</small>
              <strong>{vehicle.transmission || "N/D"}</strong>
            </div>
            <div className="sticker-spec-item">
              <small>TRACCIÓN</small>
              <strong>{vehicle.drive || "N/D"}</strong>
            </div>
            <div className="sticker-spec-item">
              <small>COMBUSTIBLE</small>
              <strong>{vehicle.fuelType || "N/D"}</strong>
            </div>
            <div className="sticker-spec-item">
              <small>COLOR EXTERIOR</small>
              <strong>{vehicle.exteriorColor || "N/D"}</strong>
            </div>
            <div className="sticker-spec-item">
              <small>COLOR INTERIOR</small>
              <strong>{vehicle.interiorColor || "N/D"}</strong>
            </div>
          </div>

          {vehicle.features && vehicle.features.length > 0 && (
            <div className="sticker-features-block">
              <strong>EQUIPAMIENTO DESTACADO</strong>
              <div className="sticker-features-pills">
                {vehicle.features.slice(0, 8).map((f) => (
                  <span key={f} className="sticker-feature-tag">{f}</span>
                ))}
              </div>
            </div>
          )}

          <div className="sticker-qr-section">
            <div className="sticker-qr-image" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <div className="sticker-qr-text">
              <h4>Escanea con tu teléfono 📱</h4>
              <p>
                Apunta tu cámara hacia este código QR para abrir instantáneamente la <strong>ficha técnica interactiva en 3D</strong>, ver la galería en alta resolución y solicitar una prueba de manejo con nuestro equipo.
              </p>
              <small style={{ color: "#e5c36d", marginTop: "6px", display: "block" }}>
                {publicUrl}
              </small>
            </div>
          </div>

          <div className="sticker-footer">
            <span>{settings?.businessName || organization?.name || "ZEVROA"} · Inventario Verificado · Todos los derechos reservados</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function QuotePrintModal({ quote, vehicle, organization, settings, onClose }) {
  if (!quote) return null;
  const businessName = organization?.name || settings?.businessName || "ZEVROA";
  const currency = quote.currency || "USD";
  const dateFormatted = quote.createdAt ? new Date(quote.createdAt).toLocaleDateString("es-DO", { day: "2-digit", month: "long", year: "numeric" }) : new Date().toLocaleDateString("es-DO", { day: "2-digit", month: "long", year: "numeric" });
  const validUntilFormatted = quote.validUntil ? new Date(quote.validUntil).toLocaleDateString("es-DO", { day: "2-digit", month: "long", year: "numeric" }) : "15 días";
  
  const numBase = Number(quote.basePriceUsd ?? quote.baseAmount ?? 0);
  const numDiscount = Number(quote.discountUsd ?? quote.discountAmount ?? 0);
  const numTotal = Number(quote.totalUsd ?? quote.totalAmount ?? (numBase - numDiscount));
  const downPayment = Math.round(numTotal * 0.2);
  const loanAmount = Math.max(numTotal - downPayment, 0);
  const estRate = 0.095 / 12;
  const estMonthly = loanAmount ? Math.round((loanAmount * estRate * Math.pow(1 + estRate, 60)) / (Math.pow(1 + estRate, 60) - 1)) : 0;

  return (
    <div className="sticker-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sticker-modal-container" role="dialog" aria-modal="true" aria-label={`Cotización ${quote.quoteNumber}`}>
        <div className="sticker-toolbar">
          <div>
            <strong style={{ fontSize: "14px" }}>Propuesta Comercial / Cotización Oficial ({quote.quoteNumber})</strong>
            <small style={{ display: "block", color: "#aaa" }}>Lista para imprimir o exportar a PDF para el cliente o entidad bancaria</small>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button className="primary-action" type="button" onClick={() => window.print()}>
              🖨️ Imprimir / Guardar PDF
            </button>
            <button className="secondary-action" type="button" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>

        <div className="sticker-sheet quote-print-sheet">
          <div className="sticker-header">
            <div className="sticker-dealer-info">
              <h2>{businessName}</h2>
              <p>{settings?.address || "Concesionario Autorizado"} {settings?.phone ? `· Tel: ${settings.phone}` : ""} {settings?.email ? `· ${settings.email}` : ""}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className="eyebrow" style={{ color: "#888" }}>COTIZACIÓN OFICIAL</span>
              <strong style={{ display: "block", fontSize: "18px", color: "#c8a24b" }}>{quote.quoteNumber}</strong>
              <small style={{ color: "#555", display: "block", marginTop: "4px" }}>Emisión: {dateFormatted} · Válida hasta: {validUntilFormatted}</small>
            </div>
          </div>

          <div style={{ margin: "20px 0 16px", padding: "14px 18px", background: "#f8f6f0", borderLeft: "4px solid #c8a24b" }}>
            <span className="eyebrow" style={{ color: "#888", fontSize: "11px" }}>DATOS DEL CLIENTE</span>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
              <div>
                <strong style={{ fontSize: "17px", color: "#111" }}>{quote.customerName}</strong>
                <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#555" }}>
                  {quote.customerEmail || "Sin correo"} {quote.customerPhone ? `· Tel: ${quote.customerPhone}` : ""}
                </p>
              </div>
              <span style={{ padding: "4px 10px", background: "#e8e4d8", borderRadius: "4px", fontSize: "12px", fontWeight: "600", textTransform: "uppercase" }}>
                Estado: {quote.status || "Enviada"}
              </span>
            </div>
          </div>

          <div className="sticker-vehicle-title">
            <h3>{quote.brand ? `${quote.brand} ${quote.model}` : "Vehículo en Catálogo"}</h3>
            <p>{quote.year ? `Año ${quote.year} · ` : ""}{vehicle?.variant || "Versión Oficial"} {vehicle?.condition === "new" ? "· Nuevo 0 km" : "· Usado"}</p>
          </div>

          <div className="sticker-price-block">
            <div>
              <span className="eyebrow" style={{ color: "#999" }}>TOTAL PROPUESTA NETO</span>
              <div className="sticker-main-price">{formatPrice(numTotal, currency)}</div>
              <small style={{ color: "#666" }}>
                {currency === "USD" ? `≈ RD$ ${(numTotal * USD_TO_DOP_RATE).toLocaleString("en-US")} DOP (tasa referencial 1 USD = ${USD_TO_DOP_RATE.toFixed(2)} DOP)` : `≈ USD $${Math.round(numTotal / USD_TO_DOP_RATE).toLocaleString("en-US")}`}
              </small>
            </div>
            <div className="sticker-finance-preview">
              <span className="eyebrow" style={{ color: "#c8a24b" }}>PLAN FINANCIERO ESTIMADO</span>
              <strong>Inicial 20%: {formatPrice(downPayment, currency)}</strong>
              <small>Cuota aprox: {formatPrice(estMonthly, currency)}/mes a 60 meses</small>
            </div>
          </div>

          <div style={{ margin: "20px 0" }}>
            <span className="eyebrow" style={{ color: "#888", display: "block", marginBottom: "8px" }}>DESGLOSE ECONÓMICO</span>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <tbody>
                <tr style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "8px 0" }}>Precio de lista oficial</td>
                  <td style={{ padding: "8px 0", textAlign: "right", fontWeight: "500" }}>{formatPrice(numBase, currency)}</td>
                </tr>
                {numDiscount > 0 && (
                  <tr style={{ borderBottom: "1px solid #eee", color: "#b83227" }}>
                    <td style={{ padding: "8px 0" }}>Bono / Descuento comercial aplicado</td>
                    <td style={{ padding: "8px 0", textAlign: "right", fontWeight: "600" }}>-{formatPrice(numDiscount, currency)}</td>
                  </tr>
                )}
                <tr style={{ borderTop: "2px solid #222" }}>
                  <td style={{ padding: "12px 0", fontSize: "16px", fontWeight: "700" }}>Total Final Cotizado</td>
                  <td style={{ padding: "12px 0", textAlign: "right", fontSize: "18px", fontWeight: "700", color: "#c8a24b" }}>{formatPrice(numTotal, currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {vehicle && (
            <div className="sticker-specs-grid" style={{ marginTop: "12px" }}>
              <div className="sticker-spec-item"><small>KILOMETRAJE</small><strong>{Number(vehicle.mileageKm || 0).toLocaleString("en-US")} km</strong></div>
              <div className="sticker-spec-item"><small>TRANSMISIÓN</small><strong>{vehicle.transmission || "N/D"}</strong></div>
              <div className="sticker-spec-item"><small>COMBUSTIBLE</small><strong>{vehicle.fuelType || "N/D"}</strong></div>
              <div className="sticker-spec-item"><small>GARANTÍA</small><strong>{vehicle.warranty || "N/D"}</strong></div>
            </div>
          )}

          {quote.notes && (
            <div style={{ margin: "16px 0", padding: "12px 16px", background: "#faf9f6", border: "1px solid #eee", borderRadius: "4px" }}>
              <strong style={{ display: "block", fontSize: "12px", color: "#666", marginBottom: "4px" }}>OBSERVACIONES Y CONDICIONES ADICIONALES</strong>
              <p style={{ margin: 0, fontSize: "13px", color: "#333", lineHeight: "1.5" }}>{quote.notes}</p>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "40px", marginTop: "48px", paddingTop: "20px" }}>
            <div style={{ textAlign: "center", borderTop: "1px solid #888", paddingTop: "8px" }}>
              <span style={{ fontSize: "12px", color: "#666", display: "block" }}>Firma Asesor Comercial</span>
              <strong style={{ fontSize: "13px", color: "#111" }}>{businessName}</strong>
            </div>
            <div style={{ textAlign: "center", borderTop: "1px solid #888", paddingTop: "8px" }}>
              <span style={{ fontSize: "12px", color: "#666", display: "block" }}>Aceptación del Comprador</span>
              <strong style={{ fontSize: "13px", color: "#111" }}>{quote.customerName}</strong>
            </div>
          </div>

          <div className="sticker-footer" style={{ marginTop: "32px" }}>
            <span>{businessName} · Documento informativo sujeto a disponibilidad y verificación física del vehículo.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SocialFlyerStudio({ vehicles = [], organization, settings }) {
  const [selectedId, setSelectedId] = useState(vehicles[0]?.id || "");
  const [format, setFormat] = useState("story");
  const canvasRef = useRef(null);

  const currentVehicle = vehicles.find((v) => v.id === selectedId) || vehicles[0];

  useEffect(() => {
    if (!currentVehicle || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    let width = 1080;
    let height = 1920;
    if (format === "post") {
      width = 1080;
      height = 1080;
    } else if (format === "banner") {
      width = 1920;
      height = 1080;
    }

    canvas.width = width;
    canvas.height = height;

    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, "#0e1112");
    bgGrad.addColorStop(0.5, "#151a1b");
    bgGrad.addColorStop(1, "#090b0c");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    const imgUrl = currentVehicle.images?.[0]?.url || "/assets/hero-highway.webp";
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const imgAspect = img.width / img.height;
      const targetAspect = width / (height * 0.55);
      let sx, sy, sWidth, sHeight;

      if (imgAspect > targetAspect) {
        sHeight = img.height;
        sWidth = img.height * targetAspect;
        sx = (img.width - sWidth) / 2;
        sy = 0;
      } else {
        sWidth = img.width;
        sHeight = img.width / targetAspect;
        sx = 0;
        sy = (img.height - sHeight) / 2;
      }

      const imgY = format === "story" ? 280 : format === "post" ? 120 : 80;
      const imgH = format === "story" ? 900 : format === "post" ? 560 : 700;
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, imgY, width, imgH);

      const overlayGrad = ctx.createLinearGradient(0, imgY, 0, imgY + imgH);
      overlayGrad.addColorStop(0, "rgba(14,17,18,0.8)");
      overlayGrad.addColorStop(0.2, "rgba(14,17,18,0)");
      overlayGrad.addColorStop(0.8, "rgba(14,17,18,0.2)");
      overlayGrad.addColorStop(1, "rgba(14,17,18,1)");
      ctx.fillStyle = overlayGrad;
      ctx.fillRect(0, imgY, width, imgH);

      ctx.fillStyle = "#c8a24b";
      ctx.font = "bold 28px 'Inter Tight', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText((settings?.businessName || organization?.name || "ZEVROA MOTORS").toUpperCase(), 60, format === "story" ? 140 : 80);

      ctx.fillStyle = "#888888";
      ctx.font = "20px 'IBM Plex Mono', monospace";
      ctx.fillText("INVENTARIO CERTIFICADO", 60, format === "story" ? 180 : 110);

      const contentY = format === "story" ? 1280 : format === "post" ? 740 : 840;

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 64px 'Inter Tight', sans-serif";
      ctx.fillText(`${currentVehicle.brand} ${currentVehicle.model}`, 60, contentY);

      ctx.fillStyle = "#c8a24b";
      ctx.font = "32px 'Inter Tight', sans-serif";
      ctx.fillText(`${currentVehicle.year} · ${currentVehicle.engine || "N/D"} · ${currentVehicle.transmission || "N/D"}`, 60, contentY + 54);

      const priceY = contentY + 110;
      ctx.fillStyle = "#c8a24b";
      ctx.beginPath();
      ctx.roundRect(60, priceY, 360, 80, 8);
      ctx.fill();

      ctx.fillStyle = "#0b0d0e";
      ctx.font = "bold 44px 'Inter Tight', sans-serif";
      ctx.fillText(formatPrice(currentVehicle.priceUsd), 84, priceY + 56);

      ctx.fillStyle = "#f2efe9";
      ctx.font = "24px 'IBM Plex Mono', monospace";
      ctx.fillText(settings?.phone ? `📲 ${settings.phone}` : "AGENDA TU CITA HOY", 60, priceY + 140);
    };
    img.onerror = () => {
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 48px sans-serif";
      ctx.fillText(`${currentVehicle.brand} ${currentVehicle.model}`, 60, height / 2);
    };
    img.src = imgUrl;
  }, [currentVehicle, format, organization, settings]);

  const downloadFlyer = () => {
    if (!canvasRef.current || !currentVehicle) return;
    const link = document.createElement("a");
    link.download = `flyer-${slugify(`${currentVehicle.brand}-${currentVehicle.model}`)}-${format}.png`;
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  };

  return (
    <article className="social-flyer-studio" aria-label="Estudio Creativo de Marketing">
      <div className="flyer-canvas-card">
        <canvas ref={canvasRef} />
      </div>

      <div className="flyer-control-panel">
        <div>
          <span className="eyebrow">PUBLICAR EN REDES</span>
          <h3 style={{ margin: "6px 0 12px", fontSize: "20px" }}>Generador de Flyers</h3>
          <p style={{ margin: 0, fontSize: "14px", color: "var(--auth-muted)" }}>
            Genera imágenes profesionales listas para publicar en tus redes sociales con el logo y precio de tu vehículo.
          </p>
        </div>

        <label style={{ display: "grid", gap: "6px", font: "500 11px 'IBM Plex Mono', monospace" }}>
          VEHÍCULO
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.brand} {v.model} ({v.year}) - {formatPrice(v.priceUsd)}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span style={{ display: "block", font: "500 11px 'IBM Plex Mono', monospace", marginBottom: "6px", color: "var(--auth-muted)" }}>
            FORMATO DE PUBLICACIÓN
          </span>
          <div className="flyer-format-selector">
            <button
              type="button"
              className={`flyer-format-btn ${format === "story" ? "is-active" : ""}`}
              onClick={() => setFormat("story")}
            >
              Story 9:16
            </button>
            <button
              type="button"
              className={`flyer-format-btn ${format === "post" ? "is-active" : ""}`}
              onClick={() => setFormat("post")}
            >
              Post 1:1
            </button>
            <button
              type="button"
              className={`flyer-format-btn ${format === "banner" ? "is-active" : ""}`}
              onClick={() => setFormat("banner")}
            >
              Banner 16:9
            </button>
          </div>
        </div>

        <button className="primary-action" type="button" onClick={downloadFlyer} style={{ width: "100%", marginTop: "12px" }}>
          Descargar Imagen PNG 📥
        </button>
      </div>
    </article>
  );
}
