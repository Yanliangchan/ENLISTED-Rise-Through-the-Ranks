import {
  Scene,
  UniversalCamera,
  RenderTargetTexture,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
} from "@babylonjs/core";

/**
 * Real windowed scope, like CoD's: a second camera renders a magnified view
 * into an offscreen texture, which is displayed on a physical lens disc held
 * up in front of the main camera. Because the main camera keeps rendering
 * its own normal-FOV view as the background, you still see the surrounding
 * world outside the lens — not a black vignette.
 *
 * Layer masks keep the two cameras from seeing the wrong things: the scope
 * camera only sees layer 0x0FFFFFFF (the world), while the lens/rim/reticle
 * (and the gun viewmodel) live exclusively on layer 0x10000000, visible only
 * to the main camera (whose mask is widened to include both).
 */
const WORLD_LAYER = 0x0fffffff;
export const VIEWMODEL_LAYER = 0x10000000;
const MAIN_CAMERA_LAYER = WORLD_LAYER | VIEWMODEL_LAYER;

const BASE_FOV = 1.1;
const LENS_DISTANCE = 0.16;
const LENS_RADIUS = 0.085;

export class ScopeLens {
  private scopeCamera: UniversalCamera;
  private rtt: RenderTargetTexture;
  private disc: Mesh;
  private rim: Mesh;
  private reticleParts: Array<{ mesh: Mesh; baseX: number; baseY: number }> = [];
  // Starts true so the constructor's initial setVisible(false) actually runs (its
  // early-return guard only skips when the state already matches the target).
  private visible = true;

  constructor(scene: Scene, mainCamera: UniversalCamera) {
    mainCamera.layerMask = MAIN_CAMERA_LAYER;

    this.scopeCamera = new UniversalCamera("scopeCamera", mainCamera.position.clone(), scene);
    this.scopeCamera.parent = mainCamera; // inherits mainCamera's world transform exactly
    this.scopeCamera.position.set(0, 0, 0);
    this.scopeCamera.rotation.set(0, 0, 0);
    this.scopeCamera.minZ = 0.05;
    this.scopeCamera.layerMask = WORLD_LAYER; // never sees the viewmodel/lens itself

    this.rtt = new RenderTargetTexture("scopeRTT", 512, scene, false);
    this.rtt.activeCamera = this.scopeCamera;
    this.rtt.refreshRate = 1;
    // Render targets in Babylon come out V-flipped relative to a normal image texture
    // (a WebGL framebuffer convention), which is what made the scope view upside down.
    this.rtt.vScale = -1;
    // Without an explicit renderList, RTT falls back to the main camera's last
    // active-mesh set rather than evaluating fresh for the scope camera — that
    // left the lens showing nothing but the clear colour. scene.meshes is a live
    // array (renderList tracks pushes/removals automatically), so this stays
    // correct as enemies/crates spawn later.
    this.rtt.renderList = scene.meshes;
    scene.customRenderTargets.push(this.rtt);

    const lensMat = new StandardMaterial("scopeLensMat", scene);
    lensMat.emissiveTexture = this.rtt;
    lensMat.diffuseColor = Color3.Black();
    lensMat.disableLighting = true;
    lensMat.backFaceCulling = false;

    this.disc = MeshBuilder.CreateDisc("scopeLensDisc", { radius: LENS_RADIUS, tessellation: 48 }, scene);
    this.disc.material = lensMat;
    this.disc.parent = mainCamera;
    this.disc.position.set(0, 0, LENS_DISTANCE);
    this.disc.rotation.y = Math.PI;
    this.disc.layerMask = VIEWMODEL_LAYER;
    this.disc.isPickable = false;

    // Slim, clean rim — a simple dark ring rather than a thick bezel.
    const rimMat = new StandardMaterial("scopeRimMat", scene);
    rimMat.diffuseColor = new Color3(0.05, 0.05, 0.055);
    rimMat.specularColor = new Color3(0.1, 0.1, 0.1);
    this.rim = MeshBuilder.CreateTorus("scopeRim", { diameter: LENS_RADIUS * 2 + 0.006, thickness: 0.008, tessellation: 32 }, scene);
    this.rim.parent = mainCamera;
    this.rim.position.set(0, 0, LENS_DISTANCE);
    this.rim.rotation.x = Math.PI / 2;
    this.rim.material = rimMat;
    this.rim.layerMask = VIEWMODEL_LAYER;
    this.rim.isPickable = false;

    // Simple thin crosshair — no extra tick marks or dot, just clean intersecting lines
    // that stop short of the centre so they don't obscure the target point itself.
    const reticleMat = new StandardMaterial("scopeReticleMat", scene);
    reticleMat.diffuseColor = new Color3(0.05, 0.05, 0.05);
    reticleMat.disableLighting = true;
    const barLen = LENS_RADIUS * 0.75;
    const gap = LENS_RADIUS * 0.18;
    const barThickness = 0.0008;
    const barSpecs: Array<[number, number, number, number]> = [
      [-gap - barLen / 2, 0, barLen, barThickness], // left
      [gap + barLen / 2, 0, barLen, barThickness], // right
      [0, -gap - barLen / 2, barThickness, barLen], // bottom
      [0, gap + barLen / 2, barThickness, barLen], // top
    ];
    for (const [x, y, w, h] of barSpecs) {
      const bar = MeshBuilder.CreateBox("scopeReticleBar", { width: w, height: h, depth: 0.001 }, scene);
      bar.material = reticleMat;
      bar.parent = mainCamera;
      bar.position.set(x, y, LENS_DISTANCE - 0.001);
      bar.layerMask = VIEWMODEL_LAYER;
      bar.isPickable = false;
      this.reticleParts.push({ mesh: bar, baseX: x, baseY: y });
    }

    this.setVisible(false);
  }

  private setVisible(v: boolean): void {
    if (this.visible === v) return;
    this.visible = v;
    this.disc.setEnabled(v);
    this.rim.setEnabled(v);
    for (const part of this.reticleParts) part.mesh.setEnabled(v);
    this.rtt.refreshRate = v ? 1 : RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  }

  /** blend: 0..1 ADS progress. zoom: the fitted optic's magnification. swayX/Y: subtle idle sway offset. */
  update(active: boolean, blend: number, zoom: number, swayX = 0, swayY = 0): void {
    this.setVisible(active && blend > 0.5);
    if (!this.visible) return;
    this.scopeCamera.fov = BASE_FOV / zoom;
    // Slight raise-to-eye animation as the last bit of ADS blend completes.
    const growth = Math.min(1, (blend - 0.5) / 0.5);
    const scale = 0.7 + 0.3 * growth;
    this.disc.scaling.set(scale, scale, scale);
    this.rim.scaling.set(scale, scale, scale);

    this.disc.position.set(swayX, swayY, LENS_DISTANCE);
    this.rim.position.set(swayX, swayY, LENS_DISTANCE);
    for (const part of this.reticleParts) {
      part.mesh.position.set(part.baseX + swayX, part.baseY + swayY, LENS_DISTANCE - 0.001);
    }
  }

  dispose(): void {
    this.rtt.dispose();
    this.scopeCamera.dispose();
    this.disc.dispose();
    this.rim.dispose();
    for (const part of this.reticleParts) part.mesh.dispose();
  }
}
