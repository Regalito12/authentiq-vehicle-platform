import "dotenv/config";
import pg from "pg";

// Recorrido completo comprador + backoffice contra el API real y PostgreSQL real.
// Crea sus propios registros y los elimina al terminar.
//
//   node scripts/e2e-test.js
//
// Variables: E2E_EMAIL, E2E_PASSWORD, API_BASE_URL

const baseUrl = String(process.env.API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3001}`).replace(/\/$/, "");
const email = process.env.E2E_EMAIL || process.env.SMOKE_EMAIL || "admin@authentiq.local";
const password = process.env.E2E_PASSWORD || process.env.SMOKE_PASSWORD || "12345678";
const stamp = Date.now();
const marker = `E2E-${stamp}`;
const localIsoDate = (value = new Date()) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

let passed = 0;
let failed = 0;
let crmContactId = null;
const created = { vehicleId: null, offerIds: [], quoteIds: [], leadIds: [], organizationSlug: null, appointmentId: null };

function check(label, condition, detail = "") {
  if (condition) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function api(path, { token, ...options } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: response.status, ok: response.ok, body };
}

const baseVehicle = {
  brand: `Marca ${marker}`,
  category: "sports",
  model: `Modelo ${marker}`,
  variant: "Launch Edition",
  year: 2025,
  condition: "used",
  priceUsd: 125000,
  engine: "4.0L", power: "510 hp", transmission: "PDK", drive: "AWD",
  fuelType: "Gasolina", exteriorColor: "Blanco", interiorColor: "Negro",
  doors: 2, seats: 4, mileageKm: 12000, location: "Santo Domingo",
  stockNumber: `STK-${stamp}`, warranty: "12 meses",
  features: ["Techo panorámico", "Asientos deportivos"],
  description: "Unidad de prueba automatizada con descripción comercial suficientemente larga para pasar la validación de publicación.",
  stock: 1, maxDiscountPercent: 5,
  images: ["/assets/hero-highway.jpg"],
  imageAltTexts: ["Vista frontal"],
  media: [],
};

async function main() {
  console.log(`E2E ZEVROA · ${baseUrl}\n`);

  // --- 1. Autenticación y protección de rutas -------------------------------
  const noToken = await api("/api/admin/vehicles");
  check("Ruta protegida sin token responde 401", noToken.status === 401, `status ${noToken.status}`);

  const badToken = await api("/api/admin/vehicles", { token: "token-invalido" });
  check("Token inválido responde 401", badToken.status === 401, `status ${badToken.status}`);

  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  check("Administrador inicia sesión", login.ok && Boolean(login.body?.token), `status ${login.status}`);
  if (!login.ok) { console.error("\nSin sesión no se puede continuar."); return; }
  const token = login.body.token;

  // --- 2. Validaciones de publicación --------------------------------------
  const noImages = await api("/api/admin/vehicles", { token, method: "POST", body: JSON.stringify({ ...baseVehicle, status: "published", images: [] }) });
  check("Publicar sin imágenes se rechaza", noImages.status === 400, `status ${noImages.status}`);

  const noDescription = await api("/api/admin/vehicles", { token, method: "POST", body: JSON.stringify({ ...baseVehicle, status: "published", description: "" }) });
  check("Publicar sin descripción se rechaza", noDescription.status === 400, `status ${noDescription.status}`);

  // --- 3. Integridad de medios 3D ------------------------------------------
  const proceduralModel = await api("/api/admin/vehicles", { token, method: "POST", body: JSON.stringify({ ...baseVehicle, status: "draft", media: [{ type: "model_3d", url: "procedural://vehicle" }] }) });
  const proceduralCleaned = proceduralModel.status === 201 && !(proceduralModel.body?.data?.media || []).some((item) => item.url?.startsWith("procedural://"));
  check("Marcador procedural:// no se guarda como modelo 3D", proceduralCleaned, `status ${proceduralModel.status}`);
  if (proceduralModel.status === 201) created.vehicleId = proceduralModel.body.data.id;

  const brokenGltf = await api("/api/admin/vehicles", { token, method: "PUT", body: JSON.stringify({ ...baseVehicle, status: "draft", media: [{ type: "model_3d", url: `${baseUrl}/uploads/no-existe-${stamp}.gltf` }] }) , ...(created.vehicleId ? {} : {}) });
  void brokenGltf;
  if (created.vehicleId) {
    const missingFile = await api(`/api/admin/vehicles/${created.vehicleId}`, { token, method: "PUT", body: JSON.stringify({ ...baseVehicle, status: "draft", media: [{ type: "model_3d", url: `${baseUrl}/uploads/no-existe-${stamp}.gltf` }] }) });
    check("GLTF inexistente se rechaza al guardar", missingFile.status === 400 && missingFile.body?.code === "MODEL_3D_INVALID", `status ${missingFile.status}`);

    const wrongExtension = await api(`/api/admin/vehicles/${created.vehicleId}`, { token, method: "PUT", body: JSON.stringify({ ...baseVehicle, status: "draft", media: [{ type: "model_3d", url: "https://cdn.ejemplo.com/modelo.zip" }] }) });
    check("Extensión no 3D se rechaza", wrongExtension.status === 400, `status ${wrongExtension.status}`);
  }

  // --- 4. Borrador no visible en catálogo público --------------------------
  if (!created.vehicleId) { console.error("No se pudo crear el vehículo de prueba."); return; }
  const publicDraft = await api("/api/vehicles");
  check("Un borrador NO aparece en el catálogo público", !(publicDraft.body?.data || []).some((item) => item.id === created.vehicleId));

  // --- 5. Publicar y comprobar visibilidad inmediata -----------------------
  const published = await api(`/api/admin/vehicles/${created.vehicleId}`, { token, method: "PUT", body: JSON.stringify({ ...baseVehicle, status: "published" }) });
  check("Vehículo se publica", published.ok && published.body?.data?.status === "published", `status ${published.status}`);

  const publicAfter = await api("/api/vehicles");
  const listed = (publicAfter.body?.data || []).find((item) => item.id === created.vehicleId);
  check("Vehículo publicado aparece en el catálogo público", Boolean(listed));
  check("La ficha pública trae imágenes y ficha técnica", Boolean(listed?.images?.length && listed?.engine && listed?.fuelType));
  check("El contrato público expone precio y moneda", Number.isFinite(Number(listed?.price)) && /^[A-Z]{3,8}$/.test(listed?.currency || ""), `price=${listed?.price} currency=${listed?.currency}`);

  // --- 6. Consentimiento y ofertas -----------------------------------------
  const offerNoConsent = await api("/api/offers", { method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, buyerName: `Comprador ${marker}`, amountUsd: 120000, privacyConsent: false }) });
  check("Oferta sin consentimiento se rechaza", offerNoConsent.status === 400, `status ${offerNoConsent.status}`);

  const wrongOfferCurrency = listed?.currency === "USD" ? "EUR" : "USD";
  const offerWrongCurrency = await api("/api/offers", { method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, buyerName: `Comprador ${marker}`, buyerEmail: `moneda-${stamp}@authentiq.test`, amount: 120000, currency: wrongOfferCurrency, message: marker, privacyConsent: true }) });
  check("Oferta con moneda incorrecta se rechaza", offerWrongCurrency.status === 400, `status ${offerWrongCurrency.status}`);

  const offer = await api("/api/offers", { method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, buyerName: `Comprador ${marker}`, buyerEmail: `e2e-${stamp}@authentiq.test`, amountUsd: 120000, message: marker, privacyConsent: true }) });
  check("Comprador envía una oferta", offer.status === 201, `status ${offer.status}`);
  if (offer.status === 201) { created.offerIds.push(offer.body.data.id); if (offer.body.data.leadId) created.leadIds.push(offer.body.data.leadId); }

  const adminOffers = await api("/api/admin/offers", { token });
  check("La oferta llega al backoffice", (adminOffers.body?.data || []).some((item) => item.id === created.offerIds[0]));

  const adminLeads = await api("/api/admin/leads", { token });
  check("La oferta genera un lead en el CRM", (adminLeads.body?.data || []).some((item) => created.leadIds.includes(item.id)));
  const contacts = await api("/api/admin/contacts", { token });
  const matchingContacts = (contacts.body?.data || []).filter((item) => item.email === `e2e-${stamp}@authentiq.test`);
  crmContactId = matchingContacts[0]?.id || null;
  check("Oferta y lead se concentran en un único contacto", contacts.ok && matchingContacts.length === 1 && Boolean(crmContactId), `contactos=${matchingContacts.length}`);
  if (crmContactId) {
    const detail = await api(`/api/admin/contacts/${crmContactId}`, { token });
    const timeline = await api(`/api/admin/contacts/${crmContactId}/timeline`, { token });
    check("El contacto reúne lead y oferta", detail.ok && detail.body?.data?.leads?.length === 1 && detail.body?.data?.offers?.length === 1, `leads=${detail.body?.data?.leads?.length || 0} ofertas=${detail.body?.data?.offers?.length || 0}`);
    check("El timeline comercial muestra la actividad", timeline.ok && (timeline.body?.data || []).some((item) => item.eventType === "offer_pending"), `eventos=${timeline.body?.data?.length || 0}`);
  }

  // --- 7. Cotización --------------------------------------------------------
  const quoteWrongCurrency = await api("/api/admin/quotes", { token, method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, customerName: `Comprador ${marker}`, baseAmount: 125000, discountAmount: 5000, currency: wrongOfferCurrency, validUntil: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) }) });
  check("Cotización con moneda incorrecta se rechaza", quoteWrongCurrency.status === 400, `status ${quoteWrongCurrency.status}`);
  const quote = await api("/api/admin/quotes", { token, method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, leadId: created.leadIds[0] || null, customerName: `Comprador ${marker}`, customerEmail: `e2e-${stamp}@authentiq.test`, basePriceUsd: 125000, discountUsd: 5000, validUntil: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), notes: marker }) });
  check("Se crea una cotización", quote.status === 201, `status ${quote.status}`);
  if (quote.status === 201) {
    created.quoteIds.push(quote.body.data.id);
    check("La cotización queda ligada al mismo contacto", Boolean(crmContactId) && quote.body.data.contactId === crmContactId, `contacto=${quote.body.data.contactId || "ninguno"}`);
    check("El total de la cotización descuenta correctamente", Number(quote.body.data.totalUsd) === 120000, `total ${quote.body.data.totalUsd}`);
    const sent = await api(`/api/admin/quotes/${quote.body.data.id}/status`, { token, method: "PATCH", body: JSON.stringify({ status: "sent" }) });
    check("Se cambia el estado de la cotización", sent.ok && sent.body?.data?.status === "sent", `status ${sent.status}`);
    const shared = await api(`/api/admin/quotes/${quote.body.data.id}/share`, { token, method: "POST" });
    check("Se genera un enlace público firmado", shared.ok && shared.body?.data?.url?.includes("/cotizaciones/"), `status ${shared.status}`);
    const publicToken = shared.body?.data?.url?.split("/cotizaciones/")[1];
    const publicQuote = publicToken ? await api(`/api/public/quotes/${publicToken}`) : { status: 0, body: null };
    check("El enlace público abre la cotización", publicQuote.ok && publicQuote.body?.data?.quoteNumber === quote.body.data.quoteNumber, `status ${publicQuote.status}`);
    const forgedQuote = await api("/api/public/quotes/no-es-un-token-valido");
    check("Un token público falsificado se rechaza", forgedQuote.status === 401, `status ${forgedQuote.status}`);
    const changes = publicToken ? await api(`/api/public/quotes/${publicToken}/decision`, { method: "POST", body: JSON.stringify({ decision: "changes", message: `${marker} revisar forma de pago` }) }) : { status: 0, body: null };
    check("El cliente puede solicitar cambios", changes.ok && changes.body?.data?.status === "sent", `status ${changes.status}`);
    const accepted = publicToken ? await api(`/api/public/quotes/${publicToken}/decision`, { method: "POST", body: JSON.stringify({ decision: "accepted", message: `${marker} confirmado` }) }) : { status: 0, body: null };
    check("El cliente puede aceptar la cotización", accepted.ok && accepted.body?.data?.status === "accepted", `status ${accepted.status}`);
    const repeatedDecision = publicToken ? await api(`/api/public/quotes/${publicToken}/decision`, { method: "POST", body: JSON.stringify({ decision: "accepted" }) }) : { status: 0, body: null };
    check("Una cotización aceptada no admite una segunda decisión", repeatedDecision.status === 409, `status ${repeatedDecision.status}`);

    // El enlace publico va firmado: es lo unico que impide que alguien lea la
    // cotizacion de otro cliente cambiando unas letras de la direccion.
    if (publicToken) {
      const alterado = `${publicToken.slice(0, -2)}${publicToken.slice(-2, -1) === "a" ? "b" : "a"}${publicToken.slice(-1)}`;
      const manipulado = await api(`/api/public/quotes/${alterado}`);
      check("Un enlace de cotizacion alterado se rechaza", manipulado.status === 401, `status ${manipulado.status}`);
      const inventado = await api("/api/public/quotes/no.es.un.token");
      check("Un enlace de cotizacion inventado se rechaza", inventado.status === 401, `status ${inventado.status}`);
      const decisionManipulada = await api(`/api/public/quotes/${alterado}/decision`, { method: "POST", body: JSON.stringify({ decision: "accepted" }) });
      check("No se puede decidir con un enlace alterado", decisionManipulada.status === 401, `status ${decisionManipulada.status}`);
      const decisionInvalida = await api(`/api/public/quotes/${publicToken}/decision`, { method: "POST", body: JSON.stringify({ decision: "borrar" }) });
      check("Una decision no prevista se rechaza", decisionInvalida.status === 400, `status ${decisionInvalida.status}`);
    }

    const raceQuote = await api("/api/admin/quotes", { token, method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, leadId: created.leadIds[0] || null, customerName: `Carrera ${marker}`, customerEmail: `race-${stamp}@authentiq.test`, basePriceUsd: 125000, discountUsd: 0, validUntil: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), notes: `${marker}-race` }) });
    if (raceQuote.status === 201) {
      created.quoteIds.push(raceQuote.body.data.id);
      await api(`/api/admin/quotes/${raceQuote.body.data.id}/status`, { token, method: "PATCH", body: JSON.stringify({ status: "sent" }) });
      const raceShared = await api(`/api/admin/quotes/${raceQuote.body.data.id}/share`, { token, method: "POST" });
      const raceToken = raceShared.body?.data?.url?.split("/cotizaciones/")[1];
      const raceResults = raceToken ? await Promise.all(Array.from({ length: 4 }, () => api(`/api/public/quotes/${raceToken}/decision`, { method: "POST", body: JSON.stringify({ decision: "accepted" }) }))) : [];
      const acceptedCount = raceResults.filter((result) => result.status === 200).length;
      const conflictCount = raceResults.filter((result) => result.status === 409).length;
      check("Aceptación concurrente solo confirma una solicitud", acceptedCount === 1 && conflictCount === 3, `200=${acceptedCount}, 409=${conflictCount}`);
    } else {
      check("Aceptación concurrente solo confirma una solicitud", false, `no se pudo preparar la cotización de carrera: ${raceQuote.status}`);
    }
  }

  const badDiscount = await api("/api/admin/quotes", { token, method: "POST", body: JSON.stringify({ customerName: "X", basePriceUsd: 1000, discountUsd: 5000 }) });
  check("Descuento mayor que el precio se rechaza", badDiscount.status === 400, `status ${badDiscount.status}`);

  // --- 8. Edición reflejada en público -------------------------------------
  const edited = await api(`/api/admin/vehicles/${created.vehicleId}`, { token, method: "PUT", body: JSON.stringify({ ...baseVehicle, status: "published", priceUsd: 131500 }) });
  check("Se edita un vehículo publicado", edited.ok, `status ${edited.status}`);
  const publicEdited = await api("/api/vehicles");
  check("La edición se refleja en el catálogo público", Number((publicEdited.body?.data || []).find((item) => item.id === created.vehicleId)?.priceUsd) === 131500);

  // --- 9. Reservado: visible pero sin ofertas nuevas -----------------------
  await api(`/api/admin/vehicles/${created.vehicleId}`, { token, method: "PUT", body: JSON.stringify({ ...baseVehicle, status: "reserved" }) });
  const publicReserved = await api("/api/vehicles");
  check("Un vehículo reservado sigue visible en el catálogo", (publicReserved.body?.data || []).some((item) => item.id === created.vehicleId));

  const offerReserved = await api("/api/offers", { method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, buyerName: "Tardío", buyerEmail: `reserved-${stamp}@authentiq.test`, amountUsd: 100000, privacyConsent: true }) });
  check("Un vehículo reservado no admite ofertas nuevas", offerReserved.status === 409, `status ${offerReserved.status}`);

  const leadReserved = await api("/api/leads", { method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, name: `Interesado ${marker}`, email: `lead-${stamp}@authentiq.test`, message: marker, privacyConsent: true }) });
  check("Un vehículo reservado sí admite consultas", leadReserved.status === 201, `status ${leadReserved.status}`);
  if (leadReserved.status === 201) created.leadIds.push(leadReserved.body.data.id);

  // --- 10. Desactivación ----------------------------------------------------
  const deactivated = await api(`/api/admin/vehicles/${created.vehicleId}`, { token, method: "DELETE" });
  check("Se desactiva el vehículo", deactivated.status === 204, `status ${deactivated.status}`);
  const publicFinal = await api("/api/vehicles");
  check("El vehículo desactivado desaparece del catálogo", !(publicFinal.body?.data || []).some((item) => item.id === created.vehicleId));

  const offerInactive = await api("/api/offers", { method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, buyerName: "Tardío", buyerEmail: `inactive-${stamp}@authentiq.test`, amountUsd: 100000, privacyConsent: true }) });
  check("No se aceptan ofertas de un vehículo desactivado", offerInactive.status === 404, `status ${offerInactive.status}`);

  // --- 11. SEO y robots -----------------------------------------------------
  const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
  const sitemapText = await sitemap.text();
  check("Sitemap responde XML válido", sitemap.ok && sitemapText.startsWith("<?xml"));
  check("Sitemap no expone vehículos desactivados", !sitemapText.includes(String(created.vehicleId).replace(/-/g, "").slice(0, 8)));

  // --- 12. Errores consistentes --------------------------------------------
  const notFound = await api("/api/ruta-inexistente");
  check("Una ruta de API inexistente responde 404 JSON", notFound.status === 404 && Boolean(notFound.body?.error), `status ${notFound.status}`);

  const badJson = await fetch(`${baseUrl}/api/leads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{no-es-json" });
  check("Un JSON malformado responde 400 y no derriba el API", badJson.status === 400, `status ${badJson.status}`);

  const healthAfter = await api("/api/health");
  check("El API sigue sano tras todas las pruebas", healthAfter.ok && healthAfter.body?.ok === true);

  // --- 13. Recuperación de contraseña mediada por administrador ------------
  const tempUserEmail = `e2e-reset-${stamp}@authentiq.test`;
  const createdUser = await api("/api/admin/users", { token, method: "POST", body: JSON.stringify({ name: `Usuario ${marker}`, email: tempUserEmail, password: "ContraseñaInicial123", role: "seller" }) });
  check("Se crea un usuario de prueba para el reseteo", createdUser.status === 201, `status ${createdUser.status}`);
  if (createdUser.status === 201) {
    const targetUserId = createdUser.body.data.id;
    const reset = await api(`/api/admin/users/${targetUserId}/reset-password`, { token, method: "POST" });
    check("El administrador genera una contraseña temporal", reset.status === 200 && Boolean(reset.body?.data?.temporaryPassword), `status ${reset.status}`);

    const oldPasswordLogin = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: tempUserEmail, password: "ContraseñaInicial123" }) });
    check("La contraseña anterior deja de funcionar tras el reseteo", oldPasswordLogin.status === 401, `status ${oldPasswordLogin.status}`);

    if (reset.status === 200) {
      const tempLogin = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: tempUserEmail, password: reset.body.data.temporaryPassword }) });
      check("La contraseña temporal sí funciona para entrar", tempLogin.ok && tempLogin.body?.user?.mustChangePassword === true, `status ${tempLogin.status}`);

      if (tempLogin.ok) {
        const tempToken = tempLogin.body.token;
        const blockedRead = await api("/api/admin/dashboard", { token: tempToken });
        check("Con contraseña pendiente de cambio, cualquier otra ruta queda bloqueada", blockedRead.status === 403 && blockedRead.body?.code === "MUST_CHANGE_PASSWORD", `status ${blockedRead.status}`);

        const shortPassword = await api("/api/auth/change-password", { token: tempToken, method: "POST", body: JSON.stringify({ newPassword: "corta" }) });
        check("Una contraseña nueva demasiado corta se rechaza", shortPassword.status === 400, `status ${shortPassword.status}`);

        const changed = await api("/api/auth/change-password", { token: tempToken, method: "POST", body: JSON.stringify({ newPassword: "ContraseñaDefinitiva456" }) });
        check("El usuario define su contraseña definitiva", changed.ok && changed.body?.user?.mustChangePassword === false, `status ${changed.status}`);

        if (changed.ok) {
          const afterChangeAccess = await api("/api/admin/dashboard", { token: changed.body.token });
          check("Tras cambiar la contraseña, el acceso normal se restaura", afterChangeAccess.ok, `status ${afterChangeAccess.status}`);
        }

        const finalLogin = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: tempUserEmail, password: "ContraseñaDefinitiva456" }) });
        check("La contraseña definitiva funciona en un login normal", finalLogin.ok && finalLogin.body?.user?.mustChangePassword === false, `status ${finalLogin.status}`);
      }
    }
    await api(`/api/admin/users/${targetUserId}`, { token, method: "PATCH", body: JSON.stringify({ name: `Usuario ${marker}`, role: "seller", isActive: false }) });
  }
}

