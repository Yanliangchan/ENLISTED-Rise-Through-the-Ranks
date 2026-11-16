import * as THREE from "three";
import type { Soldiers, SpawnOpts } from "~/ai/soldiers";

/** What a mission script can do to the game. */
export interface MissionHost {
  soldiers: Soldiers;
  playerPos: THREE.Vector3;
  say(speaker: string, text: string, seconds?: number): void;
  banner(kicker: string, title: string): void;
  resupply(): void;
  explode(pos: THREE.Vector3, scale: number): void;
  /** True if the player can currently see this point (used to hide spawns). */
  visible(p: THREE.Vector3): boolean;
  addScore(n: number): void;
}

export interface Interact {
  pos: THREE.Vector3;
  label: string;
  seconds: number;
  done(): void;
}

export interface MissionView {
  op: string;
  title: string;
  detail: string;
  marker: THREE.Vector3 | null;
  timer: number | null;
  interact: Interact | null;
}

export interface Mission extends MissionView {
  readonly spawn: { x: number; z: number; yaw: number };
  ended: "win" | "lose" | null;
  endLine: string;
  /** Objectives completed (operation) or waves cleared (holdout). */
  progress: number;
  start(): void;
  update(dt: number): void;
}

/** Key locations on Nee Soon Estate. North is -Z. */
export const LOC = {
  insert: new THREE.Vector3(3.5, 0, 126),
  junction: new THREE.Vector3(0, 0, 0),
  cache: new THREE.Vector3(62, 0, 64),
  carpark: new THREE.Vector3(-58, 0, -48),
  club: new THREE.Vector3(58, 0, -50),
  intel: new THREE.Vector3(47, 0, -53),
};

/** Edges of the map that reinforcements walk in from. */
const ENTRIES: Array<[number, number]> = [[0, -92], [5, -92], [128, 2], [128, -3], [-128, 2], [-128, -3], [-4, 150], [100, 100], [-110, -80], [110, -90]];

function spawnGroup(h: MissionHost, tag: string, pts: Array<[number, number, number?]>, o: SpawnOpts = {}): void {
  for (const [x, z, yaw] of pts) h.soldiers.spawn(x, z, { tag, yaw, ...o });
}

function reinforce(h: MissionHost, n: number, tag: string, accuracy = 1): void {
  const p = h.playerPos;
  const v = new THREE.Vector3();
  const ok = ENTRIES.filter(([x, z]) => Math.hypot(x - p.x, z - p.z) > 55 && !h.visible(v.set(x, 1.5, z)));
  const pool = ok.length ? ok : ENTRIES.filter(([x, z]) => Math.hypot(x - p.x, z - p.z) > 40);
  for (let i = 0; i < n; i++) {
    const e = pool[Math.floor(Math.random() * pool.length)] ?? ENTRIES[0];
    h.soldiers.spawn(e[0] + (Math.random() - 0.5) * 8, e[1] + (Math.random() - 0.5) * 8, { tag, alerted: true, accuracy });
  }
}

interface Stage {
  title: string;
  detail(): string;
  marker: THREE.Vector3 | null;
  enter(): void;
  /** Return true when complete. */
  tick(dt: number): boolean;
  complete: string;
}

/** OPERATION SWIFT LION: four objectives across the estate, then hold for the relief column. */
export class Operation implements Mission {
  readonly spawn = { x: LOC.insert.x, z: LOC.insert.z, yaw: 0 };
  op = "OPERATION SWIFT LION";
  title = "";
  detail = "";
  marker: THREE.Vector3 | null = null;
  timer: number | null = null;
  interact: Interact | null = null;
  ended: "win" | "lose" | null = null;
  endLine = "";
  progress = 0;
  private stage = -1;
  private readonly stages: Stage[];
  private t = 0;
  private flag = false;
  private fuse = -1;
  private wave = 0;

