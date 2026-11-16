import type { Engine } from "~/core/engine";
import type { MatLib } from "~/gfx/materials";
import { DECAL } from "~/gfx/decals";
import { rr } from "~/gfx/noise";
import { WorldCtx, decal } from "./ctx";
import { GroundPlan, type Rect } from "./ground";
import * as St from "./kit/street";
import { hdbBlock } from "./kit/hdb";

/**
 * NEE SOON ESTATE — the one map.
 *
 * A Singapore public-housing neighbourhood, late afternoon. North is -Z.
 * The avenue runs north-south through the middle; Street 41 crosses it at the
 * origin. South-west is the HDB precinct, south-east the neighbourhood centre
 * and hawker centre, north-west the multi-storey carpark, north-east the
 * community club. A monsoon canal and the MRT viaduct close the north edge.
 */

export const BOUNDS: Rect = [-150, -170, 150, 160];
/** Half-width of the avenue carriageway envelope, and of Street 41. */
export const AVE = 8;
export const ST = 7;

export interface Estate {
  ctx: WorldCtx;
  plan: GroundPlan;
}

export function buildEstate(engine: Engine, lib: MatLib): Estate {
  const ctx = new WorldCtx(engine, lib);
  const plan = new GroundPlan();
  const r = ctx.rand;

  // ---- ground plan -------------------------------------------------------
  plan.add("road", -AVE, -170, AVE, 160); // the avenue
  plan.add("road", -150, -ST, 150, ST); // Street 41
  plan.add("pave", -1, 12, 1, 160); // median, south
  plan.add("pave", -1, -96, 1, -12); // median, north
  // Footpaths flanking both roads.
  for (const s of [-1, 1]) {
    plan.add("path", s * AVE, ST, s * (AVE + 3), 160);
    plan.add("path", s * AVE, -96, s * (AVE + 3), -ST);
    plan.add("path", s * (AVE + 3), ST, s * 150, ST + 3);
    plan.add("path", s * (AVE + 3), -ST - 3, s * 150, -ST);
  }

  const g = ctx.builder("ground");

  // ---- road markings -------------------------------------------------------
  const m = ctx.builder("markings");
  for (const s of [-1, 1]) {
    for (const [za, zb] of [[20, 158], [-94, -20]]) {
      St.dashed(m, s * 4.5, za, s * 4.5, zb, 0.12, 2, 4);
      St.line(m, s * 1.25, za - 6, s * 1.25, zb, 0.12);
      St.line(m, s * 7.7, za, s * 7.7, zb, 0.1, St.YELLOW);
      St.line(m, s * 7.55, za, s * 7.55, zb, 0.1, St.YELLOW);
    }
    for (const [xa, xb] of [[20, 148], [-148, -20]]) {
      St.dashed(m, xa, s * 3.5, xb, s * 3.5, 0.12, 2, 4);
      St.line(m, xa, s * 0.12, xb, s * 0.12, 0.1);
      St.line(m, xa, s * 6.7, xb, s * 6.7, 0.1, St.YELLOW);
    }
    // Stop lines and signalised crossings on all four arms.
    St.line(m, s * 1.2, s * 15.2, s * 7.8, s * 15.2, 0.3);
    St.line(m, s * 15.2, -s * 0.3, s * 15.2, -s * 6.8, 0.3);
    St.zebra(m, 0, s * 11.5, 15.4, 3, "z");
    St.zebra(m, s * 11.5, 0, 13.4, 3, "x");
    for (const lane of [2.9, 6.1]) {
      decal(m, DECAL.arrow, -s * lane, s * 22, 1.3, s > 0 ? 0 : Math.PI, 0.013, undefined, 2.4);
      decal(m, lane > 4 ? DECAL.arrowTurn : DECAL.arrow, -s * lane, s * 30, 1.3, s > 0 ? 0 : Math.PI, 0.013, undefined, 2.4);
    }
    decal(m, DECAL.slow, s * 4.5, s * -52, 2.6, s > 0 ? Math.PI : 0, 0.013, undefined, 1.7);
  }
  St.yellowBox(m, -7.6, -6.6, 7.6, 6.6);

  // Kerbs along every carriageway edge and the median.
  for (const s of [-1, 1]) {
    St.kerb(g, s * AVE, ST + 3, s * AVE, 160);
    St.kerb(g, s * AVE, -96, s * AVE, -ST - 3);
    St.kerb(g, s * (AVE + 3), s * ST, s * 150, s * ST);
    St.kerb(g, s * (AVE + 3), -s * ST, s * 150, -s * ST);
    St.kerb(g, s * 1, 12, s * 1, 160);
    St.kerb(g, s * 1, -96, s * 1, -12);
  }

  // Wear and tear on the carriageway: no two stretches of road alike.
  for (let i = 0; i < 90; i++) {
    const onAve = r() < 0.55;
    const x = onAve ? rr(r, -7, 7) : rr(r, -140, 140);
    const z = onAve ? rr(r, -90, 150) : rr(r, -6, 6);
    const t = r();
    if (t < 0.22) decal(m, DECAL.oil, x, z, rr(r, 0.8, 2.2), r() * 6.3, 0.011);
    else if (t < 0.42) decal(m, DECAL.crack, x, z, rr(r, 2, 4.5), r() * 6.3, 0.011);
    else if (t < 0.56) decal(m, DECAL.patch, x, z, rr(r, 1.5, 3.5), Math.floor(r() * 4) * (Math.PI / 2), 0.0105);
    else if (t < 0.74) decal(m, DECAL.puddle, x, z, rr(r, 1.6, 4.5), r() * 6.3, 0.014);
    else if (t < 0.86) decal(m, DECAL.tyres, x, z, rr(r, 2.4, 3.2), onAve ? 0 : Math.PI / 2, 0.0115, undefined, 2.2);
    else if (t < 0.93) decal(m, DECAL.manhole, x, z, 0.9, 0, 0.0125);
    else decal(m, DECAL.leaves, x, z, rr(r, 1.5, 3), r() * 6.3, 0.015);
  }

  // ---- street furniture ----------------------------------------------------
  const f = ctx.builder("street");
  for (let z = 30; z <= 150; z += 30) St.lampPost(ctx, f, 0, z, 0, 2);
  for (let z = -30; z >= -90; z -= 30) St.lampPost(ctx, f, 0, z, 0, 2);
  for (let x = 35; x <= 140; x += 35) {
    St.lampPost(ctx, f, x, ST + 1.2, Math.PI / 2, 1);
    St.lampPost(ctx, f, -x, -ST - 1.2, -Math.PI / 2, 1);
  }
  St.trafficLight(f, AVE + 0.8, ST + 0.8, Math.PI, true);
  St.trafficLight(f, -AVE - 0.8, -ST - 0.8, 0, true, 2);
  St.trafficLight(f, -AVE - 0.8, ST + 0.8, Math.PI / 2, true, 0);
  St.trafficLight(f, AVE + 0.8, -ST - 0.8, -Math.PI / 2, true, 0);
  St.poleSign(ctx, f, AVE + 1.0, 40, Math.PI, "limit50");
  St.poleSign(ctx, f, -AVE - 1.0, -40, 0, "limit50");
  St.poleSign(ctx, f, AVE + 2.2, ST + 2.2, Math.PI * 0.75, "name", "YISHUN AVE 5");
  St.poleSign(ctx, f, -AVE - 2.2, -ST - 2.2, -Math.PI * 0.25, "name", "YISHUN ST 41");
  for (const s of [-1, 1]) {
    St.railing(f, s * (AVE + 0.35), 16, s * (AVE + 0.35), 46);
    St.railing(f, s * (AVE + 0.35), -16, s * (AVE + 0.35), -44);
  }
  St.ogBox(f, AVE + 5.2, 26, Math.PI / 2);
  St.ogBox(f, -AVE - 5.2, -22, -Math.PI / 2);
  St.hydrant(f, AVE + 3.6, 58);
  St.hydrant(f, -AVE - 3.6, -64);

  // ---- HDB precinct (south-west) -------------------------------------------
  plan.add("screed", -99, 83.5, -19, 96.5);
  plan.add("screed", -102, 14, -89, 78);
  hdbBlock(ctx, { x: -59, z: 90.2, yaw: Math.PI, bays: 20, storeys: 12, number: "411", accent: 0xa8553a, accent2: 0xd9b382, room: [2, 6, "YISHUN ZONE 4 RESIDENTS' COMMITTEE CENTRE"] });
  hdbBlock(ctx, { x: -95.4, z: 46, yaw: Math.PI / 2, bays: 15, storeys: 10, number: "413", accent: 0x3f7a78, accent2: 0xb8d0c4 });

  plan.build(g, BOUNDS);
  ctx.commit(g);
  ctx.commit(m);
  ctx.commit(f);
  engine.scene.add(ctx.root);
  return { ctx, plan };
}
