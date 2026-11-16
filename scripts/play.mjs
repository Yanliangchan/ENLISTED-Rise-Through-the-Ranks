// Usage: node scripts/play.mjs <out.png> "<query>" <script.js> [width] [height]
// Runs <script.js> (an async function body with `game`, `THREE`, `wait(frames)`) inside the page, prints its result, then screenshots.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [out, query = "", script, w = "1280", h = "720"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message + "\n" + (e.stack ?? "").split("\n").slice(0, 4).join("\n")));
page.on("console", (m) => { if (m.type() === "error") errs.push("error: " + m.text().slice(0, 400)); });
await page.goto(`http://localhost:5173/play.html?${query}`, { waitUntil: "load" });
try {
  await page.waitForFunction(() => (window.__frames ?? 0) >= 3, null, { timeout: 240000 });
  const body = readFileSync(script, "utf8");
  const res = await page.evaluate(async (src) => {
    const game = window.__game, THREE = window.__THREE;
    const wait = (n) => new Promise((r) => { const t = game.frames + n; const k = () => (game.frames >= t ? r() : setTimeout(k, 15)); k(); });
    return await new (Object.getPrototypeOf(async function () {}).constructor)("game", "THREE", "wait", src)(game, THREE, wait);
  }, body);
  console.log(JSON.stringify(res, null, 1));
} catch (e) { errs.push("FAIL " + String(e).slice(0, 600)); }
await page.screenshot({ path: out });
for (const e of errs.slice(0, 12)) console.log(e);
await browser.close();
