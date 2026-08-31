// Contenido HTML real para buscadores y redes sociales.
//
// El catálogo es una SPA: sin esto, lo primero que recibe Google es un <div>
// vacío y depende de que su renderizador ejecute el JavaScript. Para un
// concesionario eso significa que sus vehículos tardan más en indexarse, o no
// se indexan bien. Aquí el servidor escribe el catálogo y las fichas en HTML
// dentro de #root antes de responder.
//
// React sustituye este bloque al montar (createRoot vacía el contenedor), así
// que no hay hidratación ni riesgo de desajuste: es contenido de arranque.
// Como efecto secundario, la página deja de quedarse en blanco si el
// JavaScript falla o tarda en llegar.

function escapeHtml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&#39;", '"': "&quot;" })[char]);
}

// El JSON-LD va dentro de <script>: hay que cortar cualquier cierre de etiqueta
// antes de incrustarlo, o el atacante podría salirse del script.
function safeJsonLd(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function formatPrice(value, currency = "USD") {
  const amount = Number(value || 0);
  if (!amount) return "Precio a consultar";
  const safeCurrency = /^[A-Z]{3,8}$/.test(String(currency || "")) ? String(currency).toUpperCase() : "USD";
  const locale = safeCurrency === "DOP" ? "es-DO" : "en-US";
  return amount.toLocaleString(locale, { style: "currency", currency: safeCurrency, maximumFractionDigits: 0 });
}

function vehicleName(vehicle) {
  return [vehicle.brand, vehicle.model, vehicle.variant].filter(Boolean).join(" ");
}

// Estilos en línea y deliberadamente sobrios: este bloque solo se ve durante los
// milisegundos previos al montaje de React, o si el JavaScript nunca llega.
const shellStyle = 'style="max-width:1180px;margin:0 auto;padding:48px 24px;font-family:Inter,system-ui,sans-serif;color:#2a2723"';
const listStyle = 'style="list-style:none;margin:24px 0 0;padding:0;display:grid;gap:18px"';

export function catalogPrerender({ businessName, vehicles, settings = {} }) {
  if (!vehicles.length) {
    return `<main ${shellStyle}><h1>${escapeHtml(businessName)}</h1><p>El inventario se está actualizando. Vuelve en unos minutos.</p></main>`;
  }
  const items = vehicles.slice(0, 60).map((vehicle) => {
    const name = vehicleName(vehicle);
    const specs = [vehicle.year, vehicle.category, vehicle.fuelType, vehicle.transmission, Number(vehicle.mileageKm) >= 0 && vehicle.mileageKm !== null ? `${Number(vehicle.mileageKm).toLocaleString("en-US")} km` : null]
      .filter(Boolean).map((spec) => escapeHtml(spec)).join(" · ");
    return `<li><article><h2><a href="/vehiculos/${escapeHtml(vehicle.slug)}">${escapeHtml(name)}</a></h2><p>${escapeHtml(formatPrice(vehicle.price ?? vehicle.priceAmount ?? vehicle.priceUsd, vehicle.currency || vehicle.priceCurrency || settings.currency))}</p><p>${specs}</p></article></li>`;
  }).join("");
  const contact = [settings.phone && `Teléfono: ${settings.phone}`, settings.address, settings.hours].filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  return `<main ${shellStyle}><h1>${escapeHtml(businessName)}</h1><p>${escapeHtml(`${vehicles.length} ${vehicles.length === 1 ? "vehículo disponible" : "vehículos disponibles"}.`)}</p>${contact}<ul ${listStyle}>${items}</ul></main>`;
}

export function vehiclePrerender({ businessName, vehicle, settings = {} }) {
  const name = vehicleName(vehicle);
  const rows = [
    ["Año", vehicle.year], ["Motor", vehicle.engine], ["Potencia", vehicle.power],
    ["Transmisión", vehicle.transmission], ["Tracción", vehicle.drive], ["Combustible", vehicle.fuelType],
    ["Kilometraje", vehicle.mileageKm === null || vehicle.mileageKm === undefined ? null : `${Number(vehicle.mileageKm).toLocaleString("en-US")} km`],
    ["Color exterior", vehicle.exteriorColor], ["Ubicación", vehicle.location], ["Garantía", vehicle.warranty],
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([label, value]) => `<tr><th style="text-align:left;padding:6px 18px 6px 0;font-weight:500">${escapeHtml(label)}</th><td style="padding:6px 0">${escapeHtml(value)}</td></tr>`).join("");
  const description = vehicle.description ? `<p>${escapeHtml(vehicle.description)}</p>` : "";
  return `<main ${shellStyle}><p><a href="/">← ${escapeHtml(businessName)}</a></p><h1>${escapeHtml(name)}</h1><p>${escapeHtml(formatPrice(vehicle.price ?? vehicle.priceAmount ?? vehicle.priceUsd, vehicle.currency || vehicle.priceCurrency || settings.currency))}</p>${description}<table>${rows}</table></main>`;
}

// AutoDealer es el esquema que Google usa para mostrar un concesionario en la
// búsqueda local: nombre, teléfono, dirección y horario.
function dealerNode({ businessName, origin, settings, logoUrl }) {
  const node = { "@type": "AutoDealer", "@id": `${origin}/#dealer`, name: businessName, url: `${origin}/` };
  if (logoUrl) node.logo = logoUrl;
  if (settings.phone) node.telephone = String(settings.phone);
  if (settings.email) node.email = String(settings.email);
  if (settings.address) node.address = { "@type": "PostalAddress", streetAddress: String(settings.address) };
  if (settings.hours) node.openingHours = String(settings.hours);
  const sameAs = [settings.instagramUrl, settings.facebookUrl].filter(Boolean);
  if (sameAs.length) node.sameAs = sameAs;
  return node;
}

export function catalogJsonLd({ businessName, origin, settings = {}, logoUrl, vehicles = [] }) {
  const graph = [dealerNode({ businessName, origin, settings, logoUrl })];
  if (vehicles.length) {
    graph.push({
      "@type": "ItemList",
      name: `Inventario de ${businessName}`,
      numberOfItems: vehicles.length,
      itemListElement: vehicles.slice(0, 60).map((vehicle, index) => ({ "@type": "ListItem", position: index + 1, url: `${origin}/vehiculos/${vehicle.slug}`, name: vehicleName(vehicle) })),
    });
  }
  return `<script type="application/ld+json">${safeJsonLd({ "@context": "https://schema.org", "@graph": graph })}</script>`;
}

export function vehicleJsonLd({ businessName, origin, settings = {}, logoUrl, vehicle, image, canonical }) {
  const node = {
    "@type": ["Product", "Car"],
    name: vehicleName(vehicle),
    url: canonical,
    // 'reserved' sigue publicado pero ya no está a la venta: decirlo evita que
    // Google muestre como disponible algo que el concesionario ya comprometió.
    offers: {
      "@type": "Offer",
      price: Number(vehicle.price ?? vehicle.priceAmount ?? vehicle.priceUsd ?? 0) || undefined,
      priceCurrency: vehicle.currency || vehicle.priceCurrency || settings.currency || "USD",
      availability: vehicle.status === "reserved" ? "https://schema.org/PreOrder" : "https://schema.org/InStock",
      url: canonical,
      seller: { "@id": `${origin}/#dealer` },
    },
  };
  if (vehicle.brand) node.brand = { "@type": "Brand", name: vehicle.brand };
  if (vehicle.model) node.model = String(vehicle.model);
  if (vehicle.year) node.vehicleModelDate = String(vehicle.year);
  if (vehicle.description) node.description = String(vehicle.description).slice(0, 600);
  if (image) node.image = image;
  if (vehicle.exteriorColor) node.color = String(vehicle.exteriorColor);
  if (vehicle.fuelType) node.fuelType = String(vehicle.fuelType);
  if (vehicle.transmission) node.vehicleTransmission = String(vehicle.transmission);
  if (vehicle.stockNumber) node.sku = String(vehicle.stockNumber);
  if (vehicle.mileageKm !== null && vehicle.mileageKm !== undefined) node.mileageFromOdometer = { "@type": "QuantitativeValue", value: Number(vehicle.mileageKm), unitCode: "KMT" };
  if (vehicle.doors) node.numberOfDoors = Number(vehicle.doors);
  if (vehicle.seats) node.seatingCapacity = Number(vehicle.seats);
  if (vehicle.condition) node.itemCondition = /nuevo|new/i.test(String(vehicle.condition)) ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition";
  return `<script type="application/ld+json">${safeJsonLd({ "@context": "https://schema.org", "@graph": [dealerNode({ businessName, origin, settings, logoUrl }), node] })}</script>`;
}

const dealerLandingFaq = [
  ["¿Necesito conocimientos técnicos?", "No. ZEVROA está pensado para que tu equipo pueda publicar, atender y dar seguimiento desde un panel claro."],
  ["¿Puedo usar mi propio dominio?", "Sí. Cada concesionario puede empezar con un enlace de ZEVROA y conectar su dominio propio cuando esté listo."],
  ["¿Puedo conectar Google Calendar?", "Sí. Cada dealer autoriza su propia cuenta y las citas se sincronizan sin compartir calendarios entre concesionarios."],
  ["¿Cómo empiezo?", "Solicita una demo y revisamos contigo la configuración inicial, la identidad de tu showroom y el primer inventario."],
];

export function dealersPrerender({ businessName = "ZEVROA" }) {
  const steps = [
    ["01", "Publica tu inventario", "Fichas claras, fotos, precios y disponibilidad en un showroom que representa tu marca."],
    ["02", "Organiza tus clientes", "Cada lead, nota, cita y cotización queda en el mismo lugar para que nadie se pierda."],
    ["03", "Convierte el interés", "Da seguimiento, agenda visitas y comparte propuestas con una experiencia más cuidada."],
  ];
  const list = steps.map(([number, title, body]) => `<li><strong>${escapeHtml(number)} · ${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></li>`).join("");
  const faq = dealerLandingFaq.map(([question, answer]) => `<details><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join("");
  return `<main ${shellStyle}><p><a href="/">${escapeHtml(businessName)}</a></p><p>PARA CONCESIONARIOS</p><h1>Tu concesionario, mejor presentado.</h1><p>Un showroom digital para publicar tu inventario, atender clientes y convertir cada oportunidad en un próximo paso claro.</p><p><a href="/backoffice">Solicitar una demo</a> · <a href="/backoffice">Entrar al panel</a></p><h2>Del inventario a la venta.</h2><ol>${list}</ol><h2>Preguntas frecuentes</h2>${faq}</main>`;
}

export function dealersJsonLd({ origin, canonical }) {
  const description = "Gestiona inventario, clientes, citas y cotizaciones con un showroom digital pensado para concesionarios.";
  return `<script type="application/ld+json">${safeJsonLd({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": ["SoftwareApplication", "WebApplication"], name: "ZEVROA", url: canonical, applicationCategory: "BusinessApplication", operatingSystem: "Web", description },
      { "@type": "FAQPage", mainEntity: dealerLandingFaq.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) },
    ],
  })}</script>`;
}
