import * as THREE from "three";
import { canvasTex } from "~/gfx/textures";
import { arm, mesh, profile, rbox, tube, type GunMats, type ViewWeapon } from "./sar21";

/**
 * The rest of the section's weapons, each built at true scale from its real
 * layout. Gun space is shared with the SAR 21: +X to the muzzle, +Y up, bore
 * on y = 0, +Z the firer's right, origin above the pistol grip.
 */

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/**
 * One bipod leg on a hinge at the mount: the leg lies along +X (or -X when it folds back)
 * from the pivot, so swinging the pivot a quarter-turn about Z stands it on the ground.
 */
function bipodLeg(mats: GunMats, x: number, y: number, z: number, len: number, r: number, dir: 1 | -1, splay: 1 | -1): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.userData = { dir, splay };
  g.add(mesh(tube(r, r * 0.9, len, 8), mats.steel, (dir * len) / 2, 0, 0));
  g.add(mesh(tube(r * 1.3, r * 1.3, len * 0.28, 8), mats.steel, dir * len * 0.2, 0, 0)); // upper sleeve
  g.add(mesh(tube(r * 1.5, r * 1.2, 0.018, 8), mats.rubber, dir * (len + 0.009), 0, 0)); // foot
  return g;
}

/** Ring of thin slots around a muzzle device (birdcage flash hider). */
function slots(root: THREE.Group, mat: THREE.Material, x: number, r: number, len: number, n = 6): void {
  for (let i = 0; i < n; i++) {
    const s = mesh(rbox(len, 0.0032, 0.004, 0.0008), mat, x, Math.cos((i * Math.PI * 2) / n) * r, Math.sin((i * Math.PI * 2) / n) * r);
    s.rotation.x = (i * Math.PI * 2) / n;
    root.add(s);
  }
}

/** A run of Picatinny rail lugs along X on a face: `up` is the outward direction (y or z). */
function rail(root: THREE.Group, mat: THREE.Material, x0: number, x1: number, y: number, z: number, axis: "y" | "z", sign: 1 | -1): void {
  const n = Math.round((x1 - x0) / 0.01);
  for (let i = 0; i < n; i++) {
    const g = axis === "y" ? rbox(0.0052, 0.004, 0.021, 0.0006) : rbox(0.0052, 0.021, 0.004, 0.0006);
    root.add(mesh(g, mat, x0 + 0.005 + i * 0.01, y + (axis === "y" ? sign * 0.002 : 0), z + (axis === "z" ? sign * 0.002 : 0)));
  }
}

function reticleMesh(draw: (c: CanvasRenderingContext2D) => void, size: number, x: number, y: number, z = 0): THREE.Mesh {
  const tex = canvasTex(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128);
    draw(c);
  });
  const m = mesh(new THREE.PlaneGeometry(size, size).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }), x, y, z);
  m.renderOrder = 10;
  m.name = "reticle";
  m.visible = false;
  return m;
}

// =====================================================================================
// Ultimax 100 Mk 3 — 5.56 mm section automatic weapon (1,024 mm, 508 mm barrel)
// =====================================================================================

/**
 * ST Kinetics' constant-recoil light machine gun. Read from the muzzle back:
 * slotted flash suppressor, quick-change barrel with its carrying handle,
 * front sight post between two protective ears on the gas block, folded
 * bipod, polymer fore-end with the integral vertical grip, a long tubular
 * stamped receiver with the cocking handle on the left, the 100-round drum
 * hanging ahead of the trigger guard with its clear rear face, and an
 * in-line polymer butt.
 */
export function buildUltimax(mats: GunMats): ViewWeapon {
  const root = new THREE.Group();
  const P = mats.polymer, S = mats.steel, K = mats.park;

  // Receiver: a stamped tube over a rectangular trigger housing.
  root.add(mesh(tube(0.0245, 0.0245, 0.42, 20), K, 0.01, 0.006, 0));
  root.add(mesh(profile([[-0.2, -0.036], [0.19, -0.036], [0.21, -0.02], [0.21, 0.006], [-0.2, 0.006]], 0.043, 0.003), K));
  root.add(mesh(tube(0.027, 0.027, 0.018, 20), S, -0.196, 0.006, 0)); // rear end cap
  root.add(mesh(tube(0.028, 0.026, 0.03, 20), S, 0.212, 0.006, 0)); // barrel latch collar
  // Stamped reinforcing ribs along the receiver.
  for (const s of [-1, 1]) {
    root.add(mesh(rbox(0.24, 0.005, 0.002, 0.0008), K, 0.0, 0.016, s * 0.0238));
    root.add(mesh(rbox(0.3, 0.003, 0.002, 0.0006), S, -0.02, -0.012, s * 0.022));
  }
  // Ejection port (right) and its spring cover.
  root.add(mesh(rbox(0.058, 0.02, 0.003, 0.001), mats.rubber, 0.062, 0.006, 0.0242));
  root.add(mesh(rbox(0.06, 0.008, 0.004, 0.001), S, 0.062, -0.008, 0.025));
  // Cocking handle on the left in its slot: non-reciprocating, rides forward when firing.
  root.add(mesh(rbox(0.19, 0.006, 0.002, 0.0006), mats.rubber, 0.07, 0.004, -0.0246));
  const bolt = new THREE.Group();
  bolt.add(mesh(rbox(0.014, 0.012, 0.022, 0.003), S, 0.13, 0.004, -0.034));
  bolt.add(mesh(tube(0.007, 0.007, 0.014, 10), S, 0.13, 0.004, -0.046).rotateY(Math.PI / 2));
  root.add(bolt);

  // Rear sight: sliding aperture leaf between protective wings.
  for (const s of [-1, 1]) root.add(mesh(profile([[-0.15, 0.028], [-0.1, 0.028], [-0.105, 0.046], [-0.145, 0.046]], 0.002, 0.0006), S, 0, 0, s * 0.0125));
  root.add(mesh(rbox(0.05, 0.004, 0.024, 0.001), S, -0.125, 0.03, 0));
  root.add(mesh(new THREE.RingGeometry(0.0034, 0.0062, 18).rotateY(-Math.PI / 2), S, -0.13, 0.044, 0));
  root.add(mesh(rbox(0.004, 0.008, 0.006, 0.001), S, -0.129, 0.0345, 0));

  // Pistol grip, trigger guard, trigger, safety lever (left, behind the trigger).
  root.add(mesh(profile([[-0.036, -0.034], [0.01, -0.034], [-0.004, -0.085], [-0.016, -0.135], [-0.056, -0.132], [-0.048, -0.085]], 0.032, 0.007), P));
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) root.add(mesh(rbox(0.03, 0.0025, 0.002, 0.0006), P, -0.03 - i * 0.002, -0.062 - i * 0.011, s * 0.0165));
  const bow = new THREE.CatmullRomCurve3([V(0.01, -0.038, 0), V(0.03, -0.074, 0), V(0.066, -0.078, 0), V(0.082, -0.038, 0)]);
  root.add(mesh(new THREE.TubeGeometry(bow, 16, 0.0035, 6, false).scale(1, 1, 2.2), S));
  root.add(mesh(profile([[0.04, -0.036], [0.05, -0.036], [0.046, -0.06], [0.04, -0.066], [0.037, -0.062]], 0.006, 0.0015), S));
  root.add(mesh(rbox(0.018, 0.005, 0.004, 0.001), S, 0.0, -0.03, -0.023));

  // Butt: in line with the bore, polymer, with a rubber pad and a sling slot.
  root.add(mesh(profile([[-0.2, 0.026], [-0.44, 0.03], [-0.452, -0.115], [-0.39, -0.112], [-0.2, -0.034]], 0.036, 0.007, [[[-0.36, -0.03], [-0.41, -0.03], [-0.41, -0.08], [-0.37, -0.07]]]), P));
  root.add(mesh(profile([[-0.452, 0.032], [-0.466, 0.028], [-0.468, -0.115], [-0.452, -0.118]], 0.04, 0.004), mats.rubber));
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) root.add(mesh(rbox(0.12, 0.003, 0.002, 0.0006), P, -0.29, 0.016 - i * 0.008, s * 0.0185));

  // 100-round drum: axis parallel to the bore, rounds standing in a spiral behind a clear rear face.
  const magazine = new THREE.Group();
  const DX = 0.118, DY = -0.118, DR = 0.079, DL = 0.074;
  magazine.add(mesh(tube(DR, DR, DL, 30, true), P, DX, DY, 0));
  magazine.add(mesh(new THREE.CircleGeometry(DR, 30).rotateY(Math.PI / 2), P, DX + DL / 2, DY, 0));
  magazine.add(mesh(tube(DR + 0.003, DR + 0.003, 0.008, 30), P, DX + DL / 2 - 0.004, DY, 0));
  magazine.add(mesh(tube(DR + 0.003, DR + 0.003, 0.008, 30), P, DX - DL / 2 + 0.004, DY, 0));
  magazine.add(mesh(new THREE.CircleGeometry(DR, 30).rotateY(-Math.PI / 2), mats.smoke, DX - DL / 2, DY, 0));
  // Cartridge bases showing through the cover: two rings of the spiral.
  for (const [n, rr] of [[26, 0.066], [18, 0.046], [10, 0.026]] as const) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      magazine.add(mesh(tube(0.0048, 0.0048, 0.01, 8), mats.brass, DX - DL / 2 + 0.008, DY + Math.sin(a) * rr, Math.cos(a) * rr));
    }
  }
  magazine.add(mesh(tube(0.012, 0.012, DL + 0.012, 12), S, DX, DY, 0)); // spindle and winding key
  magazine.add(mesh(rbox(0.006, 0.01, 0.04, 0.002), S, DX + DL / 2 + 0.006, DY, 0));
  // Feed tower up into the magazine housing, and the catch.
  magazine.add(mesh(profile([[DX - 0.03, DY + 0.05], [DX + 0.03, DY + 0.05], [DX + 0.026, -0.034], [DX - 0.026, -0.034]], 0.028, 0.003), P));
  root.add(magazine);
  root.add(mesh(rbox(0.07, 0.012, 0.036, 0.002), K, DX, -0.04, 0));

  // Fore-end with the integral vertical grip.
  root.add(mesh(profile([[0.2, -0.04], [0.375, -0.04], [0.385, -0.02], [0.385, 0.012], [0.2, 0.012]], 0.046, 0.006), P));
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) root.add(mesh(rbox(0.018, 0.007, 0.003, 0.001), mats.rubber, 0.235 + i * 0.03, -0.002, s * 0.0232));
  root.add(mesh(profile([[0.268, -0.04], [0.312, -0.04], [0.306, -0.09], [0.304, -0.148], [0.27, -0.148], [0.274, -0.09]], 0.034, 0.008), P));
  for (let i = 0; i < 7; i++) root.add(mesh(rbox(0.036, 0.003, 0.036, 0.001), P, 0.289, -0.062 - i * 0.012, 0));

  // Gas system under the barrel: cylinder, regulator, front sight base with its two ears.
  root.add(mesh(tube(0.0085, 0.0085, 0.19, 12), S, 0.3, -0.022, 0));
  root.add(mesh(rbox(0.03, 0.05, 0.026, 0.004), S, 0.4, -0.004, 0));
  root.add(mesh(tube(0.011, 0.011, 0.014, 12), S, 0.418, -0.022, 0));
  for (const s of [-1, 1]) root.add(mesh(profile([[0.388, 0.018], [0.412, 0.018], [0.408, 0.05], [0.398, 0.054], [0.39, 0.048]], 0.0026, 0.0006), S, 0, 0, s * 0.0085));
  root.add(mesh(tube(0.0014, 0.0011, 0.026, 6).rotateZ(Math.PI / 2), S, 0.4, 0.031, 0));

  // Quick-change barrel, carrying handle folded to the right, flash suppressor.
  root.add(mesh(tube(0.0112, 0.0102, 0.31, 14), S, 0.37, 0, 0));
  root.add(mesh(tube(0.014, 0.014, 0.02, 14), S, 0.245, 0, 0));
  root.add(mesh(tube(0.0125, 0.0125, 0.016, 14), S, 0.3, 0, 0));
  const handle = new THREE.CatmullRomCurve3([V(0.3, 0.008, 0.012), V(0.3, 0.02, 0.05), V(0.33, 0.012, 0.062), V(0.36, 0.006, 0.05)]);
  root.add(mesh(new THREE.TubeGeometry(handle, 14, 0.0035, 6, false), S));
  root.add(mesh(tube(0.008, 0.008, 0.07, 10), P, 0.332, 0.011, 0.061));
  root.add(mesh(tube(0.0115, 0.0105, 0.062, 14), S, 0.535, 0, 0));
  slots(root, mats.rubber, 0.538, 0.0108, 0.036, 6);
  root.add(mesh(tube(0.0125, 0.0125, 0.006, 14), S, 0.506, 0, 0));

  // Bipod, legs folded forward under the barrel.
  root.add(mesh(rbox(0.022, 0.02, 0.04, 0.003), S, 0.432, -0.014, 0));
  const bipod = ([-1, 1] as const).map((sd) => bipodLeg(mats, 0.436, -0.028, sd * 0.016, 0.24, 0.0048, 1, sd));
  root.add(...bipod);
  // Sling swivels.
  for (const x of [-0.4, 0.39]) {
    const loop = mesh(new THREE.TorusGeometry(0.009, 0.002, 6, 12), S, x, x < 0 ? -0.116 : -0.03, -0.022);
    loop.rotation.y = Math.PI / 2;
    root.add(loop);
  }

  const rightArm = arm(mats, 1.0, -1, V(-0.03, -0.092, 0.03), V(0.94, 0.26, -0.1), V(0.1, 0, 1), V(-0.37, -0.25, 0.17));
  const leftArm = arm(mats, 1.0, 1, V(0.286, -0.1, -0.03), V(0.94, 0.3, 0.1), V(0.1, 0, -1), V(0.0, -0.33, -0.3));
  root.add(rightArm, leftArm);
  return { root, muzzle: V(0.568, 0, 0), sight: V(-0.3, 0.044, 0), eject: V(0.062, 0.004, 0.03), magazine, leftArm, rightArm, bolt, bipod };
}

