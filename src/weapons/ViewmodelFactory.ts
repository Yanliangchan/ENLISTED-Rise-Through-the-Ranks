import {
  Scene,
  TransformNode,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Mesh,
} from "@babylonjs/core";
import type { Weapon } from "@/data/weapons";

const DARK_METAL = new Color3(0.12, 0.12, 0.13);
const TAN_POLYMER = new Color3(0.25, 0.23, 0.18);
const SIGHT_HOUSING = new Color3(0.08, 0.08, 0.09);
const IRON_SIGHT_TIP = new Color3(0.85, 0.55, 0.15);

export interface Viewmodel {
  root: TransformNode;
  muzzle: TransformNode;
  /** World-ish local offset of the sight/optic — WeaponController lines this up with screen centre on ADS. */
  sightOffset: Vector3;
  /** Bulky body/barrel/mag meshes — WeaponController hides these on ADS so the sight isn't a giant looming block. */
  bodyMeshes: Mesh[];
  /** Iron-sight / optic-housing meshes — hidden on ADS for red-dot/holo optics so the housing doesn't occlude the reticle. */
  sightMeshes: Mesh[];
}

/** Muzzle tip offset (local, metres forward/up) per weapon class. */
const MUZZLE_OFFSET: Record<Weapon["class"], Vector3> = {
  rifle: new Vector3(0, 0.01, 0.5),
  pistol: new Vector3(0, 0.02, 0.14),
  dmr: new Vector3(0, 0.01, 0.78),
  sniper: new Vector3(0, 0.01, 0.78),
  lmg: new Vector3(0, 0.02, 0.62),
  hmg: new Vector3(0, 0.03, 0.8),
  launcher: new Vector3(0, 0, 0.7),
};

function lensMaterial(scene: Scene, name: string, color: Color3): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.emissiveColor = color;
  mat.diffuseColor = color.scale(0.3);
  mat.disableLighting = true;
  return mat;
}

/**
 * Builds a recognisable low-poly silhouette per weapon class — bullpup for
 * rifles, long-barrel for snipers/DMRs, box+belt for LMGs, tube for launchers
 * — plus a distinct sight/optic (reflex dot, iron sights, or a proper 2-lens
 * scope) so aiming actually reads as "looking down the sights". Placeholder
 * until real `.glb` models are swapped in via GLTFLoader.
 */
