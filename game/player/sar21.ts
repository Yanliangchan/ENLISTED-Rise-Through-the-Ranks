import * as THREE from "three";
import type { Engine } from "~/core/engine";
import { Paint, canvasTex } from "~/gfx/textures";
import { fbm, rng } from "~/gfx/noise";

/**
 * SAR 21 — the SAF's standard bullpup rifle — and the arms that hold it.
 *
 * Built at true scale (805 mm overall) from side-profile extrusions with
 * bevelled edges, lathed barrel parts and small detail pieces, in the gun's
 * own frame: +X toward the muzzle, +Y up, bore axis on y = 0, origin above
 * the pistol grip. Defining features are all here: the integrated 1.5×
 * optic in the carrying handle, the full-hand trigger guard, the magazine
 * behind the grip, the translucent magazine and the fore-end laser housing.
 */

export interface ViewWeapon {
  root: THREE.Group;
  /** Muzzle tip in gun space. */
  muzzle: THREE.Vector3;
  /** Eye point for aiming: on the optic axis just behind the eyepiece. */
  sight: THREE.Vector3;
  /** Case ejection port. */
  eject: THREE.Vector3;
  magazine: THREE.Object3D;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  bolt: THREE.Object3D;
}

export interface GunMats {
  polymer: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  mag: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  lens: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
  sleeve: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  reticle: THREE.MeshBasicMaterial;
  /** Flat dark earth furniture (M110). */
  fde: THREE.MeshStandardMaterial;
  /** Olive drab painted tube (MATADOR). */
  olive: THREE.MeshStandardMaterial;
  /** Smoked translucent polymer (drum rear cover). */
  smoke: THREE.MeshStandardMaterial;
  /** Yellow stencil / warning band. */
  mark: THREE.MeshStandardMaterial;
  /** Worn parkerised steel, slightly lighter than the blued parts. */
  park: THREE.MeshStandardMaterial;
}

/** SAF No. 4 pixelised camouflage. */
export function camoTexture(size = 256): THREE.CanvasTexture {
  return canvasTex(
    size,
    size,
    (c) => {
      const px = 4;
      const n = size / px;
      const cols = ["#5d5038", "#667047", "#44542f", "#2a3620", "#191b15"];
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          // Blocky macro shapes: quantise the noise lookup so pixels cluster.
          const qx = Math.floor(x / 2) * 2;
          const qy = Math.floor(y / 2) * 2;
          const a = fbm(qx / n, qy / n, 5, 3, 11);
          const b = fbm(x / n, y / n, 12, 2, 23);
          const v = a * 0.72 + b * 0.28;
          const i = v < 0.4 ? 2 : v < 0.48 ? 3 : v < 0.56 ? 1 : v < 0.63 ? 0 : v < 0.7 ? 2 : v < 0.75 ? 4 : 1;
          c.fillStyle = cols[i];
          c.fillRect(x * px, y * px, px, px);
        }
      }
    },
    { repeat: true }
  );
}