// =====================================================================================
// Heckler & Koch P30 — 9 mm service pistol (181 × 138 × 35 mm, 98 mm barrel)
// =====================================================================================

/**
 * Polymer-framed, hammer-fired. The details that make it a P30 rather than
 * any pistol: the sculpted grip with finger grooves and separate side panels,
 * the exposed spurred hammer with the decocker beside it, long ambidextrous
 * slide releases, the paddle magazine release in the trigger guard, a hooked
 * square guard and a rail under the dust cover.
 */
export function buildP30(mats: GunMats): ViewWeapon {
  const root = new THREE.Group();
  const P = mats.polymer, S = mats.steel;

  // Slide (the moving group): flat-sided with a bevelled top, serrated front and rear.
  const bolt = new THREE.Group();
  bolt.add(mesh(profile([[-0.074, -0.014], [0.106, -0.014], [0.106, 0.006], [0.1, 0.013], [-0.07, 0.013], [-0.076, 0.004]], 0.0275, 0.0035), S));
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) {
    bolt.add(mesh(rbox(0.0022, 0.02, 0.0015, 0.0004), mats.rubber, -0.064 + i * 0.0048, 0.0, s * 0.0139));
    if (i < 5) bolt.add(mesh(rbox(0.0022, 0.016, 0.0015, 0.0004), mats.rubber, 0.076 + i * 0.0048, -0.002, s * 0.0139));
  }
  // Ejection port over the barrel hood (right-top), extractor, sights.
  bolt.add(mesh(rbox(0.036, 0.006, 0.014, 0.001), mats.park, 0.012, 0.011, 0.005));
  bolt.add(mesh(rbox(0.036, 0.012, 0.003, 0.001), mats.rubber, 0.012, 0.004, 0.0132));
  bolt.add(mesh(rbox(0.022, 0.003, 0.002, 0.0006), mats.park, -0.022, 0.002, 0.0138));
  bolt.add(mesh(profile([[-0.068, 0.013], [-0.054, 0.013], [-0.054, 0.0195], [-0.068, 0.0195]], 0.022, 0.001, [[[-0.066, 0.0155], [-0.056, 0.0155], [-0.056, 0.022], [-0.066, 0.022]]]), S));
  for (const s of [-1, 1]) bolt.add(mesh(rbox(0.012, 0.0062, 0.007, 0.0008), S, -0.061, 0.0165, s * 0.0075));
  bolt.add(mesh(profile([[0.088, 0.013], [0.1, 0.013], [0.097, 0.0188], [0.09, 0.0188]], 0.0036, 0.0006), S));
  // Sight dots.
  for (const s of [-1, 1]) bolt.add(mesh(new THREE.CircleGeometry(0.0013, 8).rotateY(-Math.PI / 2), mats.skin, -0.0672, 0.0168, s * 0.0075));
  bolt.add(mesh(new THREE.CircleGeometry(0.0013, 8).rotateY(-Math.PI / 2), mats.skin, 0.0878, 0.0164, 0));
  root.add(bolt);
  // Barrel and recoil-spring guide showing at the muzzle.
  root.add(mesh(tube(0.0068, 0.0068, 0.03, 12), mats.park, 0.093, 0, 0));
  root.add(mesh(new THREE.CircleGeometry(0.0045, 10).rotateY(Math.PI / 2), mats.rubber, 0.1082, 0, 0));
  root.add(mesh(tube(0.004, 0.004, 0.02, 8), S, 0.096, -0.0105, 0));

  // Frame: dust cover with rail, trigger guard, grip.
  root.add(mesh(profile([[-0.07, -0.014], [0.1, -0.014], [0.1, -0.03], [0.046, -0.032], [0.04, -0.026], [-0.062, -0.03]], 0.029, 0.003), P));
  for (let i = 0; i < 4; i++) root.add(mesh(rbox(0.0045, 0.0045, 0.0305, 0.0008), P, 0.058 + i * 0.01, -0.0325, 0));
  // Hooked, squared trigger guard.
  root.add(mesh(profile([[0.04, -0.028], [0.046, -0.028], [0.05, -0.06], [0.044, -0.068], [-0.004, -0.068], [-0.004, -0.062], [0.04, -0.062], [0.044, -0.056]], 0.016, 0.002), P));
  root.add(mesh(profile([[0.016, -0.03], [0.026, -0.03], [0.024, -0.046], [0.02, -0.056], [0.0155, -0.054], [0.018, -0.044]], 0.006, 0.0015), S));
  // Paddle magazine release along the guard's lower edge.
  for (const s of [-1, 1]) root.add(mesh(rbox(0.018, 0.005, 0.003, 0.001), P, 0.004, -0.061, s * 0.0095));
  // Grip: raked back about 18°, palm swell at the back, three finger grooves in front.
  root.add(mesh(profile([[-0.066, -0.03], [-0.004, -0.03], [-0.008, -0.044], [-0.004, -0.058], [-0.012, -0.066], [-0.01, -0.08], [-0.018, -0.088], [-0.017, -0.102], [-0.026, -0.11], [-0.03, -0.124], [-0.082, -0.124], [-0.086, -0.1], [-0.08, -0.07], [-0.07, -0.046]], 0.031, 0.006), P));
  // Interchangeable side panels and backstrap, a shade different from the frame.
  for (const s of [-1, 1]) root.add(mesh(profile([[-0.064, -0.05], [-0.024, -0.05], [-0.034, -0.112], [-0.074, -0.112]], 0.002, 0.0008), mats.rubber, 0, 0, s * 0.0158));
  root.add(mesh(profile([[-0.074, -0.05], [-0.068, -0.05], [-0.08, -0.116], [-0.087, -0.112]], 0.026, 0.003), mats.rubber));
  // Slide releases (long, both sides), takedown lever, decocker and the spurred hammer.
  for (const s of [-1, 1]) root.add(mesh(rbox(0.034, 0.005, 0.003, 0.0012), S, -0.022, -0.017, s * 0.0152));
  root.add(mesh(rbox(0.008, 0.006, 0.0035, 0.001), S, 0.03, -0.02, -0.0152));
  root.add(mesh(rbox(0.006, 0.008, 0.006, 0.001), S, -0.0755, 0.004, -0.007));
  root.add(mesh(profile([[-0.074, -0.012], [-0.078, 0.004], [-0.088, 0.008], [-0.09, 0.002], [-0.082, -0.004], [-0.08, -0.014]], 0.007, 0.0015), S));

  // Magazine: steel body with a polymer floor plate.
  const magazine = new THREE.Group();
  magazine.add(mesh(profile([[-0.062, -0.034], [-0.024, -0.034], [-0.042, -0.122], [-0.078, -0.122]], 0.02, 0.002), S));
  magazine.add(mesh(profile([[-0.084, -0.122], [-0.03, -0.122], [-0.03, -0.132], [-0.086, -0.132]], 0.031, 0.003), P));
  root.add(magazine);

  // Two-handed hold: the right hand high on the backstrap, the left wrapped over it.
  const rightArm = arm(mats, 1.05, -1, V(-0.062, -0.09, 0.024), V(0.95, 0.22, -0.14), V(0.1, 0, 1), V(-0.42, -0.25, 0.15));
  const leftArm = arm(mats, 1.05, 1, V(-0.05, -0.102, -0.03), V(0.93, 0.25, 0.22), V(0.15, -0.1, -1), V(-0.38, -0.3, -0.24));
  root.add(rightArm, leftArm);
  return { root, muzzle: V(0.108, 0, 0), sight: V(-0.36, 0.0196, 0), eject: V(0.012, 0.012, 0.014), magazine, leftArm, rightArm, bolt };
}

// =====================================================================================
// KAC M110 SASS — 7.62 mm semi-automatic marksman rifle (1,181 mm suppressed, 508 mm barrel)
// =====================================================================================

/**
 * AR-10 pattern in flat dark earth: flat-top upper with brass deflector and
 * forward assist, the long URX free-float rail with a folded front sight,
 * a straight 20-round magazine, fixed stock with the length-of-pull knob on
 * the right, a 3.5–10× scope in a one-piece mount, Harris bipod and the
 * quick-detach suppressor over the flash hider.
 */
