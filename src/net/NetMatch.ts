import { Scene, MeshBuilder, StandardMaterial, Color3, Vector3, Mesh, DynamicTexture, TransformNode } from "@babylonjs/core";
import type { NetClient } from "@/net/NetClient";
import type { PlayerController } from "@/player/PlayerController";
import type { WeaponController } from "@/weapons/WeaponController";
import type { MatchStartInfo } from "@/ui/MultiplayerMenu";
import type { PlayerNetState, ServerMsg, Team, LobbyPlayer, MatchPlayerResult } from "@/net/protocol";
import { NetFlag } from "@/net/protocol";
import { IRON_CITADEL_BASE } from "@/world/IronCitadel";

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
    const uniform = mat(`av_uni_${info.id}`, teamColor, 0.22);
    const gear = mat(`av_gear_${info.id}`, teamColor.scale(0.45), 0.05);
    const skin = mat(`av_skin_${info.id}`, new Color3(0.62, 0.46, 0.36), 0.05);
    const helmetMat = mat(`av_hel_${info.id}`, teamColor.scale(0.6), 0.1);
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
    // torso + plate carrier (hittable body)
    box("body", 0.56, 1.0, 0.36, 0.98, uniform, "body");
    box("vest", 0.54, 0.58, 0.16, 1.06, gear);
    // shoulders + arms + hands
    box("shoulders", 0.66, 0.16, 0.38, 1.42, uniform);
    for (const x of [-0.36, 0.36]) {
      const arm = box("arm", 0.16, 0.66, 0.2, 1.06, uniform, "limb");
      arm.position.x = x;
      const hand = MeshBuilder.CreateBox(`${info.id}_hand`, { width: 0.13, height: 0.14, depth: 0.15 }, scene);
      hand.position.set(x, 0.72, 0.06); hand.material = gear; hand.parent = this.model; hand.isPickable = false;
    }
    // legs + boots
    for (const x of [-0.15, 0.15]) {
      const leg = box("leg", 0.2, 0.78, 0.24, 0.42, uniform, "limb");
      leg.position.x = x;
      const boot = MeshBuilder.CreateBox(`${info.id}_boot`, { width: 0.22, height: 0.14, depth: 0.3 }, scene);
      boot.position.set(x, 0.07, 0.05); boot.material = gear; boot.parent = this.model; boot.isPickable = false;
    }
    // neck + head (headshot) + helmet + team band
    const neck = MeshBuilder.CreateCylinder(`${info.id}_neck`, { diameter: 0.15, height: 0.12 }, scene);
    neck.position.y = 1.52; neck.material = skin; neck.parent = this.model; neck.isPickable = false;
    box("head", 0.27, 0.3, 0.27, 1.67, skin, "head", true);
    const helmet = MeshBuilder.CreateSphere(`${info.id}_helmet`, { diameter: 0.34, slice: 0.62 }, scene);
    helmet.position.y = 1.78; helmet.material = helmetMat; helmet.parent = this.model; helmet.isPickable = false;
    const band = MeshBuilder.CreateTorus(`${info.id}_band`, { diameter: 0.33, thickness: 0.035, tessellation: 12 }, scene);
    band.position.y = 1.72; band.rotation.x = Math.PI / 2; band.material = numMat; band.parent = this.model; band.isPickable = false;

    // roster number: on the chest and the helmet front + a rifle prop.
    const chestNum = MeshBuilder.CreatePlane(`${info.id}_cn`, { width: 0.34, height: 0.34 }, scene);
    chestNum.position.set(0, 1.12, 0.28); chestNum.material = numMat; chestNum.parent = this.model; chestNum.isPickable = false;
    const helmNum = MeshBuilder.CreatePlane(`${info.id}_hn`, { width: 0.18, height: 0.18 }, scene);
    helmNum.position.set(0, 1.8, 0.2); helmNum.material = numMat; helmNum.parent = this.model; helmNum.isPickable = false;
    const rifle = MeshBuilder.CreateBox(`${info.id}_rifle`, { width: 0.08, height: 0.12, depth: 0.7 }, scene);
    rifle.position.set(0.28, 1.02, 0.35); rifle.material = gear; rifle.parent = this.model; rifle.isPickable = false;

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
    this.target.set(this.base.x + s.x, s.y, this.base.z + s.z);
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
  private myArmor = 100;
  private hud: HTMLDivElement;
  private scoreboard: HTMLDivElement;
  private roster: LobbyPlayer[];
  private prevOnFire?: (w: unknown) => void;

  onExit?: () => void;
  /** Persist the local player's result (XP/currency/rank/badges) — wired to the backend by main. */
  onSubmitResult?: (r: { mode: "tdm" | "elim"; won: boolean; result: MatchPlayerResult }) => Promise<{ xpGained: number; currency: number; rankUp: { from: string; to: string } | null } | null>;

  constructor(
    private readonly scene: Scene,
    private readonly player: PlayerController,
    private readonly weapon: WeaponController,
    private readonly net: NetClient,
    private readonly info: MatchStartInfo,
    parent: HTMLElement,
  ) {
    this.roster = info.players;
    this.timeLeft = info.settings.timeLimitSec;
    const base = IRON_CITADEL_BASE;
    // place local player at spawn
    player.respawn(new Vector3(base.x + info.spawn.x, info.spawn.y, base.z + info.spawn.z));
    player.inSafeZone = false;
    (player as unknown as { spawnProtected: boolean }).spawnProtected = false;

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
    this.hud = this.buildHud(parent);
    this.scoreboard = this.buildScoreboard(parent);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
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
        this.player.health = m.hp;
        this.myArmor = m.armor;
        this.player.shakeCamera(20);
        break;
      }
      case "kill":
        if (m.victimId === this.net.playerId) {
          this.player.health = 0;
          this.showCenter(m.killerId ? "ELIMINATED" : "DOWN", 2500);
        }
        this.avatars.get(m.victimId)?.setState({ id: m.victimId, x: 0, y: -50, z: 0, yaw: 0, pitch: 0, flags: NetFlag.Dead, weapon: 0, hp: 0, armor: 0 });
        break;
      case "respawn": {
        const base = IRON_CITADEL_BASE;
        const pos = new Vector3(base.x + m.spawn.x, m.spawn.y, base.z + m.spawn.z);
        if (m.playerId === this.net.playerId) {
          this.player.respawn(pos);
          this.player.health = 100;
          this.myArmor = 100;
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
        p: { x: pos.x - base.x, y: pos.y, z: pos.z - base.z, yaw: this.player.yaw, pitch: this.player.camera.rotation.x, flags, weapon: 0, hp: this.player.health, armor: this.myArmor },
      });
    }
    // timer
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.updateHud();
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
  private updateHud(): void {
    const mm = Math.floor(this.timeLeft / 60), ss = Math.floor(this.timeLeft % 60);
    const mode = this.info.settings.mode === "tdm" ? "TDM" : `ELIM R${this.round}`;
    this.hud.innerHTML =
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

  // ---- scoreboard (hold Tab) ----------------------------------------------
  private buildScoreboard(parent: HTMLElement): HTMLDivElement {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;inset:0;z-index:57;display:none;align-items:center;justify-content:center;background:rgba(6,9,7,0.5);font-family:Consolas,monospace;";
    parent.appendChild(el);
    return el;
  }
  private renderScoreboard(results?: MatchPlayerResult[]): void {
    const rows = (team: Team) => {
      const players = this.roster.filter((p) => p.team === team);
      return players
        .map((p) => {
          const r = results?.find((x) => x.id === p.id);
          const av = this.avatars.get(p.id);
          const ping = p.id === this.net.playerId ? this.net.ping : (av?.info.ping ?? 0);
          const num = this.roster.findIndex((x) => x.id === p.id) + 1;
          const meMark = p.id === this.net.playerId ? ' style="background:rgba(255,255,255,0.06)"' : "";
          return `<tr${meMark}><td class="no">${num}</td><td class="ins">${p.rankInsignia}</td><td class="nm">${p.name}${r?.mvp ? " ★" : ""}</td><td>${r?.kills ?? 0}</td><td>${r?.deaths ?? 0}</td><td>${r?.assists ?? 0}</td><td>${ping}ms</td></tr>`;
        })
        .join("");
    };
    this.scoreboard.innerHTML =
      `<div style="background:rgba(16,22,16,0.97);border:1px solid #3c4a34;padding:20px 26px;min-width:520px;color:#cfe6c0">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px"><span style="color:#6db4ff;letter-spacing:2px">BLUE ${this.blue}</span><span style="color:#8fa47e">${this.info.settings.mode === "tdm" ? "TEAM DEATHMATCH" : "ELIMINATION"}</span><span style="color:#ff8f7a;letter-spacing:2px">RED ${this.red}</span></div>
        <style>.sb td{padding:4px 10px;font-size:13px}.sb th{color:#8fa47e;font-size:10px;letter-spacing:1px;text-align:left;padding:0 10px}.sb .ins{color:#d8f0c0}.sb .nm{color:#eaffdc}.sbh{color:#6db4ff}.sbr{color:#ff8f7a}</style>
        <table class="sb" style="width:100%;border-collapse:collapse"><tr><th>RANK</th><th>PLAYER</th><th>K</th><th>D</th><th>A</th><th>PING</th></tr>
        <tr><td colspan="6" class="sbh" style="font-size:10px;letter-spacing:2px;padding-top:8px">BLUE TEAM</td></tr>${rows("blue")}
        <tr><td colspan="6" class="sbr" style="font-size:10px;letter-spacing:2px;padding-top:8px">RED TEAM</td></tr>${rows("red")}
        </table>
      </div>`;
  }
  private onKey = (e: KeyboardEvent): void => {
    if (e.code !== "Tab") return;
    e.preventDefault();
    if (e.type === "keydown") { this.renderScoreboard(); this.scoreboard.style.display = "flex"; }
    else this.scoreboard.style.display = "none";
  };

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
    this.hud.remove();
    this.scoreboard.remove();
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    const wc = this.weapon as unknown as { callbacks?: { onFire?: (w: unknown) => void } };
    if (wc.callbacks) wc.callbacks.onFire = this.prevOnFire;
  }
}
