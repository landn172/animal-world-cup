#!/usr/bin/env node
// Quick real-Chrome screenshot: node script/shot.mjs <url> <outPath> [waitMs] [clickText]
import { chromium } from "playwright-core";

const [url, out, waitMs = "2500", clickText] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node script/shot.mjs <url> <outPath> [waitMs] [clickText]");
  process.exit(1);
}
const browser = await chromium.launch({ channel: "chrome", headless: false });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
if (clickText) {
  await page.waitForTimeout(1_500);
  await page.locator(`text=${clickText}`).first().click();
}
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out });
await browser.close();
console.log("saved", out);
