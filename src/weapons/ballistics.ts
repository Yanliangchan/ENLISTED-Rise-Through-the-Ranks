import type { Weapon, DamageFalloff } from "@/data/weapons";
import { ATTACHMENTS, type AttachmentDeltas } from "@/data/attachments";

export interface EffectiveStats {
  damage: number;
  adsTimeSec: number;
  recoilVertical: number;
  recoilHorizontal: number;
  spreadHip: number;
  spreadAds: number;
  magSize: number;
  reloadTimeSec: number;
  effectiveRangeM: number;
  moveSpeedMult: number;
  suppressed: boolean;
  hasBipod: boolean;
  hasLaser: boolean;
  hasGrenadeLauncher: boolean;
  zoom: number;
  fittedAttachmentIds: string[];
}

/** Fold a weapon's fitted attachments into one effective-stats snapshot. */
export function computeEffectiveStats(weapon: Weapon, fittedAttachmentIds: string[]): EffectiveStats {
  const stats: EffectiveStats = {
    damage: weapon.damage,
    adsTimeSec: weapon.adsTimeSec,
    recoilVertical: weapon.recoil.vertical,
    recoilHorizontal: weapon.recoil.horizontal,
    spreadHip: weapon.spread.hip,
    spreadAds: weapon.spread.ads,
    magSize: weapon.magSize,
    reloadTimeSec: weapon.reloadTimeSec,
    effectiveRangeM: weapon.effectiveRangeM,
    moveSpeedMult: weapon.moveSpeedMult,
    suppressed: false,
    hasBipod: false,
    hasLaser: false,
    hasGrenadeLauncher: false,
    zoom: 1,
    fittedAttachmentIds: [...fittedAttachmentIds],
  };

  for (const id of fittedAttachmentIds) {
    const attachment = ATTACHMENTS[id];
    if (!attachment) continue;
    applyDeltas(stats, attachment.deltas);
    if (attachment.zoom) stats.zoom = attachment.zoom;
    if (attachment.flags?.suppressed) stats.suppressed = true;
    if (attachment.flags?.bipod) stats.hasBipod = true;
    if (attachment.flags?.laser) stats.hasLaser = true;
    if (attachment.flags?.grenadeLauncher) stats.hasGrenadeLauncher = true;
  }

  return stats;
}

function applyDeltas(stats: EffectiveStats, deltas: AttachmentDeltas): void {
  if (deltas.damage) stats.damage += deltas.damage;
  if (deltas.adsTimeSec) stats.adsTimeSec = Math.max(0.05, stats.adsTimeSec + deltas.adsTimeSec);
  if (deltas.recoilVertical) stats.recoilVertical = Math.max(0, stats.recoilVertical + deltas.recoilVertical);
  if (deltas.recoilHorizontal) stats.recoilHorizontal = Math.max(0, stats.recoilHorizontal + deltas.recoilHorizontal);
  if (deltas.spreadHip) stats.spreadHip = Math.max(0, stats.spreadHip + deltas.spreadHip);
  if (deltas.spreadAds) stats.spreadAds = Math.max(0, stats.spreadAds + deltas.spreadAds);
  if (deltas.magSize) stats.magSize += deltas.magSize;
  if (deltas.reloadTimeSec) stats.reloadTimeSec = Math.max(0.2, stats.reloadTimeSec + deltas.reloadTimeSec);
  if (deltas.effectiveRangeM) stats.effectiveRangeM += deltas.effectiveRangeM;
  if (deltas.moveSpeedMult) stats.moveSpeedMult += deltas.moveSpeedMult;
}

/** Linear falloff from full damage at `startM` to `minMultiplier` by `endM`. */
export function damageAtRange(baseDamage: number, distanceM: number, falloff: DamageFalloff): number {
  if (distanceM <= falloff.startM) return baseDamage;
  if (distanceM >= falloff.endM) return baseDamage * falloff.minMultiplier;
  const t = (distanceM - falloff.startM) / (falloff.endM - falloff.startM);
  const mult = 1 - t * (1 - falloff.minMultiplier);
  return baseDamage * mult;
}

/** Blast damage falls off linearly from centre to 0 at radiusM. */
export function blastDamageAtDistance(centreDamage: number, distanceM: number, radiusM: number): number {
  if (distanceM >= radiusM) return 0;
  const t = distanceM / radiusM;
  return centreDamage * (1 - t);
}