// Alta de concesionario de principio a fin. Es la puerta de entrada del producto
// y no estaba cubierta: un fallo aquí impide que exista un cliente nuevo.
async function checkDealerSignup() {
  const slug = `e2e-dealer-${stamp}`;
  const email = `e2e-dealer-${stamp}@authentiq.local`;
  const password = "E2E-Authentiq-2026!";
  const payload = { dealershipName: `E2E Motors ${stamp}`, slug, adminName: "E2E Admin", adminEmail: email, adminPassword: password };

  const reserved = await api("/api/auth/register-dealer", { method: "POST", body: JSON.stringify({ ...payload, slug: "www" }) });
  check("Un identificador reservado no puede registrarse", reserved.status === 400, `respondió ${reserved.status}`);

  const short = await api("/api/auth/register-dealer", { method: "POST", body: JSON.stringify({ ...payload, adminPassword: "1234567" }) });
  check("Una contraseña corta no puede registrarse", short.status === 400, `respondió ${short.status}`);

  const signup = await api("/api/auth/register-dealer", { method: "POST", body: JSON.stringify(payload) });
  check("Un concesionario nuevo se registra", signup.status === 201, `respondió ${signup.status}`);
  if (signup.status !== 201) return;
  created.organizationSlug = slug;

  check("El showroom nuevo queda pendiente de aprobación", signup.body?.organization?.approvalStatus === "pending", String(signup.body?.organization?.approvalStatus));
  check("El alta entrega sesión sin pedir login otra vez", Boolean(signup.body?.token));

  const duplicateSlug = await api("/api/auth/register-dealer", { method: "POST", body: JSON.stringify({ ...payload, adminEmail: `otro-${stamp}@authentiq.local` }) });
  check("Un identificador repetido se rechaza", duplicateSlug.status === 409, `respondió ${duplicateSlug.status}`);

  const duplicateEmail = await api("/api/auth/register-dealer", { method: "POST", body: JSON.stringify({ ...payload, slug: `otro-${stamp}` }) });
  check("Un correo repetido se rechaza", duplicateEmail.status === 409, `respondió ${duplicateEmail.status}`);

  // Lo que fallaba: tras registrarse desde el dominio central, volver a entrar
  // por esa misma puerta daba 401 y la persona quedaba fuera de su propia cuenta.
  const relogin = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  check("El dueño nuevo puede volver a iniciar sesión", relogin.status === 200, `respondió ${relogin.status}`);
  check("Su sesión apunta a su propio concesionario", Boolean(relogin.body?.user?.organizationId) && relogin.body?.user?.role === "admin");

  const wrong = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "no-es-la-clave" }) });
  check("Una contraseña incorrecta sigue rechazada", wrong.status === 401, `respondió ${wrong.status}`);

  // Y su backoffice debe estar operativo desde el primer minuto.
  const dashboard = await api("/api/admin/dashboard", { token: relogin.body?.token });
  check("El backoffice del concesionario nuevo responde", dashboard.ok, `respondió ${dashboard.status}`);
  const settings = await api("/api/admin/settings", { token: relogin.body?.token });
  check("Su configuración inicial existe", settings.ok && Boolean(settings.body?.data));
  const trustSettings = await api("/api/admin/settings", { token: relogin.body?.token, method: "PATCH", body: JSON.stringify({ ...settings.body?.data, faqItems: [{ question: "¿Tienen historial?", answer: "Sí, cada unidad se entrega con información revisada." }], testimonials: [{ quote: "Todo fue claro y rápido.", name: "Cliente E2E", detail: "Compra verificada" }] }) });
  check("El dealer puede guardar FAQ y opiniones", trustSettings.ok && trustSettings.body?.data?.faqItems?.length === 1 && trustSettings.body?.data?.testimonials?.length === 1, `status ${trustSettings.status}`);
  const publicTrust = await api("/api/settings", { headers: { "X-Authentiq-Tenant": created.organizationSlug || "" } });
  check("El showroom público recibe su contenido de confianza", publicTrust.ok && publicTrust.body?.data?.faqItems?.[0]?.question === "¿Tienen historial?" && publicTrust.body?.data?.testimonials?.[0]?.name === "Cliente E2E", `status ${publicTrust.status}`);
  const onboarding = await api("/api/admin/onboarding", { token: relogin.body?.token });
  check("Ve su guía de personalización", onboarding.ok && Array.isArray(onboarding.body?.data?.steps));

  // Lo que la guía llama "esencial" tiene que ser exactamente lo que la
  // plataforma exige para aprobar. Si divergen, el dealer lee "listo para
  // recibir compradores" y luego le rechazan la publicación sin entender por qué.
  const steps = onboarding.body?.data?.steps || [];
  const essentials = steps.filter((step) => step.essential).map((step) => step.id).sort();
  const required = ["appointments", "catalog", "contact", "identity", "legal", "logo"];
  check("Lo esencial coincide con lo que exige la aprobación", JSON.stringify(essentials) === JSON.stringify(required), `guía: ${essentials.join(", ")}`);
  check("Un showroom sin completar no se declara listo", onboarding.body?.data?.readyToPublish === (essentials.length === steps.filter((s2) => s2.essential && s2.done).length));
}