export function buildM110(mats: GunMats): ViewWeapon {
  const root = new THREE.Group();
  const F = mats.fde, S = mats.steel, P = mats.polymer;
  const TOP = 0.034; // rail height above the bore

  // Upper receiver: flat top, rounded shoulders, with the port and deflector on the right.
  root.add(mesh(profile([[-0.118, -0.016], [0.118, -0.016], [0.118, 0.026], [0.1, TOP], [-0.112, TOP], [-0.118, 0.022]], 0.044, 0.006), F));
  rail(root, F, -0.11, 0.118, TOP, 0, "y", 1);
  root.add(mesh(rbox(0.062, 0.02, 0.003, 0.001), mats.rubber, 0.03, 0.004, 0.0225));
  root.add(mesh(rbox(0.066, 0.012, 0.004, 0.001), F, 0.03, -0.013, 0.0235)); // dust cover, open and hanging
  root.add(mesh(profile([[-0.03, -0.008], [-0.006, -0.008], [-0.006, 0.014], [-0.022, 0.014]], 0.012, 0.003), F, 0, 0, 0.026)); // brass deflector
  const fa = mesh(tube(0.0065, 0.0065, 0.03, 10), F, -0.062, 0.008, 0.027);
  fa.rotation.y = -0.5;
  root.add(fa);
  root.add(mesh(tube(0.0085, 0.0085, 0.006, 10), S, -0.076, 0.008, 0.035).rotateY(-0.5));
  // Charging handle at the rear of the upper.
  const bolt = new THREE.Group();
  bolt.add(mesh(rbox(0.02, 0.008, 0.05, 0.002), S, -0.122, 0.024, 0));
  bolt.add(mesh(rbox(0.012, 0.01, 0.014, 0.002), S, -0.124, 0.024, -0.028));
  // Bolt carrier showing in the ejection port.
  bolt.add(mesh(rbox(0.058, 0.016, 0.004, 0.001), mats.park, 0.03, 0.004, 0.0205));
  root.add(bolt);

  // Lower receiver: magazine well, trigger housing, ambidextrous controls.
  root.add(mesh(profile([[-0.118, -0.016], [0.106, -0.016], [0.106, -0.078], [0.03, -0.078], [0.024, -0.05], [-0.04, -0.048], [-0.118, -0.04]], 0.04, 0.005), F));
  for (const s of [-1, 1]) {
    root.add(mesh(tube(0.005, 0.005, 0.004, 10), S, -0.02, -0.03, s * 0.0215).rotateY(Math.PI / 2)); // selector
    root.add(mesh(rbox(0.016, 0.004, 0.004, 0.001), S, -0.012, -0.027, s * 0.0235));
    root.add(mesh(rbox(0.01, 0.014, 0.004, 0.001), S, 0.05, -0.034, s * 0.0215)); // magazine release
    root.add(mesh(rbox(0.008, 0.022, 0.004, 0.001), S, 0.074, -0.02, s * 0.0215)); // bolt catch
  }
  for (const x of [-0.07, 0.092]) for (const s of [-1, 1]) root.add(mesh(tube(0.0035, 0.0035, 0.003, 8), S, x, -0.03, s * 0.021).rotateY(Math.PI / 2));
  // Trigger guard and trigger.
  root.add(mesh(profile([[-0.036, -0.05], [0.026, -0.05], [0.026, -0.054], [0.018, -0.082], [-0.03, -0.084], [-0.036, -0.08], [-0.03, -0.079], [0.014, -0.077], [0.021, -0.054], [-0.036, -0.054]], 0.012, 0.0015), F));
  root.add(mesh(profile([[-0.004, -0.05], [0.006, -0.05], [0.002, -0.066], [-0.004, -0.074], [-0.0075, -0.07]], 0.006, 0.0015), S));
  // A2 pistol grip.
  root.add(mesh(profile([[-0.07, -0.042], [-0.034, -0.046], [-0.04, -0.07], [-0.05, -0.078], [-0.056, -0.136], [-0.092, -0.134], [-0.082, -0.09]], 0.03, 0.006), F));
  for (let i = 0; i < 9; i++) for (const s of [-1, 1]) root.add(mesh(rbox(0.026, 0.002, 0.002, 0.0005), F, -0.064 - i * 0.0018, -0.066 - i * 0.007, s * 0.0155));

  // 20-round magazine: straight-sided, ribbed.
  const magazine = new THREE.Group();
  magazine.add(mesh(profile([[0.034, -0.07], [0.102, -0.07], [0.11, -0.186], [0.044, -0.19]], 0.026, 0.002), S));
  for (const s of [-1, 1]) for (const yy of [-0.1, -0.13, -0.16]) magazine.add(mesh(rbox(0.058, 0.004, 0.0015, 0.0005), S, 0.072, yy, s * 0.0133));
  magazine.add(mesh(profile([[0.04, -0.186], [0.114, -0.182], [0.114, -0.192], [0.04, -0.196]], 0.03, 0.002), F));
  root.add(magazine);

  // Fixed stock on the receiver extension, with the adjustable butt and its knob.
  root.add(mesh(tube(0.016, 0.016, 0.06, 14), S, -0.146, 0.006, 0));
  root.add(mesh(profile([[-0.16, 0.03], [-0.4, 0.03], [-0.4, -0.108], [-0.36, -0.106], [-0.16, -0.022]], 0.04, 0.008), F));
  root.add(mesh(profile([[-0.4, 0.032], [-0.428, 0.03], [-0.432, -0.11], [-0.4, -0.112]], 0.042, 0.004), mats.rubber));
  root.add(mesh(tube(0.012, 0.012, 0.012, 14), S, -0.36, -0.03, 0.026).rotateY(Math.PI / 2));
  for (let i = 0; i < 8; i++) root.add(mesh(rbox(0.003, 0.004, 0.012, 0.0006), S, -0.36 + Math.cos((i * Math.PI) / 4) * 0.012, -0.03 + Math.sin((i * Math.PI) / 4) * 0.012, 0.027));
  for (const s of [-1, 1]) root.add(mesh(tube(0.006, 0.006, 0.004, 10), S, -0.14, -0.024, s * 0.021).rotateY(Math.PI / 2)); // QD sling sockets

  // URX free-float rail: octagonal tube, rails on four faces, folded front sight.
  const H0 = 0.118, H1 = 0.455;
  const oct = new THREE.CylinderGeometry(0.0285, 0.0285, H1 - H0, 8, 1, true).rotateZ(-Math.PI / 2).rotateX(Math.PI / 8);
  root.add(mesh(oct, F, (H0 + H1) / 2, 0.004, 0));
  root.add(mesh(new THREE.RingGeometry(0.014, 0.0285, 8).rotateY(Math.PI / 2).rotateX(Math.PI / 8), F, H1, 0.004, 0));
  root.add(mesh(tube(0.031, 0.031, 0.02, 16), F, H0 + 0.01, 0.004, 0)); // barrel nut
  root.add(mesh(rbox(H1 - H0, 0.006, 0.021, 0.001), F, (H0 + H1) / 2, TOP - 0.003, 0));
  rail(root, F, H0, H1, TOP, 0, "y", 1);
  rail(root, F, H0 + 0.1, H1, -0.0235, 0, "y", -1);
  for (const s of [-1, 1] as const) rail(root, F, H0 + 0.12, H1, 0.004, s * 0.0275, "z", s);
  for (let i = 0; i < 6; i++) for (const a of [1, 3, 5, 7]) {
    const an = (a * Math.PI) / 4;
    const v = mesh(rbox(0.026, 0.005, 0.003, 0.001), mats.rubber, H0 + 0.05 + i * 0.05, 0.004 + Math.sin(an) * 0.0262, Math.cos(an) * 0.0262);
    v.rotation.x = -an + Math.PI / 2;
    root.add(v);
  }
  root.add(mesh(rbox(0.04, 0.008, 0.018, 0.002), S, H1 - 0.03, TOP + 0.007, 0));
  root.add(mesh(rbox(0.03, 0.005, 0.01, 0.001), S, H1 - 0.05, TOP + 0.012, 0));

  // Barrel, flash hider, quick-detach suppressor.
  root.add(mesh(tube(0.0115, 0.0105, 0.2, 14), S, 0.5, 0.0, 0));
  root.add(mesh(tube(0.0135, 0.0135, 0.02, 14), S, 0.47, 0, 0)); // gas block shoulder
  root.add(mesh(tube(0.0205, 0.0205, 0.3, 20), F, 0.71, 0, 0));
  root.add(mesh(tube(0.022, 0.022, 0.022, 20), S, 0.572, 0, 0)); // locking collar
  root.add(mesh(tube(0.0205, 0.018, 0.012, 20), F, 0.866, 0, 0));
  root.add(mesh(new THREE.CircleGeometry(0.006, 12).rotateY(Math.PI / 2), mats.rubber, 0.8722, 0, 0));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    root.add(mesh(rbox(0.012, 0.0025, 0.0025, 0.0006), S, 0.572, Math.sin(a) * 0.022, Math.cos(a) * 0.022));
  }

  // Scope: 30 mm tube, 40 mm objective, turret saddle, one-piece mount.
  const SY = TOP + 0.04;
  root.add(mesh(rbox(0.13, 0.012, 0.03, 0.002), S, 0.02, TOP + 0.008, 0));
  for (const x of [-0.03, 0.07]) {
    root.add(mesh(rbox(0.02, 0.03, 0.036, 0.004), S, x, SY - 0.012, 0));
    root.add(mesh(tube(0.0195, 0.0195, 0.02, 18), S, x, SY, 0));
    for (const s of [-1, 1]) root.add(mesh(tube(0.003, 0.003, 0.008, 6).rotateZ(Math.PI / 2), S, x, SY + 0.018, s * 0.012));
  }
  root.add(mesh(tube(0.015, 0.015, 0.2, 20), S, 0.02, SY, 0));
  root.add(mesh(tube(0.015, 0.024, 0.045, 22), S, 0.142, SY, 0)); // objective bell flare
  root.add(mesh(tube(0.024, 0.024, 0.07, 22, true), S, 0.2, SY, 0));
  root.add(mesh(tube(0.021, 0.015, 0.03, 22), S, -0.094, SY, 0)); // ocular flare
  root.add(mesh(tube(0.021, 0.021, 0.06, 22, true), S, -0.139, SY, 0));
  root.add(mesh(tube(0.0225, 0.0225, 0.014, 22, true), mats.rubber, -0.166, SY, 0)); // eyepiece ring
  root.add(mesh(new THREE.RingGeometry(0.016, 0.0225, 22).rotateY(-Math.PI / 2), mats.rubber, -0.173, SY, 0));
  root.add(mesh(tube(0.0225, 0.0225, 0.016, 22), P, -0.112, SY, 0)); // power ring
  for (let i = 0; i < 12; i++) root.add(mesh(rbox(0.014, 0.003, 0.003, 0.0006), P, -0.112, SY + Math.sin((i * Math.PI) / 6) * 0.0228, Math.cos((i * Math.PI) / 6) * 0.0228));
  root.add(mesh(rbox(0.034, 0.034, 0.034, 0.005), S, 0.03, SY, 0)); // turret saddle
  root.add(mesh(tube(0.011, 0.011, 0.02, 16).rotateZ(Math.PI / 2), S, 0.03, SY + 0.026, 0)); // elevation
  root.add(mesh(tube(0.011, 0.011, 0.018, 16).rotateY(Math.PI / 2), S, 0.03, SY, 0.026)); // windage
  root.add(mesh(tube(0.012, 0.012, 0.016, 16).rotateY(Math.PI / 2), S, 0.03, SY, -0.025)); // parallax
  root.add(mesh(new THREE.CircleGeometry(0.0235, 22).rotateY(Math.PI / 2), mats.lens, 0.232, SY, 0));
  root.add(mesh(new THREE.CircleGeometry(0.0195, 22).rotateY(-Math.PI / 2), mats.lens, -0.168, SY, 0));

  // Harris bipod on the bottom rail, legs folded forward.
  root.add(mesh(rbox(0.04, 0.016, 0.05, 0.003), S, 0.415, -0.034, 0));
  const bipod = ([-1, 1] as const).map((sd) => bipodLeg(mats, 0.43, -0.04, sd * 0.024, 0.22, 0.0058, 1, sd));
  root.add(...bipod);
  for (const sd of [-1, 1]) root.add(mesh(tube(0.002, 0.002, 0.05, 5), S, 0.41, -0.046, sd * 0.031)); // return springs

  root.add(
    reticleMesh((c) => {
      c.strokeStyle = "#000";
      c.lineWidth = 1.4;
      for (const [x0, y0, x1, y1] of [[64, 0, 64, 128], [0, 64, 128, 64]]) {
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
        c.stroke();
      }
    }, 0.03, 0.03, SY)
  );
  const rightArm = arm(mats, 1.0, -1, V(-0.066, -0.098, 0.03), V(0.94, 0.26, -0.1), V(0.1, 0, 1), V(-0.38, -0.25, 0.17));
  const leftArm = arm(mats, 0.8, 1, V(0.25, -0.044, -0.004), V(0.12, 0.05, 1), V(0, -1, 0.1), V(-0.1, -0.3, -0.27));
  root.add(rightArm, leftArm);
  return { root, muzzle: V(0.874, 0, 0), sight: V(-0.235, SY, 0), eject: V(0.03, 0.006, 0.028), magazine, leftArm, rightArm, bolt, bipod };
}

