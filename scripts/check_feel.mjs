#!/usr/bin/env node
/**
 * Headless check of the viewmodel motion layer (ViewmodelMotion) and the
 * throwable-slot holster fix, at the training range.
 *
 *   npm run build && node scripts/check_feel.mjs
 *
 * Prints PASS/FAIL per check; exits non-zero on any failure.
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 5600 + Math.floor(Math.random() * 300);
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "pipe" });
await new Promise((r) => server.stdout.on("data", (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/?debug&fixedquality`);
await page.waitForFunction(() => !!window.__debug, null, { timeout: 180000 });
await page.evaluate(() => window.__debug.enterTrainingRange());

/** Wait for n rendered frames. */
const frames = (n) =>
  page.evaluate(
    (n) =>
      new Promise((res) => {
        const s = window.__debug.game.scene;
        let k = 0;
        const o = s.onAfterRenderObservable.add(() => {
          if (++k >= n) {
            s.onAfterRenderObservable.remove(o);
            res();
          }
        });
      }),
    n
  );
const state = () =>
  page.evaluate(() => {
    const wc = window.__debug.weaponController;
    const vm = wc.activeViewmodel;
    return {
      enabled: vm?.root.isEnabled(),
      pos: vm ? [vm.root.position.x, vm.root.position.y, vm.root.position.z] : null,
      rotX: vm?.root.rotation.x,
      mag: wc.ammo?.mag,
    };
  });

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, detail ?? "");
  if (!ok) failed++;
};

await frames(40); // spawn drops the player from y=2 — let the landing dip settle first
const idle1 = await state();
await frames(3);
const idle2 = await state();
check("viewmodel visible at range", idle1.enabled === true, idle1);
check("idle is stable (no drift)", Math.abs(idle1.pos[1] - idle2.pos[1]) < 0.01, { y1: idle1.pos[1], y2: idle2.pos[1] });

// Fire a short burst: kick must move the gun back/up, then recover.
const magBefore = (await state()).mag;
await page.evaluate(() => (window.__debug.input.leftMouseDown = true));
await frames(2);
const firing = await state();
await page.evaluate(() => (window.__debug.input.leftMouseDown = false));
await frames(10);
const settled = await state();
check("burst spends ammo", firing.mag < magBefore, { magBefore, magAfter: firing.mag });
check("kick pushes gun back", firing.pos[2] < idle2.pos[2] - 0.003, { idleZ: idle2.pos[2], firingZ: firing.pos[2] });
check("kick recovers", Math.abs(settled.pos[2] - idle2.pos[2]) < 0.004, { idleZ: idle2.pos[2], settledZ: settled.pos[2] });

// Throwable slot: gun hidden and the trigger must not fire it.
await page.evaluate(() => window.__debug.input && window.__debug.loadoutSwitch?.("throwable"));
const hasSwitch = await page.evaluate(() => !!window.__debug.loadoutSwitch);
if (!hasSwitch) {
  // No loadout hook exposed: drive it through setViewmodelVisible, which is what Loadout calls.
  await page.evaluate(() => window.__debug.weaponController.setViewmodelVisible(false));
}
const magHolster = (await state()).mag;
await page.evaluate(() => (window.__debug.input.leftMouseDown = true));
await frames(4);
await page.evaluate(() => (window.__debug.input.leftMouseDown = false));
const holstered = await state();
check("holstered gun stays hidden", holstered.enabled === false, holstered);
check("holstered gun does not fire", holstered.mag === magHolster, { before: magHolster, after: holstered.mag });

// Back to the rifle: equip raise starts low and comes up.
await page.evaluate(() => window.__debug.weaponController.setViewmodelVisible(true));
await frames(1);
const raising = await state();
await frames(12);
const raised = await state();
check("equip starts lowered", raising.pos[1] < raised.pos[1] - 0.02, { raisingY: raising.pos[1], raisedY: raised.pos[1] });
check("no page errors", errors.length === 0, errors.slice(0, 3));

await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
