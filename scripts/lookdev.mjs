#!/usr/bin/env node
/**
 * Render lookdev views of assets to PNG.
 *
 *   npm run build && node scripts/lookdev.mjs <outDir> <asset:view[:time]> ...
 *
 * e.g. node scripts/lookdev.mjs docs/overhaul/shots/bench sar21_new:three sar21:three
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [outDirArg, ...specs] = process.argv.slice(2);
const outDir = path.resolve(outDirArg ?? "docs/overhaul/shots/lookdev");
mkdirSync(outDir, { recursive: true });
const PORT = 5100 + Math.floor(Math.random() * 500);
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "pipe" });
await new Promise((resolve) => server.stdout.on("data", (d) => String(d).includes(String(PORT)) && resolve()));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const W = Number(process.env.W ?? 960), H = Number(process.env.H ?? 540);
for (const spec of specs) {
  const [asset, view = "three", time = "day", extra = ""] = spec.split(":");
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  try {
    await page.goto(`http://localhost:${PORT}/?lookdev=${asset}&view=${view}&time=${time}&fixedquality${extra ? "&" + extra : ""}`);
    await page.waitForFunction(() => window.__lookdevReady === true, null, { timeout: 150000 });
    const tag = extra ? "_" + extra.replace(/[^a-z0-9.,-]/gi, "") : "";
    const file = path.join(outDir, `${asset}_${view}${time === "night" ? "_night" : ""}${tag}.png`);
    await page.screenshot({ path: file, timeout: 120000 });
    console.log("ok", file, errors.length ? errors.slice(0, 3) : "");
  } catch (e) {
    console.log("FAILED", spec, String(e).slice(0, 300), errors.slice(0, 5));
  }
  await page.close();
}
await browser.close();
server.kill();
process.exit(0);