export function buildViewmodel(weapon: Weapon, scene: Scene): Viewmodel {
  const root = new TransformNode(`viewmodel_${weapon.id}`, scene);
  const mat = new StandardMaterial(`viewmodelMat_${weapon.id}`, scene);
  mat.diffuseColor = weapon.class === "pistol" ? TAN_POLYMER : DARK_METAL;
  mat.specularColor = new Color3(0.15, 0.15, 0.15);

  const housingMat = new StandardMaterial(`sightHousingMat_${weapon.id}`, scene);
  housingMat.diffuseColor = SIGHT_HOUSING;
  housingMat.specularColor = Color3.Black();

  const ironMat = new StandardMaterial(`ironSightMat_${weapon.id}`, scene);
  ironMat.diffuseColor = IRON_SIGHT_TIP;
  ironMat.specularColor = Color3.Black();

  const parts: Mesh[] = [];
  const sightParts: Mesh[] = [];
  let sightOffset = new Vector3(0, 0.1, 0.1);

  switch (weapon.class) {
    case "rifle": {
      // Bullpup silhouette matching the SAR 21's real layout: the receiver and
      // stock sit behind the trigger group (not a separate buttstock sticking
      // out back), the magazine and pistol grip are roughly centred under the
      // action rather than at the very rear, and a carry-handle rail bridges
      // the top over the optic — distinct tapered handguard forward of that.
      const stock = MeshBuilder.CreateBox("stock", { width: 0.082, height: 0.125, depth: 0.22 }, scene);
      stock.position.set(0, 0.005, -0.2);
      const receiver = MeshBuilder.CreateBox("receiver", { width: 0.09, height: 0.13, depth: 0.24 }, scene);
      receiver.position.set(0, 0, 0.02);
      const handguard = MeshBuilder.CreateBox("handguard", { width: 0.07, height: 0.09, depth: 0.2 }, scene);
      handguard.position.set(0, -0.01, 0.24);
      const barrel = MeshBuilder.CreateCylinder("barrel", { diameter: 0.022, height: 0.16 }, scene);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.01, 0.42);
      const mag = MeshBuilder.CreateBox("mag", { width: 0.045, height: 0.24, depth: 0.075 }, scene);
      mag.position.set(0, -0.17, 0.07);
      mag.rotation.x = -0.08;
      const grip = MeshBuilder.CreateBox("grip", { width: 0.048, height: 0.15, depth: 0.055 }, scene);
      grip.position.set(0, -0.11, 0.17);
      grip.rotation.x = 0.15;
      const carryHandle = MeshBuilder.CreateBox("carryHandle", { width: 0.018, height: 0.045, depth: 0.3 }, scene);
      carryHandle.position.set(0, 0.09, -0.03);
      const trigger = MeshBuilder.CreateBox("trigger", { width: 0.012, height: 0.03, depth: 0.01 }, scene);
      trigger.position.set(0, -0.05, 0.12);
      parts.push(stock, receiver, handguard, barrel, mag, grip, carryHandle, trigger);

      // Compact integral scope (matches the SAR 21's real 1.5x integral optic): short
      // tube + objective/ocular lenses, sitting on the carry handle. Kept small — ADS
      // brings the sight right up to the camera, so full-size gun-scale geometry here
      // would loom into frame as a block.
      sightOffset = new Vector3(0, 0.12, -0.03);
      const scopeTube = MeshBuilder.CreateCylinder("sightScopeTube", { diameter: 0.013, height: 0.045 }, scene);
      scopeTube.rotation.x = Math.PI / 2;
      scopeTube.position.copyFrom(sightOffset);
      scopeTube.material = housingMat;
      const objective = MeshBuilder.CreateCylinder("sightObjective", { diameter: 0.016, height: 0.004 }, scene);
      objective.rotation.x = Math.PI / 2;
      objective.position.set(sightOffset.x, sightOffset.y, sightOffset.z + 0.023);
      objective.material = lensMaterial(scene, `sightObjectiveLens_${weapon.id}`, new Color3(0.9, 0.2, 0.15));
      const ocular = MeshBuilder.CreateCylinder("sightOcular", { diameter: 0.012, height: 0.003 }, scene);
      ocular.rotation.x = Math.PI / 2;
      ocular.position.set(sightOffset.x, sightOffset.y, sightOffset.z - 0.022);
      ocular.material = lensMaterial(scene, `sightOcularLens_${weapon.id}`, new Color3(0.15, 0.35, 0.5));
      sightParts.push(scopeTube, objective, ocular);
      break;
    }
    case "pistol": {
      // H&K P30: slide with a squared-off nose, polymer frame with a
      // dust-cover accessory rail, angled grip with a beavertail, and a
      // trigger inside its guard.
      const slide = MeshBuilder.CreateBox("slide", { width: 0.042, height: 0.085, depth: 0.23 }, scene);
      slide.position.set(0, 0.03, 0.02);
      const frame = MeshBuilder.CreateBox("frame", { width: 0.04, height: 0.05, depth: 0.24 }, scene);
      frame.position.set(0, -0.025, 0.02);
      frame.material = housingMat;
      const dustRail = MeshBuilder.CreateBox("dustRail", { width: 0.03, height: 0.02, depth: 0.06 }, scene);
      dustRail.position.set(0, -0.05, 0.12);
      dustRail.material = housingMat;
      const grip = MeshBuilder.CreateBox("grip", { width: 0.048, height: 0.15, depth: 0.075 }, scene);
      grip.position.set(0, -0.1, -0.07);
      grip.rotation.x = 0.2; // rake back like a real pistol grip
      grip.material = housingMat;
      const beavertail = MeshBuilder.CreateBox("beavertail", { width: 0.04, height: 0.02, depth: 0.05 }, scene);
      beavertail.position.set(0, -0.01, -0.11);
      beavertail.material = housingMat;
      const guard = MeshBuilder.CreateTorus("triggerGuard", { diameter: 0.06, thickness: 0.008, tessellation: 12 }, scene);
      guard.rotation.x = Math.PI / 2;
      guard.position.set(0, -0.05, -0.02);
      guard.material = housingMat;
      const trigger = MeshBuilder.CreateBox("trigger", { width: 0.008, height: 0.025, depth: 0.008 }, scene);
      trigger.position.set(0, -0.05, -0.02);
      trigger.material = ironMat;
      parts.push(slide, frame, dustRail, grip, beavertail, guard, trigger);

      // Simple front-post + rear-notch iron sights (kept small — see rifle note above).
      sightOffset = new Vector3(0, 0.082, -0.06);
      const rearSight = MeshBuilder.CreateBox("rearSight", { width: 0.014, height: 0.006, depth: 0.005 }, scene);
      rearSight.position.copyFrom(sightOffset);
      rearSight.material = ironMat;
      const frontSight = MeshBuilder.CreateBox("frontSight", { width: 0.0025, height: 0.006, depth: 0.0025 }, scene);
      frontSight.position.set(0, 0.082, 0.13);
      frontSight.material = ironMat;
      sightParts.push(rearSight, frontSight);
      break;
    }
    case "dmr":
    case "sniper": {
      const body = MeshBuilder.CreateBox("body", { width: 0.075, height: 0.11, depth: 0.62 }, scene);
      body.position.set(0, 0, 0.02);
      const barrel = MeshBuilder.CreateCylinder("barrel", { diameter: 0.024, height: 0.5 }, scene);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.01, 0.56);
      // Muzzle brake / flash hider at the end of the barrel.
      const brake = MeshBuilder.CreateCylinder("brake", { diameter: 0.036, height: 0.06 }, scene);
      brake.rotation.x = Math.PI / 2;
      brake.position.set(0, 0.01, 0.82);
      brake.material = housingMat;
      // Pistol grip + buttstock with a raised cheek riser (comb) for scope use.
      const grip = MeshBuilder.CreateBox("grip", { width: 0.05, height: 0.15, depth: 0.06 }, scene);
      grip.position.set(0, -0.11, -0.1);
      grip.rotation.x = 0.2;
      const stock = MeshBuilder.CreateBox("stock", { width: 0.06, height: 0.1, depth: 0.24 }, scene);
      stock.position.set(0, -0.02, -0.32);
      const cheek = MeshBuilder.CreateBox("cheek", { width: 0.05, height: 0.04, depth: 0.18 }, scene);
      cheek.position.set(0, 0.05, -0.3);
      cheek.material = housingMat;
      const mag = MeshBuilder.CreateBox("mag", { width: 0.05, height: 0.18, depth: 0.07 }, scene);
      mag.position.set(0, -0.14, 0.06);
      parts.push(body, barrel, brake, grip, stock, cheek, mag);
      if (weapon.class === "sniper") {
        // Bolt handle sticking out the right of the receiver.
        const bolt = MeshBuilder.CreateCylinder("bolt", { diameter: 0.012, height: 0.09 }, scene);
        bolt.rotation.z = Math.PI / 2;
        bolt.position.set(0.08, 0.02, -0.08);
        bolt.material = housingMat;
        const boltKnob = MeshBuilder.CreateSphere("boltKnob", { diameter: 0.024 }, scene);
        boltKnob.position.set(0.13, 0.02, -0.08);
        boltKnob.material = housingMat;
        parts.push(bolt, boltKnob);
      }

      // Full scope: tube + objective/ocular lenses (tinted glass) + turret knobs
      // (kept small — see rifle note above).
      sightOffset = new Vector3(0, 0.1, 0.05);
      const scopeTube = MeshBuilder.CreateCylinder("scopeTube", { diameter: 0.012, height: 0.075 }, scene);
      scopeTube.rotation.x = Math.PI / 2;
      scopeTube.position.copyFrom(sightOffset);
      scopeTube.material = mat;
      const objective = MeshBuilder.CreateCylinder("objectiveLens", { diameter: 0.015, height: 0.004 }, scene);
      objective.rotation.x = Math.PI / 2;
      objective.position.set(sightOffset.x, sightOffset.y, sightOffset.z + 0.038);
      objective.material = lensMaterial(scene, `objectiveLens_${weapon.id}`, new Color3(0.2, 0.5, 0.65));
      const ocular = MeshBuilder.CreateCylinder("ocularLens", { diameter: 0.011, height: 0.003 }, scene);
      ocular.rotation.x = Math.PI / 2;
      ocular.position.set(sightOffset.x, sightOffset.y, sightOffset.z - 0.037);
      ocular.material = lensMaterial(scene, `ocularLens_${weapon.id}`, new Color3(0.15, 0.35, 0.5));
      const turret = MeshBuilder.CreateCylinder("turret", { diameter: 0.006, height: 0.008 }, scene);
      turret.position.set(sightOffset.x, sightOffset.y + 0.008, sightOffset.z);
      turret.material = housingMat;
      sightParts.push(scopeTube, objective, ocular, turret);
      break;
    }
    case "lmg": {
      const body = MeshBuilder.CreateBox("body", { width: 0.1, height: 0.15, depth: 0.55 }, scene);
      body.position.set(0, 0, 0.02);
      // Ribbed heavy barrel with a slotted flash hider.
      const barrel = MeshBuilder.CreateCylinder("barrel", { diameter: 0.032, height: 0.44 }, scene);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, 0.44);
      const flashHider = MeshBuilder.CreateCylinder("flashHider", { diameter: 0.048, height: 0.07 }, scene);
      flashHider.rotation.x = Math.PI / 2;
      flashHider.position.set(0, 0.02, 0.68);
      flashHider.material = housingMat;
      // Feed-tray cover (raised hump on top of the receiver) + carry handle.
      const feedCover = MeshBuilder.CreateBox("feedCover", { width: 0.09, height: 0.05, depth: 0.24 }, scene);
      feedCover.position.set(0, 0.1, 0.05);
      feedCover.material = housingMat;
      const mgCarryHandle = MeshBuilder.CreateBox("mgCarryHandle", { width: 0.02, height: 0.05, depth: 0.13 }, scene);
      mgCarryHandle.position.set(0.02, 0.16, 0.08);
      mgCarryHandle.material = housingMat;
      // Belt box + a short hanging belt of rounds feeding into the left side.
      const beltBox = MeshBuilder.CreateBox("beltbox", { width: 0.13, height: 0.13, depth: 0.14 }, scene);
      beltBox.position.set(-0.02, -0.14, -0.05);
      const belt = MeshBuilder.CreateBox("belt", { width: 0.03, height: 0.09, depth: 0.05 }, scene);
      belt.position.set(-0.07, -0.05, 0.02);
      belt.material = ironMat; // brassy round tips
      // Buttstock + pistol grip.
      const stock = MeshBuilder.CreateBox("mgStock", { width: 0.06, height: 0.11, depth: 0.22 }, scene);
      stock.position.set(0, -0.01, -0.34);
      const grip = MeshBuilder.CreateBox("mgGrip", { width: 0.05, height: 0.14, depth: 0.06 }, scene);
      grip.position.set(0, -0.11, -0.1);
      grip.rotation.x = 0.2;
      const bipodL = MeshBuilder.CreateCylinder("bipodL", { diameter: 0.015, height: 0.22 }, scene);
      bipodL.position.set(-0.05, -0.1, 0.55);
      bipodL.rotation.z = Math.PI / 10;
      const bipodR = bipodL.clone("bipodR");
      bipodR.position.x = 0.05;
      bipodR.rotation.z = -Math.PI / 10;
      parts.push(body, barrel, flashHider, feedCover, mgCarryHandle, beltBox, belt, stock, grip, bipodL, bipodR);

      // Carry-handle rear sight + front post — belt-fed guns keep it basic, optics are
      // attachment-only (kept small — see rifle note above).
      sightOffset = new Vector3(0, 0.13, -0.05);
      const carryHandle = MeshBuilder.CreateBox("carryHandle", { width: 0.008, height: 0.018, depth: 0.04 }, scene);
      carryHandle.position.copyFrom(sightOffset);
      carryHandle.material = housingMat;
      const frontPost = MeshBuilder.CreateBox("frontPost", { width: 0.0025, height: 0.008, depth: 0.0025 }, scene);
      frontPost.position.set(0, 0.12, 0.4);
      frontPost.material = ironMat;
      sightParts.push(carryHandle, frontPost);
      break;
    }
    case "launcher": {
      // MATADOR: a 90mm launch tube with flared end caps, a firing grip
      // under the tube, and a shoulder rest at the rear.
      const tube = MeshBuilder.CreateCylinder("tube", { diameter: 0.13, height: 1.0 }, scene);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0, 0.2);
      const frontCap = MeshBuilder.CreateCylinder("frontCap", { diameter: 0.16, height: 0.05 }, scene);
      frontCap.rotation.x = Math.PI / 2;
      frontCap.position.set(0, 0, 0.68);
      frontCap.material = housingMat;
      const rearCap = MeshBuilder.CreateCylinder("rearCap", { diameter: 0.16, height: 0.05 }, scene);
      rearCap.rotation.x = Math.PI / 2;
      rearCap.position.set(0, 0, -0.28);
      rearCap.material = housingMat;
      const grip = MeshBuilder.CreateBox("launcherGrip", { width: 0.05, height: 0.15, depth: 0.07 }, scene);
      grip.position.set(0, -0.15, 0.05);
      grip.rotation.x = 0.15;
      grip.material = housingMat;
      const shoulderRest = MeshBuilder.CreateBox("shoulderRest", { width: 0.14, height: 0.09, depth: 0.04 }, scene);
      shoulderRest.position.set(0, -0.08, -0.15);
      shoulderRest.material = housingMat;
      parts.push(tube, frontCap, rearCap, grip, shoulderRest);

      // Reflex-style optic on the launcher's carry rail (kept small — see rifle note above).
      sightOffset = new Vector3(0, 0.12, 0.2);
      const sightBody = MeshBuilder.CreateBox("sight", { width: 0.008, height: 0.017, depth: 0.017 }, scene);
      sightBody.position.copyFrom(sightOffset);
      sightBody.material = housingMat;
      const reticle = MeshBuilder.CreateDisc("reticle", { radius: 0.004, tessellation: 8 }, scene);
      reticle.rotation.x = Math.PI / 2;
      reticle.position.set(sightOffset.x, sightOffset.y, sightOffset.z);
      reticle.material = lensMaterial(scene, `launcherLens_${weapon.id}`, new Color3(1, 0.2, 0.15));
      sightParts.push(sightBody, reticle);
      break;
    }
    case "hmg": {
      const body = MeshBuilder.CreateBox("body", { width: 0.14, height: 0.2, depth: 0.8 }, scene);
      const barrel = MeshBuilder.CreateCylinder("barrel", { diameter: 0.05, height: 0.5 }, scene);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.03, 0.55);
      parts.push(body, barrel);

      sightOffset = new Vector3(0, 0.14, 0);
      const housing = MeshBuilder.CreateBox("sightHousing", { width: 0.011, height: 0.013, depth: 0.021 }, scene);
      housing.position.copyFrom(sightOffset);
      housing.material = housingMat;
      sightParts.push(housing);
      break;
    }
  }

  for (const part of parts) {
    // Only default to the base weapon material — parts given an explicit
    // material inside the switch (wood furniture, flash hiders, etc.) keep it.
    if (!part.material) part.material = mat;
    part.parent = root;
    part.isPickable = false;
  }
  for (const part of sightParts) {
    part.parent = root;
    part.isPickable = false;
  }

  const muzzle = new TransformNode(`muzzle_${weapon.id}`, scene);
  muzzle.parent = root;
  muzzle.position = MUZZLE_OFFSET[weapon.class].clone();

  return { root, muzzle, sightOffset, bodyMeshes: parts, sightMeshes: sightParts };
}
