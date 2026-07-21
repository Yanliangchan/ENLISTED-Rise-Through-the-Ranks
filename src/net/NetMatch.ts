import { Scene, MeshBuilder, StandardMaterial, Color3, Vector3, Mesh, DynamicTexture, TransformNode } from "@babylonjs/core";
import type { NetClient } from "@/net/NetClient";
import type { PlayerController } from "@/player/PlayerController";
import type { WeaponController } from "@/weapons/WeaponController";
import type { HUD } from "@/ui/HUD";
import type { MatchStartInfo } from "@/ui/MultiplayerMenu";
import type { PlayerNetState, ServerMsg, Team, LobbyPlayer, MatchPlayerResult } from "@/net/protocol";
import { NetFlag } from "@/net/protocol";
import { IRON_CITADEL_BASE, IRON_CITADEL_SCALE } from "@/world/IronCitadel";

/** Networked coords are unscaled "logical" map space; render/place them at BASE + SCALE*local. */
const S = IRON_CITADEL_SCALE;

/** Damage hook shared by an avatar's hittable meshes; NetMatch wires takeDamage. */
interface DmgHook { takeDamage: (dmg: number, headshot: boolean, origin?: unknown, fmj?: boolean) => void }

/**
 * Local visual + net state for one remote player. Renders as a proper SAF
 * soldier (torso / plate carrier / head / helmet / arms / legs) in the team
 * colour, carrying a large roster number (1-4) on the chest, helmet and
 * nameplate so teammates and opponents are instantly identifiable.
 */
export class Avatar {
  root: TransformNode;
  private model: TransformNode;
  /** Shared damageable — NetMatch sets .takeDamage to emit a server hit-claim. */
  readonly dmg: DmgHook = { takeDamage: () => {} };
  target = new Vector3();
  targetYaw = 0;
  hp = 100;
  dead = false;

  constructor(scene: Scene, public readonly info: LobbyPlayer, teamColor: Color3, public readonly number: number, private readonly base: Vector3) {
    this.root = new TransformNode(`avatar_${info.id}`, scene);
    this.model = new TransformNode(`avmodel_${info.id}`, scene);
    this.model.parent = this.root;

    const mat = (name: string, rgb: Color3, glow = 0.12): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = rgb;
      m.emissiveColor = rgb.scale(glow);
      m.specularColor = new Color3(0.08, 0.08, 0.08);
      return m;
    };
    // MUTED SAF combat uniform for BOTH teams (olive-drab / pixelised green),
    // so soldiers blend into the office instead of glowing blue/red. The team
    // colour appears only on identifiers (helmet band, armband, chest/helmet
    // number, nameplate) so they stay readable at combat distance.
    const uniform = mat(`av_uni_${info.id}`, new Color3(0.29, 0.31, 0.23), 0.05);
    const gear = mat(`av_gear_${info.id}`, new Color3(0.17, 0.18, 0.14), 0.03); // plate carrier / pouches
    const gearB = mat(`av_gearB_${info.id}`, new Color3(0.11, 0.12, 0.1), 0.02); // dark rubber / boots / rifle
    const skin = mat(`av_skin_${info.id}`, new Color3(0.58, 0.44, 0.34), 0.03);
    const helmetMat = mat(`av_hel_${info.id}`, new Color3(0.23, 0.25, 0.19), 0.04);
    const accent = mat(`av_acc_${info.id}`, teamColor, 0.35); // team identifier
    const numTex = this.numberTexture(scene, teamColor);
    const numMat = new StandardMaterial(`av_num_${info.id}`, scene);
    numMat.emissiveTexture = numTex; numMat.diffuseTexture = numTex; numMat.disableLighting = true;

