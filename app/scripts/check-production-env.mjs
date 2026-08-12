const apiUrl = String(process.env.VITE_API_URL || "").trim();

if (!apiUrl) {
  console.log("PRODUCTION ENV PASS · API same-origin (Render sirve frontend y API desde el mismo servicio)");
  process.exit(0);
}

if (!/^https:\/\//i.test(apiUrl) || /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(apiUrl)) {
  console.error("PRODUCTION ENV FAIL · VITE_API_URL debe ser una URL HTTPS pública y no puede apuntar a localhost");
  process.exit(1);
}

console.log(`PRODUCTION ENV PASS · API ${apiUrl}`);
