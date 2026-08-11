import { Vector3 } from "@babylonjs/core";
import type { EnemyManager } from "@/enemies/EnemySpawner";
import type { EnemyInstance } from "@/enemies/EnemyAI";
import type { PlayerController } from "@/player/PlayerController";
import type { TerminalStrongpointDef, StrongpointPhaseDef } from "@/world/PasirPanjang";

export type StrongpointState = "locked" | "gated" | "active" | "cleared";

export interface Strongpoint {
  id: string;
  name: string;
  center: Vector3;
  radius: number;
  state: StrongpointState;
  phases: StrongpointPhaseDef[];
  /** Index of the layer currently being fought; equals phases.length once cleared. */
  phaseIndex: number;
  /** Defenders of the live layer only — previous layers are already dead. */
  enemies: EnemyInstance[];
  requiresAll: boolean;
}

export interface StrongpointMissionCallbacks {
  onStrongpointActivated?: (sp: Strongpoint) => void;
  /** A layer fell, but the objective still stands — fired with the layer that is now live. */
  onPhaseAdvanced?: (sp: Strongpoint, newPhase: StrongpointPhaseDef) => void;
  onStrongpointCleared?: (sp: Strongpoint, clearedCount: number, total: number) => void;
  /** A gated objective just became available (its prerequisites are all cleared). */
  onGateOpened?: (sp: Strongpoint) => void;
  /** Fired once, when every strongpoint is cleared. */
  onMissionClear?: (completionTimeSec: number) => void;
  /** Fired once, when the mission ends unsuccessfully. */
  onMissionFail?: (reason: "timeout" | "death") => void;
  onTimerTick?: (secondsLeft: number) => void;
}

/**
 * Operation clock. Generous enough that a careful, methodical clear is the
 * intended way through — the pressure comes from attrition and the gated final
 * objective, not from having to sprint.
 */
const MISSION_TIME_SEC = 32 * 60;

/**
 * Objective tracker for Strongpoint Assault — deliberately decoupled from
 * WaveManager. Where wave-survival escalates an endless sequence of waves at a
 * fixed base, this is a finite, spatial objective list: four strongpoints
 * across Pasir Panjang Terminal, each defended in ordered layers.
 *
 * Layering is what makes an objective an operation rather than a checkpoint.
 * Walking into a strongpoint wakes its outer screen only; killing that screen
 * commits the next layer deeper in, and so on to the final holdout. The player
 * therefore fights *through* a position instead of clearing one clump of
 * enemies standing on a marker.
 *
 * Three of the four can be taken in any order. Bukit Chandu is gated behind
 * the rest (`requiresAll`) so the operation always ends on its hardest
 * position — the culmination, not a fourth interchangeable stop.
 *
 * Clear condition stays enemies-dead rather than a hold timer: it reuses
 * `EnemyInstance.isDead` instead of inventing a second timer/UI state, and
 * reads naturally as "assault and clear".
 */
export class StrongpointMission {
  readonly strongpoints: Strongpoint[];
  private timeLeft = MISSION_TIME_SEC;
  private elapsed = 0;
  private ended = false;
  private lastTickSecond = -1;

  constructor(
    private readonly enemyManager: EnemyManager,
    strongpointDefs: TerminalStrongpointDef[],
    private readonly callbacks: StrongpointMissionCallbacks = {}
  ) {
    this.strongpoints = strongpointDefs.map((def) => ({
      id: def.id,
      name: def.name,
      center: def.center,
      radius: def.activationRadiusM,
      state: (def.requiresAll ? "gated" : "locked") as StrongpointState,
      phases: def.phases,
      phaseIndex: 0,
      enemies: [],
      requiresAll: !!def.requiresAll,
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

  /** The layer currently being fought at an active strongpoint, for HUD copy. */
  currentPhase(sp: Strongpoint): StrongpointPhaseDef | null {
    return sp.state === "active" ? (sp.phases[sp.phaseIndex] ?? null) : null;
  }

  /**
   * Difficulty band handed to EnemyManager for the whole-map AI tick. It drives
   * the concurrent-attacker cap, so it rises with mission progress: early on
   * only a couple of defenders press at once, by the final objective the
   * garrison fights as a group.
   */
  private get missionWave(): number {
    return 5 + this.clearedCount * 3;
  }

  update(dt: number, player: PlayerController): void {
    if (this.ended) return;
    this.elapsed += dt;
    this.timeLeft -= dt;

    // Nothing else ticks the AI in this mode — WaveManager (which normally
    // drives enemyManager.update) is deliberately not running during a
    // Strongpoint Assault, so the mission owns the tick.
    this.enemyManager.update(dt, player, this.missionWave);

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

    this.updateGates();

    for (const sp of this.strongpoints) {
      if (sp.state === "locked") {
        if (Vector3.Distance(player.position, sp.center) <= sp.radius) {
          sp.state = "active";
          this.spawnPhase(sp);
          this.callbacks.onStrongpointActivated?.(sp);
        }
      } else if (sp.state === "active") {
        // A layer holds until every one of its defenders is down.
        if (sp.enemies.length === 0 || !sp.enemies.every((e) => e.isDead)) continue;
        sp.phaseIndex += 1;
        if (sp.phaseIndex >= sp.phases.length) {
          sp.state = "cleared";
          sp.enemies = [];
          this.callbacks.onStrongpointCleared?.(sp, this.clearedCount, this.strongpoints.length);
        } else {
          this.spawnPhase(sp);
          this.callbacks.onPhaseAdvanced?.(sp, sp.phases[sp.phaseIndex]);
        }
      }
    }

    if (this.clearedCount >= this.strongpoints.length) {
      this.ended = true;
      this.callbacks.onMissionClear?.(Math.round(this.elapsed));
    }
  }

  /** Opens gated objectives once every ungated one has fallen. */
  private updateGates(): void {
    const outstandingUngated = this.strongpoints.some((s) => !s.requiresAll && s.state !== "cleared");
    if (outstandingUngated) return;
    for (const sp of this.strongpoints) {
      if (sp.state !== "gated") continue;
      sp.state = "locked"; // now behaves like any other objective: walk in to trigger it
      this.callbacks.onGateOpened?.(sp);
    }
  }

  /**
   * Commits the current layer. Defenders are dealt round-robin across the
   * layer's anchors so a squad holds a position as a spread firing line rather
   * than a single clump on one marker — the anchors are placed on real cover in
   * PasirPanjang.ts, and `spawnGroupAt` snaps each soldier onto navigable
   * ground from there.
   */
  private spawnPhase(sp: Strongpoint): void {
    const phase = sp.phases[sp.phaseIndex];
    if (!phase) return;
    const spawned: EnemyInstance[] = [];
    phase.enemyTypes.forEach((typeId, i) => {
      const anchor = phase.anchors[i % phase.anchors.length];
      spawned.push(...this.enemyManager.spawnGroupAt(anchor, [typeId], phase.difficultyWave, phase.elite));
    });
    sp.enemies = spawned;
  }
}
