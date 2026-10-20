import {
  ArcRotateCamera,
  Color3,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  TransformNode,
  UniversalCamera,
  Vector3,
  type AbstractMesh,
  type Camera,
} from "@babylonjs/core";
import { attachCinematicPipeline } from "@/core/Postprocess";
import { WEAPONS } from "@/data/weapons";
import { WorldMaterial } from "@/world/WorldMaterial";
import { buildSky, SKY_DAY, SKY_NIGHT } from "@/render/sky";
import { buildViewmodel } from "@/weapons/ViewmodelFactory";

/**
 * Look-development scene for the overhaul (`?lookdev=<asset>&view=<view>`).
 * Renders one asset under the game's real lighting model and post stack, on
 * its own, so assets can be reviewed and iterated without loading a 1,600-mesh
 * map — on the CPU rasteriser in CI a full map frame takes ~20 s, this takes
 * well under one.
 *
 *   asset: any weapon id (current production viewmodel), or a registered
 *          benchmark asset (see ASSETS below)
 *   view:  side | three | front | fp | ads | wide
 *   time:  day | night
 */

type AssetBuilder = (scene: Scene) => { root: TransformNode; sightOffset?: Vector3 };

const ASSETS: Record<string, AssetBuilder> = {};

/** Benchmark assets register here so lookdev can show them before they're wired into the game. */
export function registerLookdevAsset(id: string, build: AssetBuilder): void {
  ASSETS[id] = build;
}

const HIP: Record<string, Vector3> = {
  rifle: new Vector3(0.2, -0.2, 0.35),
  pistol: new Vector3(0.17, -0.22, 0.3),
  lmg: new Vector3(0.24, -0.24, 0.34),
  smg: new Vector3(0.19, -0.2, 0.32),
};

export async function runLookdev(canvas: HTMLCanvasElement): Promise<void> {
  await import("@/lookdevAssets"); // registers benchmark assets
  const q = new URLSearchParams(location.search);
  const assetId = q.get("lookdev") || "sar21";
  const view = q.get("view") || "three";
  const night = q.get("time") === "night";

  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true });
  const scene = new Scene(engine);
  scene.clearColor.set(0.5, 0.55, 0.6, 1);

  const sunDir = new Vector3(-0.5, -0.9, 0.35).normalize();
  const hemi = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), scene);
  hemi.intensity = night ? 0.12 : 0.55;
  hemi.groundColor = night ? new Color3(0.02, 0.03, 0.03) : new Color3(0.32, 0.28, 0.22);
  const sun = new DirectionalLight("sunLight", sunDir, scene);
  sun.intensity = night ? 0.25 : 2.4;
  sun.diffuse = night ? Color3.FromHexString("#9fb3d6") : Color3.FromHexString("#fff3dc");
  sun.position = sunDir.scale(-20);
  buildSky(scene, sunDir, night ? SKY_NIGHT : SKY_DAY);

  const ground = MeshBuilder.CreateGround("ground", { width: 40, height: 40 }, scene);
  const gm = new WorldMaterial("lookdevGround", scene);
  gm.diffuseColor = Color3.FromHexString("#5d6447");
  ground.material = gm;
  ground.receiveShadows = true;
  const wall = MeshBuilder.CreateBox("lookdevWall", { width: 6, height: 2.6, depth: 0.25 }, scene);
  wall.position.set(0, 1.3, 2.2);
  const wm = new WorldMaterial("lookdevWall", scene);
  wm.diffuseColor = Color3.FromHexString("#d8d2c0");
  wall.material = wm;
  wall.receiveShadows = true;

  const shadows = new ShadowGenerator(2048, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.bias = 0.0008;
  shadows.normalBias = 0.01;

  // ---- Asset ---------------------------------------------------------------
  let root: TransformNode;
  let sightOffset = new Vector3(0, 0.1, 0);
  let weaponClass = "rifle";
  if (ASSETS[assetId]) {
    const a = ASSETS[assetId](scene);
    root = a.root;
    if (a.sightOffset) sightOffset = a.sightOffset;
  } else {
    const w = WEAPONS[assetId.replace(/_old$/, "")];
    if (!w) throw new Error(`unknown lookdev asset ${assetId}`);
    weaponClass = w.class;
    const vm = buildViewmodel(w, scene);
    root = vm.root;
    sightOffset = vm.sightOffset;
  }
  const meshes: AbstractMesh[] = root.getChildMeshes(false);
  for (const m of meshes) {
    shadows.addShadowCaster(m);
    m.receiveShadows = true;
  }

  // ---- Camera --------------------------------------------------------------
  let camera: Camera;
  const isCharacter = assetId.startsWith("soldier") || assetId.startsWith("opfor");
  if (view === "fp" || view === "ads") {
    const cam = new UniversalCamera("fpCam", new Vector3(0, 1.7, 0), scene);
    cam.minZ = 0.05;
    cam.fov = 1.1;
    camera = cam;
    root.parent = cam;
    if (view === "ads") root.position.set(-sightOffset.x, -sightOffset.y, 0.28 - sightOffset.z);
    else root.position.copyFrom(HIP[weaponClass] ?? new Vector3(0.18, -0.16, 0.35));
    // Viewmodel draws over the world, as in game.
    for (const m of meshes) m.renderingGroupId = 1;
    scene.setRenderingAutoClearDepthStencil(1, true, true, false);
  } else {
    root.position.set(0, isCharacter ? 0 : 1.1, 0);
    const target = new Vector3(0, isCharacter ? 0.95 : 1.1, isCharacter ? 0 : -0.02);
    const radius = isCharacter ? 2.9 : view === "wide" ? 2.2 : 0.95;
    const alpha = view === "side" ? 0 : view === "front" ? -Math.PI / 2 : view === "wide" ? -0.6 : -0.75;
    const beta = view === "side" ? Math.PI / 2 : 1.25;
    const cam = new ArcRotateCamera("lookCam", alpha, beta, radius, target, scene);
    cam.minZ = 0.02;
    cam.fov = 0.7;
    camera = cam;
  }
  scene.activeCamera = camera;
  attachCinematicPipeline(scene, camera);

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
  await scene.whenReadyAsync();
  // A few frames for the reflection probe, shadow map and post stack to settle.
  let frames = 0;
  scene.onAfterRenderObservable.add(() => {
    if (++frames === 4) (window as unknown as Record<string, unknown>).__lookdevReady = true;
  });
}
