import * as THREE from "three";
import { Surf, type Builder } from "~/gfx/builder";
import { canvasTex } from "~/gfx/textures";
import { rng, type Rand } from "~/gfx/noise";
import type { WorldCtx } from "../ctx";

/**
 * Tropical planting. Trunks and limbs are real geometry in the world builder;
 * every leaf mass is a set of alpha-tested cards collected into one mesh that
 * sways in the wind and casts dappled shadows.
 */

function leafAtlas(): THREE.CanvasTexture {
  return canvasTex(1024, 512, (c) => {
    const r = rng(77);
    // Left half: a broad-leaf clump (rain tree / shrub). Small paired leaflets along twigs.
    const greens = ["#2f4a1c", "#3a5a22", "#476a28", "#557a30", "#28401a", "#63883a"];
    for (let t = 0; t < 46; t++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 190;
      let x = 256 + Math.cos(a) * d;
      let y = 256 + Math.sin(a) * d;
      const dir = a + (r() - 0.5) * 1.6;
      const len = 60 + r() * 70;
      c.strokeStyle = "#3a3222";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(dir) * len, y + Math.sin(dir) * len);
      c.stroke();
      for (let k = 0; k < 9; k++) {
        x += (Math.cos(dir) * len) / 9;
        y += (Math.sin(dir) * len) / 9;
        for (const s of [-1, 1]) {
          c.fillStyle = greens[Math.floor(r() * greens.length)];
          c.save();
          c.translate(x, y);
          c.rotate(dir + s * (1.1 + r() * 0.3));
          c.beginPath();
          c.ellipse(11, 0, 12 + r() * 4, 5 + r() * 2, 0, 0, Math.PI * 2);
          c.fill();
          c.restore();
        }
      }
    }
    // Right half: one palm frond, stem along +X from the left edge.
    c.save();
    c.translate(512, 256);
    c.strokeStyle = "#5a6a2c";
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(500, 0);
    c.stroke();
    for (let i = 0; i < 60; i++) {
      const x = 12 + i * 8;
      const l = Math.sin((i / 60) * Math.PI) ** 0.6 * 215 + 20;
      for (const s of [-1, 1]) {
        c.strokeStyle = greens[Math.floor(r() * 4)];
        c.lineWidth = 6.5;
        c.beginPath();
        c.moveTo(x, 0);
        c.quadraticCurveTo(x + l * 0.3, s * l * 0.6, x + l * 0.42 + r() * 10, s * (l + r() * 12));
        c.stroke();
      }
    }
    c.restore();
  });
}

function hedgeTex(): THREE.CanvasTexture {
  return canvasTex(
    256,
    256,
    (c) => {
      const r = rng(5);
      c.fillStyle = "#1c2a12";
      c.fillRect(0, 0, 256, 256);
      const greens = ["#2f4a1c", "#3a5a22", "#476a28", "#557a30", "#28401a", "#6a8c3c"];
      for (let i = 0; i < 1500; i++) {
        c.fillStyle = greens[Math.floor(r() * greens.length)];
        const x = r() * 256, y = r() * 256, a = r() * 6.3;
        for (const [ox, oy] of [[0, 0], [256, 0], [0, 256], [-256, 0], [0, -256]]) {
          c.beginPath();
          c.ellipse(x + ox, y + oy, 7 + r() * 3, 3.2, a, 0, 6.3);
          c.fill();
        }
      }
    },
    { repeat: true }
  );
}

export class Vegetation {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly wind: number[] = [];
  private readonly idx: number[] = [];
  private readonly r: Rand = rng(9041);

  constructor(private readonly ctx: WorldCtx) {
    ctx.lib.add("hedge", new THREE.MeshStandardMaterial({ map: hedgeTex(), vertexColors: true, roughness: 0.9 }), 0.9, Surf.Foliage, "soft", { macro: 0.7 });
    ctx.lib.add("bark", new THREE.MeshStandardMaterial({ map: ctx.lib.tex.wood.map, normalMap: ctx.lib.tex.wood.normalMap, vertexColors: true, roughness: 0.95 }), 1.1, Surf.Wood, "solid", { macro: 0.6 });
  }