// =====================================================================================
// MATADOR — 90 mm disposable anti-armour / anti-structure launcher (1 m, 8.9 kg)
// =====================================================================================

/**
 * A fat olive tube carried on the right shoulder: big faceted shock absorbers
 * on both ends, the firing mechanism and pistol grip under the middle with a
 * folding fore grip ahead of it and the shoulder rest behind, the optical
 * sight on a bracket up the left side with a rail on top, and the stand-off
 * probe in the muzzle that selects HEAT (out) or HESH (in).
 */
export function buildMatador(mats: GunMats): ViewWeapon {
  const root = new THREE.Group();
  const O = mats.olive, S = mats.steel, P = mats.polymer, R = mats.rubber;
  const X0 = -0.56, X1 = 0.44, TR = 0.053;

  root.add(mesh(tube(TR, TR, X1 - X0, 28, true), O, (X0 + X1) / 2, 0, 0));
  // Filament-wound reinforcing bands and the yellow hazard band near the venturi.
  for (const x of [-0.36, -0.12, 0.12, 0.3]) root.add(mesh(tube(TR + 0.002, TR + 0.002, 0.03, 28, true), O, x, 0, 0));
  root.add(mesh(tube(TR + 0.0012, TR + 0.0012, 0.018, 28, true), mats.mark, -0.44, 0, 0));
  root.add(mesh(tube(TR + 0.0012, TR + 0.0012, 0.006, 28, true), mats.mark, 0.34, 0, 0));
  // Shock absorbers: octagonal foam bumpers, front and rear.
  for (const [x, len] of [[X1 - 0.04, 0.1], [X0 + 0.045, 0.11]]) {
    const g = new THREE.CylinderGeometry(0.078, 0.072, len, 8, 1, false).rotateZ(-Math.PI / 2).rotateX(Math.PI / 8);
    root.add(mesh(g, R, x, 0, 0));
    root.add(mesh(tube(0.066, 0.066, len + 0.012, 24, true), R, x, 0, 0));
  }
  // Muzzle: the warhead's nose and the stand-off probe, extended.
  root.add(mesh(new THREE.RingGeometry(0.043, 0.066, 24).rotateY(Math.PI / 2), R, X1 + 0.016, 0, 0));
  root.add(mesh(new THREE.SphereGeometry(0.043, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2).scale(0.7, 1, 1), O, X1 - 0.02, 0, 0));
  root.add(mesh(tube(0.009, 0.007, 0.07, 10), S, X1 + 0.04, 0, 0));
  // Venturi at the back.
  root.add(mesh(new THREE.RingGeometry(0.04, 0.066, 24).rotateY(-Math.PI / 2), R, X0 - 0.016, 0, 0));
  root.add(mesh(new THREE.CircleGeometry(0.04, 20).rotateY(-Math.PI / 2), R, X0 + 0.02, 0, 0));

  // Firing mechanism: housing, pistol grip, guard, trigger, safety/arming lever.
  root.add(mesh(profile([[-0.07, -TR + 0.004], [0.09, -TR + 0.004], [0.084, -0.086], [-0.06, -0.086]], 0.04, 0.006), P));
  root.add(mesh(profile([[-0.05, -0.084], [-0.012, -0.084], [-0.024, -0.13], [-0.03, -0.176], [-0.068, -0.172], [-0.06, -0.128]], 0.032, 0.007), P));
  const magazine = new THREE.Group(); // nothing to change on a disposable; kept for the shared rig
  root.add(magazine);
  root.add(mesh(profile([[-0.012, -0.086], [0.07, -0.086], [0.066, -0.118], [0.052, -0.124], [-0.016, -0.122], [-0.016, -0.118], [0.05, -0.119], [0.062, -0.114], [0.064, -0.09]], 0.014, 0.002), P));
  root.add(mesh(profile([[0.022, -0.086], [0.032, -0.086], [0.028, -0.102], [0.022, -0.11], [0.0185, -0.106]], 0.007, 0.0015), S));
  const bolt = new THREE.Group();
  bolt.add(mesh(rbox(0.03, 0.008, 0.006, 0.002), mats.mark, 0.05, -0.07, -0.023));
  root.add(bolt);
  // Folding fore grip, down and locked.
  root.add(mesh(rbox(0.04, 0.02, 0.036, 0.004), P, 0.21, -TR - 0.008, 0));
  root.add(mesh(profile([[0.196, -TR - 0.016], [0.226, -TR - 0.016], [0.222, -0.19], [0.2, -0.19]], 0.03, 0.008), P));
  // Shoulder rest behind the grip.
  root.add(mesh(profile([[-0.3, -TR + 0.004], [-0.17, -TR + 0.004], [-0.19, -0.1], [-0.3, -0.112]], 0.05, 0.01), R));
  // Carrying handle / sling bar along the right side.
  const bar = new THREE.CatmullRomCurve3([V(-0.2, 0.02, TR), V(-0.18, 0.03, TR + 0.03), V(0.1, 0.03, TR + 0.03), V(0.12, 0.02, TR)]);
  root.add(mesh(new THREE.TubeGeometry(bar, 14, 0.004, 6, false), S));

  // Optical sight on its bracket, up the left side: body, eyecup, objective, rail on top.
  const SYc = 0.088, SZ = -0.062;
  root.add(mesh(profile([[0.0, 0.03], [0.1, 0.03], [0.1, SYc - 0.02], [0.0, SYc - 0.02]], 0.012, 0.002), S, 0, 0, SZ + 0.012));
  // The housing is solid from outside; anything named "lens" is hidden while aiming so the
  // firer sees the sight picture (eyecup ring and stadia) instead of the back of a box.
  for (const m of [
    mesh(rbox(0.13, 0.044, 0.04, 0.006), P, 0.05, SYc, SZ),
    mesh(tube(0.017, 0.015, 0.03, 16), R, -0.03, SYc, SZ),
    mesh(tube(0.016, 0.016, 0.014, 16), P, 0.12, SYc, SZ),
    mesh(new THREE.CircleGeometry(0.014, 16).rotateY(Math.PI / 2), mats.lens, 0.1275, SYc, SZ),
    mesh(rbox(0.1, 0.006, 0.021, 0.001), S, 0.05, SYc + 0.025, SZ),
  ]) {
    m.name = "lens";
    root.add(m);
  }
  root.add(mesh(new THREE.RingGeometry(0.0135, 0.018, 20).rotateY(-Math.PI / 2), R, -0.0452, SYc, SZ));

  // Stencilled data panel.
  const label = canvasTex(256, 96, (c) => {
    c.fillStyle = "#5a6340";
    c.fillRect(0, 0, 256, 96);
    c.fillStyle = "#e0c838";
    c.font = "bold 22px Arial";
    c.fillText("MATADOR 90 MM", 10, 28);
    c.font = "13px Arial";
    c.fillText("HEAT / HESH  ·  DISPOSABLE", 10, 50);
    c.fillText("DANGER — BACKBLAST AREA 50 M", 10, 72);
  });
  const lm = new THREE.MeshBasicMaterial({ map: label, fog: false });
  const lab = mesh(new THREE.PlaneGeometry(0.16, 0.06), lm, -0.1, 0.012, TR + 0.0015);
  lab.rotation.x = -0.2;
  lab.position.y = 0.014;
  root.add(lab);

  root.add(
    reticleMesh((c) => {
      c.strokeStyle = "#101010";
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(64, 20);
      c.lineTo(64, 120);
      c.stroke();
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.moveTo(64 - 26 + i * 4, 50 + i * 14);
        c.lineTo(64 + 26 - i * 4, 50 + i * 14);
        c.stroke();
      }
    }, 0.024, 0.06, SYc, SZ)
  );
  const rightArm = arm(mats, 1.0, -1, V(-0.046, -0.13, 0.03), V(0.94, 0.26, -0.1), V(0.1, 0, 1), V(-0.3, -0.3, 0.2));
  const leftArm = arm(mats, 1.0, 1, V(0.21, -0.14, -0.03), V(0.94, 0.3, 0.1), V(0.1, 0, -1), V(-0.05, -0.36, -0.28));
  root.add(rightArm, leftArm);
  return { root, muzzle: V(X1 + 0.08, 0, 0), sight: V(-0.1, SYc, SZ), eject: V(X0 - 0.05, 0, 0), magazine, leftArm, rightArm, bolt };
}

// =====================================================================================
// ST Engineering BR18 — 5.56 mm bullpup (645 mm overall, 368 mm barrel)
// =====================================================================================

/**
 * The SAF's next-generation bullpup. Compact and angular, in reinforced polymer: a
 * full-length top rail, side and bottom rails at the fore-end, forward ejection through a
 * deflector on the right just ahead of the grip, the charging handle above the trigger
 * guard, a large flip-out trigger guard for gloved hands and a carbon-fibre cheek piece
 * that slides open over the chamber. Issued here with a red-dot sight and a 3× magnifier
 * flipped aside on its mount.
 */