// Reservar una visita es la accion de conversion mas directa del catalogo y no
// tenia ninguna prueba: se publico rota (el INSERT usaba 'test-drive' y la
// restriccion de la base solo admite 'test_drive'), asi que TODA reserva moria
// con un 500 y el comprador leia "No se pudo registrar la cita".
async function checkAppointmentBooking() {
  // El flujo principal desactiva su unidad para probar que deja de publicarse.
  // Se vuelve a publicar de forma explícita para que esta prueba sea autónoma
  // y no dependa de datos demo que CI no instala.
  const adminLogin = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const adminToken = adminLogin.body?.token || "";
  const restored = created.vehicleId && adminToken
    ? await api(`/api/admin/vehicles/${created.vehicleId}`, { token: adminToken, method: "PUT", body: JSON.stringify({ ...baseVehicle, status: "published" }) })
    : { status: 0, ok: false };
  check("La unidad E2E se vuelve a publicar para probar citas", restored.ok, `status ${restored.status}`);

  const catalog = await api("/api/vehicles");
  const vehicle = (catalog.body?.data || []).find((item) => item.status === "published");
  check("Hay un vehiculo publicado con el que reservar", Boolean(vehicle), `${(catalog.body?.data || []).length} en catalogo`);
  if (!vehicle) return;

  const day = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
  // Domingo no esta en los dias de atencion por defecto (lunes a sabado).
  if (day.getDay() === 0) day.setDate(day.getDate() + 1);
  const date = localIsoDate(day);

  const availability = await api(`/api/appointments/availability?date=${date}`);
  check("La disponibilidad de citas responde", availability.ok, `respondió ${availability.status}`);
  const slots = availability.body?.data?.slots || availability.body?.slots || [];
  const slot = slots.find((item) => item.available);
  check("Hay al menos un horario libre para reservar", Boolean(slot), `${slots.length} horarios devueltos`);
  if (!slot) return;

  const payload = { vehicleId: vehicle.id, name: `Comprador ${marker}`, email: `comprador-${stamp}@example.com`, phone: "+18095550100", date, time: slot.time, privacyConsent: true, notes: marker };

  const yesterday = localIsoDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const pastDate = await api("/api/appointments", { method: "POST", body: JSON.stringify({ ...payload, date: yesterday }) });
  check("Una cita con fecha pasada explica el error correctamente", pastDate.status === 400 && /fecha ya pasó/i.test(pastDate.body?.error || ""), `respondió ${pastDate.status}`);

  const noConsent = await api("/api/appointments", { method: "POST", body: JSON.stringify({ ...payload, privacyConsent: false }) });
  check("Una cita sin consentimiento de privacidad se rechaza", noConsent.status === 400, `respondió ${noConsent.status}`);

  const noContact = await api("/api/appointments", { method: "POST", body: JSON.stringify({ ...payload, email: "", phone: "" }) });
  check("Una cita sin forma de contacto se rechaza", noContact.status === 400, `respondió ${noContact.status}`);

  const booked = await api("/api/appointments", { method: "POST", body: JSON.stringify(payload) });
  check("Un comprador reserva una visita", booked.status === 201, `respondió ${booked.status} ${JSON.stringify(booked.body).slice(0, 90)}`);
  if (booked.status !== 201) return;
  created.appointmentId = booked.body?.data?.id || null;

  check("La reserva genera un lead en el CRM", Boolean(booked.body?.data?.leadId));
  check("La cita queda ligada a un contacto comercial", Boolean(booked.body?.data?.contactId));

  // El horario reservado tiene que dejar de ofrecerse: si no, dos compradores
  // reservan lo mismo y el concesionario descubre el choque en el mostrador.
  const after = await api(`/api/appointments/availability?date=${date}`);
  const sameSlot = (after.body?.data?.slots || after.body?.slots || []).find((item) => item.time === slot.time);
  check("El horario reservado deja de estar disponible", sameSlot ? sameSlot.available === false : true, JSON.stringify(sameSlot));

  const retry = await api("/api/appointments", { method: "POST", body: JSON.stringify(payload) });
  check("Reservar el mismo horario otra vez se rechaza", retry.status === 409, `respondió ${retry.status}`);

  // Y el concesionario tiene que verla en su agenda.
  const admin = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const agenda = await api("/api/admin/appointments", { token: admin.body?.token });
  const mine = (agenda.body?.data || []).some((item) => item.customerName === payload.name);
  check("La cita aparece en la agenda del concesionario", agenda.ok && mine, `respondió ${agenda.status}`);
  const contacts = await api("/api/admin/contacts", { token: admin.body?.token });
  // El teléfono puede identificar a un contacto que ya existía con otro correo;
  // la fuente de verdad es el contactId devuelto por la reserva, no el correo.
  const contact = (contacts.body?.data || []).find((item) => item.id === booked.body?.data?.contactId);
  const detail = contact ? await api(`/api/admin/contacts/${contact.id}`, { token: admin.body?.token }) : { ok: false, body: null };
  const timeline = contact ? await api(`/api/admin/contacts/${contact.id}/timeline`, { token: admin.body?.token }) : { ok: false, body: null };
  check("La cita aparece en el contacto correcto", detail.ok && (detail.body?.data?.appointments || []).some((item) => item.id === created.appointmentId), `cita=${created.appointmentId || "ninguna"}`);
  check("El timeline incluye la cita", timeline.ok && (timeline.body?.data || []).some((item) => item.eventType === "appointment_pending"), `eventos=${timeline.body?.data?.length || 0}`);
}

