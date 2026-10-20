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

type AssetBuilder = (scene: Scene) => { root: TransformNode; sightOffset?: Vector3; hipRest?: Vector3; hipRot?: Vector3 };

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

  // Mirrors the game's rig (Level.ts buildLevel) so lookdev judges assets
  // under the light they'll actually get.
  const sunDir = new Vector3(-0.5, -1, 0.3).normalize();
  const hemi = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), scene);
  hemi.intensity = night ? 0.16 : 0.85;
  hemi.diffuse = night ? new Color3(0.36, 0.4, 0.44) : new Color3(0.84, 0.85, 0.82);
  hemi.groundColor = night ? new Color3(0.05, 0.05, 0.05) : new Color3(0.3, 0.25, 0.19);
  const sun = new DirectionalLight("sunLight", sunDir, scene);
  sun.intensity = night ? 0.26 : 1.15;
  sun.diffuse = night ? new Color3(0.56, 0.6, 0.66) : Color3.FromHexString("#fff3dc");
  sun.position = sunDir.scale(-20);
  const fill = new DirectionalLight("fillLight", new Vector3(0.45, -0.35, -0.35), scene);
  fill.intensity = night ? 0.07 : 0.28;
  fill.specular = Color3.Black();
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
  let hipRest: Vector3 | undefined;
  let hipRot: Vector3 | undefined;
  if (ASSETS[assetId]) {
    const a = ASSETS[assetId](scene);
    root = a.root;
    hipRest = a.hipRest;
    hipRot = a.hipRot;
    if (a.sightOffset) sightOffset = a.sightOffset;
  } else {
    const w = WEAPONS[assetId.replace(/_old$/, "")];
    if (!w) throw new Error(`unknown lookdev asset ${assetId}`);
    weaponClass = w.class;
    const vm = buildViewmodel(w, scene);
    root = vm.root;
    sightOffset = vm.sightOffset;
    hipRest = vm.hipRest;
    hipRot = vm.hipRot;
  }
  // Framing overrides for tuning: &hip=x,y,z&rot=x,y,z
  const vec = (k: string) => (q.get(k) ? Vector3.FromArray(q.get(k)!.split(",").map(Number)) : undefined);
  hipRest = vec("hip") ?? hipRest;
  hipRot = vec("rot") ?? hipRot;
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
    else {
      root.position.copyFrom(hipRest ?? HIP[weaponClass] ?? new Vector3(0.18, -0.16, 0.35));
      if (hipRot) root.rotation.copyFrom(hipRot);
    }
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
  // Never hang silently: after 60 s, report what isn't ready and render anyway.
  const timeout = new Promise<void>((resolve) =>
    setTimeout(() => {
      const notReady = scene.meshes.filter((m) => !m.isReady(true)).map((m) => `${m.name}:${m.material?.name}`);
      console.error("lookdev: not ready after 60s", notReady.slice(0, 12).join(", "));
      resolve();
    }, 60000)
  );
  await Promise.race([scene.whenReadyAsync(), timeout]);
  // A few frames for the reflection probe, shadow map and post stack to settle.
  let frames = 0;
  scene.onAfterRenderObservable.add(() => {
    if (++frames === 4) (window as unknown as Record<string, unknown>).__lookdevReady = true;
  });
}