export function buildBR18(mats: GunMats): ViewWeapon {
  const root = new THREE.Group();
  const P = mats.polymer, S = mats.steel, R = mats.rubber;
  const TOP = 0.04;

  // Main body: one angular shell from butt to fore-end.
  // Lower shell: stock, magazine housing and fore-end, slimming toward the muzzle.
  root.add(mesh(profile([[-0.37, -0.064], [-0.17, -0.07], [-0.07, -0.05], [0.02, -0.046], [0.08, -0.034], [0.196, -0.032], [0.208, -0.018], [0.208, 0.002], [-0.37, 0.002]], 0.052, 0.006), P));
  // Upper receiver: a slightly wider, lighter grey shell carrying the top rail, chamfered at the nose.
  root.add(mesh(profile([[-0.37, 0.0], [0.212, 0.0], [0.212, 0.014], [0.19, TOP - 0.004], [-0.33, TOP - 0.004], [-0.37, 0.022]], 0.056, 0.005), mats.park));
  // Parting line between the two shells, and recessed grip panels on the stock.
  for (const s of [-1, 1]) {
    root.add(mesh(rbox(0.56, 0.0025, 0.002, 0.0006), R, -0.08, 0.001, s * 0.0281));
    root.add(mesh(profile([[-0.33, -0.05], [-0.2, -0.054], [-0.16, -0.012], [-0.33, -0.012]], 0.002, 0.0008), R, 0, 0, s * 0.0262));
  }
  // Fore-end vents.
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) root.add(mesh(rbox(0.014, 0.012, 0.002, 0.0006), R, 0.105 + i * 0.02, -0.016, s * 0.0262));
  root.add(mesh(profile([[-0.384, -0.068], [-0.368, -0.07], [-0.368, 0.024], [-0.384, 0.02]], 0.05, 0.004), R)); // butt pad
  // Carbon-fibre cheek piece (left), with its sliding seam.
  root.add(mesh(profile([[-0.33, -0.012], [-0.14, -0.012], [-0.13, 0.03], [-0.33, 0.03]], 0.003, 0.0008), R, 0, 0, -0.0275));
  root.add(mesh(rbox(0.004, 0.04, 0.002, 0.0006), S, -0.14, 0.009, -0.0292));
  // Stock flutes and texture panels.
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) root.add(mesh(rbox(0.13, 0.003, 0.002, 0.0006), P, -0.25, -0.03 - i * 0.008, s * 0.0275));
  // Forward ejection deflector on the right, with the port behind it.
  root.add(mesh(profile([[-0.08, -0.01], [0.02, -0.01], [0.04, 0.0], [0.04, 0.026], [-0.06, 0.026]], 0.012, 0.003), P, 0, 0, 0.031));
  root.add(mesh(rbox(0.05, 0.016, 0.003, 0.001), R, -0.12, 0.01, 0.0275));
  // Gas valve and front of the receiver.
  root.add(mesh(tube(0.011, 0.011, 0.014, 12).rotateY(Math.PI / 2), S, 0.17, 0.02, -0.028));

  // Rails: full-length top, plus 3, 6 and 9 o'clock at the fore-end.
  root.add(mesh(rbox(0.5, 0.006, 0.021, 0.001), P, -0.07, TOP, 0));
  rail(root, P, -0.32, 0.2, TOP + 0.001, 0, "y", 1);
  rail(root, P, 0.09, 0.2, -0.039, 0, "y", -1);
  for (const s of [-1, 1] as const) rail(root, P, 0.1, 0.2, 0.0, s * 0.0275, "z", s);

  // Pistol grip with finger groove and texture, flip-out trigger guard, trigger.
  root.add(mesh(profile([[-0.03, -0.046], [0.012, -0.046], [0.004, -0.07], [0.008, -0.092], [-0.004, -0.13], [-0.044, -0.128], [-0.04, -0.084]], 0.032, 0.007), P));
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) root.add(mesh(rbox(0.028, 0.0025, 0.002, 0.0006), P, -0.022 - i * 0.0015, -0.07 - i * 0.009, s * 0.0165));
  root.add(mesh(profile([[0.012, -0.046], [0.11, -0.04], [0.112, -0.05], [0.098, -0.092], [0.004, -0.13], [-0.002, -0.124], [0.09, -0.086], [0.1, -0.052], [0.016, -0.054]], 0.016, 0.003), P));
  root.add(mesh(profile([[0.034, -0.046], [0.044, -0.046], [0.04, -0.066], [0.034, -0.074], [0.031, -0.07]], 0.007, 0.0015), S));
  // Ambidextrous selector behind the grip and the magazine release paddle.
  for (const s of [-1, 1]) root.add(mesh(rbox(0.016, 0.006, 0.004, 0.001), S, -0.06, -0.026, s * 0.029));
  root.add(mesh(rbox(0.012, 0.016, 0.042, 0.003), P, -0.045, -0.06, 0));
  // Charging handle above the trigger guard (left), folded.
  const bolt = new THREE.Group();
  bolt.add(mesh(rbox(0.032, 0.012, 0.012, 0.003), S, 0.07, -0.026, -0.033));
  bolt.add(mesh(rbox(0.012, 0.02, 0.02, 0.004), P, 0.082, -0.026, -0.045));
  root.add(mesh(rbox(0.11, 0.004, 0.002, 0.0008), R, 0.05, -0.026, -0.0275)); // its slot
  root.add(bolt);

  // STANAG magazine behind the grip, curved.
  const magazine = new THREE.Group();
  magazine.add(mesh(profile([[-0.122, -0.06], [-0.058, -0.06], [-0.062, -0.12], [-0.078, -0.18], [-0.13, -0.17], [-0.124, -0.12]], 0.024, 0.002), S));
  for (const s of [-1, 1]) magazine.add(mesh(rbox(0.05, 0.004, 0.0015, 0.0005), S, -0.095, -0.1, s * 0.0125));
  magazine.add(mesh(profile([[-0.132, -0.168], [-0.075, -0.178], [-0.076, -0.188], [-0.134, -0.178]], 0.028, 0.002), P));
  root.add(magazine);
  root.add(mesh(rbox(0.074, 0.016, 0.034, 0.003), P, -0.09, -0.056, 0)); // magazine well lip

  // Barrel, gas block, flash hider.
  root.add(mesh(tube(0.0098, 0.0092, 0.07, 14), S, 0.245, 0.0, 0));
  root.add(mesh(tube(0.0118, 0.0118, 0.028, 14), S, 0.272, 0, 0));
  slots(root, R, 0.274, 0.0112, 0.02, 6);
  root.add(mesh(tube(0.0125, 0.0125, 0.005, 14), S, 0.257, 0, 0));
  // Folded back-up iron sights at each end of the top rail.
  root.add(mesh(rbox(0.03, 0.009, 0.02, 0.002), P, 0.18, TOP + 0.008, 0));
  root.add(mesh(rbox(0.03, 0.009, 0.02, 0.002), P, -0.3, TOP + 0.008, 0));

  // Red-dot sight on the rail: base, hood, window, battery cap, brightness buttons.
  const RY = TOP + 0.034;
  root.add(mesh(rbox(0.06, 0.012, 0.03, 0.002), S, -0.02, TOP + 0.01, 0));
  for (const s of [-1, 1]) root.add(mesh(profile([[-0.05, TOP + 0.012], [0.01, TOP + 0.012], [0.006, RY + 0.024], [-0.045, RY + 0.024]], 0.006, 0.0015), P, 0, 0, s * 0.017));
  root.add(mesh(rbox(0.055, 0.006, 0.04, 0.002), P, -0.02, RY + 0.025, 0));
  root.add(mesh(tube(0.008, 0.008, 0.012, 12).rotateY(Math.PI / 2), S, -0.03, TOP + 0.02, 0.022));
  for (const x of [-0.045, -0.035]) root.add(mesh(rbox(0.006, 0.004, 0.006, 0.001), R, x, RY + 0.029, 0.008));
  const win = mesh(new THREE.PlaneGeometry(0.03, 0.024).rotateY(-Math.PI / 2), mats.lens, -0.018, RY, 0);
  win.name = "lens";
  root.add(win);
  // 3× magnifier on a flip mount, swung out to the left.
  // Hinged down and out to the left, below the line of sight.
  root.add(mesh(rbox(0.03, 0.012, 0.03, 0.002), S, -0.09, TOP + 0.01, 0));
  root.add(mesh(rbox(0.012, 0.012, 0.03, 0.002), S, -0.09, TOP + 0.014, -0.022));
  root.add(mesh(tube(0.0145, 0.0145, 0.072, 18), P, -0.09, TOP + 0.008, -0.045));
  root.add(mesh(tube(0.016, 0.016, 0.012, 18), R, -0.128, TOP + 0.008, -0.045));
  root.add(mesh(new THREE.CircleGeometry(0.012, 16).rotateY(-Math.PI / 2), mats.lens, -0.1342, TOP + 0.008, -0.045));

  root.add(
    reticleMeshRed(0.034, -0.02, RY)
  );
  const rightArm = arm(mats, 1.0, -1, V(-0.03, -0.098, 0.031), V(0.94, 0.26, -0.1), V(0.1, 0, 1), V(-0.37, -0.24, 0.17));
  const leftArm = arm(mats, 0.8, 1, V(0.15, -0.062, -0.004), V(0.12, 0.05, 1), V(0, -1, 0.1), V(-0.18, -0.3, -0.26));
  root.add(rightArm, leftArm);
  return { root, muzzle: V(0.286, 0, 0), sight: V(-0.3, RY, 0), eject: V(0.04, 0.008, 0.04), magazine, leftArm, rightArm, bolt };
}

/** Red-dot reticle: a 2 MOA dot inside a thin 65 MOA ring, glowing red. */
function reticleMeshRed(size: number, x: number, y: number): THREE.Mesh {
  const tex = canvasTex(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128);
    c.strokeStyle = "rgba(255,40,30,0.9)";
    c.lineWidth = 3;
    c.beginPath();
    c.arc(64, 64, 46, 0, Math.PI * 2);
    c.stroke();
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 12);
    g.addColorStop(0, "rgba(255,90,60,1)");
    g.addColorStop(0.45, "rgba(255,50,30,1)");
    g.addColorStop(1, "rgba(255,40,30,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(64, 64, 12, 0, Math.PI * 2);
    c.fill();
  });
  const m = mesh(new THREE.PlaneGeometry(size, size).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, color: new THREE.Color(2.2, 1.2, 1.1) }), x, y, 0);
  m.renderOrder = 10;
  m.name = "reticle";
  m.visible = false;
  return m;
}

// =====================================================================================
// FN MAG — 7.62 mm general-purpose machine gun (1,263 mm, 630 mm barrel, 11.8 kg)
// =====================================================================================

/**
 * The SAF's GPMG. A long, slab-sided steel receiver with rows of rivets, the feed cover on
 * top hinged at its front with the latch at the rear, the belt entering the feed tray from
 * the left out of a canvas belt bag hung on that side, the cocking handle on the right,
 * cases leaving through the bottom of the receiver. Forward of the receiver: the barrel
 * lock and the folding carrying handle, the gas cylinder under the barrel with the folded
 * bipod clipped to its front, the gas regulator, the tall front sight between its ears and
 * the slotted flash suppressor. A polymer butt with a hinged shoulder strap at the back.
 */