async function checkGoogleCalendarIntegration() {
  console.log("\n=== Integración Google Calendar ===");
  const admin = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  check("Inicio de sesión de admin para Google Calendar", admin.ok && Boolean(admin.body?.token));
  const token = admin.body?.token;

  const integrations = await api("/api/admin/integrations", { token });
  check("Consulta del centro de integraciones", integrations.ok, `status=${integrations.status}`);
  const gcalHealth = integrations.body?.data?.health?.googleCalendar;
  check("Estado de salud de Google Calendar presente", Boolean(gcalHealth), `health=${JSON.stringify(gcalHealth)}`);

  const connect = await api("/api/admin/integrations/google-calendar/connect", { token });
  check("Preparación de autorización Google Calendar", connect.ok && Boolean(connect.body?.data?.authorizationUrl), `status=${connect.status}`);
  if (connect.body?.data?.authorizationUrl) {
    const url = new URL(connect.body.data.authorizationUrl);
    check("URL de Google OAuth apunta a accounts.google.com", url.origin === "https://accounts.google.com");
    check("URL de Google OAuth contiene scope de calendar", url.searchParams.get("scope")?.includes("calendar"));
    check("URL de Google OAuth contiene redirect_uri", Boolean(url.searchParams.get("redirect_uri")));
    check("URL de Google OAuth contiene state firmado", Boolean(url.searchParams.get("state")));
  }

  const disconnect = await api("/api/admin/integrations/google-calendar", { method: "DELETE", token });
  check("Desconexión de Google Calendar", disconnect.ok, `status=${disconnect.status}`);
}

