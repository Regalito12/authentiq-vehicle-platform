import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Detecta componentes usados en JSX que no están definidos ni importados en su archivo.
// Existe porque `AnalyticsEventsPanel` se usaba en Reportes sin estar definido: el build
// pasaba y el módulo reventaba en tiempo de ejecución dejando la pantalla en blanco.
//
//   node scripts/check-components.js

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(scriptDir, "../../src");

async function listJsxFiles(directory) {
  const found = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await listJsxFiles(full));
    else if (/\.jsx?$/.test(entry.name) && !entry.name.startsWith("__")) found.push(full);
  }
  return found;
}

// Elementos de HTML/SVG y custom elements se escriben en minúscula o con guion.
const isComponentName = (name) => /^[A-Z]/.test(name);

let problems = 0;
for (const file of await listJsxFiles(sourceDir)) {
  const code = await fs.readFile(file, "utf8");
  const declared = new Set();
  for (const match of code.matchAll(/\b(?:function|class)\s+([A-Za-z0-9_$]+)/g)) declared.add(match[1]);
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/g)) declared.add(match[1]);
  for (const match of code.matchAll(/import\s+([^;]+?)\s+from/g)) {
    for (const piece of match[1].replace(/[{}]/g, ",").split(",")) {
      const name = piece.trim().split(/\s+as\s+/).pop().trim();
      if (name) declared.add(name);
    }
  }

  const used = new Set();
  for (const match of code.matchAll(/<([A-Za-z][A-Za-z0-9_$.]*)/g)) {
    const root = match[1].split(".")[0];
    if (isComponentName(root)) used.add(root);
  }

  for (const name of used) {
    if (!declared.has(name)) {
      problems += 1;
      console.error(`FAIL  ${path.relative(sourceDir, file)} usa <${name}> pero no está definido ni importado`);
    }
  }
}

if (problems) {
  console.error(`\n${problems} componente(s) sin definir. Esto rompe la pantalla en tiempo de ejecución.`);
  process.exit(1);
}
console.log("PASS  Todos los componentes usados en JSX están definidos o importados");