export function buildFNMAG(mats: GunMats): ViewWeapon {
  const root = new THREE.Group();
  const P = mats.polymer, S = mats.steel, K = mats.park, R = mats.rubber;
  const RT = 0.05; // receiver top
  // Receiver: tall steel box with a heavier rail along the top and stamped side panels.
  root.add(mesh(profile([[-0.33, -0.042], [0.17, -0.042], [0.17, RT], [-0.33, RT]], 0.058, 0.004), K));
  for (const s of [-1, 1]) {
    root.add(mesh(rbox(0.46, 0.008, 0.003, 0.001), S, -0.08, RT - 0.012, s * 0.03));
    root.add(mesh(rbox(0.46, 0.006, 0.003, 0.001), S, -0.08, -0.03, s * 0.03));
    for (let i = 0; i < 9; i++) for (const y of [RT - 0.012, -0.03]) root.add(mesh(new THREE.SphereGeometry(0.0028, 6, 4).scale(1, 1, 0.5), S, -0.3 + i * 0.055, y, s * 0.0318));
    // Lightening panel recessed between the rivet rows.
    root.add(mesh(rbox(0.3, 0.032, 0.002, 0.0006), mats.rubber, -0.12, 0.004, s * 0.0292));
  }
  // Feed tray mouth on the left, link chute on the right, bottom ejection port.
  root.add(mesh(rbox(0.07, 0.02, 0.012, 0.002), S, 0.02, RT - 0.018, -0.034));
  root.add(mesh(rbox(0.05, 0.014, 0.016, 0.002), S, 0.02, RT - 0.02, 0.036));
  root.add(mesh(rbox(0.07, 0.003, 0.03, 0.001), R, 0.0, -0.0435, 0));
  // Cocking handle, right side, forward, folded.
  const bolt = new THREE.Group();
  bolt.add(mesh(rbox(0.012, 0.014, 0.03, 0.003), S, 0.11, 0.0, 0.044));
  bolt.add(mesh(tube(0.009, 0.009, 0.016, 10).rotateZ(Math.PI / 2), P, 0.11, 0.0, 0.062));
  root.add(mesh(rbox(0.2, 0.006, 0.002, 0.0008), R, 0.05, 0.0, 0.0302)); // its slot
  root.add(bolt);

  // Feed cover: aluminium casting with a top rail, hinged at its front edge.
  const cover = new THREE.Group();
  cover.position.set(0.1, RT, 0);
  cover.add(mesh(profile([[-0.24, 0.0], [0.0, 0.0], [0.0, 0.016], [-0.035, 0.024], [-0.225, 0.024], [-0.24, 0.014]], 0.062, 0.004), K));
  cover.add(mesh(rbox(0.17, 0.006, 0.021, 0.001), S, -0.125, 0.027, 0));
  rail(cover, S, -0.2, -0.05, 0.028, 0, "y", 1);
  cover.add(mesh(rbox(0.02, 0.014, 0.05, 0.003), S, -0.232, 0.012, 0)); // rear latch
  cover.add(mesh(tube(0.006, 0.006, 0.07, 10).rotateY(Math.PI / 2), S, -0.002, 0.004, 0)); // hinge pin
  root.add(cover);

  // Fixed top plate of the receiver behind the cover, with the cover latch catch.
  root.add(mesh(rbox(0.19, 0.012, 0.056, 0.003), K, -0.235, RT + 0.006, 0));
  // Leaf rear sight with its protective ears, forward of the cover hinge.
  // Tall enough to see over the railed feed cover.
  for (const s of [-1, 1]) root.add(mesh(profile([[0.11, RT], [0.165, RT], [0.16, 0.118], [0.12, 0.118]], 0.003, 0.0008), S, 0, 0, s * 0.013));
  root.add(mesh(rbox(0.04, 0.006, 0.03, 0.001), S, 0.14, RT + 0.003, 0));
  root.add(mesh(profile([[0.13, RT + 0.006], [0.142, RT + 0.006], [0.142, 0.114], [0.13, 0.114]], 0.016, 0.001, [[[0.1335, 0.1035], [0.1385, 0.1035], [0.1385, 0.1105], [0.1335, 0.1105]]]), S));

  // Trigger housing, guard, trigger, cross-bolt safety, pistol grip.
  root.add(mesh(profile([[-0.06, -0.042], [0.06, -0.042], [0.05, -0.058], [-0.06, -0.058]], 0.03, 0.003), K));
  const bow = new THREE.CatmullRomCurve3([V(0.002, -0.058, 0), V(0.016, -0.088, 0), V(0.052, -0.092, 0), V(0.062, -0.058, 0)]);
  root.add(mesh(new THREE.TubeGeometry(bow, 16, 0.004, 6, false).scale(1, 1, 2.4), S));
  root.add(mesh(profile([[0.03, -0.058], [0.04, -0.058], [0.036, -0.078], [0.03, -0.084], [0.027, -0.08]], 0.007, 0.0015), S));
  root.add(mesh(tube(0.0055, 0.0055, 0.04, 8).rotateY(Math.PI / 2), S, -0.012, -0.05, 0));
  root.add(mesh(profile([[-0.044, -0.058], [0.0, -0.058], [-0.01, -0.1], [-0.018, -0.15], [-0.058, -0.146], [-0.052, -0.098]], 0.034, 0.008), P));
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) root.add(mesh(rbox(0.03, 0.0025, 0.002, 0.0006), P, -0.032 - i * 0.002, -0.076 - i * 0.01, s * 0.0175));

  // Butt: polymer, deep and straight, with the hinged shoulder strap folded down.
  root.add(mesh(profile([[-0.33, 0.046], [-0.6, 0.046], [-0.614, -0.12], [-0.52, -0.122], [-0.33, -0.042]], 0.042, 0.009, [[[-0.42, -0.02], [-0.5, -0.02], [-0.52, -0.09], [-0.47, -0.088]]]), P));
  root.add(mesh(profile([[-0.614, 0.048], [-0.628, 0.044], [-0.632, -0.122], [-0.614, -0.126]], 0.046, 0.004), R));
  root.add(mesh(rbox(0.008, 0.11, 0.044, 0.003), K, -0.636, -0.02, 0));
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) root.add(mesh(rbox(0.14, 0.003, 0.002, 0.0006), P, -0.43, 0.034 - i * 0.008, s * 0.0215));

  // Barrel, barrel lock, carrying handle folded to the left.
  root.add(mesh(tube(0.0145, 0.0135, 0.43, 16), S, 0.39, 0, 0));
  root.add(mesh(tube(0.021, 0.021, 0.04, 16), K, 0.19, 0, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    root.add(mesh(rbox(0.024, 0.004, 0.004, 0.001), S, 0.19, Math.sin(a) * 0.021, Math.cos(a) * 0.021));
  }
  root.add(mesh(rbox(0.03, 0.024, 0.03, 0.004), K, 0.25, 0.006, 0));
  const ch = new THREE.CatmullRomCurve3([V(0.24, 0.014, -0.014), V(0.245, 0.03, -0.07), V(0.29, 0.034, -0.088), V(0.335, 0.028, -0.072), V(0.34, 0.012, -0.02)]);
  root.add(mesh(new THREE.TubeGeometry(ch, 18, 0.0045, 6, false), S));
  root.add(mesh(tube(0.011, 0.011, 0.08, 12), P, 0.29, 0.033, -0.088));

  // Gas cylinder under the barrel, gas block and regulator, bipod folded back.
  root.add(mesh(tube(0.011, 0.011, 0.27, 12), K, 0.3, -0.032, 0));
  root.add(mesh(rbox(0.044, 0.064, 0.034, 0.005), K, 0.455, -0.012, 0));
  root.add(mesh(tube(0.013, 0.013, 0.02, 12).rotateY(Math.PI / 2), S, 0.465, -0.032, 0.022));
  for (let i = 0; i < 3; i++) root.add(mesh(rbox(0.004, 0.006, 0.004, 0.001), S, 0.465 + (i - 1) * 0.007, -0.022, 0.034));
  root.add(mesh(rbox(0.03, 0.022, 0.05, 0.004), S, 0.44, -0.048, 0));
  // Legs fold back under the receiver and swing forward and down to deploy.
  const bipod = ([-1, 1] as const).map((sd) => bipodLeg(mats, 0.44, -0.052, sd * 0.02, 0.3, 0.0055, -1, sd));
  root.add(...bipod);
  // Front sight: tall base with protective ears and the blade, then the slotted suppressor.
  root.add(mesh(profile([[0.57, 0.0], [0.6, 0.0], [0.597, 0.03], [0.575, 0.03]], 0.024, 0.003), K));
  for (const s of [-1, 1]) root.add(mesh(profile([[0.574, 0.026], [0.598, 0.026], [0.594, 0.116], [0.586, 0.12], [0.578, 0.114]], 0.0028, 0.0006), S, 0, 0, s * 0.011));
  root.add(mesh(rbox(0.004, 0.08, 0.003, 0.0006), S, 0.586, 0.067, 0));
  root.add(mesh(tube(0.017, 0.0175, 0.065, 16), S, 0.635, 0, 0));
  slots(root, R, 0.637, 0.0165, 0.046, 8);

  // Belt: a curve of linked rounds from the feed tray down into the belt bag on the left.
  const belt = new THREE.Group();
  const path = new THREE.CatmullRomCurve3([V(0.02, RT - 0.012, -0.036), V(0.02, RT - 0.01, -0.07), V(0.022, 0.0, -0.11), V(0.02, -0.06, -0.122)]);
  const round = new THREE.CylinderGeometry(0.0059, 0.0059, 0.051, 8).rotateZ(-Math.PI / 2);
  const tip = new THREE.ConeGeometry(0.0055, 0.022, 8).rotateZ(-Math.PI / 2);
  for (let i = 0; i <= 12; i++) {
    const p = path.getPointAt(i / 12);
    belt.add(mesh(round, mats.brass, p.x - 0.008, p.y, p.z));
    belt.add(mesh(tip, mats.brass, p.x + 0.028, p.y, p.z));
    belt.add(mesh(rbox(0.04, 0.012, 0.004, 0.001), S, p.x - 0.006, p.y, p.z + 0.002));
  }
  root.add(belt);
  // Belt bag, hooked to the left of the receiver: 100 rounds in canvas.
  const magazine = new THREE.Group();
  magazine.add(mesh(rbox(0.14, 0.11, 0.07, 0.016), mats.sleeve, 0.02, -0.11, -0.112));
  magazine.add(mesh(rbox(0.144, 0.022, 0.074, 0.008), mats.sleeve, 0.02, -0.048, -0.112));
  magazine.add(mesh(rbox(0.06, 0.02, 0.004, 0.002), R, 0.02, -0.11, -0.149));
  magazine.add(mesh(rbox(0.02, 0.05, 0.02, 0.004), S, -0.04, -0.03, -0.075));
  root.add(magazine);

  const rightArm = arm(mats, 1.0, -1, V(-0.034, -0.11, 0.032), V(0.94, 0.26, -0.1), V(0.1, 0, 1), V(-0.38, -0.26, 0.17));
  const leftArm = arm(mats, 0.9, 1, V(0.13, -0.066, -0.01), V(0.15, 0.1, 1), V(0, -1, 0.15), V(-0.22, -0.34, -0.3));
  root.add(rightArm, leftArm);
  return { root, muzzle: V(0.67, 0, 0), sight: V(-0.32, 0.107, 0), eject: V(0.0, -0.05, 0.0), magazine, leftArm, rightArm, bolt, cover, belt, bipod };
}

// =====================================================================================
// Sako TRG-22 — 7.62 mm bolt-action sniper rifle (1,150 mm, 660 mm barrel)
// =====================================================================================

/**
 * Green polyurethane stock over an aluminium skeleton: the adjustable cheek piece on its two
 * posts, spacer plates and an adjustable butt plate at the back, a near-vertical grip. The
 * round receiver carries a 3–12× scope in two rings; the three-lug bolt has a 60° throw and
 * a big synthetic knob on the right. A ten-round magazine, a flat fore-stock ending in the
 * bipod lock, a long heavy barrel and a side-venting muzzle brake.
 */