export function buildGunMats(engine: Engine): GunMats {
  const vm = { viewmodel: true };
  // Glass-filled polymer: fine stipple, slight sheen on worn edges.
  const poly = new Paint(256, "#3e4042", { rough: 0.56, seed: 3 });
  poly.grain(0.06, 24, 3, 5).speckle(0.04, 7);
  const r = rng(9);
  for (let i = 0; i < 140; i++) {
    poly.all(`rgba(120,122,124,${0.15 + r() * 0.25})`, 0.52, 0.4, (c) => {
      c.lineWidth = 0.6 + r();
      c.beginPath();
      const x = r() * 256;
      const y = r() * 256;
      c.moveTo(x, y);
      c.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 6);
      c.stroke();
    });
  }
  const polyT = poly.finish({ normal: 1.3 });
  const steelP = new Paint(256, "#5a5c5f", { rough: 0.4, seed: 5 });
  steelP.grain(0.18, 12, 4, 15).speckle(0.06, 3);
  const steelT = steelP.finish({ normal: 0.6, metal: 0.9 });
  const fabric = new Paint(256, "#ffffff", { rough: 0.92, seed: 8 });
  const weave = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) weave[y * 256 + x] = (Math.sin(x * 1.6) * 0.5 + 0.5) * (Math.sin(y * 1.6) * 0.5 + 0.5) * 0.3 + (fbm(x / 256, y / 256, 5, 3, 4) - 0.5) * 0.5;
  const fabricT = fabric.finish({ normal: 1.6, height: weave });
  const camo = camoTexture();
  camo.repeat.set(1.2, 1.2);

  const std = (p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => engine.lit(new THREE.MeshStandardMaterial(p), vm);
  return {
    polymer: std({ map: polyT.map, normalMap: polyT.normalMap, roughnessMap: polyT.ormMap, roughness: 1, metalness: 0, color: 0xd8d8d8 }),
    steel: std({ map: steelT.map, normalMap: steelT.normalMap, roughnessMap: steelT.ormMap, metalnessMap: steelT.ormMap, roughness: 1, metalness: 1 }),
    rubber: std({ color: 0x242424, roughness: 0.9 }),
    mag: std({ color: 0x55523f, roughness: 0.28, transparent: true, opacity: 0.86 }),
    brass: std({ color: 0xb8923a, roughness: 0.3, metalness: 1 }),
    lens: std({ color: 0x1a2a30, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.22, envMapIntensity: 2.5 }),
    glove: std({ color: 0x4a4b42, normalMap: fabricT.normalMap, roughness: 0.9 }),
    sleeve: std({ map: camo, normalMap: fabricT.normalMap, roughness: 0.92 }),
    skin: std({ color: 0xb98a6a, roughness: 0.62 }),
    reticle: new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, depthTest: false, depthWrite: false, fog: false }),
    fde: std({ normalMap: polyT.normalMap, roughnessMap: polyT.ormMap, roughness: 1, metalness: 0, color: 0x9a8563 }),
    olive: std({ normalMap: polyT.normalMap, roughnessMap: polyT.ormMap, roughness: 1, metalness: 0, color: 0x5a6340 }),
    smoke: std({ color: 0x3a3830, roughness: 0.2, transparent: true, opacity: 0.55 }),
    mark: std({ color: 0xd8b020, roughness: 0.7 }),
    park: std({ map: steelT.map, normalMap: steelT.normalMap, roughnessMap: steelT.ormMap, roughness: 1, metalness: 0.6, color: 0xc8c8c8 }),
  };
}