  constructor(private readonly h: MissionHost) {
    const s = h.soldiers;
    const left = (tag: string): string => {
      const n = s.countTag(tag);
      return n === 1 ? "1 hostile remaining" : `${n} hostiles remaining`;
    };
    this.stages = [
      {
        title: "Clear the junction",
        detail: () => (this.flag ? left("junction") : "Advance north up Avenue 4"),
        marker: LOC.junction,
        complete: "JUNCTION SECURE",
        enter: () => {
          spawnGroup(h, "junction", [[-10.5, 12, 0], [10.5, 10.5, 0.2], [-11, -11, 0.4], [11.5, -12, -0.3], [3, -24, 0], [-22, -9.5, 1.2]], { leash: 13 });
          spawnGroup(h, "junction", [[0.5, 34, 0]], { patrol: [[0.5, 34], [0.5, 12], [9.5, 20]] });
          h.say("SECT COMD", "Two-One Charlie, dismount complete. Enemy holds the junction ahead. Stay off the centre line and move up.", 6);
        },
        tick: () => {
          if (!this.flag && (h.playerPos.z < 70 || s.inCombat)) {
            this.flag = true;
            h.say("SECT COMD", "Contact front! Riflemen at the junction. Use the cover and take them down.", 4.5);
          }
          return s.countTag("junction") === 0;
        },
      },
      {
        title: "Destroy the weapons cache",
        detail: () => (this.fuse >= 0 ? "Charge set — get clear" : s.countTag("hawker") > 0 ? `Hawker centre · ${left("hawker")}` : "Set the demolition charge on the cache"),
        marker: LOC.cache,
        complete: "CACHE DESTROYED",
        enter: () => {
          spawnGroup(h, "hawker", [[48, 52, 3], [70, 54, 3.4], [56, 70, 2.6], [74, 70, 3.6], [64, 60, 3.1], [40, 40, 3.5]], { leash: 14 });
          spawnGroup(h, "hawker", [[30, 46, 0]], { patrol: [[30, 46], [44, 78], [82, 76], [84, 44]] });
          h.say("3 SIR HQ", "Two-One, Zero. Good work. UAV shows a weapons cache inside the hawker centre, south-east of you. Destroy it.", 6.5);
          this.interact = { pos: LOC.cache, label: "Set demolition charge", seconds: 2.4, done: () => {
            this.interact = null;
            this.fuse = 7;
            h.say("SECT COMD", "Charge is live! Seven seconds — move, move!", 3.5);
          } };
        },
        tick: (dt) => {
          if (this.fuse < 0) return false;
          this.fuse -= dt;
          this.timer = Math.max(0, this.fuse);
          if (this.fuse > 0) return false;
          this.timer = null;
          this.fuse = -1;
          h.explode(new THREE.Vector3(LOC.cache.x, 0.6, LOC.cache.z), 2.2);
          return true;
        },
      },
      {
        title: "Clear the multi-storey carpark",
        detail: () => `Blk 406A · ${left("mscp")}`,
        marker: LOC.carpark,
        complete: "CARPARK CLEAR",
        enter: () => {
          spawnGroup(h, "mscp", [[-44, -40, 1.6], [-70, -44, 1.2], [-58, -58, 0.8], [-48, -54, 1.4], [-66, -36, 1.8], [-36, -28, 1.9], [-30, -50, 1.5]], { leash: 15 });
          spawnGroup(h, "mscp", [[-24, -20, 2]], { patrol: [[-24, -20], [-24, -70], [-84, -70], [-84, -22]] });
          h.say("3 SIR HQ", "Two-One, a mortar team is working out of the multi-storey carpark to your north-west. Clear it before they range in on the relief column.", 7);
        },
        tick: () => s.countTag("mscp") === 0,
      },
      {
        title: "Seize the enemy command post",
        detail: () => (s.countTag("club") > 2 ? `Community club · ${left("club")}` : "Recover the command laptop"),
        marker: LOC.club,
        complete: "COMMAND POST SEIZED",
        enter: () => {
          spawnGroup(h, "club", [[46, -40, 3.6], [70, -42, 3.9], [52, -60, 4.2], [66, -58, 4], [58, -34, 3.4], [40, -52, 4.4], [76, -52, 4.2], [58, -48, 3.8]], { leash: 15, accuracy: 1.15 });
          h.say("3 SIR HQ", "Last one. Their command post is in the community club, north-east corner. Take the building and recover whatever they are planning with.", 7);
          this.interact = { pos: LOC.intel, label: "Recover command laptop", seconds: 2, done: () => {
            this.interact = null;
            this.flag = true;
          } };
        },
        tick: () => this.flag,
      },
      {
        title: "Hold the junction for extraction",
        detail: () => (this.flag ? `Terrex inbound · ${left("counter")}` : "Return to the junction"),
        marker: LOC.junction,
        complete: "EXTRACTION",
        enter: () => {
          h.say("3 SIR HQ", "Outstanding. Terrex section is rolling to the junction. Enemy is counter-attacking from all sides — get back there and hold.", 7);
        },
        tick: (dt) => {
          if (!this.flag) {
            if (h.playerPos.distanceTo(LOC.junction) < 26) {
              this.flag = true;
              this.t = 100;
              this.wave = 0;
              h.say("SECT COMD", "In position. They are coming — pick your arcs!", 4);
            }
            return false;
          }
          this.t -= dt;
          this.timer = Math.max(0, this.t);
          const due = this.wave === 0 ? 96 : this.wave === 1 ? 68 : this.wave === 2 ? 38 : -1;
          if (this.t < due) {
            this.wave++;
            reinforce(h, 4 + this.wave, "counter", 0.95);
            if (this.wave === 3) h.say("3 SIR HQ", "Two-One, Terrex is one minute out. Hold on.", 4);
          }
          if (this.t <= 0) {
            this.timer = null;
            return true;
          }
          return false;
        },
      },
    ];
  }