export function buildTRG22(mats: GunMats): ViewWeapon {
  const root = new THREE.Group();
  const G = mats.olive, S = mats.steel, R = mats.rubber;
  // Stock: one shell from butt to grip, the fore-stock under the barrel.
  root.add(mesh(profile([[-0.15, 0.012], [-0.4, 0.012], [-0.41, -0.11], [-0.33, -0.118], [-0.13, -0.05], [-0.07, -0.05], [-0.06, -0.022], [-0.15, -0.012]], 0.044, 0.01, [[[-0.27, -0.03], [-0.36, -0.03], [-0.37, -0.09], [-0.31, -0.088]]]), G));
  root.add(mesh(profile([[-0.07, -0.05], [-0.03, -0.05], [-0.034, -0.094], [-0.042, -0.14], [-0.078, -0.136], [-0.074, -0.09]], 0.034, 0.008), G));
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) root.add(mesh(rbox(0.028, 0.0025, 0.002, 0.0006), G, -0.058 + i * 0.0006, -0.068 - i * 0.011, s * 0.0175));
  root.add(mesh(profile([[0.07, -0.014], [0.39, -0.014], [0.4, -0.03], [0.39, -0.05], [0.12, -0.052], [0.07, -0.04]], 0.046, 0.008), G));
  // Adjustable cheek piece on posts, spacer plates and butt plate.
  root.add(mesh(profile([[-0.36, 0.044], [-0.17, 0.044], [-0.16, 0.03], [-0.36, 0.03]], 0.04, 0.008), G));
  for (const x of [-0.31, -0.22]) root.add(mesh(tube(0.004, 0.004, 0.022, 8).rotateZ(Math.PI / 2), S, x, 0.02, 0));
  root.add(mesh(rbox(0.012, 0.012, 0.04, 0.002), S, -0.26, 0.021, 0.024));
  for (let i = 0; i < 3; i++) root.add(mesh(rbox(0.006, 0.124, 0.044, 0.001), i % 2 ? R : S, -0.412 - i * 0.006, -0.049, 0));
  root.add(mesh(profile([[-0.43, 0.014], [-0.444, 0.01], [-0.444, -0.112], [-0.43, -0.118]], 0.046, 0.004), R));
  // Receiver, bolt shroud, magazine, trigger guard and trigger.
  root.add(mesh(tube(0.019, 0.019, 0.24, 18), S, -0.01, 0.006, 0));
  root.add(mesh(tube(0.0165, 0.012, 0.03, 16), S, -0.145, 0.006, 0));
  root.add(mesh(rbox(0.07, 0.008, 0.008, 0.002), S, 0.02, 0.022, 0)); // 17 mm dovetail
  root.add(mesh(rbox(0.06, 0.016, 0.003, 0.001), R, 0.03, 0.01, 0.0188)); // ejection port
  const magazine = new THREE.Group();
  magazine.add(mesh(profile([[0.002, -0.04], [0.082, -0.04], [0.082, -0.082], [0.002, -0.082]], 0.028, 0.002), S));
  magazine.add(mesh(rbox(0.084, 0.008, 0.03, 0.002), G, 0.042, -0.085, 0));
  root.add(magazine);
  root.add(mesh(profile([[-0.03, -0.05], [0.0, -0.05], [0.0, -0.054], [-0.006, -0.078], [-0.04, -0.08], [-0.046, -0.074], [-0.042, -0.074], [-0.012, -0.075], [-0.004, -0.054]], 0.012, 0.0015), S));
  root.add(mesh(profile([[-0.022, -0.05], [-0.014, -0.05], [-0.017, -0.066], [-0.022, -0.072], [-0.025, -0.068]], 0.007, 0.0015), S));
  // Bolt: body in the receiver, handle on the right with the synthetic knob.
  const bolt = new THREE.Group();
  bolt.add(mesh(tube(0.009, 0.009, 0.05, 10), mats.park, -0.1, 0.006, 0));
  const handle = mesh(tube(0.0045, 0.0045, 0.05, 8).rotateX(Math.PI / 2), S, -0.075, 0.0, 0.035);
  handle.rotation.z = 0.25;
  bolt.add(handle);
  bolt.add(mesh(new THREE.SphereGeometry(0.0125, 12, 10).scale(1, 1.15, 1), mats.polymer, -0.082, -0.01, 0.062));
  root.add(bolt);
  // Barrel and side-venting brake.
  root.add(mesh(tube(0.0135, 0.0105, 0.55, 16), S, 0.385, 0.006, 0));
  root.add(mesh(rbox(0.05, 0.026, 0.026, 0.005), S, 0.685, 0.006, 0));
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) root.add(mesh(rbox(0.008, 0.016, 0.004, 0.001), R, 0.672 + i * 0.012, 0.006, s * 0.0132));
  // Scope: 3–12×, 50 mm objective, in two rings on the dovetail.
  const SY = 0.068;
  for (const x of [-0.06, 0.08]) {
    root.add(mesh(rbox(0.02, 0.034, 0.03, 0.004), S, x, 0.04, 0));
    root.add(mesh(tube(0.0185, 0.0185, 0.018, 18), S, x, SY, 0));
  }
  root.add(mesh(tube(0.015, 0.015, 0.2, 20), S, 0.01, SY, 0));
  root.add(mesh(tube(0.015, 0.027, 0.05, 22), S, 0.135, SY, 0));
  root.add(mesh(tube(0.027, 0.027, 0.08, 22, true), S, 0.2, SY, 0));
  root.add(mesh(tube(0.021, 0.015, 0.03, 22), S, -0.105, SY, 0));
  root.add(mesh(tube(0.021, 0.021, 0.06, 22, true), S, -0.15, SY, 0));
  root.add(mesh(new THREE.RingGeometry(0.016, 0.0215, 22).rotateY(-Math.PI / 2), R, -0.18, SY, 0));
  root.add(mesh(tube(0.022, 0.022, 0.018, 22), mats.polymer, -0.12, SY, 0));
  root.add(mesh(rbox(0.036, 0.036, 0.036, 0.006), S, 0.0, SY, 0));
  root.add(mesh(tube(0.012, 0.012, 0.022, 16).rotateZ(Math.PI / 2), S, 0.0, SY + 0.028, 0));
  root.add(mesh(tube(0.012, 0.012, 0.02, 16).rotateY(Math.PI / 2), S, 0.0, SY, 0.028));
  root.add(mesh(new THREE.CircleGeometry(0.026, 22).rotateY(Math.PI / 2), mats.lens, 0.241, SY, 0));
  // Bipod in the fore-stock lock, legs folded forward.
  root.add(mesh(rbox(0.03, 0.016, 0.05, 0.003), S, 0.375, -0.054, 0));
  const bipod = ([-1, 1] as const).map((sd) => bipodLeg(mats, 0.38, -0.058, sd * 0.022, 0.24, 0.0055, 1, sd));
  root.add(...bipod);
  root.add(
    reticleMesh((c) => {
      c.strokeStyle = "#000";
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(64, 0);
      c.lineTo(64, 128);
      c.moveTo(0, 64);
      c.lineTo(128, 64);
      c.stroke();
    }, 0.03, 0.03, SY)
  );
  const rightArm = arm(mats, 1.0, -1, V(-0.056, -0.09, 0.03), V(0.94, 0.3, -0.1), V(0.1, 0, 1), V(-0.38, -0.26, 0.17));
  const leftArm = arm(mats, 0.8, 1, V(0.24, -0.06, -0.004), V(0.12, 0.05, 1), V(0, -1, 0.1), V(-0.1, -0.3, -0.27));
  root.add(rightArm, leftArm);
  return { root, muzzle: V(0.712, 0.006, 0), sight: V(-0.25, SY, 0), eject: V(0.03, 0.012, 0.03), magazine, leftArm, rightArm, bolt, bipod };
}

// =====================================================================================
// Heckler & Koch MP5K — 9 mm machine pistol (325 mm, 115 mm barrel)
// =====================================================================================

/**
 * The short MP5: stamped receiver with its ribs, the cocking tube along the top with the
 * handle at its front left, a rotary-drum rear sight and hooded front post, a vertical
 * foregrip with a hand stop, the polymer trigger group, a curved thirty-round magazine and
 * an end cap with a sling loop where a stock would be.
 */
export function buildMP5K(mats: GunMats): ViewWeapon {
  const root = new THREE.Group();
  const S = mats.steel, K = mats.park, P = mats.polymer, R = mats.rubber;
  root.add(mesh(profile([[-0.13, -0.03], [0.14, -0.03], [0.15, -0.018], [0.15, 0.022], [0.13, 0.034], [-0.12, 0.034], [-0.13, 0.024]], 0.046, 0.005), K));
  for (const s of [-1, 1]) {
    root.add(mesh(rbox(0.24, 0.005, 0.002, 0.0008), S, 0.005, 0.014, s * 0.0235));
    root.add(mesh(rbox(0.24, 0.005, 0.002, 0.0008), S, 0.005, -0.012, s * 0.0235));
  }
  root.add(mesh(tube(0.012, 0.012, 0.22, 14), K, 0.03, 0.036, 0)); // cocking tube
  root.add(mesh(rbox(0.11, 0.004, 0.002, 0.0008), R, 0.07, 0.036, -0.0122)); // handle slot
  const bolt = new THREE.Group();
  bolt.add(mesh(rbox(0.012, 0.01, 0.016, 0.002), S, 0.12, 0.036, -0.018));
  bolt.add(mesh(rbox(0.016, 0.014, 0.012, 0.003), P, 0.126, 0.036, -0.03));
  root.add(bolt);
  root.add(mesh(rbox(0.05, 0.02, 0.003, 0.001), R, -0.01, 0.006, 0.0232)); // ejection port
  // Rear drum sight and hooded front sight.
  root.add(mesh(tube(0.011, 0.011, 0.03, 12).rotateY(Math.PI / 2), S, -0.105, 0.058, 0));
  root.add(mesh(new THREE.RingGeometry(0.0018, 0.004, 12).rotateY(-Math.PI / 2), R, -0.121, 0.064, 0));
  root.add(mesh(rbox(0.016, 0.022, 0.024, 0.003), S, 0.148, 0.054, 0));
  root.add(mesh(rbox(0.004, 0.012, 0.0025, 0.0006), S, 0.148, 0.064, 0));
  root.add(mesh(new THREE.TorusGeometry(0.011, 0.002, 6, 14, Math.PI).rotateY(Math.PI / 2), S, 0.148, 0.066, 0));
  // Barrel stub and muzzle.
  root.add(mesh(tube(0.009, 0.009, 0.05, 12), S, 0.17, 0.0, 0));
  root.add(mesh(tube(0.0105, 0.0105, 0.012, 12), S, 0.19, 0.0, 0));
  // Trigger group: guard, trigger, selector, pistol grip.
  root.add(mesh(profile([[-0.06, -0.03], [0.06, -0.03], [0.05, -0.048], [-0.054, -0.048]], 0.034, 0.004), P));
  root.add(mesh(profile([[0.0, -0.048], [0.05, -0.048], [0.046, -0.07], [0.0, -0.072], [-0.004, -0.066], [0.04, -0.066], [0.042, -0.052], [0.0, -0.052]], 0.012, 0.002), P));
  root.add(mesh(profile([[0.022, -0.048], [0.03, -0.048], [0.027, -0.062], [0.022, -0.068], [0.019, -0.064]], 0.006, 0.0015), S));
  root.add(mesh(rbox(0.012, 0.006, 0.004, 0.001), S, -0.03, -0.038, -0.019));
  root.add(mesh(profile([[-0.04, -0.048], [-0.002, -0.048], [-0.01, -0.09], [-0.016, -0.124], [-0.05, -0.12], [-0.046, -0.09]], 0.032, 0.008), P));
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) root.add(mesh(rbox(0.026, 0.0025, 0.002, 0.0006), P, -0.028 - i * 0.001, -0.062 - i * 0.009, s * 0.0165));
  // Vertical foregrip with hand stop.
  root.add(mesh(profile([[0.098, -0.03], [0.128, -0.03], [0.124, -0.11], [0.132, -0.116], [0.1, -0.12], [0.1, -0.11]], 0.03, 0.008), P));
  // End cap and sling loop.
  root.add(mesh(rbox(0.012, 0.05, 0.04, 0.004), S, -0.136, 0.0, 0));
  const loop = mesh(new THREE.TorusGeometry(0.012, 0.0025, 6, 12), S, -0.148, 0.0, 0);
  root.add(loop);
  // Curved magazine.
  const magazine = new THREE.Group();
  magazine.add(mesh(profile([[0.034, -0.03], [0.07, -0.03], [0.08, -0.08], [0.1, -0.15], [0.07, -0.158], [0.054, -0.09], [0.04, -0.06]], 0.022, 0.002), S));
  for (const s of [-1, 1]) magazine.add(mesh(rbox(0.004, 0.08, 0.0015, 0.0005), S, 0.064, -0.09, s * 0.0115));
  root.add(magazine);
  const rightArm = arm(mats, 1.0, -1, V(-0.032, -0.085, 0.029), V(0.94, 0.3, -0.1), V(0.1, 0, 1), V(-0.38, -0.24, 0.17));
  const leftArm = arm(mats, 1.0, 1, V(0.114, -0.085, -0.028), V(0.94, 0.3, 0.1), V(0.1, 0, -1), V(-0.12, -0.33, -0.28));
  root.add(rightArm, leftArm);
  return { root, muzzle: V(0.196, 0, 0), sight: V(-0.36, 0.064, 0), eject: V(-0.01, 0.008, 0.028), magazine, leftArm, rightArm, bolt };
}

// =====================================================================================
// FN P90 — 5.7 mm personal defence weapon (505 mm, 263 mm barrel)
// =====================================================================================

/**
 * Smooth bullpup polymer with no edges to snag: a thumbhole for the firing hand, the big
 * trigger guard that is also the foregrip with a hand stop at its front, the translucent
 * fifty-round magazine lying along the top with its rounds crosswise, the ring sight on its
 * housing at the front of the top, iron sights either side, a diagonal flash hider.
 */