    const box = (n: string, w: number, h: number, d: number, y: number, m: StandardMaterial, hz?: "body" | "head" | "limb", hs = false): Mesh => {
      const mesh = MeshBuilder.CreateBox(`${info.id}_${n}`, { width: w, height: h, depth: d }, scene);
      mesh.position.y = y; mesh.material = m; mesh.parent = this.model;
      if (hz) mesh.metadata = { damageable: this.dmg, hitZone: hz, isHeadshotMesh: hs };
      else mesh.isPickable = false;
      return mesh;
    };
    // torso + plate carrier with pouches (hittable body)
    box("body", 0.56, 1.0, 0.36, 0.98, uniform, "body");
    box("vest", 0.54, 0.6, 0.17, 1.08, gear);
    for (const px of [-0.16, 0.16]) { const p = box("pouch", 0.16, 0.2, 0.1, 0.86, gearB); p.position.x = px; p.position.z = 0.22; }
    // backpack + radio antenna
    box("pack", 0.4, 0.5, 0.2, 1.12, gear).position.z = -0.26;
    const ant = MeshBuilder.CreateCylinder(`${info.id}_ant`, { diameter: 0.03, height: 0.5, tessellation: 5 }, scene);
    ant.position.set(-0.18, 1.55, -0.28); ant.material = gearB; ant.parent = this.model; ant.isPickable = false;
    // shoulders + arms + hands + team armband
    box("shoulders", 0.66, 0.16, 0.38, 1.42, uniform);
    for (const x of [-0.36, 0.36]) {
      const arm = box("arm", 0.16, 0.66, 0.2, 1.06, uniform, "limb");
      arm.position.x = x;
      const hand = MeshBuilder.CreateBox(`${info.id}_hand`, { width: 0.13, height: 0.14, depth: 0.15 }, scene);
      hand.position.set(x, 0.72, 0.06); hand.material = gearB; hand.parent = this.model; hand.isPickable = false;
    }
    const armband = MeshBuilder.CreateCylinder(`${info.id}_arm_b`, { diameter: 0.19, height: 0.1, tessellation: 10 }, scene);
    armband.position.set(0.36, 1.28, 0.02); armband.material = accent; armband.parent = this.model; armband.isPickable = false;
    // legs + knee pads + boots
    for (const x of [-0.15, 0.15]) {
      const leg = box("leg", 0.2, 0.78, 0.24, 0.42, uniform, "limb");
      leg.position.x = x;
      const knee = box("knee", 0.2, 0.14, 0.1, 0.5, gearB); knee.position.x = x; knee.position.z = 0.12;
      const boot = MeshBuilder.CreateBox(`${info.id}_boot`, { width: 0.22, height: 0.14, depth: 0.3 }, scene);
      boot.position.set(x, 0.07, 0.05); boot.material = gearB; boot.parent = this.model; boot.isPickable = false;
    }
    // neck + head (headshot) + helmet + team band
    const neck = MeshBuilder.CreateCylinder(`${info.id}_neck`, { diameter: 0.15, height: 0.12 }, scene);
    neck.position.y = 1.52; neck.material = skin; neck.parent = this.model; neck.isPickable = false;
    box("head", 0.27, 0.3, 0.27, 1.67, skin, "head", true);
    const helmet = MeshBuilder.CreateSphere(`${info.id}_helmet`, { diameter: 0.34, slice: 0.62 }, scene);
    helmet.position.y = 1.78; helmet.material = helmetMat; helmet.parent = this.model; helmet.isPickable = false;
    const band = MeshBuilder.CreateTorus(`${info.id}_band`, { diameter: 0.33, thickness: 0.035, tessellation: 12 }, scene);
    band.position.y = 1.72; band.rotation.x = Math.PI / 2; band.material = accent; band.parent = this.model; band.isPickable = false;

