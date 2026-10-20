import { Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { chamferBox, extrudeProfile, fillet, latheZ, mergeParts, stroke, type P2 } from "@/render/geom";
import { materialLibrary } from "@/render/materials";
import { buildHands } from "@/weapons/models/hands";

/**
 * SAR 21 — Singapore's bullpup service rifle, modelled at true scale from
 * reference pack R-01 (docs/overhaul/REFERENCES.md): 805 mm overall, 508 mm
 * barrel, magazine behind the pistol grip, the 1.5× optic built into the
 * carrying handle, the full-length trigger guard that encloses the firing
 * hand, the LAD in the fore-end, and a translucent 30-round magazine.
 *
 * Frame: origin at the top of the pistol grip, bore axis at y = 0, z forward.
 * Butt plate at z = -0.43, muzzle at z = +0.375.
 */

export interface WeaponModel {
  root: TransformNode;
  muzzle: TransformNode;
  sightOffset: Vector3;
  bodyMeshes: Mesh[];
  sightMeshes: Mesh[];
  hipRest?: Vector3;
  hipRot?: Vector3;
}

const OPTIC_AXIS_Y = 0.095;

export function buildSar21Model(scene: Scene, id = "sar21", withHands = true): WeaponModel {
  const lib = materialLibrary(scene);
  const root = new TransformNode(`vm_${id}`, scene);
  const olive: Mesh[] = [];
  const black: Mesh[] = [];
  const steel: Mesh[] = [];
  const sightOlive: Mesh[] = [];
  const sightMetal: Mesh[] = [];
  const lenses: Mesh[] = [];

  // ---- Butt / receiver body: one moulded profile from butt plate to grip ----
  const body: P2[] = fillet([
    [-0.426, -0.096], [-0.3, -0.088], [-0.17, -0.079], [-0.09, -0.071], [-0.035, -0.049], [0.045, -0.046],
    [0.045, 0.03], [0.0, 0.036], [-0.36, 0.036], [-0.405, 0.031], [-0.43, 0.018], [-0.432, -0.07],
  ], [0.014, 0.004, 0.004, 0.006, 0.004, 0.002, 0.003, 0.004, 0.01, 0.008, 0.006, 0.012], 3);
  olive.push(extrudeProfile(`${id}_body`, scene, body, 0.062, { bevel: 0.004 }));
  // Rubber butt pad.
  black.push(extrudeProfile(`${id}_buttpad`, scene, fillet([[-0.442, -0.097], [-0.428, -0.097], [-0.43, 0.032], [-0.443, 0.03]], 0.004, 2), 0.064, { bevel: 0.003 }));
  // Composite cheek plate on the left flank (safety feature, R-01).
  black.push(extrudeProfile(`${id}_cheek`, scene, fillet([[-0.39, -0.03], [-0.19, -0.022], [-0.185, 0.03], [-0.39, 0.03]], 0.008, 2), 0.006, { bevel: 0.0015, x: -0.0325 }));
  // Ejection port recess (right) and its dark bolt face.
  steel.push(chamferBox(`${id}_ejport`, scene, { w: 0.003, h: 0.02, d: 0.058 }, new Vector3(0.0315, 0.004, -0.13), 0.001));
  // Fire selector at the butt (R-01: rear selector).
  black.push(chamferBox(`${id}_selector`, scene, { w: 0.008, h: 0.012, d: 0.022 }, new Vector3(0.032, -0.062, -0.31), 0.002));

  // ---- Pistol grip (raked) with finger grooves ------------------------------
  const grip: P2[] = fillet([
    [0.036, -0.044], [0.03, -0.075], [0.022, -0.09], [0.026, -0.104], [0.016, -0.12], [0.02, -0.134], [0.008, -0.156],
    [-0.028, -0.152], [-0.012, -0.044],
  ], [0.004, 0.006, 0.006, 0.006, 0.006, 0.006, 0.008, 0.012, 0.004], 2);
  olive.push(extrudeProfile(`${id}_grip`, scene, grip, 0.031, { bevel: 0.005 }));

  // ---- Full trigger guard: grip base forward and up into the fore-end -------
  const guardPath: P2[] = [[0.004, -0.149], [0.06, -0.146], [0.12, -0.13], [0.165, -0.1], [0.186, -0.058]];
  olive.push(extrudeProfile(`${id}_guard`, scene, stroke(guardPath, 0.013), 0.027, { bevel: 0.004, smoothDeg: 50 }));
  // Trigger blade.
  steel.push(extrudeProfile(`${id}_trigger`, scene, stroke([[0.048, -0.046], [0.052, -0.062], [0.047, -0.078]], 0.006), 0.007, { bevel: 0.001, smoothDeg: 60 }));

  // ---- Fore-end with the integral LAD -------------------------------------
  const fore: P2[] = fillet([
    [0.044, -0.046], [0.19, -0.059], [0.245, -0.056], [0.272, -0.036], [0.276, 0.012], [0.262, 0.03], [0.044, 0.03],
  ], [0.003, 0.008, 0.012, 0.01, 0.01, 0.006, 0.003], 3);
  olive.push(extrudeProfile(`${id}_fore`, scene, fore, 0.056, { bevel: 0.005 }));
  // Grip ridges on the fore-end flanks.
  for (const y of [-0.012, -0.03]) {
    black.push(extrudeProfile(`${id}_foreRib${y}`, scene, stroke([[0.08, y], [0.225, y - 0.006]], 0.0045), 0.059, { bevel: 0.001 }));
  }
  // LAD housing under the fore-end nose, lens on its front face (R-01).
  olive.push(extrudeProfile(`${id}_lad`, scene, fillet([[0.19, -0.075], [0.262, -0.07], [0.27, -0.05], [0.19, -0.056]], 0.006, 2), 0.04, { bevel: 0.004 }));
  lenses.push(latheZ(`${id}_ladLens`, scene, [[0.0001, 0.267], [0.0075, 0.267], [0.0075, 0.271], [0.0001, 0.2712]], 14, new Vector3(0, -0.061, 0)));
  black.push(latheZ(`${id}_ladCap`, scene, [[0.0001, 0.21], [0.009, 0.21], [0.009, 0.235], [0.0001, 0.235]], 12, new Vector3(-0.022, -0.064, 0)));

  // ---- Barrel and birdcage flash hider --------------------------------------
  steel.push(latheZ(`${id}_barrel`, scene, [
    [0.0001, 0.24], [0.0105, 0.24], [0.0105, 0.29], [0.0088, 0.296], [0.0088, 0.33], [0.0112, 0.332],
    [0.0112, 0.374], [0.0095, 0.376], [0.0046, 0.376], [0.0046, 0.37], [0.0001, 0.37],
  ], 20));
  // Birdcage slots read as dark notches.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    black.push(chamferBox(`${id}_slot${i}`, scene, { w: 0.003, h: 0.003, d: 0.026 }, new Vector3(Math.cos(a) * 0.0112, Math.sin(a) * 0.0112, 0.355), 0.0006));
  }

  // ---- Carrying handle with the integral 1.5x optic -------------------------
  sightOlive.push(extrudeProfile(`${id}_hPostRear`, scene, fillet([[-0.168, 0.03], [-0.118, 0.03], [-0.122, 0.078], [-0.17, 0.078]], 0.005, 2), 0.03, { bevel: 0.004 }));
  sightOlive.push(extrudeProfile(`${id}_hPostFront`, scene, fillet([[0.05, 0.026], [0.1, 0.026], [0.095, 0.078], [0.058, 0.078]], 0.006, 2), 0.03, { bevel: 0.004 }));
  sightOlive.push(extrudeProfile(`${id}_optic`, scene, fillet([
    [-0.188, 0.07], [0.124, 0.071], [0.128, 0.084], [0.128, 0.114], [0.115, 0.12], [-0.17, 0.122], [-0.188, 0.116],
  ], [0.006, 0.004, 0.006, 0.008, 0.01, 0.012, 0.008], 3), 0.036, { bevel: 0.005 }));
  // Objective bell and eyepiece with rubber eyecup.
  sightMetal.push(latheZ(`${id}_objective`, scene, [[0.0001, 0.12], [0.0175, 0.12], [0.019, 0.128], [0.019, 0.134], [0.0001, 0.134]], 22, new Vector3(0, OPTIC_AXIS_Y, 0)));
  lenses.push(latheZ(`${id}_objLens`, scene, [[0.0001, 0.1345], [0.0158, 0.1345], [0.0158, 0.135], [0.0001, 0.1352]], 22, new Vector3(0, OPTIC_AXIS_Y, 0)));
  black.push(latheZ(`${id}_eyepiece`, scene, [[0.0001, -0.208], [0.0185, -0.208], [0.0175, -0.198], [0.016, -0.186], [0.0001, -0.186]], 22, new Vector3(0, OPTIC_AXIS_Y, 0)));
  lenses.push(latheZ(`${id}_eyeLens`, scene, [[0.0001, -0.2092], [0.0128, -0.2092], [0.0128, -0.2085], [0.0001, -0.2085]], 22, new Vector3(0, OPTIC_AXIS_Y, 0)));
  // Backup iron sights on top of the handle (R-01).
  sightMetal.push(chamferBox(`${id}_ironRearL`, scene, { w: 0.004, h: 0.01, d: 0.008 }, new Vector3(-0.005, 0.127, -0.16), 0.001));
  sightMetal.push(chamferBox(`${id}_ironRearR`, scene, { w: 0.004, h: 0.01, d: 0.008 }, new Vector3(0.005, 0.127, -0.16), 0.001));
  sightMetal.push(chamferBox(`${id}_ironFront`, scene, { w: 0.0025, h: 0.011, d: 0.005 }, new Vector3(0, 0.124, 0.105), 0.0008));
  // Cocking handle, left side under the carry handle.
  steel.push(chamferBox(`${id}_cocking`, scene, { w: 0.014, h: 0.011, d: 0.03 }, new Vector3(-0.036, 0.019, 0.022), 0.002, 0.003));

  // ---- Translucent curved magazine behind the grip -------------------------
  // STANAG-style curve: the front edge sweeps forward as the stack deepens.
  const mag: P2[] = fillet([
    [-0.166, -0.066], [-0.093, -0.066], [-0.084, -0.12], [-0.066, -0.17], [-0.04, -0.222],
    [-0.106, -0.25], [-0.13, -0.2], [-0.15, -0.14],
  ], [0.002, 0.002, 0.02, 0.02, 0.006, 0.006, 0.02, 0.02], 4);
  const magMesh = extrudeProfile(`${id}_mag`, scene, mag, 0.025, { bevel: 0.0025 });
  black.push(extrudeProfile(`${id}_magBase`, scene, fillet([[-0.044, -0.218], [-0.108, -0.246], [-0.114, -0.259], [-0.038, -0.229]], 0.004, 2), 0.029, { bevel: 0.002 }));
  // Rounds stacked inside, visible through the translucent body.
  const rounds = extrudeProfile(`${id}_rounds`, scene, fillet([[-0.16, -0.07], [-0.1, -0.07], [-0.083, -0.14], [-0.138, -0.16]], 0.01, 3), 0.012, { bevel: 0.002 });

  // ---- Hands ----------------------------------------------------------------
  const hands = withHands
    ? buildHands(scene, id, {
        top: new Vector3(0, -0.05, 0.016),
        axis: new Vector3(0, -0.105, -0.03),
        halfWidth: 0.0155,
        trigger: new Vector3(0, -0.06, 0.05),
        elbow: new Vector3(0.16, -0.24, -0.3),
      }, {
        centre: new Vector3(0, -0.016, 0.17),
        along: new Vector3(0, -0.04, 1),
        halfX: 0.028,
        halfY: 0.044,
        elbow: new Vector3(-0.3, -0.3, -0.12),
      })
    : null;

  const bodyMeshes = [
    mergeParts(`vm_${id}_olive`, olive, lib.polymerOlive),
    mergeParts(`vm_${id}_black`, black, lib.polymerBlack),
    mergeParts(`vm_${id}_steel`, steel, lib.gunSteel),
    mergeParts(`vm_${id}_mag`, [magMesh], lib.magTranslucent),
    mergeParts(`vm_${id}_rounds`, [rounds], lib.brass),
  ];
  if (hands) bodyMeshes.push(hands.glove, hands.fabric);
  const sightMeshes = [
    mergeParts(`vm_${id}_handle`, sightOlive, lib.polymerOlive),
    mergeParts(`vm_${id}_opticMetal`, sightMetal, lib.aluminium),
    mergeParts(`vm_${id}_lenses`, lenses, lib.lens),
  ];
  for (const m of [...bodyMeshes, ...sightMeshes]) m.parent = root;

  const muzzle = new TransformNode(`vm_${id}_muzzle`, scene);
  muzzle.parent = root;
  muzzle.position.set(0, 0, 0.378);

    // Shoulder-ready hold: butt at the shoulder (~0.17 right, ~0.15 below the
  // eye), muzzle yawed slightly in and the gun canted so its left flank and
  // the support hand face the camera. Both unwind to zero on ADS.
  return {
    root, muzzle, sightOffset: new Vector3(0, OPTIC_AXIS_Y, -0.21), bodyMeshes, sightMeshes,
    hipRest: new Vector3(0.16, -0.15, 0.45),
    hipRot: new Vector3(-0.04, -0.09, -0.3),
  };
}
