import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const routes = [
  { path: "/backoffice", heading: /acceso administrativo/i },
  { path: "/privacidad", heading: /datos|privacidad/i },
  { path: "/terminos", heading: /experiencia|términos/i },
];

for (const route of routes) {
  test(`${route.path} monta una pantalla accesible`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(route.heading);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const serious = results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact));
    expect(serious, serious.map((violation) => `${violation.id}: ${violation.help}`).join(" | ")).toEqual([]);
  });
}

test("el catálogo no desborda y la ficha conserva el gesto de galería", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?studio=1", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toContainText(/zevroa|inventario|showroom/i);
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 390);
  const firstVehicle = page.locator(".vehicle-card-image-button").first();
  if (await firstVehicle.count()) {
    await firstVehicle.click();
    await expect(page).toHaveURL(/\/vehiculos\//);
    await expect(page.locator(".embla-viewport")).toBeVisible();
    await expect(page.locator(".detail-carousel-controls")).toBeVisible();
  }
});

test("la búsqueda inteligente ofrece sugerencias y navegación por teclado", async ({ page }) => {
  await page.goto("/?studio=1", { waitUntil: "networkidle" });
  await expect(page.locator(".studio-landing")).toBeVisible();
  const demoButton = page.locator(".studio-actions .studio-link").first();
  await demoButton.click();
  const search = page.getByRole("combobox", { name: /buscar vehículos/i });
  await expect(search).toBeVisible();
  const firstTitle = page.locator(".vehicle-card h3").first();
  if (await firstTitle.count()) {
    const firstWord = (await firstTitle.innerText()).trim().split(/\s+/)[0];
    await search.fill(firstWord.slice(0, Math.max(3, firstWord.length - 1)));
    await expect(page.locator(".smart-search-popover")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(search).toHaveValue(new RegExp(firstWord.slice(0, 3), "i"));
  }
});