    // roster number: chest + helmet front + a slung rifle.
    const chestNum = MeshBuilder.CreatePlane(`${info.id}_cn`, { width: 0.3, height: 0.3 }, scene);
    chestNum.position.set(0, 1.16, 0.29); chestNum.material = numMat; chestNum.parent = this.model; chestNum.isPickable = false;
    const helmNum = MeshBuilder.CreatePlane(`${info.id}_hn`, { width: 0.16, height: 0.16 }, scene);
    helmNum.position.set(0, 1.8, 0.2); helmNum.material = numMat; helmNum.parent = this.model; helmNum.isPickable = false;
    const rifle = MeshBuilder.CreateBox(`${info.id}_rifle`, { width: 0.07, height: 0.11, depth: 0.7 }, scene);
    rifle.position.set(0.26, 1.02, 0.34); rifle.material = gearB; rifle.parent = this.model; rifle.isPickable = false;

    // billboard nameplate: [#N] RANK NAME
    const plate = MeshBuilder.CreatePlane(`np_${info.id}`, { width: 2.4, height: 0.55 }, scene);
    plate.parent = this.root; plate.position.y = 2.35; plate.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const tex = new DynamicTexture(`npt_${info.id}`, { width: 300, height: 64 }, scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "rgba(8,12,8,0.62)"; ctx.fillRect(0, 0, 300, 64);
    ctx.fillStyle = teamColor.toHexString(); ctx.fillRect(0, 0, 46, 64);
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 40px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(number), 23, 34);
    tex.drawText(`${info.rankInsignia} ${info.name}`, 58, 40, "bold 24px Arial", teamColor.toHexString(), null, true, true);
    const pm = new StandardMaterial(`npm_${info.id}`, scene);
    pm.emissiveTexture = tex; pm.opacityTexture = tex; pm.disableLighting = true; pm.backFaceCulling = false;
    plate.material = pm;
  }

  /** Big roster number on a translucent team-tinted plate. */
  private numberTexture(scene: Scene, teamColor: Color3): DynamicTexture {
    const t = new DynamicTexture(`num_${this.info.id}`, { width: 128, height: 128 }, scene, true);
    const c = t.getContext() as CanvasRenderingContext2D;
    c.clearRect(0, 0, 128, 128);
    c.fillStyle = teamColor.scale(0.7).toHexString(); c.fillRect(8, 8, 112, 112);
    c.fillStyle = "#ffffff"; c.font = "bold 96px Arial"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(String(this.number), 64, 70);
    t.update(true);
    t.hasAlpha = true;
    return t;
  }

  setState(s: PlayerNetState): void {
    this.target.set(this.base.x + S * s.x, s.y, this.base.z + S * s.z);
    this.targetYaw = s.yaw;
    this.hp = s.hp;
    const nowDead = (s.flags & NetFlag.Dead) !== 0;
    if (nowDead !== this.dead) { this.dead = nowDead; this.model.setEnabled(!nowDead); }
  }
  interpolate(dt: number): void {
    const p = this.root.position;
    const a = Math.min(1, dt * 12);
    p.x += (this.target.x - p.x) * a;
    p.y += (this.target.y - p.y) * a;
    p.z += (this.target.z - p.z) * a;
    this.root.rotation.y += (this.targetYaw - this.root.rotation.y) * a;
  }
  setEnabled(on: boolean): void { this.model.setEnabled(on); this.dead = !on; }
  dispose(): void { this.root.dispose(false, true); }
}

/**
 * In-match multiplayer controller. Renders remote players, broadcasts the local
 * player's state, routes real weapon hits to the server as claims, and drives
 * the scoreboard / scores / timer / match-end overlays. The server stays
 * authoritative for hp, kills, scores and win conditions.
 */
export class NetMatch {
  private avatars = new Map<string, Avatar>();
  private off: () => void;
  private sendAccum = 0;
  private timeLeft: number;
  private blue = 0;
  private red = 0;
  private round = 1;
  private ended = false;
  private topHud: HTMLDivElement;
  private scoreboard: HTMLDivElement;
  private roster: LobbyPlayer[];
  private prevOnFire?: (w: unknown) => void;
  private prevHp = 100;
  private prevArmor = 100;
  private scoreboardAccum = 0;