  /** One card: a quad centred at p spanning vectors u and v, shading normal n. */
  private card(p: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, n: THREE.Vector3, uv0: number, uv1: number, tint: THREE.Color, w0: number, w1: number, stemmed = false): void {
    const base = this.pos.length / 3;
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [a, b] = c[i];
      // Stemmed cards (fronds) grow from p along +u; others are centred on p.
      const au = stemmed ? (a + 1) / 2 : a * 0.5;
      this.pos.push(p.x + u.x * au + v.x * b * 0.5, p.y + u.y * au + v.y * b * 0.5, p.z + u.z * au + v.z * b * 0.5);
      this.nrm.push(n.x, n.y, n.z);
      this.uv.push(uv0 + (uv1 - uv0) * ((a + 1) / 2), (b + 1) / 2);
      this.col.push(tint.r, tint.g, tint.b);
      this.wind.push(stemmed ? (a > 0 ? w1 : w0) : w1);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  private clump(c: THREE.Vector3, size: number, n: THREE.Vector3, tint: THREE.Color, wind: number): void {
    const r = this.r;
    const u = new THREE.Vector3(), v = new THREE.Vector3();
    for (let k = 0; k < 2; k++) {
      u.set(r() - 0.5, (r() - 0.5) * 0.7, r() - 0.5).normalize();
      v.set(r() - 0.5, r() - 0.5, r() - 0.5).cross(u).normalize();
      this.card(c, u.multiplyScalar(size), v.multiplyScalar(size), n, 0, 0.5, tint, wind, wind);
    }
  }

  /** Rain tree: short thick trunk, heavy spreading limbs, a broad umbrella crown. */
  rainTree(b: Builder, x: number, z: number, scale = 1, y = 0.1): void {
    const r = this.r;
    const H = (5.2 + r() * 1.4) * scale;
    const R = (7.5 + r() * 2.5) * scale;
    const bark = 0x6a5a48;
    b.cyl("bark", x, y + H * 0.4, z, 0.48 * scale, H * 0.8, 9, { rTop: 0.34 * scale, tint: bark, collide: "none" });
    b.cyl("bark", x, y + 0.12, z, 0.72 * scale, 0.3, 9, { rTop: 0.48 * scale, tint: bark, collide: "none" });
    b.collisionBox(Surf.Wood, "solid", x, y + H * 0.4, z, 0.7 * scale, H * 0.8, 0.7 * scale);
    const limbs = 5 + Math.floor(r() * 2);
    const top = new THREE.Vector3(x, y + H * 0.78, z);
    for (let i = 0; i < limbs; i++) {
      const a = (i / limbs) * Math.PI * 2 + r() * 0.5;
      const tilt = 0.75 + r() * 0.3;
      const len = R * (0.62 + r() * 0.2);
      const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
      const m = new THREE.Matrix4().compose(top.clone().addScaledVector(dir, len / 2), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), new THREE.Vector3(1, 1, 1));
      b.push(m);
      b.cyl("bark", 0, 0, 0, 0.2 * scale, len, 6, { rTop: 0.07 * scale, tint: bark, collide: "none" });
      b.pop();
    }
    // Crown: clumps scattered through a flattened dome, densest at the surface.
    const centre = new THREE.Vector3(x, y + H + R * 0.12, z);
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    const count = Math.round(150 * scale);
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const el = Math.acos(r() * 0.98);
      const rad = R * (0.55 + 0.45 * Math.sqrt(r()));
      p.set(Math.cos(a) * Math.sin(el) * rad, Math.cos(el) * rad * 0.42 - 0.4 * (1 - Math.cos(el)), Math.sin(a) * Math.sin(el) * rad).add(centre);
      n.subVectors(p, centre).normalize().lerp(new THREE.Vector3(0, 1, 0), 0.45).normalize();
      const shade = 0.62 + 0.38 * Math.max(0, Math.cos(el)) + (r() - 0.5) * 0.16;
      this.clump(p, (2.6 + r() * 1.6) * scale, n, new THREE.Color(shade * 0.92, shade, shade * 0.8), 0.5 + r() * 0.5);
    }
  }

  /** Slender street tree (yellow flame / tembusu): upright oval crown. */
  streetTree(b: Builder, x: number, z: number, scale = 1, y = 0.1): void {
    const r = this.r;
    const H = (3.4 + r() * 1.2) * scale;
    const R = (2.6 + r() * 0.8) * scale;
    b.cyl("bark", x, y + H / 2, z, 0.2 * scale, H, 7, { rTop: 0.13 * scale, tint: 0x75685a, collide: "none" });
    b.collisionBox(Surf.Wood, "solid", x, y + H / 2, z, 0.36, H, 0.36);
    const centre = new THREE.Vector3(x, y + H + R * 0.75, z);
    const n = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < 46; i++) {
      const a = r() * Math.PI * 2;
      const el = Math.acos(r() * 2 - 1);
      const rad = R * (0.4 + 0.6 * Math.sqrt(r()));
      p.set(Math.cos(a) * Math.sin(el) * rad, Math.cos(el) * rad * 1.2, Math.sin(a) * Math.sin(el) * rad).add(centre);
      n.subVectors(p, centre).normalize().lerp(new THREE.Vector3(0, 1, 0), 0.4).normalize();
      const shade = 0.7 + 0.3 * Math.max(0, Math.cos(el)) + (r() - 0.5) * 0.15;
      this.clump(p, (1.7 + r() * 0.9) * scale, n, new THREE.Color(shade * 0.95, shade, shade * 0.72), 0.6 + r() * 0.4);
    }
  }

  /** Royal palm: ringed grey trunk, green crownshaft, arching fronds. */
  palm(b: Builder, x: number, z: number, scale = 1, y = 0.1): void {
    const r = this.r;
    const H = (7 + r() * 2.5) * scale;
    b.cyl("bark", x, y + H / 2, z, 0.24, H, 8, { rTop: 0.16, tint: 0x9a9488, collide: "none" });
    b.cyl("bark", x, y + 0.3, z, 0.34, 0.6, 8, { rTop: 0.25, tint: 0x8d877b, collide: "none" });
    b.cyl("plastic", x, y + H + 0.55, z, 0.15, 1.1, 8, { rTop: 0.1, tint: 0x5f7a3a, collide: "none" });
    b.collisionBox(Surf.Wood, "solid", x, y + H / 2, z, 0.42, H, 0.42);
    const top = new THREE.Vector3(x, y + H + 1.05, z);
    const fronds = 11;
    const u = new THREE.Vector3(), v = new THREE.Vector3(), n = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < fronds; i++) {
      const a = (i / fronds) * Math.PI * 2 + r() * 0.4;
      const lift = 0.75 - (i % 3) * 0.42 + r() * 0.2;
      const len = (3.4 + r() * 0.8) * scale;
      // Two segments so the frond arches over.
      p.copy(top);
      for (let s = 0; s < 2; s++) {
        const el = lift - s * 0.75;
        u.set(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).multiplyScalar(len / 2);
        v.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(1.5 * scale);
        n.crossVectors(v, u).normalize();
        if (n.y < 0) n.negate();
        const sh = 0.8 + r() * 0.2;
        this.card(p, u, v, n.lerp(new THREE.Vector3(0, 1, 0), 0.3).normalize(), 0.5 + s * 0.25, 0.75 + s * 0.25, new THREE.Color(sh * 0.95, sh, sh * 0.8), s * 0.45, 0.45 + s * 0.55, true);
        p.add(u);
      }
    }
  }

  /** Loose shrub: ixora, hibiscus and the like around void decks. */
  shrub(x: number, z: number, size = 1, y = 0.1, flower = 0): void {
    const r = this.r;
    const centre = new THREE.Vector3(x, y + 0.45 * size, z);
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < 7; i++) {
      p.set((r() - 0.5) * 0.9 * size, (r() - 0.3) * 0.6 * size, (r() - 0.5) * 0.9 * size).add(centre);
      n.subVectors(p, centre).normalize().lerp(new THREE.Vector3(0, 1, 0), 0.6).normalize();
      const sh = 0.7 + r() * 0.3;
      const tint = flower && i % 3 === 0 ? new THREE.Color(flower).multiplyScalar(1.2) : new THREE.Color(sh * 0.9, sh, sh * 0.7);
      this.clump(p, (0.9 + r() * 0.5) * size, n, tint, 0.3);
    }
  }

  /** Emit the leaf mesh. Call once, after all planting. */
  finish(): void {
    const mat = new THREE.MeshStandardMaterial({ map: leafAtlas(), alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.82, metalness: 0 });
    this.ctx.engine.lit(mat, { wind: true, macro: 0.5 });
    // Cards are grouped by 64 m cell so trees out of view (and out of a shadow cascade) cost nothing.
    const cells = new Map<number, number[]>();
    for (let q = 0; q < this.pos.length / 12; q++) {
      const id = (Math.floor(this.pos[q * 12] / 64) + 512) * 1024 + Math.floor(this.pos[q * 12 + 2] / 64) + 512;
      let c = cells.get(id);
      if (!c) cells.set(id, (c = []));
      c.push(q);
    }
    for (const quads of cells.values()) {
      const n = quads.length;
      const pos = new Float32Array(n * 12), nrm = new Float32Array(n * 12), col = new Float32Array(n * 12), uv = new Float32Array(n * 8), wind = new Float32Array(n * 4);
      const idx = new Uint32Array(n * 6);
      quads.forEach((q, k) => {
        for (let j = 0; j < 12; j++) {
          pos[k * 12 + j] = this.pos[q * 12 + j];
          nrm[k * 12 + j] = this.nrm[q * 12 + j];
          col[k * 12 + j] = this.col[q * 12 + j];
        }
        for (let j = 0; j < 8; j++) uv[k * 8 + j] = this.uv[q * 8 + j];
        for (let j = 0; j < 4; j++) wind[k * 4 + j] = this.wind[q * 4 + j];
        idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.setAttribute("aWind", new THREE.BufferAttribute(wind, 1));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = "foliage";
      this.ctx.root.add(mesh);
    }
  }
}
