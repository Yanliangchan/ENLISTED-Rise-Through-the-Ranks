import { registerLookdevAsset } from "@/lookdev";
import { buildSar21Model } from "@/weapons/models/sar21";

/** Benchmark assets visible in lookdev before (or after) they're wired into the game. */
registerLookdevAsset("sar21_new", (scene) => buildSar21Model(scene, "sar21"));
registerLookdevAsset("sar21_bare", (scene) => buildSar21Model(scene, "sar21", false));