  onExit?: () => void;
  /** Persist the local player's result (XP/currency/rank/badges) — wired to the backend by main. */
  onSubmitResult?: (r: { mode: "tdm" | "elim"; won: boolean; result: MatchPlayerResult }) => Promise<{ xpGained: number; currency: number; rankUp: { from: string; to: string } | null } | null>;

  constructor(
    private readonly scene: Scene,
    private readonly player: PlayerController,
    private readonly weapon: WeaponController,
    private readonly net: NetClient,
    private readonly info: MatchStartInfo,
    private readonly hud: HUD,
    private readonly isPointerLocked: () => boolean,
    parent: HTMLElement,
  ) {
    this.roster = info.players;
    this.timeLeft = info.settings.timeLimitSec;
    const base = IRON_CITADEL_BASE;
    // place local player at spawn; give everyone a plate carrier (armour) so
    // the armour bar + absorption match the single-player loadout feel.
    player.respawn(new Vector3(base.x + S * info.spawn.x, info.spawn.y, base.z + S * info.spawn.z));
    player.inSafeZone = false;
    (player as unknown as { spawnProtected: boolean }).spawnProtected = false;
    player.maxHealth = 100; player.health = 100;
    player.maxArmour = 100; player.armour = 100;
    this.prevHp = 100; this.prevArmor = 100;

    for (const p of info.players) {
      if (p.id === net.playerId) continue;
      this.spawnAvatar(p);
    }

    // broadcast fire events by chaining the weapon's onFire callback
    const wc = weapon as unknown as { onFire?: (w: unknown) => void; callbacks?: { onFire?: (w: unknown) => void } };
    this.prevOnFire = wc.callbacks?.onFire;
    if (wc.callbacks) {
      wc.callbacks.onFire = (w: unknown) => {
        this.prevOnFire?.(w);
        const cam = player.camera;
        const dir = cam.getDirection(new Vector3(0, 0, 1));
        const o = cam.globalPosition;
        this.net.send({ t: "fire", weapon: 0, ox: o.x, oy: o.y, oz: o.z, dx: dir.x, dy: dir.y, dz: dir.z });
      };
    }

    this.off = net.on((m) => this.onServer(m));
    this.topHud = this.buildHud(parent);
    this.scoreboard = this.buildScoreboard(parent);
    this.renderScoreboard();
  }

  private teamColor(t: Team): Color3 {
    return t === "blue" ? new Color3(0.3, 0.56, 0.85) : new Color3(0.85, 0.36, 0.3);
  }

  private spawnAvatar(p: LobbyPlayer): void {
    const num = this.roster.findIndex((r) => r.id === p.id) + 1; // 1-4 roster number
    const av = new Avatar(this.scene, p, this.teamColor(p.team), num, IRON_CITADEL_BASE);
    av.dmg.takeDamage = (dmg, hs) => {
      if (av.dead || this.ended) return;
      this.net.send({ t: "hit", targetId: p.id, damage: dmg, headshot: hs });
      this.hud.notifyHit(hs); // instant client-side hitmarker (responsive)
    };
    this.avatars.set(p.id, av);
  }

