#!/usr/bin/env node
// Asserts the locale switcher actually switches: the kick-off label must
// differ across all six locales and no raw dict keys may leak into the DOM.
import { chromium } from "playwright-core";

const baseUrl = process.argv[2] || "http://localhost:3001";
const LOCALES = ["zh", "en", "ja", "es", "pt", "fr"];

const browser = await chromium.launch({ channel: "chrome", headless: false });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const labels = {};
for (const locale of LOCALES) {
  await page.evaluate((id) => localStorage.setItem("animalCupLocale", id), locale);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  labels[locale] = (await page.locator(".lb-kick .ak-btn").first().textContent())?.trim();
  const leaked = await page.evaluate(() =>
    [...document.querySelectorAll("main *")].some((el) =>
      /^[a-z]+\.[a-zA-Z.]+$/.test(el.textContent?.trim() || "") && el.children.length === 0,
    ),
  );
  if (leaked) {
    console.log(JSON.stringify({ ok: false, reason: `raw dict key leaked in ${locale}` }));
    process.exit(1);
  }
}
await browser.close();

const unique = new Set(Object.values(labels));
const ok = unique.size === LOCALES.length && [...unique].every(Boolean);
console.log(JSON.stringify({ ok, labels }, null, 2));
process.exit(ok ? 0 : 1);
