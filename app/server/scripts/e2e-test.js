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

let passed = 0;
let failed = 0;
const created = { vehicleId: null, offerIds: [], quoteIds: [], leadIds: [] };

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
  console.log(`E2E AUTHENTIQ · ${baseUrl}\n`);

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

  // --- 6. Consentimiento y ofertas -----------------------------------------
  const offerNoConsent = await api("/api/offers", { method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, buyerName: `Comprador ${marker}`, amountUsd: 120000, privacyConsent: false }) });
  check("Oferta sin consentimiento se rechaza", offerNoConsent.status === 400, `status ${offerNoConsent.status}`);

  const offer = await api("/api/offers", { method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, buyerName: `Comprador ${marker}`, buyerEmail: `e2e-${stamp}@authentiq.test`, amountUsd: 120000, message: marker, privacyConsent: true }) });
  check("Comprador envía una oferta", offer.status === 201, `status ${offer.status}`);
  if (offer.status === 201) { created.offerIds.push(offer.body.data.id); if (offer.body.data.leadId) created.leadIds.push(offer.body.data.leadId); }

  const adminOffers = await api("/api/admin/offers", { token });
  check("La oferta llega al backoffice", (adminOffers.body?.data || []).some((item) => item.id === created.offerIds[0]));

  const adminLeads = await api("/api/admin/leads", { token });
  check("La oferta genera un lead en el CRM", (adminLeads.body?.data || []).some((item) => created.leadIds.includes(item.id)));

  // --- 7. Cotización --------------------------------------------------------
  const quote = await api("/api/admin/quotes", { token, method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, leadId: created.leadIds[0] || null, customerName: `Comprador ${marker}`, customerEmail: `e2e-${stamp}@authentiq.test`, basePriceUsd: 125000, discountUsd: 5000, validUntil: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), notes: marker }) });
  check("Se crea una cotización", quote.status === 201, `status ${quote.status}`);
  if (quote.status === 201) {
    created.quoteIds.push(quote.body.data.id);
    check("El total de la cotización descuenta correctamente", Number(quote.body.data.totalUsd) === 120000, `total ${quote.body.data.totalUsd}`);
    const sent = await api(`/api/admin/quotes/${quote.body.data.id}/status`, { token, method: "PATCH", body: JSON.stringify({ status: "sent" }) });
    check("Se cambia el estado de la cotización", sent.ok && sent.body?.data?.status === "sent", `status ${sent.status}`);
    const shared = await api(`/api/admin/quotes/${quote.body.data.id}/share`, { token, method: "POST" });
    check("Se genera un enlace público firmado", shared.ok && shared.body?.data?.url?.includes("/cotizaciones/"), `status ${shared.status}`);
    const publicToken = shared.body?.data?.url?.split("/cotizaciones/")[1];
    const publicQuote = publicToken ? await api(`/api/public/quotes/${publicToken}`) : { status: 0, body: null };
    check("El enlace público abre la cotización", publicQuote.ok && publicQuote.body?.data?.quoteNumber === quote.body.data.quoteNumber, `status ${publicQuote.status}`);
    const changes = publicToken ? await api(`/api/public/quotes/${publicToken}/decision`, { method: "POST", body: JSON.stringify({ decision: "changes", message: `${marker} revisar forma de pago` }) }) : { status: 0, body: null };
    check("El cliente puede solicitar cambios", changes.ok && changes.body?.data?.status === "sent", `status ${changes.status}`);
    const accepted = publicToken ? await api(`/api/public/quotes/${publicToken}/decision`, { method: "POST", body: JSON.stringify({ decision: "accepted", message: `${marker} confirmado` }) }) : { status: 0, body: null };
    check("El cliente puede aceptar la cotización", accepted.ok && accepted.body?.data?.status === "accepted", `status ${accepted.status}`);
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

  const offerReserved = await api("/api/offers", { method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, buyerName: "Tardío", amountUsd: 100000, privacyConsent: true }) });
  check("Un vehículo reservado no admite ofertas nuevas", offerReserved.status === 409, `status ${offerReserved.status}`);

  const leadReserved = await api("/api/leads", { method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, name: `Interesado ${marker}`, email: `lead-${stamp}@authentiq.test`, message: marker, privacyConsent: true }) });
  check("Un vehículo reservado sí admite consultas", leadReserved.status === 201, `status ${leadReserved.status}`);
  if (leadReserved.status === 201) created.leadIds.push(leadReserved.body.data.id);

  // --- 10. Desactivación ----------------------------------------------------
  const deactivated = await api(`/api/admin/vehicles/${created.vehicleId}`, { token, method: "DELETE" });
  check("Se desactiva el vehículo", deactivated.status === 204, `status ${deactivated.status}`);
  const publicFinal = await api("/api/vehicles");
  check("El vehículo desactivado desaparece del catálogo", !(publicFinal.body?.data || []).some((item) => item.id === created.vehicleId));

  const offerInactive = await api("/api/offers", { method: "POST", body: JSON.stringify({ vehicleId: created.vehicleId, buyerName: "Tardío", amountUsd: 100000, privacyConsent: true }) });
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

async function cleanup() {
  if (!process.env.DATABASE_URL) return;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query("DELETE FROM quotes WHERE notes = $1 OR customer_name LIKE $2", [marker, `%${marker}%`]);
    await pool.query("DELETE FROM offers WHERE buyer_name LIKE $1 OR message = $2", [`%${marker}%`, marker]);
    await pool.query("DELETE FROM leads WHERE name LIKE $1 OR message = $2", [`%${marker}%`, marker]);
    if (created.vehicleId) {
      await pool.query("DELETE FROM vehicle_media WHERE vehicle_id = $1", [created.vehicleId]);
      await pool.query("DELETE FROM vehicle_images WHERE vehicle_id = $1", [created.vehicleId]);
      await pool.query("DELETE FROM analytics_events WHERE vehicle_id = $1", [created.vehicleId]);
      await pool.query("DELETE FROM vehicle_favorites WHERE vehicle_id = $1", [created.vehicleId]);
      await pool.query("DELETE FROM vehicles WHERE id = $1", [created.vehicleId]);
    }
    await pool.query("DELETE FROM vehicle_brands WHERE name LIKE $1", [`%${marker}%`]);
    console.log("\nLimpieza: registros de prueba eliminados.");
  } catch (error) {
    console.error("\nLimpieza incompleta:", error.message);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.error("FAIL  Excepción no controlada —", error.message);
} finally {
  await cleanup();
  console.log(`\nResultado E2E: ${passed} pasaron, ${failed} fallaron.`);
  process.exit(failed ? 1 : 0);
}