  private onServer(m: ServerMsg): void {
    switch (m.t) {
      case "snapshot":
        for (const s of m.players) {
          if (s.id === this.net.playerId) continue;
          this.avatars.get(s.id)?.setState(s);
        }
        break;
      case "hurt": {
        // Damage the amount actually lost this hit (health + armour delta).
        const dmg = Math.max(1, this.prevHp + this.prevArmor - m.hp - m.armor);
        this.player.health = m.hp;
        this.player.armour = m.armor;
        this.prevHp = m.hp; this.prevArmor = m.armor;
        // Subtle feedback (no big screen shake): directional arrow + vignette +
        // blood scaled to damage, and only a tiny camera nudge.
        const from = this.avatars.get(m.fromId);
        if (from) {
          const bearing = Math.atan2(from.root.position.x - this.player.position.x, from.root.position.z - this.player.position.z);
          this.hud.notifyDamageFrom(bearing);
        }
        this.hud.notifyPlayerHurt(dmg);
        this.player.shakeCamera(Math.min(6, dmg * 0.12)); // minor recoil, never disruptive
        break;
      }
      case "kill": {
        const victim = this.roster.find((p) => p.id === m.victimId);
        const killer = m.killerId ? this.roster.find((p) => p.id === m.killerId) : null;
        if (m.killerId === this.net.playerId && victim) this.hud.notifyKill(victim.name, m.headshot);
        if (m.victimId === this.net.playerId) {
          this.player.health = 0; this.prevHp = 0; this.prevArmor = 0;
          // Die immediately: lock movement + holster the weapon so a dead player
          // can never keep shooting or walking until they respawn.
          this.player.frozen = true;
          this.weapon.disabled = true;
          this.showCenter(killer ? `ELIMINATED BY ${killer.rankInsignia} ${killer.name}` : "ELIMINATED", 2800);
        }
        this.avatars.get(m.victimId)?.setState({ id: m.victimId, x: 0, y: -50, z: 0, yaw: 0, pitch: 0, flags: NetFlag.Dead, weapon: 0, hp: 0, armor: 0 });
        break;
      }
      case "respawn": {
        const base = IRON_CITADEL_BASE;
        const pos = new Vector3(base.x + S * m.spawn.x, m.spawn.y, base.z + S * m.spawn.z);
        if (m.playerId === this.net.playerId) {
          this.player.respawn(pos);
          this.player.health = 100; this.player.armour = 100;
          this.prevHp = 100; this.prevArmor = 100;
          this.player.frozen = false; // regain control
          this.weapon.disabled = false;
          this.weapon.resetAllAmmo();
        } else {
          const av = this.avatars.get(m.playerId);
          if (av) { av.setEnabled(true); av.root.position.copyFrom(pos); av.target.copyFrom(pos); }
        }
        break;
      }
      case "scores":
        this.blue = m.blue; this.red = m.red; this.round = m.round;
        break;
      case "matchEnd":
        this.ended = true;
        this.showMatchEnd(m.winner, m.blue, m.red, m.results);
        break;
    }
  }

  update(dt: number): void {
    if (this.ended) return;
    for (const av of this.avatars.values()) av.interpolate(dt);
    // broadcast local state ~20Hz
    this.sendAccum += dt;
    if (this.sendAccum >= 0.05) {
      this.sendAccum = 0;
      const pos = this.player.position;
      const base = IRON_CITADEL_BASE;
      let flags = 0;
      if (this.player.sprinting) flags |= NetFlag.Sprint;
      if (this.player.crouching) flags |= NetFlag.Crouch;
      if (this.weapon.isAiming) flags |= NetFlag.Ads;
      if (this.weapon.isReloading) flags |= NetFlag.Reloading;
      if (this.player.health <= 0) flags |= NetFlag.Dead;
      this.net.send({
        t: "state",
        p: { x: (pos.x - base.x) / S, y: pos.y, z: (pos.z - base.z) / S, yaw: this.player.yaw, pitch: this.player.camera.rotation.x, flags, weapon: 0, hp: this.player.health, armor: this.player.armour },
      });
    }
    // timer
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.updateTopHud();
    // Refresh the persistent top-left scoreboard at ~5Hz (scores/ping/alive change).
    this.scoreboardAccum += dt;
    if (this.scoreboardAccum >= 0.2) { this.scoreboardAccum = 0; this.renderScoreboard(); }
    // Drive the full combat HUD (health/armour/ammo/hitmarker/vignette/blood/
    // directional indicators) — main's loop skips hud.update in this mode.
    this.hud.update(this.isPointerLocked(), [], null, [], null);
  }

