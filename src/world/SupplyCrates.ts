import { Scene, MeshBuilder, StandardMaterial, Color3, Mesh, Vector3 } from "@babylonjs/core";
import type { PlayerController } from "@/player/PlayerController";
import type { WeaponController } from "@/weapons/WeaponController";
import type { InputManager } from "@/core/InputManager";
import type { AudioManager } from "@/core/AudioManager";
import type { MedKitController } from "@/player/MedKit";

type CrateType = "ammo" | "health";

interface CrateSpot {
  x: number;
  z: number;
  type: CrateType;
}

/** Tucked into alleys, mid-block gaps, and the garden — off the main plaza sightlines. */
const CRATE_SPOTS: CrateSpot[] = [
  { x: 22, z: 11, type: "ammo" },
  { x: -22, z: -11, type: "health" },
  { x: 44, z: 22, type: "ammo" },
  { x: -44, z: 22, type: "health" },
  { x: 22, z: -44, type: "ammo" },
  { x: -22, z: 44, type: "ammo" },
  { x: 66, z: 0, type: "health" },
  { x: -66, z: 0, type: "ammo" },
  { x: 0, z: 66, type: "health" },
  { x: -51, z: -51, type: "ammo" },
  { x: -59, z: -25, type: "health" },
  { x: 8, z: -12, type: "ammo" },
];

const INTERACT_RADIUS = 2.3;
const RESPAWN_SEC = 90;
const AMMO_AMOUNT = 90;
const MEDKITS_PER_CRATE = 2;
const ARMOUR_AMOUNT = 25;

interface Crate {
  mesh: Mesh;
  type: CrateType;
  available: boolean;
  respawnTimer: number;
}

/**
 * Hidden ammo/health supply crates scattered around the map. Walk within
 * range and press `F` to collect; each crate respawns after a cooldown so
 * repeat visits stay worthwhile.
 */
export class SupplyCrateManager {
  private crates: Crate[] = [];
  /** Non-null when the player is in range of an available crate — HUD shows this as an interact prompt. */
  promptText: string | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly player: PlayerController,
    private readonly weaponController: WeaponController,
    private readonly input: InputManager,
    private readonly audio: AudioManager,
    private readonly medKit: MedKitController
  ) {
    const crateMat = new StandardMaterial("supplyCrateMat", scene);
    crateMat.diffuseColor = new Color3(0.32, 0.28, 0.18);
    crateMat.specularColor = Color3.Black();

    const ammoMarkerMat = new StandardMaterial("ammoMarkerMat", scene);
    ammoMarkerMat.diffuseColor = new Color3(0.6, 0.4, 0.05);
    ammoMarkerMat.emissiveColor = new Color3(0.5, 0.32, 0.03);

    const healthMarkerMat = new StandardMaterial("healthMarkerMat", scene);
    healthMarkerMat.diffuseColor = new Color3(0.7, 0.08, 0.08);
    healthMarkerMat.emissiveColor = new Color3(0.5, 0.05, 0.05);

    for (const spot of CRATE_SPOTS) {
      const box = MeshBuilder.CreateBox(`supplyCrate_${spot.x}_${spot.z}`, { width: 0.8, height: 0.7, depth: 0.8 }, scene);
      box.position.set(spot.x, 0.35, spot.z);
      box.material = crateMat;
      box.checkCollisions = true;

      const marker = MeshBuilder.CreateBox(`supplyCrateMarker_${spot.x}_${spot.z}`, { width: 0.5, height: 0.06, depth: 0.5 }, scene);
      marker.position.set(0, 0.38, 0);
      marker.material = spot.type === "ammo" ? ammoMarkerMat : healthMarkerMat;
      marker.parent = box;
      marker.isPickable = false;

      this.crates.push({ mesh: box, type: spot.type, available: true, respawnTimer: 0 });
    }
  }

  update(dt: number): void {
    let nearest: Crate | null = null;
    let nearestDist = INTERACT_RADIUS;

    for (const crate of this.crates) {
      if (!crate.available) {
        crate.respawnTimer -= dt;
        if (crate.respawnTimer <= 0) {
          crate.available = true;
          crate.mesh.setEnabled(true);
        }
        continue;
      }
      const dist = Vector3.Distance(crate.mesh.position, this.player.position);
      if (dist < nearestDist) {
        nearest = crate;
        nearestDist = dist;
      }
    }

    if (!nearest) {
      this.promptText = null;
      return;
    }

    this.promptText =
      nearest.type === "ammo"
        ? "Press F — collect Ammo Crate"
        : "Press F — collect Medical Crate (2 first aid kits + armour)";

    if (this.input.wasPressed("KeyF")) {
      nearest.available = false;
      nearest.mesh.setEnabled(false);
      nearest.respawnTimer = RESPAWN_SEC;
      if (nearest.type === "ammo") {
        this.weaponController.resupplyAmmo(AMMO_AMOUNT);
      } else {
        this.medKit.add(MEDKITS_PER_CRATE);
        this.player.armour = Math.min(this.player.maxArmour, this.player.armour + ARMOUR_AMOUNT);
      }
      this.audio.purchase();
      this.promptText = null;
    }
  }
}
