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

export interface Viewmodel {
  root: TransformNode;
  muzzle: TransformNode;
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

/**
 * Builds a recognisable low-poly silhouette per weapon class — bullpup for
 * rifles, long-barrel for snipers/DMRs, box+belt for LMGs, tube for launchers
 * — as a placeholder until real `.glb` models are swapped in via GLTFLoader.
 */
export function buildViewmodel(weapon: Weapon, scene: Scene): Viewmodel {
  const root = new TransformNode(`viewmodel_${weapon.id}`, scene);
  const mat = new StandardMaterial(`viewmodelMat_${weapon.id}`, scene);
  mat.diffuseColor = weapon.class === "pistol" ? TAN_POLYMER : DARK_METAL;
  mat.specularColor = new Color3(0.15, 0.15, 0.15);

  const parts: Mesh[] = [];

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
      break;
    }
    case "pistol": {
      const slide = MeshBuilder.CreateBox("slide", { width: 0.045, height: 0.09, depth: 0.22 }, scene);
      slide.position.set(0, 0.02, 0.02);
      const grip = MeshBuilder.CreateBox("grip", { width: 0.05, height: 0.14, depth: 0.07 }, scene);
      grip.position.set(0, -0.09, -0.08);
      parts.push(slide, grip);
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
      const scopeBody = MeshBuilder.CreateCylinder("scope", { diameter: 0.04, height: 0.22 }, scene);
      scopeBody.rotation.x = Math.PI / 2;
      scopeBody.position.set(0, 0.09, 0.05);
      parts.push(body, barrel, mag, scopeBody);
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
      break;
    }
    case "launcher": {
      const tube = MeshBuilder.CreateCylinder("tube", { diameter: 0.14, height: 1.0 }, scene);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0, 0.2);
      const sight = MeshBuilder.CreateBox("sight", { width: 0.03, height: 0.06, depth: 0.06 }, scene);
      sight.position.set(0, 0.1, 0.2);
      parts.push(tube, sight);
      break;
    }
    case "hmg": {
      const body = MeshBuilder.CreateBox("body", { width: 0.14, height: 0.2, depth: 0.8 }, scene);
      const barrel = MeshBuilder.CreateCylinder("barrel", { diameter: 0.05, height: 0.5 }, scene);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.03, 0.55);
      parts.push(body, barrel);
      break;
    }
  }

  for (const part of parts) {
    part.material = mat;
    part.parent = root;
    part.isPickable = false;
  }

  const muzzle = new TransformNode(`muzzle_${weapon.id}`, scene);
  muzzle.parent = root;
  muzzle.position = MUZZLE_OFFSET[weapon.class].clone();

  return { root, muzzle };
}