  // ---- HUD -----------------------------------------------------------------
  private buildHud(parent: HTMLElement): HTMLDivElement {
    const el = document.createElement("div");
    el.style.cssText =
      "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:55;display:flex;gap:22px;align-items:center;" +
      "font-family:Consolas,monospace;background:rgba(10,14,10,0.7);border:1px solid #3c4a34;padding:6px 18px;color:#cfe6c0;";
    parent.appendChild(el);
    return el;
  }
  private updateTopHud(): void {
    const mm = Math.floor(this.timeLeft / 60), ss = Math.floor(this.timeLeft % 60);
    const mode = this.info.settings.mode === "tdm" ? "TDM" : `ELIM R${this.round}`;
    this.topHud.innerHTML =
      `<span style="color:#6db4ff;font-size:20px;font-weight:bold">${this.blue}</span>` +
      `<span style="font-size:11px;letter-spacing:2px;color:#8fa47e">${mode}  ${mm}:${ss.toString().padStart(2, "0")}</span>` +
      `<span style="color:#ff8f7a;font-size:20px;font-weight:bold">${this.red}</span>`;
  }
  private showCenter(text: string, ms: number): void {
    const c = document.createElement("div");
    c.textContent = text;
    c.style.cssText = "position:fixed;top:42%;left:50%;transform:translate(-50%,-50%);z-index:58;color:#ff5b4d;font-family:Consolas,monospace;font-size:34px;letter-spacing:4px;text-shadow:0 2px 8px #000";
    document.body.appendChild(c);
    setTimeout(() => c.remove(), ms);
  }

  // ---- scoreboard (persistent, top-left) ----------------------------------
  // Always visible in the top-left corner (Tab is reserved for another use), so
  // both teams' K/D and score are readable at a glance without an overlay.
  private buildScoreboard(parent: HTMLElement): HTMLDivElement {
    const el = document.createElement("div");
    el.style.cssText =
      "position:fixed;top:52px;left:10px;z-index:56;font-family:Consolas,monospace;font-size:12px;" +
      "background:rgba(10,14,10,0.72);border:1px solid #3c4a34;padding:8px 10px;color:#cfe6c0;min-width:220px;pointer-events:none;";
    parent.appendChild(el);
    return el;
  }
  private renderScoreboard(): void {
    const rows = (team: Team) => {
      const players = this.roster.filter((p) => p.team === team);
      return players
        .map((p) => {
          const av = this.avatars.get(p.id);
          const ping = p.id === this.net.playerId ? this.net.ping : (av?.info.ping ?? 0);
          const num = this.roster.findIndex((x) => x.id === p.id) + 1;
          const dead = p.id === this.net.playerId ? this.player.health <= 0 : (av?.dead ?? false);
          const meMark = p.id === this.net.playerId ? "background:rgba(255,255,255,0.08);" : "";
          const op = dead ? "opacity:0.45;" : "";
          return `<tr style="${meMark}${op}"><td class="no">${num}</td><td class="nm">${p.rankInsignia} ${p.name}</td><td class="pg">${ping}ms</td></tr>`;
        })
        .join("");
    };
    const mode = this.info.settings.mode === "tdm" ? "TDM" : `ELIM R${this.round}`;
    this.scoreboard.innerHTML =
      `<style>.sb td{padding:1px 6px}.sb .no{color:#8fa47e}.sb .nm{color:#eaffdc}.sb .pg{color:#8fa47e;text-align:right}</style>
       <div style="display:flex;justify-content:space-between;letter-spacing:1px;margin-bottom:5px;font-size:11px">
         <span style="color:#6db4ff;font-weight:bold">BLUE ${this.blue}</span>
         <span style="color:#8fa47e">${mode}</span>
         <span style="color:#ff8f7a;font-weight:bold">RED ${this.red}</span></div>
       <table class="sb" style="width:100%;border-collapse:collapse">
       <tr><td colspan="3" style="color:#6db4ff;font-size:9px;letter-spacing:2px;padding-top:2px">BLUE</td></tr>${rows("blue")}
       <tr><td colspan="3" style="color:#ff8f7a;font-size:9px;letter-spacing:2px;padding-top:4px">RED</td></tr>${rows("red")}
       </table>`;
  }

