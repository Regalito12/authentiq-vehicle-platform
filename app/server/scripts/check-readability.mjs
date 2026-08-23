// Comprobación de legibilidad del texto de la interfaz.
//
// El requisito es simple: ningún texto funcional por debajo de 14px. Se barrió una
// vez a mano, pero el barrido miró solo `font-size` en la hoja de estilos y dejó
// cuatro tamaños escritos en línea dentro del JSX — uno de 11px en la calculadora
// de financiamiento, que es justo donde el comprador decide si le alcanza.
//
// Esta comprobación mira las dos formas de escribirlo y falla si aparece una nueva.
//
//   node scripts/check-readability.mjs

import fs from "node:fs";
import path from "node:path";

const MINIMO_PX = 14;
const raiz = path.resolve(process.cwd(), "..", "src");

// Excepciones justificadas, con su motivo. Cualquier otra cosa es un fallo.
const excepciones = [
  // Las piezas gráficas se componen a tamaño de impresión (1080x1920 y una hoja
  // A4): sus px no son px de pantalla y escalan con la imagen.
  { archivo: "admin/GraphicsStudio.jsx", motivo: "medidas de impresión, no de pantalla" },
];

function estaExento(relativo) {
  return excepciones.some((item) => relativo.replaceAll("\\", "/").endsWith(item.archivo));
}

function* archivos(dir) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) yield* archivos(completo);
    else if (/\.(jsx?|css)$/.test(entrada.name)) yield completo;
  }
}

const hallazgos = [];

for (const archivo of archivos(raiz)) {
  const relativo = path.relative(raiz, archivo);
  if (estaExento(relativo)) continue;
  const lineas = fs.readFileSync(archivo, "utf8").split("\n");
  lineas.forEach((linea, indice) => {
    const patrones = [
      // CSS: font-size: 12px  |  font: 500 12px "..."
      /font-size:\s*(\d+(?:\.\d+)?)px/g,
      /font:\s*[^;{]*?\b(\d+(?:\.\d+)?)px/g,
      // JSX en línea: fontSize: "12px"
      /fontSize:\s*["'](\d+(?:\.\d+)?)px["']/g,
      // rem por debajo del mínimo (16px de raíz)
      /font-size:\s*(0\.\d+)rem/g,
    ];
    for (const patron of patrones) {
      for (const coincidencia of linea.matchAll(patron)) {
        const bruto = Number(coincidencia[1]);
        const px = String(coincidencia[1]).startsWith("0.") ? bruto * 16 : bruto;
        if (px < MINIMO_PX) {
          hallazgos.push({ relativo, linea: indice + 1, px, texto: linea.trim().slice(0, 100) });
        }
      }
    }
  });
}

if (hallazgos.length) {
  console.error(`FAIL  ${hallazgos.length} texto(s) por debajo de ${MINIMO_PX}px:\n`);
  for (const item of hallazgos) {
    console.error(`  ${String(item.px).padStart(4)}px  ${item.relativo}:${item.linea}`);
    console.error(`         ${item.texto}`);
  }
  console.error("\nSube el tamaño a 14px o más. Si de verdad hay un motivo, añádelo");
  console.error("a la lista de excepciones de este archivo, con su explicación.");
  process.exit(1);
}

console.log(`PASS  Ningún texto de interfaz por debajo de ${MINIMO_PX}px`);
