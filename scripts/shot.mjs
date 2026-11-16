// Usage: node scripts/shot.mjs <out.png> "<query string>" [frames] [width] [height]
import { chromium } from "playwright";
const [out, query = "", frames = "4", w = "1280", h = "720"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.type() + ": " + m.text().slice(0, 400)); });
const t0 = Date.now();
await page.goto(`http://localhost:5173/play.html?${query}`, { waitUntil: "load" });
try {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, +frames, { timeout: 240000 });
} catch (e) { errs.push("TIMEOUT waiting for frames"); }
await page.screenshot({ path: out });
console.log(`shot ${out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const e of errs.slice(0, 12)) console.log(e);
await browser.close();