async function cleanup() {
  if (!process.env.DATABASE_URL) return;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query("DELETE FROM quotes WHERE notes = $1 OR customer_name LIKE $2", [marker, `%${marker}%`]);
    await pool.query("DELETE FROM offers WHERE buyer_name LIKE $1 OR message = $2", [`%${marker}%`, marker]);
    await pool.query("DELETE FROM leads WHERE name LIKE $1 OR message = $2", [`%${marker}%`, marker]);
    await pool.query("DELETE FROM test_drive_requests WHERE customer_name LIKE $1 OR notes = $2", [`%${marker}%`, marker]);
    if (created.vehicleId) {
      await pool.query("DELETE FROM vehicle_media WHERE vehicle_id = $1", [created.vehicleId]);
      await pool.query("DELETE FROM vehicle_images WHERE vehicle_id = $1", [created.vehicleId]);
      await pool.query("DELETE FROM analytics_events WHERE vehicle_id = $1", [created.vehicleId]);
      await pool.query("DELETE FROM vehicle_favorites WHERE vehicle_id = $1", [created.vehicleId]);
      await pool.query("DELETE FROM vehicles WHERE id = $1", [created.vehicleId]);
    }
    await pool.query("DELETE FROM vehicle_brands WHERE name LIKE $1", [`%${marker}%`]);
    // El alta crea una organización entera: hay que retirarla, y con ella su
    // administrador, para no dejar cuentas activas con una contraseña conocida.
    await pool.query("DELETE FROM admin_users WHERE email LIKE $1", [`%${stamp}@authentiq.local`]);
    await pool.query("DELETE FROM organizations WHERE slug LIKE $1", [`e2e-dealer-${stamp}%`]);
    await pool.query("DELETE FROM organizations WHERE slug LIKE $1", [`otro-${stamp}%`]);
    console.log("\nLimpieza: registros de prueba eliminados.");
  } catch (error) {
    console.error("\nLimpieza incompleta:", error.message);
  } finally {
    await pool.end();
  }
}

try {
  await main();
  await checkAppointmentBooking();
  await checkDealerSignup();
  await checkGoogleCalendarIntegration();
} catch (error) {
  failed += 1;
  console.error("FAIL  Excepción no controlada —", error.message);
} finally {
  await cleanup();
  console.log(`\nResultado E2E: ${passed} pasaron, ${failed} fallaron.`);
  process.exit(failed ? 1 : 0);
}
