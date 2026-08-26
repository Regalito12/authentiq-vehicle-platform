// Copy for the public platform landing, in the two languages the showroom ships with.
// Headlines are split into lines so each one can be revealed on its own; `em` marks
// the line that carries the gold accent.
export const LANDING_LANGUAGES = ["es", "en"];

export const LANDING_COPY = {
  es: {
    label: "Español",
    nav: { experience: "La experiencia", how: "Cómo funciona", demo: "Ver demo", login: "Iniciar sesión", cta: "Crear showroom" },
    hero: {
      kicker: "El showroom digital para concesionarios",
      lines: [{ t: "Tu inventario" }, { t: "vende antes", em: true }, { t: "de hablar." }],
      body: "Una experiencia de marca que convierte cada vehículo en una razón para escribirte, visitarte y decidir.",
      primary: "Crear mi showroom",
      secondary: "Explorar una demo",
      metaLeft: "AUTHENTIQ / 2026",
      metaRight: "Inventario · clientes · citas",
    },
    proof: {
      kicker: "La primera impresión",
      lines: [{ t: "El cliente" }, { t: "no quiere" }, { t: "otra tabla" }, { t: "de vehículos." }],
      body: "Quiere imaginarse llegando en uno. AUTHENTIQ convierte tus fotos, datos, video y atención en una experiencia que se entiende sola.",
      action: "Ver el showroom en acción",
      overlayTag: "01 / PRESENTACIÓN",
      overlayLines: [{ t: "Lo que vendes" }, { t: "se siente.", em: true }],
      overlayMeta: "Fotos · video · 3D · ficha · cita",
      imageAlt: "Porsche Taycan presentado en un showroom digital",
    },
    chapters: [
      {
        kicker: "01 · Publica",
        lines: [{ t: "Tu inventario," }, { t: "presentado" }, { t: "como merece." }],
        body: "Cada vehículo sale con ficha completa, fotos ordenadas y una vista previa que apruebas antes de que el cliente lo vea.",
        mediaAlt: "Vehículo publicado en un showroom AUTHENTIQ",
        card: { tag: "Inventario", status: "Publicado", title: "Porsche Taycan Turbo S", meta: "Ficha completa · showroom listo" },
      },
      {
        kicker: "02 · Responde",
        lines: [{ t: "Cada conversación" }, { t: "llega con" }, { t: "su contexto." }],
        body: "Sabes qué vehículo miró, qué preguntó y quién lo atiende. El equipo responde sin reconstruir la historia cada vez.",
        steps: [
          { index: "01 · Señal", title: "El cliente deja pistas.", body: "Visita una ficha, guarda un modelo, pide una cotización. Todo queda registrado." },
          { index: "02 · Lead", title: "María quiere verlo.", quote: "“¿Puedo agendar una visita esta semana?”", meta: "Porsche Taycan Turbo S · hace 4 min" },
          { index: "03 · Respuesta", title: "El equipo contesta con todo a la mano.", body: "Historial, vehículo y próxima acción en la misma pantalla." },
        ],
      },
      {
        kicker: "03 · Cierra",
        lines: [{ t: "De la intención" }, { t: "a la cita firmada." }],
        body: "Agenda, cotiza y da seguimiento hasta que el cliente decide. Sin hojas sueltas ni conversaciones perdidas.",
        action: "Abrir showroom de ejemplo",
        appointment: { tag: "Cita confirmada", status: "Hoy", time: "4:30 PM", meta: "Visita al showroom · Porsche Cayenne Turbo GT" },
        list: [
          { title: "Agenda", body: "El cliente elige hora y tu equipo la confirma en un toque." },
          { title: "Cotiza", body: "Genera una propuesta con precio, plan y condiciones listas para compartir." },
          { title: "Sigue", body: "Cada oportunidad avanza con recordatorios hasta el cierre." },
        ],
      },
    ],
    close: {
      kicker: "Tu siguiente vehículo empieza aquí",
      lines: [{ t: "Haz que tu" }, { t: "inventario" }, { t: "se sienta", em: true }, { t: "propio.", em: true }],
      cta: "Crear mi showroom",
    },
    footer: { tagline: "La vitrina digital para concesionarios.", privacy: "Privacidad", terms: "Términos", legalNav: "Enlaces legales" },
    marqueeBrands: ["Porsche", "BMW", "Mercedes-AMG", "Audi", "Land Rover", "Lexus", "Jaguar", "Alfa Romeo", "Bentley", "Ferrari"],
    marqueeLabel: "Marcas con inventario",
    navAria: "Navegación de AUTHENTIQ",
    langAria: "Idioma",
  },
  en: {
    label: "English",
    nav: { experience: "The experience", how: "How it works", demo: "See demo", login: "Sign in", cta: "Create showroom" },
    hero: {
      kicker: "The digital showroom for dealerships",
      lines: [{ t: "Your inventory" }, { t: "sells before", em: true }, { t: "you speak." }],
      body: "A brand experience that turns every vehicle into a reason to message you, visit you, and decide.",
      primary: "Create my showroom",
      secondary: "Explore a demo",
      metaLeft: "AUTHENTIQ / 2026",
      metaRight: "Inventory · customers · appointments",
    },
    proof: {
      kicker: "The first impression",
      lines: [{ t: "Buyers don't" }, { t: "want another" }, { t: "spreadsheet" }, { t: "of vehicles." }],
      body: "They want to picture themselves arriving in one. AUTHENTIQ turns your photos, specs, video, and service into an experience that explains itself.",
      action: "See the showroom in action",
      overlayTag: "01 / PRESENTATION",
      overlayLines: [{ t: "What you sell" }, { t: "is felt.", em: true }],
      overlayMeta: "Photos · video · 3D · specs · booking",
      imageAlt: "Porsche Taycan presented in a digital showroom",
    },
    chapters: [
      {
        kicker: "01 · Publish",
        lines: [{ t: "Your inventory," }, { t: "presented" }, { t: "as it deserves." }],
        body: "Every vehicle ships with full specs, ordered photography, and a preview you approve before any customer sees it.",
        mediaAlt: "Vehicle published in an AUTHENTIQ showroom",
        card: { tag: "Inventory", status: "Published", title: "Porsche Taycan Turbo S", meta: "Full specs · showroom ready" },
      },
      {
        kicker: "02 · Respond",
        lines: [{ t: "Every conversation" }, { t: "arrives with" }, { t: "its context." }],
        body: "You know which vehicle they viewed, what they asked, and who is handling it. Your team replies without rebuilding the story each time.",
        steps: [
          { index: "01 · Signal", title: "Buyers leave clues.", body: "They open a listing, save a model, request a quote. All of it is recorded." },
          { index: "02 · Lead", title: "María wants to see it.", quote: "“Can I book a visit this week?”", meta: "Porsche Taycan Turbo S · 4 min ago" },
          { index: "03 · Reply", title: "Your team answers with everything at hand.", body: "History, vehicle, and next action on the same screen." },
        ],
      },
      {
        kicker: "03 · Close",
        lines: [{ t: "From intent" }, { t: "to a booked visit." }],
        body: "Schedule, quote, and follow through until the customer decides. No loose spreadsheets, no lost conversations.",
        action: "Open example showroom",
        appointment: { tag: "Appointment confirmed", status: "Today", time: "4:30 PM", meta: "Showroom visit · Porsche Cayenne Turbo GT" },
        list: [
          { title: "Schedule", body: "The customer picks a time and your team confirms it in one tap." },
          { title: "Quote", body: "Generate a proposal with pricing, plan, and terms ready to share." },
          { title: "Follow up", body: "Every opportunity moves forward with reminders until it closes." },
        ],
      },
    ],
    close: {
      kicker: "Your next vehicle starts here",
      lines: [{ t: "Make your" }, { t: "inventory" }, { t: "feel like", em: true }, { t: "your own.", em: true }],
      cta: "Create my showroom",
    },
    footer: { tagline: "The digital storefront for dealerships.", privacy: "Privacy", terms: "Terms", legalNav: "Legal links" },
    marqueeBrands: ["Porsche", "BMW", "Mercedes-AMG", "Audi", "Land Rover", "Lexus", "Jaguar", "Alfa Romeo", "Bentley", "Ferrari"],
    marqueeLabel: "Brands in inventory",
    navAria: "AUTHENTIQ navigation",
    langAria: "Language",
  },
};