export function buildP90(mats: GunMats): ViewWeapon {
  const root = new THREE.Group();
  const P = mats.polymer, S = mats.steel, R = mats.rubber;
  const TOP = 0.034;
  // Body with the thumbhole cut through it.
  root.add(mesh(profile([[-0.31, -0.07], [-0.31, 0.01], [-0.29, TOP], [0.12, TOP], [0.165, 0.016], [0.17, -0.02], [0.15, -0.035], [0.06, -0.035], [0.05, -0.05], [-0.06, -0.05], [-0.08, -0.12], [-0.2, -0.12], [-0.29, -0.095]], 0.055, 0.012, [[[-0.04, -0.02], [0.03, -0.02], [0.02, -0.05], [-0.05, -0.05]]]), P));
  // The guard / foregrip loop and the hand stop.
  const guard = new THREE.CatmullRomCurve3([V(-0.045, -0.05, 0), V(-0.05, -0.1, 0), V(0.02, -0.122, 0), V(0.11, -0.11, 0), V(0.13, -0.06, 0), V(0.12, -0.035, 0)]);
  root.add(mesh(new THREE.TubeGeometry(guard, 24, 0.012, 8, false).scale(1, 1, 1.6), P));
  root.add(mesh(rbox(0.012, 0.03, 0.05, 0.005), P, 0.13, -0.072, 0));
  root.add(mesh(profile([[0.0, -0.035], [0.008, -0.035], [0.006, -0.056], [0.0, -0.062], [-0.003, -0.058]], 0.007, 0.0015), S));
  root.add(mesh(tube(0.012, 0.012, 0.006, 14).rotateZ(Math.PI / 2), R, 0.0, -0.068, 0)); // selector dial
  // Charging handles both sides, ejection chute underneath behind the grip.
  const bolt = new THREE.Group();
  for (const s of [-1, 1]) bolt.add(mesh(rbox(0.016, 0.01, 0.01, 0.003), P, 0.13, -0.008, s * 0.032));
  root.add(bolt);
  root.add(mesh(rbox(0.04, 0.004, 0.024, 0.001), R, -0.13, -0.121, 0));
  // Barrel and the diagonally cut flash hider.
  root.add(mesh(tube(0.0082, 0.0082, 0.06, 12), S, 0.19, 0.0, 0));
  const fh = new THREE.CylinderGeometry(0.011, 0.011, 0.034, 12).rotateZ(-Math.PI / 2);
  root.add(mesh(fh, S, 0.235, 0.0, 0));
  root.add(mesh(rbox(0.012, 0.028, 0.024, 0.002).rotateZ(0.5), R, 0.254, 0.004, 0));
  // Magazine: translucent body on top, rounds across the bore inside it, the feed end at the back.
  const magazine = new THREE.Group();
  magazine.add(mesh(profile([[-0.27, TOP - 0.004], [0.075, TOP - 0.004], [0.08, TOP + 0.012], [0.07, TOP + 0.03], [-0.26, TOP + 0.03], [-0.275, TOP + 0.016]], 0.052, 0.006), mats.mag));
  const rd = new THREE.CylinderGeometry(0.0039, 0.0039, 0.04, 6).rotateX(Math.PI / 2);
  for (let i = 0; i < 25; i++) for (const row of [0, 1]) magazine.add(mesh(rd, mats.brass, -0.24 + i * 0.0125 + row * 0.006, TOP + 0.008 + row * 0.009, 0));
  magazine.add(mesh(rbox(0.024, 0.012, 0.03, 0.003), P, -0.268, TOP + 0.012, 0)); // release catch
  root.add(magazine);
  // Ring sight housing at the front of the top, with the fixed irons either side.
  root.add(mesh(rbox(0.06, 0.04, 0.05, 0.008), P, 0.098, TOP + 0.032, 0));
  for (const s of [-1, 1]) root.add(mesh(profile([[0.07, TOP + 0.03], [0.128, TOP + 0.03], [0.124, TOP + 0.068], [0.074, TOP + 0.068]], 0.006, 0.002), P, 0, 0, s * 0.024));
  const win = mesh(new THREE.PlaneGeometry(0.036, 0.026).rotateY(-Math.PI / 2), mats.lens, 0.07, TOP + 0.052, 0);
  win.name = "lens";
  root.add(win);
  root.add(
    reticleMesh((c) => {
      c.strokeStyle = "#111";
      c.lineWidth = 3;
      c.beginPath();
      c.arc(64, 64, 50, 0, Math.PI * 2);
      c.stroke();
      c.lineWidth = 2;
      c.beginPath();
      c.arc(64, 64, 9, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = "#111";
      c.beginPath();
      c.arc(64, 64, 2.2, 0, Math.PI * 2);
      c.fill();
    }, 0.03, 0.09, TOP + 0.052)
  );
  const rightArm = arm(mats, 1.0, -1, V(-0.012, -0.072, 0.03), V(0.94, 0.26, -0.1), V(0.1, 0, 1), V(-0.37, -0.25, 0.17));
  const leftArm = arm(mats, 0.9, 1, V(0.08, -0.13, -0.006), V(0.4, 0.1, 1), V(0, -1, 0.15), V(-0.15, -0.34, -0.27));
  root.add(rightArm, leftArm);
  return { root, muzzle: V(0.262, 0, 0), sight: V(-0.24, TOP + 0.052, 0), eject: V(-0.13, -0.12, 0), magazine, leftArm, rightArm, bolt };
}

// =====================================================================================
// Colt IAR — 5.56 mm infantry automatic rifle (AR pattern, heavy barrel, bipod, 4× prism sight)
// =====================================================================================

/**
 * Colt's automatic rifle on the AR pattern: flat-top upper with forward assist and brass
 * deflector, a monolithic rail upper running out over a heavy barrel, an A2-style flash
 * hider, a six-position stock on the buffer tube, a STANAG magazine, a Harris bipod on the
 * bottom rail and a fixed 4× prism sight with a chevron reticle.
 */
export function buildColtIAR(mats: GunMats): ViewWeapon {
  const root = new THREE.Group();
  const P = mats.polymer, S = mats.steel, K = mats.park, R = mats.rubber;
  const TOP = 0.032;
  // Upper and lower receivers.
  root.add(mesh(profile([[-0.11, -0.016], [0.11, -0.016], [0.11, 0.024], [0.095, TOP], [-0.105, TOP], [-0.11, 0.02]], 0.04, 0.005), K));
  root.add(mesh(profile([[-0.11, -0.016], [0.1, -0.016], [0.1, -0.07], [0.03, -0.07], [0.022, -0.046], [-0.04, -0.044], [-0.11, -0.036]], 0.036, 0.005), K));
  rail(root, S, -0.1, 0.11, TOP, 0, "y", 1);
  root.add(mesh(rbox(0.056, 0.018, 0.003, 0.001), R, 0.028, 0.004, 0.0205));
  root.add(mesh(profile([[-0.028, -0.008], [-0.006, -0.008], [-0.006, 0.012], [-0.02, 0.012]], 0.01, 0.003), K, 0, 0, 0.024));
  root.add(mesh(tube(0.006, 0.006, 0.026, 10).rotateY(-0.5), K, -0.058, 0.008, 0.024));
  const bolt = new THREE.Group();
  bolt.add(mesh(rbox(0.02, 0.008, 0.044, 0.002), S, -0.116, 0.022, 0)); // charging handle
  bolt.add(mesh(rbox(0.054, 0.014, 0.004, 0.001), mats.park, 0.028, 0.004, 0.0186)); // carrier in the port
  root.add(bolt);
  for (const s of [-1, 1]) {
    root.add(mesh(rbox(0.016, 0.004, 0.004, 0.001), S, -0.012, -0.026, s * 0.0195));
    root.add(mesh(rbox(0.01, 0.012, 0.004, 0.001), S, 0.045, -0.03, s * 0.0195));
  }
  root.add(mesh(profile([[-0.036, -0.046], [0.024, -0.046], [0.024, -0.05], [0.016, -0.076], [-0.03, -0.078], [-0.036, -0.074], [-0.03, -0.074], [0.012, -0.072], [0.019, -0.05], [-0.036, -0.05]], 0.011, 0.0015), K));
  root.add(mesh(profile([[-0.004, -0.046], [0.005, -0.046], [0.002, -0.062], [-0.004, -0.068], [-0.007, -0.064]], 0.006, 0.0015), S));
  root.add(mesh(profile([[-0.068, -0.04], [-0.034, -0.044], [-0.04, -0.068], [-0.05, -0.076], [-0.056, -0.13], [-0.09, -0.128], [-0.08, -0.086]], 0.03, 0.006), P));
  // Buffer tube and the six-position stock.
  root.add(mesh(tube(0.0145, 0.0145, 0.2, 14), K, -0.21, 0.004, 0));
  root.add(mesh(profile([[-0.24, 0.026], [-0.36, 0.026], [-0.37, -0.08], [-0.34, -0.084], [-0.26, -0.02], [-0.24, -0.016]], 0.038, 0.008), P));
  root.add(mesh(profile([[-0.37, 0.026], [-0.382, 0.024], [-0.384, -0.082], [-0.37, -0.084]], 0.04, 0.003), R));
  // STANAG magazine.
  const magazine = new THREE.Group();
  magazine.add(mesh(profile([[0.032, -0.07], [0.098, -0.07], [0.106, -0.12], [0.12, -0.17], [0.06, -0.182], [0.046, -0.12]], 0.024, 0.002), S));
  for (const s of [-1, 1]) magazine.add(mesh(rbox(0.05, 0.004, 0.0015, 0.0005), S, 0.075, -0.11, s * 0.0125));
  root.add(magazine);
  // Monolithic rail over a heavy barrel, A2 flash hider.
  const H0 = 0.11, H1 = 0.4;
  root.add(mesh(profile([[H0, -0.024], [H1, -0.024], [H1, 0.024], [H1 - 0.01, TOP], [H0, TOP]], 0.05, 0.005), K));
  rail(root, S, H0, H1, TOP, 0, "y", 1);
  rail(root, S, H0 + 0.06, H1, -0.024, 0, "y", -1);
  for (const s of [-1, 1] as const) rail(root, S, H0 + 0.12, H1, 0.004, s * 0.025, "z", s);
  root.add(mesh(tube(0.0125, 0.0115, 0.12, 14), S, 0.46, 0.0, 0));
  root.add(mesh(tube(0.011, 0.011, 0.045, 12), S, 0.54, 0.0, 0));
  slots(root, R, 0.545, 0.0105, 0.025, 5);
  // Folding back-up irons.
  root.add(mesh(rbox(0.022, 0.009, 0.018, 0.002), S, H1 - 0.02, TOP + 0.008, 0));
  root.add(mesh(rbox(0.022, 0.009, 0.018, 0.002), S, -0.09, TOP + 0.008, 0));
  // Fixed 4× prism sight.
  const SY = TOP + 0.04;
  root.add(mesh(rbox(0.07, 0.014, 0.03, 0.002), S, 0.0, TOP + 0.01, 0));
  root.add(mesh(profile([[-0.05, TOP + 0.016], [0.05, TOP + 0.016], [0.06, SY + 0.016], [0.04, SY + 0.03], [-0.04, SY + 0.03], [-0.05, SY + 0.012]], 0.034, 0.006), P));
  root.add(mesh(tube(0.019, 0.019, 0.04, 18), P, 0.07, SY, 0));
  root.add(mesh(tube(0.017, 0.017, 0.024, 18), P, -0.062, SY, 0));
  root.add(mesh(tube(0.019, 0.019, 0.012, 18), R, -0.078, SY, 0));
  root.add(mesh(rbox(0.016, 0.012, 0.016, 0.003), S, 0.0, SY + 0.034, 0));
  root.add(mesh(new THREE.CircleGeometry(0.017, 18).rotateY(Math.PI / 2), mats.lens, 0.0905, SY, 0));
  // Harris bipod on the bottom rail.
  root.add(mesh(rbox(0.036, 0.016, 0.046, 0.003), S, H1 - 0.03, -0.034, 0));
  const bipod = ([-1, 1] as const).map((sd) => bipodLeg(mats, H1 - 0.02, -0.04, sd * 0.022, 0.2, 0.0052, 1, sd));
  root.add(...bipod);
  const rightArm = arm(mats, 1.0, -1, V(-0.064, -0.096, 0.03), V(0.94, 0.26, -0.1), V(0.1, 0, 1), V(-0.38, -0.25, 0.17));
  const leftArm = arm(mats, 0.8, 1, V(0.22, -0.046, -0.004), V(0.12, 0.05, 1), V(0, -1, 0.1), V(-0.12, -0.3, -0.27));
  root.add(rightArm, leftArm);
  return { root, muzzle: V(0.565, 0, 0), sight: V(-0.2, SY, 0), eject: V(0.028, 0.006, 0.026), magazine, leftArm, rightArm, bolt, bipod };
}
