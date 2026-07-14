import type { Weapon, AttachmentSlot } from "@/data/weapons";
import { ATTACHMENTS } from "@/data/attachments";

/**
 * Which of a weapon's `attachmentSlots` are actually fittable right now.
 * Mirrors the SAR 21 P-Rail: its optic/underbarrel slots stay locked until
 * an attachment with `flags.unlocksSlots` (the P-Rail) is fitted.
 */
export function getUnlockedSlots(weapon: Weapon, fittedAttachmentIds: string[]): AttachmentSlot[] {
  const gatedSlots: AttachmentSlot[] = [];
  for (const id of fittedAttachmentIds) {
    const attachment = ATTACHMENTS[id];
    if (attachment?.flags?.unlocksSlots) gatedSlots.push(...attachment.flags.unlocksSlots);
  }

  const requiresGating = weapon.attachmentSlots.includes("rail");
  if (!requiresGating) return weapon.attachmentSlots;

  return weapon.attachmentSlots.filter((slot) => {
    if (slot === "rail") return true;
    if (slot === "optic" || slot === "underbarrel") return gatedSlots.includes(slot);
    return true;
  });
}

export function isAttachmentCompatible(weapon: Weapon, attachmentId: string): boolean {
  const attachment = ATTACHMENTS[attachmentId];
  if (!attachment) return false;
  if (!weapon.attachmentSlots.includes(attachment.slot)) return false;
  if (attachment.compatibleWith.length === 0) return true;
  return attachment.compatibleWith.includes(weapon.id);
}