/** Extrude a side profile (XY) to a given thickness, centred on Z, with a bevel. */
export function profile(pts: number[][], thick: number, bevel: number, holes: number[][][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -(thick - bevel * 2) / 2);
  // Planar UVs at ~12 repeats per metre so the stipple reads at arm's length.
  const pos = g.getAttribute("position");
  const uv = new Float32Array(pos.count * 2);
  const nrm = g.getAttribute("normal");
  for (let i = 0; i < pos.count; i++) {
    const side = Math.abs(nrm.getZ(i)) > 0.5;
    uv[i * 2] = (side ? pos.getX(i) : pos.getX(i) + pos.getZ(i)) * 12;
    uv[i * 2 + 1] = (side ? pos.getY(i) : pos.getY(i) + pos.getZ(i)) * 12;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

export function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = false;
  o.receiveShadow = true;
  o.frustumCulled = false;
  return o;
}

/** Cylinder along X. */
export function tube(r0: number, r1: number, len: number, seg = 18, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  g.rotateZ(-Math.PI / 2);
  return g;
}

export function rbox(sx: number, sy: number, sz: number, bevel = 0.002): THREE.BufferGeometry {
  return profile(
    [
      [-sx / 2, -sy / 2],
      [sx / 2, -sy / 2],
      [sx / 2, sy / 2],
      [-sx / 2, sy / 2],
    ],
    sz,
    bevel
  );
}

/** A capsule limb between two points. */
export function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, mat: THREE.Material, uvScale = 1): THREE.Mesh {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, 14, 1, false);
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * uvScale, uv.getY(i) * len * 6 * uvScale);
  const m = mesh(g, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/** Gloved hand: palm block plus curled fingers, built to wrap a grip of the given radius. */
export function hand(mats: GunMats, curl: number, mirror: 1 | -1): THREE.Group {
  const g = new THREE.Group();
  const palm = mesh(rbox(0.085, 0.034, 0.092, 0.01), mats.glove);
  g.add(palm);
  // Knuckle pad (hard-knuckle tactical glove).
  g.add(mesh(rbox(0.03, 0.012, 0.078, 0.004), mats.rubber, 0.03, 0.02, 0));
  for (let f = 0; f < 4; f++) {
    const z = -0.034 + f * 0.0225;
    const len = [0.03, 0.034, 0.032, 0.026][f];
    let p = new THREE.Vector3(0.043, 0.004, z);
    let ang = -0.25;
    for (let s = 0; s < 3; s++) {
      ang -= curl * [0.9, 1.05, 0.8][s];
      const n = p.clone().add(new THREE.Vector3(Math.cos(ang) * len, Math.sin(ang) * len, 0));
      const seg = limb(p, n, 0.0105 - s * 0.001, 0.0098 - s * 0.001, mats.glove);
      g.add(seg);
      const joint = mesh(new THREE.SphereGeometry(0.0108 - s * 0.001, 10, 8), mats.glove, n.x, n.y, n.z);
      g.add(joint);
      p = n;
    }
  }
  // Thumb.
  const t0 = new THREE.Vector3(-0.012, 0.0, mirror * 0.046);
  const t1 = new THREE.Vector3(0.022, -0.004, mirror * 0.064);
  const t2 = new THREE.Vector3(0.05, -0.014, mirror * 0.058);
  g.add(limb(t0, t1, 0.014, 0.012, mats.glove));
  g.add(limb(t1, t2, 0.0115, 0.0105, mats.glove));
  g.add(mesh(new THREE.SphereGeometry(0.0108, 10, 8), mats.glove, t2.x, t2.y, t2.z));
  // Cuff.
  g.add(mesh(tube(0.036, 0.033, 0.05, 14), mats.glove, -0.062, 0, 0));
  g.add(mesh(tube(0.038, 0.038, 0.014, 14), mats.rubber, -0.085, 0, 0));
  return g;
}

/**
 * Hand + forearm placed directly in gun space: `palm` is the palm centre,
 * `fingers` the direction the fingers leave the palm before curling, `back`
 * the direction the back of the hand faces, `elbow` where the forearm ends.
 */
export function arm(mats: GunMats, curl: number, mirror: 1 | -1, palm: THREE.Vector3, fingers: THREE.Vector3, back: THREE.Vector3, elbow: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const hx = fingers.clone().normalize();
  const hz = hx.clone().cross(back).normalize();
  const hy = hz.clone().cross(hx).normalize();
  const h = hand(mats, curl, mirror);
  h.matrixAutoUpdate = false;
  h.matrix.makeBasis(hx, hy, hz).setPosition(palm);
  g.add(h);
  const wrist = palm.clone().addScaledVector(hx, -0.088);
  g.add(limb(wrist, elbow, 0.037, 0.054, mats.sleeve));
  return g;
}

export function buildSar21(mats: GunMats): ViewWeapon {
  const root = new THREE.Group();
  const P = mats.polymer;
  const S = mats.steel;

  // --- stock / receiver shell (the long bullpup body behind the grip) -------
  root.add(
    mesh(
      profile(
        [
          [-0.335, -0.062],
          [-0.2, -0.074],
          [-0.118, -0.072],
          [-0.06, -0.05],
          [0.03, -0.046],
          [0.035, 0.03],
          [-0.02, 0.046],
          [-0.3, 0.046],
          [-0.335, 0.036],
        ],
        0.056,
        0.006
      ),
      P
    )
  );
  // Butt pad.
  root.add(mesh(profile([[-0.347, -0.064], [-0.333, -0.066], [-0.333, 0.04], [-0.347, 0.036]], 0.05, 0.004), mats.rubber));
  // Cheek-piece ribs along the stock.
  for (let i = 0; i < 5; i++) {
    for (const s of [-1, 1]) root.add(mesh(rbox(0.12, 0.004, 0.003, 0.001), P, -0.25, 0.03 - i * 0.012, s * 0.0285));
  }
  // Ejection port (right side) with its steel lip, and the case deflector.
  root.add(mesh(rbox(0.05, 0.02, 0.003, 0.001), mats.rubber, -0.19, 0.016, 0.0283));
  root.add(mesh(rbox(0.056, 0.003, 0.004, 0.001), S, -0.19, 0.028, 0.0288));
  root.add(mesh(rbox(0.012, 0.022, 0.006, 0.002), P, -0.158, 0.016, 0.03));
  // Takedown pins.
  for (const x of [-0.3, -0.09, 0.012]) for (const s of [-1, 1]) {
    const pin = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.003, 10), S, x, -0.03, s * 0.0285);
    pin.rotation.x = Math.PI / 2;
    root.add(pin);
  }
  // Magazine well.
  root.add(mesh(profile([[-0.215, -0.07], [-0.13, -0.07], [-0.126, -0.105], [-0.213, -0.11]], 0.04, 0.004), P));
  // Magazine release paddle.
  root.add(mesh(rbox(0.012, 0.03, 0.03, 0.002), P, -0.122, -0.09, 0));

  // --- magazine: translucent 30-round, slight forward curve ----------------
  const magazine = new THREE.Group();
  magazine.add(
    mesh(
      profile(
        [
          [-0.208, -0.1],
          [-0.134, -0.096],
          [-0.118, -0.2],
          [-0.11, -0.262],
          [-0.176, -0.27],
          [-0.196, -0.2],
        ],
        0.026,
        0.003
      ),
      mats.mag
    )
  );
  // Rounds visible through the body.
  for (let i = 0; i < 9; i++) {
    const t = i / 9;
    const cart = mesh(tube(0.0048, 0.0048, 0.05, 8), mats.brass, -0.166 + t * 0.022, -0.115 - t * 0.14, i % 2 ? 0.004 : -0.004);
    cart.rotation.z = 0.09 + t * 0.12;
    magazine.add(cart);
  }
  magazine.add(mesh(profile([[-0.182, -0.262], [-0.106, -0.254], [-0.105, -0.268], [-0.181, -0.276]], 0.03, 0.003), P));
  root.add(magazine);

  // --- pistol grip and the full-hand guard ---------------------------------
  root.add(
    mesh(
      profile(
        [
          [-0.012, -0.044],
          [0.03, -0.044],
          [0.014, -0.11],
          [0.0, -0.158],
          [-0.044, -0.158],
          [-0.036, -0.11],
        ],
        0.032,
        0.007
      ),
      P
    )
  );
  // Guard bow: from the grip heel forward and up into the fore-end.
  const bow = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.03, -0.156, 0),
    new THREE.Vector3(0.04, -0.168, 0),
    new THREE.Vector3(0.1, -0.14, 0),
    new THREE.Vector3(0.128, -0.085, 0),
    new THREE.Vector3(0.132, -0.05, 0),
  ]);
  const bowG = new THREE.TubeGeometry(bow, 20, 0.008, 8, false);
  bowG.scale(1, 1, 1.6);
  root.add(mesh(bowG, P));
  // Trigger.
  root.add(mesh(profile([[0.052, -0.046], [0.062, -0.046], [0.058, -0.074], [0.05, -0.082], [0.047, -0.078]], 0.007, 0.002), S));
  // Fire selector (cross-bolt, behind the trigger) and safety.
  root.add(mesh(rbox(0.01, 0.01, 0.062, 0.002), S, 0.036, -0.036, 0));

  // --- fore-end with the laser aiming device ---------------------------------
  root.add(
    mesh(
      profile(
        [
          [0.03, -0.05],
          [0.21, -0.05],
          [0.242, -0.03],
          [0.246, 0.034],
          [0.2, 0.048],
          [0.03, 0.044],
        ],
        0.054,
        0.008
      ),
      P
    )
  );
  // Cooling slots.
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) root.add(mesh(rbox(0.022, 0.006, 0.003, 0.001), mats.rubber, 0.075 + i * 0.036, 0.02, s * 0.0272));
  // Grip texturing panel.
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) root.add(mesh(rbox(0.12, 0.002, 0.002, 0.0005), P, 0.13, -0.014 - i * 0.005, s * 0.0274));
  // LAD housing and aperture above the barrel.
  root.add(mesh(rbox(0.04, 0.022, 0.03, 0.004), P, 0.228, 0.036, 0));
  const lad = mesh(tube(0.006, 0.006, 0.004, 12), mats.lens, 0.2495, 0.036, 0);
  (lad.material as THREE.MeshStandardMaterial).opacity = 0.9;
  root.add(lad);

  // --- barrel and flash hider --------------------------------------------------
  root.add(mesh(tube(0.0095, 0.0085, 0.18), S, 0.335, 0, 0));
  root.add(mesh(tube(0.012, 0.012, 0.016), S, 0.262, 0, 0));
  root.add(mesh(tube(0.0115, 0.0105, 0.05), S, 0.445, 0, 0));
  for (let i = 0; i < 6; i++) {
    const slot = mesh(rbox(0.026, 0.0035, 0.004, 0.001), mats.rubber, 0.448, 0, 0);
    slot.position.y = Math.cos((i * Math.PI) / 3) * 0.0105;
    slot.position.z = Math.sin((i * Math.PI) / 3) * 0.0105;
    slot.rotation.x = (i * Math.PI) / 3;
    root.add(slot);
  }
  root.add(mesh(tube(0.0125, 0.0125, 0.006), S, 0.422, 0, 0));
  // Gas block and bayonet lug.
  root.add(mesh(rbox(0.024, 0.02, 0.018, 0.003), S, 0.29, 0.012, 0));
  root.add(mesh(rbox(0.016, 0.008, 0.008, 0.002), S, 0.3, -0.014, 0));

  // --- carrying handle with the integral 1.5× optic ---------------------------
  const HY = 0.108; // optic axis height
  root.add(mesh(tube(0.0235, 0.0235, 0.255, 22, true), P, 0.02, HY, 0));
  root.add(mesh(tube(0.0265, 0.0265, 0.03, 22, true), P, -0.105, HY, 0)); // eyepiece housing
  root.add(mesh(tube(0.0275, 0.0275, 0.014, 22, true), mats.rubber, -0.124, HY, 0)); // rubber eyecup
  root.add(mesh(new THREE.RingGeometry(0.0215, 0.0275, 24).rotateY(-Math.PI / 2), mats.rubber, -0.131, HY, 0));
  root.add(mesh(new THREE.RingGeometry(0.019, 0.0255, 24).rotateY(Math.PI / 2), mats.rubber, 0.161, HY, 0));
  root.add(mesh(tube(0.0255, 0.0255, 0.03, 22, true), P, 0.146, HY, 0)); // objective housing
  // Flat top rail with back-up iron sights.
  root.add(mesh(rbox(0.21, 0.008, 0.016, 0.002), P, 0.02, HY + 0.026, 0));
  root.add(mesh(rbox(0.004, 0.012, 0.003, 0.0008), S, 0.118, HY + 0.035, 0));
  for (const s of [-1, 1]) root.add(mesh(rbox(0.004, 0.011, 0.003, 0.0008), S, -0.07, HY + 0.034, s * 0.005));
  // Handle posts.
  root.add(mesh(profile([[-0.11, 0.044], [-0.062, 0.044], [-0.07, HY - 0.018], [-0.106, HY - 0.018]], 0.03, 0.005), P));
  root.add(mesh(profile([[0.11, 0.044], [0.165, 0.044], [0.158, HY - 0.018], [0.118, HY - 0.018]], 0.03, 0.005), P));
  // Lenses.
  // Lenses: tinted glass from outside, but they must not darken the sight picture, so the
  // weapon system hides anything named "lens" while aiming.
  for (const l of [mesh(new THREE.CircleGeometry(0.019, 20).rotateY(-Math.PI / 2), mats.lens, -0.118, HY, 0), mesh(new THREE.CircleGeometry(0.02, 20).rotateY(Math.PI / 2), mats.lens, 0.16, HY, 0)]) {
    l.name = "lens";
    root.add(l);
  }
  // Cocking handle under the carrying handle.
  const bolt = new THREE.Group();
  bolt.add(mesh(rbox(0.05, 0.01, 0.012, 0.002), S, 0.02, 0.052, 0));
  bolt.add(mesh(rbox(0.014, 0.012, 0.03, 0.003), P, 0.04, 0.056, -0.012));
  root.add(bolt);

  // Sling loops.
  for (const x of [-0.31, 0.2]) {
    const loop = mesh(new THREE.TorusGeometry(0.009, 0.002, 6, 12), S, x, -0.02, -0.031);
    loop.rotation.y = Math.PI / 2;
    root.add(loop);
  }

  // --- reticle: a fine post-and-circle floating on the optic axis --------------
  const retTex = canvasTex(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128);
    c.strokeStyle = "#000";
    c.lineWidth = 2.2;
    c.beginPath();
    c.arc(64, 64, 20, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 3;
    for (const [x0, y0, x1, y1] of [[64, 84, 64, 126], [2, 64, 44, 64], [84, 64, 126, 64]]) {
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
    }
    c.fillStyle = "#000";
    c.beginPath();
    c.arc(64, 64, 2.2, 0, Math.PI * 2);
    c.fill();
  });
  mats.reticle.map = retTex;
  const reticle = mesh(new THREE.PlaneGeometry(0.034, 0.034).rotateY(-Math.PI / 2), mats.reticle, 0.05, HY, 0);
  reticle.renderOrder = 10;
  reticle.name = "reticle";
  reticle.visible = false;
  root.add(reticle);

  // --- arms -----------------------------------------------------------------------
  // Right hand wraps the pistol grip from the right; forearm runs back, down and out.
  const rightArm = arm(mats, 1.0, -1, new THREE.Vector3(-0.034, -0.1, 0.031), new THREE.Vector3(0.94, 0.26, -0.1), new THREE.Vector3(0.1, 0, 1), new THREE.Vector3(-0.36, -0.24, 0.17));
  root.add(rightArm);
  // Left hand cups the fore-end from below, fingers up the far side.
  const leftArm = arm(mats, 0.8, 1, new THREE.Vector3(0.135, -0.068, -0.004), new THREE.Vector3(0.12, 0.05, 1), new THREE.Vector3(0, -1, 0.1), new THREE.Vector3(-0.2, -0.3, -0.26));
  root.add(leftArm);

  return {
    root,
    muzzle: new THREE.Vector3(0.472, 0, 0),
    sight: new THREE.Vector3(-0.215, HY, 0),
    eject: new THREE.Vector3(-0.19, 0.018, 0.034),
    magazine,
    leftArm,
    rightArm,
    bolt,
  };
}