  private showMatchEnd(winner: Team | "draw", blue: number, red: number, results: MatchPlayerResult[]): void {
    const me = results.find((r) => r.id === this.net.playerId);
    const won = winner !== "draw" && me && winner === me.team;
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:62;display:flex;align-items:center;justify-content:center;background:rgba(6,9,7,0.9);font-family:Consolas,monospace;color:#cfe6c0";
    const acc = me && me.shotsFired > 0 ? Math.round((me.shotsHit / me.shotsFired) * 100) : 0;
    overlay.innerHTML =
      `<div style="text-align:center;min-width:460px">
        <div style="font-size:38px;letter-spacing:6px;color:${winner === "draw" ? "#e8c86a" : won ? "#6ee06e" : "#ff5b4d"}">${winner === "draw" ? "DRAW" : won ? "VICTORY" : "DEFEAT"}</div>
        <div style="font-size:22px;margin:6px 0 18px"><span style="color:#6db4ff">BLUE ${blue}</span>  —  <span style="color:#ff8f7a">${red} RED</span></div>
        ${me ? `<div style="font-size:13px;color:#8fa47e;letter-spacing:1px;margin-bottom:16px">YOUR MATCH${me.mvp ? " · ★ MVP" : ""}<br><br>Kills ${me.kills} · Deaths ${me.deaths} · Assists ${me.assists}<br>Headshots ${me.headshots} · Damage ${Math.round(me.damage)} · Accuracy ${acc}%</div>` : ""}
        <div id="mp-rewards" style="font-size:12px;color:#e8c86a;letter-spacing:1px;min-height:18px;margin-bottom:14px">Recording match…</div>
        <button id="mp-end-btn" style="background:#3f6b2f;color:#eaffdc;border:1px solid #5c9a45;padding:12px 26px;font-family:inherit;letter-spacing:2px;cursor:pointer">RETURN TO LOBBY</button>
      </div>`;
    document.body.appendChild(overlay);
    document.exitPointerLock();
    overlay.querySelector("#mp-end-btn")?.addEventListener("click", () => { overlay.remove(); this.exit(); });
    // Persist result → XP / currency / rank / badges (server-authoritative).
    const rewardsEl = overlay.querySelector("#mp-rewards") as HTMLElement | null;
    if (me && this.onSubmitResult) {
      this.onSubmitResult({ mode: this.info.settings.mode, won: !!won, result: me })
        .then((r) => {
          if (!rewardsEl) return;
          if (!r) { rewardsEl.textContent = ""; return; }
          rewardsEl.innerHTML = `+${r.xpGained} XP · +$${r.currency}${r.rankUp ? ` · PROMOTED → ${r.rankUp.to}` : ""}`;
        })
        .catch(() => { if (rewardsEl) rewardsEl.textContent = ""; });
    } else if (rewardsEl) {
      rewardsEl.textContent = "";
    }
  }

  exit(): void {
    this.dispose();
    this.onExit?.();
  }

  dispose(): void {
    this.ended = true;
    this.off?.();
    for (const av of this.avatars.values()) av.dispose();
    this.avatars.clear();
    this.topHud.remove();
    this.scoreboard.remove();
    // Ensure control is restored if the match ends while the local player is dead.
    this.player.frozen = false;
    this.weapon.disabled = false;
    const wc = this.weapon as unknown as { callbacks?: { onFire?: (w: unknown) => void } };
    if (wc.callbacks) wc.callbacks.onFire = this.prevOnFire;
  }
}
