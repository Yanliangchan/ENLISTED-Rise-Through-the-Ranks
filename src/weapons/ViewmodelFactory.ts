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
      // Bullpup: stock/receiver behind the trigger, short barrel forward.
      const body = MeshBuilder.CreateBox("body", { width: 0.09, height: 0.14, depth: 0.55 }, scene);
      body.position.set(0, 0, -0.05);
      const barrel = MeshBuilder.CreateCylinder("barrel", { diameter: 0.03, height: 0.28 }, scene);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.01, 0.35);
      const mag = MeshBuilder.CreateBox("mag", { width: 0.05, height: 0.22, depth: 0.08 }, scene);
      mag.position.set(0, -0.16, -0.05);
      const grip = MeshBuilder.CreateBox("grip", { width: 0.05, height: 0.16, depth: 0.06 }, scene);
      grip.position.set(0, -0.12, 0.08);
      parts.push(body, barrel, mag, grip);

      // Compact integral scope (matches the SAR 21's real 1.5x integral optic): short
      // tube + objective/ocular lenses. Kept small — ADS brings the sight right up to
      // the camera, so full-size gun-scale geometry here would loom into frame as a block.
      sightOffset = new Vector3(0, 0.11, -0.02);
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
      const slide = MeshBuilder.CreateBox("slide", { width: 0.045, height: 0.09, depth: 0.22 }, scene);
      slide.position.set(0, 0.02, 0.02);
      const grip = MeshBuilder.CreateBox("grip", { width: 0.05, height: 0.14, depth: 0.07 }, scene);
      grip.position.set(0, -0.09, -0.08);
      parts.push(slide, grip);

      // Simple front-post + rear-notch iron sights (kept small — see rifle note above).
      sightOffset = new Vector3(0, 0.075, -0.06);
      const rearSight = MeshBuilder.CreateBox("rearSight", { width: 0.011, height: 0.004, depth: 0.004 }, scene);
      rearSight.position.copyFrom(sightOffset);
      rearSight.material = ironMat;
      const frontSight = MeshBuilder.CreateBox("frontSight", { width: 0.0025, height: 0.005, depth: 0.0025 }, scene);
      frontSight.position.set(0, 0.075, 0.12);
      frontSight.material = ironMat;
      sightParts.push(rearSight, frontSight);
      break;
    }
    case "dmr":
    case "sniper": {
      const body = MeshBuilder.CreateBox("body", { width: 0.08, height: 0.12, depth: 0.7 }, scene);
      const barrel = MeshBuilder.CreateCylinder("barrel", { diameter: 0.025, height: 0.45 }, scene);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.01, 0.55);
      const mag = MeshBuilder.CreateBox("mag", { width: 0.05, height: 0.18, depth: 0.06 }, scene);
      mag.position.set(0, -0.13, 0.05);
      parts.push(body, barrel, mag);

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
      const body = MeshBuilder.CreateBox("body", { width: 0.1, height: 0.16, depth: 0.6 }, scene);
      const barrel = MeshBuilder.CreateCylinder("barrel", { diameter: 0.035, height: 0.4 }, scene);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, 0.42);
      const beltBox = MeshBuilder.CreateBox("beltbox", { width: 0.12, height: 0.14, depth: 0.14 }, scene);
      beltBox.position.set(0, -0.14, -0.1);
      const bipodL = MeshBuilder.CreateCylinder("bipodL", { diameter: 0.015, height: 0.2 }, scene);
      bipodL.position.set(-0.05, -0.1, 0.55);
      bipodL.rotation.z = Math.PI / 10;
      const bipodR = bipodL.clone("bipodR");
      bipodR.position.x = 0.05;
      bipodR.rotation.z = -Math.PI / 10;
      parts.push(body, barrel, beltBox, bipodL, bipodR);

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
      const tube = MeshBuilder.CreateCylinder("tube", { diameter: 0.14, height: 1.0 }, scene);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0, 0.2);
      parts.push(tube);

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
    part.material = mat;
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

  return { root, muzzle, sightOffset, bodyMeshes: parts };
}
