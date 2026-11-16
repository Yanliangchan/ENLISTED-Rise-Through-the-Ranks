import type { Engine } from "~/core/engine";
import type { MatLib } from "~/gfx/materials";
import { DECAL } from "~/gfx/decals";
import { rr } from "~/gfx/noise";
import { WorldCtx, decal, signQuad as signQuadWorld } from "./ctx";
import { GroundPlan, type Rect } from "./ground";
import * as St from "./kit/street";
import { hdbBlock } from "./kit/hdb";
import * as THREE from "three";
import { Surf } from "~/gfx/builder";
import * as P from "./kit/props";
import * as B from "./kit/buildings";
import { Vegetation } from "./kit/vegetation";
import * as Camp from "./kit/camp";

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

export interface Fire {
  pos: THREE.Vector3;
  size: number;
}

export interface Estate {
  ctx: WorldCtx;
  plan: GroundPlan;
  /** Burning wrecks: the game feeds these with smoke. */
  fires: Fire[];
  anim: Array<(t: number, dt: number) => void>;
}

/** The area soldiers and the player can actually reach. */
export const PLAY: Rect = [-142, -95, 142, 152];

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


  // =====================================================================================
  // Districts
  // =====================================================================================
  ctx.lib.add("facade", new THREE.MeshStandardMaterial({ map: B.facadeTexture(), vertexColors: true, roughness: 0.9 }), 1, Surf.Plaster, "none", { macro: 0.4 });
  const veg = new Vegetation(ctx);
  const d = ctx.builder("dressing");
  const v = ctx.builder("vehicles");
  const fires: Fire[] = [];
  const burn = (x: number, y: number, z: number, size = 1): void => {
    fires.push({ pos: new THREE.Vector3(x, y, z), size });
    decal(m, DECAL.oil, x, z, 3.2 * size, r() * 6.3, 0.016, 0x050505);
  };

  // ---- south-west: more of the HDB precinct -------------------------------------------
  plan.add("path", -40.5, 10, -37.5, 84);
  plan.add("path", -88, 58.5, -11, 61.5);
  plan.add("court", -62, 30, -44, 52);
  B.playground(d, -53, 41);
  B.linkway(ctx, d, -12.6, 60, -86, 60);
  B.linkway(ctx, d, -39, 61.5, -39, 83.4);
  B.busStop(ctx, d, -12.6, 52, Math.PI / 2, "59241");
  for (const [bx, bz, by] of [[-30, 66, 0], [-66, 56, Math.PI], [-48, 28, Math.PI / 2]] as const) St.bench(d, bx, bz, by);
  St.bin(d, -36.6, 57.6);
  for (const [px, pz, py, pl] of [[-30, 82, 0, 8], [-70, 82, 0, 8], [-86, 30, Math.PI / 2, 6]] as const) P.planter(d, px, pz, py, pl, 0);

  // ---- south-east: neighbourhood centre ------------------------------------------------
  plan.add("path", 14, 10, 100, 18.2);
  plan.add("path", 26, 30, 84, 48.5);
  plan.add("screed", 32, 42, 40.5, 80);
  plan.add("path", 39, 76, 82, 82);
  plan.add("path", 80, 30, 86, 82);
  B.shopRow(ctx, { x: 52, z: 22, yaw: Math.PI, units: 8, accent: 0x3f7a78 });
  B.shopRow(ctx, { x: 24, z: 62, yaw: -Math.PI / 2, units: 6, first: 3, accent: 0xa8553a });
  B.hawkerCentre(ctx, { x: 60, z: 62, yaw: 0, cache: [2, 2] });
  plan.add("screed", 34, 96, 100, 110);
  hdbBlock(ctx, { x: 66, z: 103, yaw: 0, bays: 16, storeys: 11, number: "409", accent: 0x5a6f9a, accent2: 0xc9d2e0 });
  for (const [px, pz] of [[34, 36], [46, 40], [60, 37], [74, 41]]) {
    P.planter(d, px, pz, 0, 4.4, 0.15);
    St.bench(d, px, pz + 1.6, 0);
  }
  St.bin(d, 30, 44);
  P.wheelieBin(d, 36.4, 50, 0, 0.15);
  P.wheelieBin(d, 36.4, 52, 0.1, 0.15, 0x2a5a8a);
  P.pallet(d, 34.4, 66, 0.3, 0.15);
  P.crate(d, 34.5, 66, 0.3, 0.9, 0.8);
  P.drum(d, 39.4, 72, 0.15, 0x8a3a2a);
  P.drum(d, 39.5, 73, 0.15);

  // ---- north-west: multi-storey carpark -------------------------------------------------
  plan.add("screed", -87, -70, -29, -31);
  plan.add("road", -62.2, -31, -53.8, -10);
  B.carpark(ctx, { x: -58, z: -48, yaw: 0, number: "406A" });
  St.poleSign(ctx, d, -52.6, -12, 0, "hump");
  P.hesco(d, -50, -27, 0, 4, 1);
  P.hesco(d, -66, -27, 0, 4, 1);
  P.sandbags(d, r, -30, -22, 0.5, 4.2, 4, 0.1);
  P.wire(d, -40, -24, 0.1, 9);

  // ---- north-east: community club ---------------------------------------------------------
  plan.add("pave", 46, -39, 70, -28);
  plan.add("path", 38, -39, 78, -27);
  plan.add("path", 56, -27, 60, -10);
  plan.add("court", 17, -64, 35, -36);
  plan.add("path", 35, -52, 40, -48);
  B.communityClub(ctx, { x: 58, z: -50, yaw: 0, intel: [-11, -3] });
  // Basketball court: lines, hoops, fence on the road side.
  for (const zz of [-63.4, -36.6]) St.line(m, 17.6, zz, 34.4, zz, 0.06, St.WHITE, 0.052);
  for (const xx of [17.6, 34.4]) St.line(m, xx, -63.4, xx, -36.6, 0.06, St.WHITE, 0.052);
  St.line(m, 17.6, -50, 34.4, -50, 0.06, St.WHITE, 0.052);
  for (const s of [-1, 1]) {
    const hz = -50 + s * 12.6;
    d.cyl("steel", 26, 1.6, hz + s * 1.2, 0.08, 3.2, 8, { tint: 0x3a3c3d });
    d.box("steel", 26, 3.1, hz + s * 0.6, 0.08, 0.08, 1.2, { tint: 0x3a3c3d, collide: "none" });
    d.box("plastic", 26, 3.3, hz, 1.8, 1.05, 0.04, { tint: 0xe8e8e4 });
    d.cyl("steel", 26, 3.02, hz - s * 0.28, 0.23, 0.02, 12, { tint: 0xd8521e, collide: "none", caps: false });
  }
  St.railing(d, 16.6, -64, 16.6, -36, 0.1, 0x5a6a5a);
  P.hesco(d, 50, -30, 0, 3, 1);
  P.hesco(d, 66, -30, 0, 3, 1);
  P.sandbagPost(d, r, 58, -24.5, Math.PI, 3.4, 5);
  P.wire(d, 44, -25, 0, 8);

  // ---- north: overhead bridge, canal, viaduct ---------------------------------------------
  plan.add("void", -150, -111.6, -11, -96.4);
  plan.add("void", 11, -111.6, 150, -96.4);
  B.overheadBridge(ctx, d, 0, -78, 0, 23);
  B.canal(d, -150, 150, -104, [-11, 11]);
  B.viaduct(d, -160, 160, -131);
  B.busStop(ctx, d, 12.6, -34, -Math.PI / 2, "59249");

  // ---- the junction: enemy roadblock ---------------------------------------------------------
  P.sandbagPost(d, r, -10.8, 13.4, 0, 3.4, 5);
  P.sandbagPost(d, r, 10.6, 12.2, 0, 3.4, 5);
  P.sandbagPost(d, r, -11, -12.6, Math.PI, 3.2, 5);
  P.sandbagPost(d, r, 11.6, -13.4, Math.PI, 3.2, 5);
  for (const [jx, jz, jy] of [[-5, 19, 0.06], [-1.8, 19.4, -0.1], [3.6, 23, 0.04], [6.6, 22.6, 0.2], [-4.6, -19, 0], [4.4, -21, 0.12], [1.2, -21.4, -0.05]] as const) P.jersey(d, jx, jz, jy, 0xbfbcb2, true);
  for (const [jx, jz, jy] of [[19, -3.6, Math.PI / 2], [19.3, 0.4, Math.PI / 2 + 0.1], [-19, 3.4, Math.PI / 2], [-19.2, -0.6, Math.PI / 2 - 0.1]] as const) P.jersey(d, jx, jz, jy);
  P.hesco(d, 3, -26.5, 0, 4, 1);
  P.wire(d, -3.5, 26, 0.05, 7);
  P.wire(d, 26, 2, Math.PI / 2, 9);
  P.crate(d, -9, 0.15, 9.6, 0.4, 0.9, 0.9, 0x5c6440);
  P.ammoBox(d, -9, 1.05, 9.6, 0.2);
  P.drum(d, 12.6, 0.15, 14.6, 0x4a5338);
  P.tyreStack(d, -13, 9.6, 4, 0.15);
  P.tyreStack(d, 13.6, -9.4, 3, 0.15);
  // Shot-up traffic caught at the lights.
  P.car(v, r, 4.6, 6.2, 0.5, { color: 0x2a2420, wreck: true });
  burn(4.6, 1.2, 6.2);
  P.car(v, r, -3.2, -7.5, 2.4, { color: 0x2a2420, kind: "van", wreck: true });
  burn(-3.2, 1.6, -7.5);
  P.car(v, r, 6.2, 32, Math.PI + 0.06, { color: 0x1f3a6a, kind: "taxi" });
  P.car(v, r, 2.9, 41, Math.PI - 0.3, { color: 0xb8b0a0, kind: "suv" });
  P.car(v, r, -6.1, 30, 0.04, { color: 0x9a9da0 });
  P.car(v, r, -2.8, 52, 0.5, { color: 0xc23a2a, kind: "hatch" });
  P.bus(ctx, v, -5.2, 84, 0.03);
  P.car(v, r, 6.2, 74, Math.PI, { color: 0xd8d8d4, kind: "van" });
  P.car(v, r, 2.8, 96, Math.PI + 0.1, { color: 0x3a5a44 });
  P.car(v, r, -6, -36, 0, { color: 0x2a2c30, kind: "suv" });
  P.car(v, r, 6.3, -52, Math.PI, { color: 0x8a8f94 });
  P.car(v, r, -2.9, -60, 0.2, { color: 0x2a2420, wreck: true });
  burn(-2.9, 1.2, -60);
  P.car(v, r, 36, -3.4, -Math.PI / 2, { color: 0xd8d8d4 });
  P.car(v, r, 62, 3.6, Math.PI / 2, { color: 0x1f3a6a, kind: "hatch" });
  P.car(v, r, 88, -3.5, -Math.PI / 2 + 0.3, { color: 0x2a2420, kind: "suv", wreck: true });
  P.car(v, r, -44, 3.5, Math.PI / 2, { color: 0xc23a2a });
  P.car(v, r, -78, -3.4, -Math.PI / 2, { color: 0x9a9da0, kind: "van" });
  P.car(v, r, -104, 3.6, Math.PI / 2 + 0.2, { color: 0xb8b0a0, kind: "taxi" });

  // ---- insertion point: the section's transport ------------------------------------------------
  P.fiveTonner(v, 5.4, 137, Math.PI);
  P.fiveTonner(v, -4.6, 147, Math.PI, { tilt: false });
  for (const jx of [-6.4, -3.2, 3.2, 6.4]) P.jersey(d, jx, 154.5, 0, 0xbfbcb2, true);
  for (const [cx, cz] of [[1.4, 128], [1.5, 120], [1.3, 112], [-1.4, 133]]) P.cone(d, cx, cz);
  P.crate(d, 9.3, 0.15, 131, 0.2, 0.9, 0.7, 0x5c6440);
  P.ammoBox(d, 9.3, 0.85, 131, 0.5);
  P.ammoBox(d, 9.9, 0.15, 132.2, 1.2);
  P.sandbags(d, r, -9.6, 124, Math.PI / 2, 4.4, 4, 0.15);

  // ---- patrol base (south-east corner by the insertion road) -----------------------------------
  plan.add("dirt", Camp.CAMP[0] - 0.6, Camp.CAMP[1] - 0.6, Camp.CAMP[2] + 0.6, Camp.CAMP[3] + 0.6);
  plan.add("path", 11, 133.4, Camp.CAMP[0] - 0.6, 140.6);
  const camp = ctx.builder("camp");
  Camp.patrolBase(ctx, camp);
  ctx.commit(camp);
  for (const [fx, fz] of [[50, -28.5], [66, -28.5], [47, -28.5]]) Camp.flag(ctx, d, fx, fz, 8.5, 0.15);
  // Hazard lamps still blinking on the abandoned taxi and van.
  for (const [hx, hz] of [[5.45, 34.2], [6.95, 34.3], [5.4, 76.4], [7.0, 76.4]]) Camp.beacon(ctx, hx, 0.72, hz, 0xff8a10, 1.1, 0.055, hz > 50 ? 0.4 : 0);

  // ---- wreckage and debris: cover on every approach ------------------------------------------
  const k = ctx.builder("debris");
  // Overturned trucks, burning.
  P.fiveTonner(k, 3.6, 60, 0.9, { roll: -Math.PI / 2, burnt: true, tilt: false });
  burn(4.6, 2.5, 61.2, 1.6);
  burn(2.2, 2.3, 58.6, 1.1);
  P.fiveTonner(k, 74, -1.5, 1.9, { roll: -Math.PI / 2, burnt: true });
  burn(74.5, 2.5, -1.8, 1.6);
  burn(72.6, 2.2, -0.6, 1.0);
  P.fiveTonner(k, -98, 1.2, -1.2, { roll: Math.PI / 2, burnt: true, tilt: false });
  burn(-98, 2.5, 1, 1.5);
  P.car(k, r, -46, 16, 0.7, { color: 0x2a2420, kind: "van", wreck: true });
  burn(-46, 1.3, 16, 1);
  P.car(k, r, 30, -18, 2.2, { color: 0x2a2420, wreck: true });
  P.car(k, r, 92, 20, 1.1, { color: 0x2a2420, kind: "suv", wreck: true });
  burn(92, 1.2, 20, 0.9);
  P.car(k, r, -5.5, 104, 0.3, { color: 0x2a2420, kind: "hatch", wreck: true });
  P.fallenLamp(k, 3.5, 88, 0.35);
  P.fallenLamp(k, -50, -2, 1.75);
  P.fallenLamp(k, 46, 2, 1.4);
  // Hand-placed cover along the two roads.
  const roadCover: Array<[string, number, number, number]> = [
    ["rubble", -4.5, 44, 0], ["jersey", 5, 48, 0.2], ["jersey", -6.4, 70, -0.1], ["rubble", 5.6, 68, 0], ["crates", -6.2, 96, 0], ["jersey", 2.2, 108, 0.1], ["rubble", -5, 116, 0],
    ["rubble", 4.8, -34, 0], ["jersey", -4.4, -44, 0.15], ["crates", 5.6, -66, 0], ["rubble", -5.4, -72, 0], ["jersey", 3, -88, 0],
    ["rubble", 32, 3.4, 0], ["jersey", 46, -3.8, 1.5], ["crates", 58, -3, 0], ["rubble", 104, 2.6, 0], ["jersey", 116, -2, 1.7], ["rubble", 124, 4, 0],
    ["rubble", -30, -3.6, 0], ["jersey", -36, 3.4, 1.6], ["crates", -66, 3.8, 0], ["rubble", -84, 2.2, 0], ["jersey", -112, -3, 1.5], ["rubble", -124, 3, 0],
    ["wall", 14.5, 44, 1.57], ["wall", -14.5, -50, 1.57], ["pipes", 13.6, 100, 0], ["pipes", -13.4, -28, 0.2], ["container", 15.5, 84, 1.57], ["container", -15, 26, 1.5],
    ["wall", 40, 11.6, 0], ["wall", -70, 11.4, 0], ["wall", 96, -11.4, 0], ["wall", -30, -11.2, 0], ["container", 112, 12.6, 0.1], ["container", -122, -12.4, 0],
    ["rubble", 44, 40, 0], ["crates", 66, 42, 0], ["rubble", 56, 88, 0], ["crates", 84, 60, 0], ["wall", 86.6, 90, 1.57],
  ];
  const tints = [0x8a3a2a, 0x2f5f8a, 0x3f6a4a, 0xb07a2a, 0x6a6d70];
  let ti = 0;
  const place = (kind: string, x: number, z: number, yaw: number): void => {
    if (kind === "rubble") P.rubble(k, r, x, z, rr(r, 1.3, 2.2), rr(r, 0.8, 1.2), z > -7 && z < 7 || Math.abs(x) < 8 ? 0 : 0.1);
    else if (kind === "jersey") {
      P.jersey(k, x, z, yaw);
      P.jersey(k, x + Math.cos(yaw) * 3.1, z - Math.sin(yaw) * 3.1, yaw + rr(r, -0.2, 0.2));
    } else if (kind === "crates") {
      P.pallet(k, x, 0.1, z, yaw);
      P.crate(k, x - 0.2, 0.24, z, yaw + 0.1, 0.95, 0.9);
      P.crate(k, x + 0.9, 0.1, z + 0.3, yaw - 0.3, 0.8, 0.7, 0x7a6a4c);
      if (r() < 0.6) P.crate(k, x - 0.15, 1.14, z, yaw + 0.5, 0.7, 0.55);
      P.drum(k, x - 1.1, 0.1, z - 0.5, tints[ti++ % tints.length]);
    } else if (kind === "wall") P.brokenWall(k, r, x, z, yaw, rr(r, 4, 6.5));
    else if (kind === "pipes") P.pipes(k, x, z, yaw);
    else if (kind === "container") P.container(k, x, z, yaw, tints[ti++ % tints.length], r() < 0.5);
    else if (kind === "sandbags") P.sandbags(k, r, x, z, yaw, rr(r, 3, 4.6), 4, 0.1);
    else if (kind === "wreck") P.car(k, r, x, z, yaw, { color: 0x2a2420, kind: r() < 0.5 ? "sedan" : "van", wreck: true }, 0.1);
    else if (kind === "tyres") {
      P.tyreStack(k, x, z, 4, 0.1);
      P.tyreStack(k, x + 0.72, z + 0.2, 3, 0.1);
      P.tyreStack(k, x + 0.3, z - 0.7, 4, 0.1);
    }
  };
  for (const [kind, x, z, yaw] of roadCover) place(kind, x, z, yaw);
  // Scattered across the open ground between the districts, spaced so there is always a next bound.
  const zones: Rect[] = [
    [-86, 12, -64, 56], [-36, 14, -14, 56], [98, 14, 138, 110], [80, -92, 138, -14], [14, -92, 80, -66], [14, -34, 36, -12],
    [-138, -92, -90, -12], [-28, -92, -14, -34], [-138, 12, -106, 150], [-100, 100, -16, 118], [60, 114, 138, 150], [-90, 122, -14, 150],
  ];
  const kinds = ["rubble", "rubble", "wall", "crates", "pipes", "container", "sandbags", "wreck", "tyres", "wall", "rubble", "sandbags"];
  const placed: Array<[number, number]> = roadCover.map(([, x, z]) => [x, z]);
  for (const zr of zones) {
    const want = Math.max(2, Math.round(((zr[2] - zr[0]) * (zr[3] - zr[1])) / 420));
    let made = 0;
    for (let tries = 0; tries < want * 12 && made < want; tries++) {
      const x = rr(r, zr[0] + 3, zr[2] - 3), z = rr(r, zr[1] + 3, zr[3] - 3);
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 11)) continue;
      placed.push([x, z]);
      place(kinds[Math.floor(r() * kinds.length)], x, z, r() * 6.3);
      made++;
    }
  }
  ctx.commit(k);

  // ---- road ends and the edge of the area of operations ------------------------------------------
  for (const s of [-1, 1]) {
    for (const jz of [-5.2, -1.8, 1.8, 5.2]) P.jersey(d, s * 139, jz, Math.PI / 2, 0xbfbcb2, true);
    P.car(v, r, s * 133, s * 3.4, s * 0.4 + Math.PI / 2, { color: 0xd8d8d4, kind: "van" });
    // Construction hoarding along the east and west edges, and the south.
    d.slab("ribmetal", s * 144 - 0.05, 0, -96, 0.1, 2.6, 254, { tint: 0x3f6a4a, tile: 1.6 });
  }
  d.slab("ribmetal", -144, 0, 157.9, 136, 2.6, 0.1, { tint: 0x3f6a4a, tile: 1.6 });
  d.slab("ribmetal", 8, 0, 157.9, 136, 2.6, 0.1, { tint: 0x3f6a4a, tile: 1.6 });
  d.collisionBox(Surf.Metal, "solid", 0, 3, 157.9, 300, 8, 0.4);
  d.collisionBox(Surf.Metal, "solid", 0, 3, -96.4, 300, 8, 0.4);
  for (const s of [-1, 1]) d.collisionBox(Surf.Metal, "solid", s * 144, 3, 30, 0.4, 8, 260);
  const hoard = ctx.signs.text("hoard", 1024, 256, "#3f6a4a", "#f4f0e2", [["UPGRADING WORKS IN PROGRESS", 60], ["HDB · NEIGHBOURHOOD RENEWAL PROGRAMME", 34], ["DANGER · KEEP OUT", 40]], { border: "#f4f0e2" });
  for (const hz of [-50, 40, 110]) for (const s of [-1, 1]) signQuadWorld(d, hoard, s * 143.9, 1.5, hz, 6, 1.5, (-s * Math.PI) / 2);

  // ---- backdrop: the rest of Yishun beyond the hoardings ---------------------------------------
  const tones = [0xf0e8d8, 0xe8dcc8, 0xe0e4e0, 0xecdccc];
  const blocks: Array<[number, number, number, number, number]> = [
    [-84, 192, 0, 72, 13], [26, 200, 0, 60, 16], [112, 188, 0, 66, 12], [-150, 240, 0, 70, 18], [70, 250, 0, 80, 20],
    [182, 96, Math.PI / 2, 64, 14], [190, 0, Math.PI / 2, 70, 12], [178, -70, Math.PI / 2, 56, 16], [240, 40, Math.PI / 2, 80, 20],
    [-182, 100, Math.PI / 2, 60, 12], [-186, 10, Math.PI / 2, 70, 15], [-178, -74, Math.PI / 2, 56, 13], [-240, 60, Math.PI / 2, 80, 19],
    [-110, -176, 0, 70, 14], [-10, -186, 0, 64, 17], [96, -172, 0, 72, 13], [30, -240, 0, 90, 22], [-150, -236, 0, 80, 19],
  ];
  blocks.forEach(([bx, bz, by, bl, bs], i) => B.backdropBlock(d, bx, bz, by, bl, bs, tones[i % tones.length]));

  // ---- planting ------------------------------------------------------------------------------------
  const t = ctx.builder("trees");
  for (const s of [-1, 1]) {
    for (const tz of [32, 58, 84, 110, 136, -30, -56, -84]) if (tz !== 58 && !(s > 0 && tz === 136)) veg.rainTree(t, s * 13.6 + rr(r, -0.5, 0.5), tz + rr(r, -2, 2), rr(r, 0.85, 1.1));
    for (const tx of [30, 52, 74, 98, 122]) {
      veg.streetTree(t, s * tx + rr(r, -1, 1), s * 12.4, rr(r, 0.9, 1.2));
      veg.streetTree(t, -s * tx + rr(r, -1, 1), s * 12.2, rr(r, 0.9, 1.2));
    }
  }
  for (const [tx, tz, ts] of [[-28, 40, 1.1], [-72, 44, 1], [-64, 70, 0.9], [-24, 74, 0.9], [-112, 100, 1.1], [-120, 30, 1], [-60, 122, 1.1], [-20, 116, 0.9], [-100, 130, 1],
    [100, 60, 1], [112, 24, 1.1], [96, 90, 0.9], [120, 120, 1.1], [24, 112, 0.9], [106, 140, 1],
    [-108, -20, 1], [-100, -64, 1.1], [-22, -70, 0.9], [-120, -84, 1], [-20, -36, 0.8],
    [94, -24, 1], [100, -70, 1.1], [120, -44, 1], [28, -80, 0.9], [84, -86, 1]]) veg.rainTree(t, tx, tz, ts);
  for (const [px, pz] of [[42, -32], [74, -32], [38, 33], [80, 33], [-18, 20], [-18, -20], [18, -20], [86, 46], [86, 70]]) veg.palm(t, px, pz, rr(r, 0.9, 1.1));
  for (let i = 0; i < 70; i++) {
    const sx = rr(r, -138, 138), sz = rr(r, -92, 150);
    if (Math.abs(sx) < 12 || Math.abs(sz) < 11) continue;
    veg.shrub(sx, sz, rr(r, 0.8, 1.5), 0.1, i % 5 === 0 ? 0xc8305a : i % 7 === 0 ? 0xe0a020 : 0);
  }
  // Behind the hoardings: a tree line to soften the backdrop.
  for (let i = 0; i < 26; i++) {
    veg.rainTree(t, -152 - (i % 3) * 5, -90 + i * 9.6, 1.1);
    veg.rainTree(t, 152 + (i % 3) * 5, -90 + i * 9.6, 1.1);
    if (i < 22) veg.rainTree(t, -140 + i * 13.5, 166 + (i % 2) * 6, 1.1);
  }
  veg.finish();
  ctx.commit(d);
  ctx.commit(v);
  ctx.commit(t);

  plan.build(g, BOUNDS);
  ctx.commit(g);
  ctx.commit(m);
  ctx.commit(f);
  engine.scene.add(ctx.root);
  return { ctx, plan, fires, anim: ctx.anim };
}