  start(): void {
    this.next();
  }

  private next(): void {
    this.stage++;
    this.flag = false;
    this.interact = null;
    this.timer = null;
    if (this.stage >= this.stages.length) {
      this.ended = "win";
      this.endLine = "Nee Soon Estate is back in friendly hands. The relief column reached the junction and your section walked out with the enemy's plans.";
      return;
    }
    const st = this.stages[this.stage];
    this.title = st.title;
    this.marker = st.marker;
    st.enter();
  }

  update(dt: number): void {
    if (this.ended || this.stage < 0) return;
    const st = this.stages[this.stage];
    this.detail = st.detail();
    if (st.tick(dt)) {
      this.progress = Math.min(4, this.stage + 1);
      this.h.banner("OBJECTIVE COMPLETE", st.complete);
      this.h.addScore(500);
      this.h.resupply();
      this.next();
    }
  }
}

/** HOLDOUT: endless waves at the junction. */
export class Holdout implements Mission {
  readonly spawn = { x: 2, z: 16, yaw: 0 };
  op = "HOLDOUT";
  title = "Hold the junction";
  detail = "";
  marker: THREE.Vector3 | null = null;
  timer: number | null = null;
  interact: Interact | null = null;
  ended: "win" | "lose" | null = null;
  endLine = "";
  progress = 0;
  private wave = 0;
  private rest = 6;
  private pending = 0;
  private drip = 0;

  constructor(private readonly h: MissionHost) {}

  start(): void {
    this.h.say("3 SIR HQ", "Two-One, you are the only callsign at the junction. Enemy is massing on every approach. Hold as long as you can.", 6);
  }

  update(dt: number): void {
    const s = this.h.soldiers;
    const alive = s.aliveCount;
    if (this.rest > 0) {
      this.rest -= dt;
      this.timer = this.rest;
      this.detail = `Wave ${this.wave + 1} inbound`;
      if (this.rest <= 0) {
        this.timer = null;
        this.wave++;
        this.pending = Math.min(26, 4 + this.wave * 2);
        this.h.banner("ENEMY ASSAULT", `Wave ${this.wave}`);
      }
      return;
    }
    // Feed the wave in, keeping the number on the field manageable.
    this.drip -= dt;
    if (this.pending > 0 && this.drip <= 0 && alive < 12) {
      const n = Math.min(this.pending, 3);
      reinforce(this.h, n, "wave", Math.min(1.3, 0.8 + this.wave * 0.05));
      this.pending -= n;
      this.drip = 2.5;
    }
    this.detail = `Wave ${this.wave} · ${alive + this.pending} hostiles`;
    if (this.pending === 0 && alive === 0) {
      this.progress = this.wave;
      this.h.addScore(250 + this.wave * 50);
      this.h.resupply();
      this.h.banner("WAVE REPELLED", `Wave ${this.wave} down`);
      this.rest = 12;
    }
  }
}
