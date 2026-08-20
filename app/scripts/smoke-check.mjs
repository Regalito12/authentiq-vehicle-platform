import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = join(appRoot, "dist");

const requiredFiles = [
  join(distRoot, "index.html"),
  join(appRoot, "src", "App.jsx"),
  join(appRoot, "src", "admin", "Backoffice.jsx"),
  join(appRoot, "src", "styles.css"),
];

for (const file of requiredFiles) {
  await access(file);
}

const html = await readFile(join(distRoot, "index.html"), "utf8");
if (!html.includes("<div id=\"root\">") || !html.includes("<script")) {
  throw new Error("dist/index.html no parece contener el shell de la aplicación");
}

const assetFiles = await readdir(join(distRoot, "assets"));
if (!assetFiles.some((file) => /\.(js|css)$/.test(file))) {
  throw new Error("El build no generó assets JS/CSS");
}

console.log(`SMOKE PASS · ${assetFiles.length} assets de producción presentes`);
