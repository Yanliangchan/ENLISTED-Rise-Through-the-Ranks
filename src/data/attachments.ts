/**
 * attachments.ts — AUTHORITATIVE ATTACHMENT DATA
 *
 * Each attachment fits one AttachmentSlot and applies stat DELTAS (added to the
 * weapon's base stats) plus optional flags. `compatibleWith` lists weapon ids;
 * an empty array means "any weapon that exposes the matching slot".
 *
 * SAR 21 progression note: the `rail_prail` (P-Rail) unlocks the optic/underbarrel
 * slots on the SAR 21 — mirrors the real modular rail. Gate SAR 21 optics behind it.
 */

import type { AttachmentSlot } from "./weapons";

export interface AttachmentDeltas {
  damage?: number;
  adsTimeSec?: number; // negative = faster
  recoilVertical?: number;
  recoilHorizontal?: number;
  spreadHip?: number;
  spreadAds?: number;
  magSize?: number;
  reloadTimeSec?: number;
  effectiveRangeM?: number;
  moveSpeedMult?: number; // additive to the multiplier
}

export interface Attachment {
  id: string;
  name: string;
  slot: AttachmentSlot;
  compatibleWith: string[]; // weapon ids; [] = any with the slot
  price: number;
  zoom?: number; // optic magnification; 1 = none
  deltas: AttachmentDeltas;
  /** Special behaviour flags for game logic to read. */
  flags?: {
    unlocksSlots?: AttachmentSlot[]; // e.g. P-Rail unlocks optic/underbarrel
    suppressed?: boolean; // no muzzle flash, reduced AI hearing
    grenadeLauncher?: boolean; // underslung 40mm GL (secondary fire)
    bipod?: boolean; // huge recoil/spread cut when deployed prone/crouched
    laser?: boolean; // tighter hipfire
  };
  realNotes?: string;
}

export const ATTACHMENTS: Record<string, Attachment> = {
  // --- SAR 21 rail (gates its optics) ---
  rail_prail: {
    id: "rail_prail",
    name: "SAR 21 P-Rail",
    slot: "rail",
    compatibleWith: ["sar21"],
    price: 200,
    deltas: {},
    flags: { unlocksSlots: ["optic", "underbarrel"] },
    realNotes: "Real SAR 21 variant. Adds Picatinny rail so optics/underbarrel can be fitted.",
  },

  // --- Optics ---
  optic_sar21_1_5x: {
    id: "optic_sar21_1_5x",
    name: "1.5× Integral Optic",
    slot: "optic",
    compatibleWith: ["sar21"],
    price: 0,
    zoom: 1.5,
    deltas: {},
    realNotes: "SAR 21 factory integral 1.5x sight. Default.",
  },
  optic_red_dot: {
    id: "optic_red_dot",
    name: "Red Dot",
    slot: "optic",
    compatibleWith: [],
    price: 300,
    zoom: 1.15,
    deltas: { adsTimeSec: -0.03, spreadAds: -0.02 },
  },
  optic_holo: {
    id: "optic_holo",
    name: "Holographic",
    slot: "optic",
    compatibleWith: [],
    price: 350,
    zoom: 1.2,
    deltas: { adsTimeSec: -0.02 },
  },
  optic_sharpshooter_3x: {
    id: "optic_sharpshooter_3x",
    name: "3× Sharpshooter",
    slot: "optic",
    compatibleWith: ["sar21", "br18"],
    price: 600,
    zoom: 3.0,
    deltas: { adsTimeSec: 0.05, effectiveRangeM: 40 },
    realNotes: "Mirrors the SAR 21 Sharpshooter variant's 3x optic.",
  },

  optic_lpvo_1_6x: {
    id: "optic_lpvo_1_6x",
    name: "LPVO 1–6×",
    slot: "optic",
    compatibleWith: ["br18", "iar6940"],
    price: 900,
    zoom: 6.0, // variable; game can toggle 1x/6x
    deltas: { adsTimeSec: 0.04, effectiveRangeM: 50 },
  },
  optic_variable_3_9x: {
    id: "optic_variable_3_9x",
    name: "Variable 3–9×",
    slot: "optic",
    compatibleWith: ["m110"],
    price: 0,
    zoom: 9.0,
    deltas: { effectiveRangeM: 100 },
  },
  optic_precision_5_25x: {
    id: "optic_precision_5_25x",
    name: "Precision 5–25×",
    slot: "optic",
    compatibleWith: ["trg22"],
    price: 0,
    zoom: 25.0,
    deltas: { effectiveRangeM: 200 },
  },
  optic_micro_rds: {
    id: "optic_micro_rds",
    name: "Micro Red Dot",
    slot: "optic",
    compatibleWith: ["p30"],
    price: 250,
    zoom: 1.1,
    deltas: { adsTimeSec: -0.02 },
  },

  // --- Muzzle ---
  muzzle_flash_hider: {
    id: "muzzle_flash_hider",
    name: "Flash Hider",
    slot: "muzzle",
    compatibleWith: [],
    price: 200,
    deltas: { recoilVertical: -0.1 },
  },
  muzzle_suppressor: {
    id: "muzzle_suppressor",
    name: "Suppressor",
    slot: "muzzle",
    compatibleWith: [],
    price: 500,
    deltas: { damage: -2, effectiveRangeM: -20 },
    flags: { suppressed: true },
    realNotes: "No muzzle flash; reduces the range at which enemy AI hears your shots.",
  },

  // --- Laser ---
  laser_lad: {
    id: "laser_lad",
    name: "Laser Aiming Device (LAD)",
    slot: "laser",
    compatibleWith: [],
    price: 300,
    deltas: { spreadHip: -0.8 },
    flags: { laser: true },
    realNotes: "SAR 21 issues a LAD (visible/IR). Tightens hipfire.",
  },

  // --- Magazine ---
  mag_extended: {
    id: "mag_extended",
    name: "Extended Magazine",
    slot: "magazine",
    compatibleWith: [],
    price: 400,
    deltas: { magSize: 10, reloadTimeSec: 0.2 },
  },
  mag_p30_extended: {
    id: "mag_p30_extended",
    name: "P30 +3 Extended Mag",
    slot: "magazine",
    compatibleWith: ["p30"],
    price: 250,
    deltas: { magSize: 3 },
  },
};
