#!/usr/bin/env node
/**
 * Headless visual + perf capture for the overhaul.
 *
 *   npm run build && node scripts/capture.mjs <label> [menu|city|range|terminal|citadel|all]
 *
 * Serves dist/ with `vite preview`, opens the game with ?debug in Chromium
 * (SwiftShader WebGL — CPU rendering, so FPS numbers are only comparable
 * run-to-run on this harness, never representative of real GPUs), drives
 * each mode through window.__debug, and writes PNGs plus metrics.json to
 * docs/overhaul/shots/<label>/. Camera positions are fixed so before/after
 * runs line up shot-for-shot.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const label = process.argv[2] ?? "current";
// One mode group per browser process: a SwiftShader crash then costs one group, not the run.
const group = process.argv[3] ?? "all";
const want = (g) => group === "all" || group === g;
const filter = null;
const outDir = path.resolve("docs/overhaul/shots", label);
mkdirSync(outDir, { recursive: true });

const PORT = 4173 + Math.floor(Math.random() * 500);
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort", "--outDir", process.env.DIST ?? "dist"], { stdio: "pipe" });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("vite preview did not start")), 30000);
  server.stdout.on("data", (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t);
      resolve();
    }
  });
});

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(`http://localhost:${PORT}/?debug&fixedquality`);
await page.waitForFunction(() => !!window.__debug, null, { timeout: 120000 });
await page.waitForTimeout(3000);

const metrics = { label, date: new Date().toISOString(), renderer: "", shots: {} };
metrics.renderer = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
});

/** Scene stats + a short frame-time sample with rendering live. */
async function sample() {
  return page.evaluate(async () => {
    const d = window.__debug;
    const scene = d.game.scene;
    const engine = scene.getEngine();
    const times = [];
    let last = performance.now();
    await new Promise((resolve) => {
      // Menus pause rendering; don't wait on frames that never come.
      setTimeout(resolve, 45000);
      let n = 0;
      const obs = scene.onAfterRenderObservable.add(() => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        if (++n >= 3) {
          scene.onAfterRenderObservable.remove(obs);
          resolve();
        }
      });
    });
    times.shift();
    times.sort((a, b) => a - b);
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : NaN;
    return {
      frameMsAvg: +avg.toFixed(1),
      frameMsP95: times.length ? +times[Math.floor(times.length * 0.95)].toFixed(1) : null,
      framesSampled: times.length,
      activeMeshes: scene.getActiveMeshes().length,
      enabledMeshes: scene.meshes.filter((m) => m.isEnabled()).length,
      totalMeshes: scene.meshes.length,
      totalVertices: scene.getTotalVertices(),
      materials: scene.materials.length,
      textures: scene.textures.length,
      lightsEnabled: scene.lights.filter((l) => l.isEnabled()).length,
      drawCalls: engine._drawCalls?.current ?? null,
      jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    };
  });
}

async function shot(name, setup) {
  if (filter && !filter.test(name)) return;
  try {
    if (setup) await page.evaluate(setup);
    await page.waitForTimeout(4000);
    metrics.shots[name] = await sample();
    await page.screenshot({ path: path.join(outDir, `${name}.png`), timeout: 180000 });
    console.log("captured", name, JSON.stringify(metrics.shots[name]));
  } catch (e) {
    metrics.shots[name] = { error: String(e) };
    console.log("FAILED", name, String(e));
  }
}

const look = (yaw, pitch = 0) => `(() => { const d = window.__debug; d.player.collider.rotation.y = ${yaw}; d.player.camera.rotation.x = ${pitch}; })()`;
const ads = (on) => `(() => { window.__debug.input.rightMouseDown = ${on}; })()`;

// ---- Menu ---------------------------------------------------------------
if (want("menu")) await shot("00_menu");

// ---- Survival city (default deployment) ---------------------------------
if (want("city")) {
await page.evaluate(() => { const lp = window.__debug.landingPage(); lp.hide(); lp.onDeploy(); });
await page.waitForTimeout(2500);
await shot("10_city_spawn", look(Math.PI / 4));
await shot("11_city_spawn_ads", ads(true));
await page.evaluate(ads(false));
await shot("12_city_street", () => window.__debug.teleport(0, 2, -40, 0, 0));
await shot("13_city_overlook", () => window.__debug.teleport(-60, 2, 20, 2.2, 0.05));
await shot("14_city_soldiers", () => {
  const d = window.__debug;
  d.teleport(-40, 2, -40, Math.PI, 0.1);
  d.spawnTestSoldiers(-40, 0.05, -44);
});
await shot("15_city_weapon_close", () => window.__debug.teleport(-82, 2, -70, 0.6, -0.25));
}

// ---- Training range -------------------------------------------------------
if (want("range")) {
await page.evaluate(() => window.__debug.enterTrainingRange());
await page.waitForTimeout(2000);
await shot("20_range_firingline", look(0, 0));
await shot("21_range_ads", ads(true));
await page.evaluate(ads(false));
await page.evaluate(() => window.__debug.exitTrainingRangeToMenu());
}

// ---- Pasir Panjang (Operations) -------------------------------------------
if (want("terminal")) {
await page.evaluate(() => window.__debug.enterStrongpointAssault());
await page.waitForTimeout(3000);
await shot("30_terminal_spawn", look(0, 0));
await shot("31_terminal_yard", () => window.__debug.teleport(0, 2, -60, 0.3, 0));
await shot("32_terminal_cranes", () => window.__debug.teleport(40, 2, 0, -1.2, -0.15));
await shot("33_terminal_enemies", () => {
  const d = window.__debug;
  d.teleport(0, 2, -20, 0, 0.05);
  d.spawnTestSoldiers(0, 0.05, -15);
});
await page.evaluate(() => window.__debug.exitStrongpointAssaultToMenu());
}

// ---- Iron Citadel ------------------------------------------------------------
if (want("citadel")) {
await page.evaluate(() => window.__debug.enterIronCitadel());
await page.waitForTimeout(3000);
await shot("40_citadel_spawn", look(0, 0));
await shot("41_citadel_turn", look(Math.PI / 2, 0));
await page.evaluate(() => window.__debug.exitIronCitadelToMenu());
}

metrics.consoleErrors = consoleErrors.slice(0, 50);
writeFileSync(path.join(outDir, `metrics_${group}.json`), JSON.stringify(metrics, null, 2));
console.log("renderer:", metrics.renderer, "errors:", consoleErrors.length);
await browser.close();
server.kill();
process.exit(0);
