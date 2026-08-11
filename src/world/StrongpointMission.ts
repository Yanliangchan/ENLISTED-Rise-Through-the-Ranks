import { Vector3 } from "@babylonjs/core";
import type { EnemyManager } from "@/enemies/EnemySpawner";
import type { EnemyInstance } from "@/enemies/EnemyAI";
import type { PlayerController } from "@/player/PlayerController";
import type { KranjiStrongpointDef } from "@/world/Kranji";

export type StrongpointState = "locked" | "active" | "cleared";

export interface Strongpoint {
  id: string;
  name: string;
  center: Vector3;
  radius: number;
  state: StrongpointState;
  enemyTypes: string[];
  difficultyWave: number;
  enemies: EnemyInstance[];
}

export interface StrongpointMissionCallbacks {
  onStrongpointActivated?: (sp: Strongpoint) => void;
  onStrongpointCleared?: (sp: Strongpoint, clearedCount: number, total: number) => void;
  /** Fired once, when every strongpoint is cleared. */
  onMissionClear?: (completionTimeSec: number) => void;
  /** Fired once, when the mission ends unsuccessfully. */
  onMissionFail?: (reason: "timeout" | "death") => void;
  onTimerTick?: (secondsLeft: number) => void;
}

const MISSION_TIME_SEC = 12 * 60;
/** How close the player must get to a locked strongpoint before its squad wakes up. */
const ACTIVATION_RADIUS_M = 22;

/**
 * Objective tracker for the "Strongpoint Assault" mission — deliberately
 * decoupled from WaveManager. Where wave-survival escalates an endless
 * sequence of enemy waves, this is a fixed, finite objective list: 4
 * strongpoints, each a small non-escalating squad, cleared by killing
 * everyone in it. The player can approach them in any order; only the one
 * they walk up to wakes up, so the other three stay dormant (cheaper, and
 * doesn't alert the whole map at once).
 *
 * Clear condition is enemies-dead rather than a hold-timer — it reuses
 * EnemyInstance's existing `isDead` flag instead of a second timer/UI state,
 * and reads naturally as "assault and clear" rather than "stand and wait".
 */
export class StrongpointMission {
  readonly strongpoints: Strongpoint[];
  private timeLeft = MISSION_TIME_SEC;
  private elapsed = 0;
  private ended = false;
  private lastTickSecond = -1;

  constructor(
    private readonly enemyManager: EnemyManager,
    strongpointDefs: KranjiStrongpointDef[],
    private readonly callbacks: StrongpointMissionCallbacks = {}
  ) {
    this.strongpoints = strongpointDefs.map((def) => ({
      id: def.id,
      name: def.name,
      center: def.center,
      radius: ACTIVATION_RADIUS_M,
      state: "locked" as StrongpointState,
      enemyTypes: def.enemyTypes,
      difficultyWave: def.difficultyWave,
      enemies: [],
    }));
  }

  get clearedCount(): number {
    return this.strongpoints.filter((s) => s.state === "cleared").length;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  get secondsRemaining(): number {
    return Math.max(0, this.timeLeft);
  }

  update(dt: number, player: PlayerController): void {
    if (this.ended) return;
    this.elapsed += dt;
    this.timeLeft -= dt;

    const wholeSecLeft = Math.max(0, Math.ceil(this.timeLeft));
    if (wholeSecLeft !== this.lastTickSecond) {
      this.lastTickSecond = wholeSecLeft;
      this.callbacks.onTimerTick?.(wholeSecLeft);
    }

    if (this.timeLeft <= 0) {
      this.ended = true;
      this.callbacks.onMissionFail?.("timeout");
      return;
    }
    if (player.isDead) {
      this.ended = true;
      this.callbacks.onMissionFail?.("death");
      return;
    }

    for (const sp of this.strongpoints) {
      if (sp.state === "locked") {
        if (Vector3.Distance(player.position, sp.center) <= sp.radius) {
          sp.state = "active";
          sp.enemies = this.enemyManager.spawnGroupAt(sp.center, sp.enemyTypes, sp.difficultyWave);
          this.callbacks.onStrongpointActivated?.(sp);
        }
      } else if (sp.state === "active") {
        if (sp.enemies.length > 0 && sp.enemies.every((e) => e.isDead)) {
          sp.state = "cleared";
          this.callbacks.onStrongpointCleared?.(sp, this.clearedCount, this.strongpoints.length);
        }
      }
    }

    if (this.clearedCount >= this.strongpoints.length) {
      this.ended = true;
      this.callbacks.onMissionClear?.(Math.round(this.elapsed));
    }
  }
}
