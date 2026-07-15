import { LoadAssetContainerAsync, type AssetContainer, type Scene } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

/**
 * Optional `.glb` asset loading with graceful fallback to the game's built-in
 * procedural models. Every model is optional: if the file isn't present (the
 * default — the repo ships no binary assets), the caller keeps its procedural
 * geometry and nothing is logged. Drop real CC0 `.glb` files into
 * `public/models/…` (see that folder's README) and they load automatically.
 *
 * A HEAD request gates the actual import so a missing file is a silent no-op
 * rather than a noisy loader 404 in the console.
 */
const containerCache = new Map<string, Promise<AssetContainer | null>>();

async function fileExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Loads a `.glb` as an AssetContainer (so it can be instantiated many times —
 * e.g. one HDB model reused across every HDB tower). Returns null if the file
 * is absent or fails to load. Cached per path so each asset is fetched once.
 */
export function loadGlbContainerOrNull(scene: Scene, path: string): Promise<AssetContainer | null> {
  let cached = containerCache.get(path);
  if (!cached) {
    cached = (async () => {
      if (!(await fileExists(path))) return null;
      try {
        return await LoadAssetContainerAsync(path, scene);
      } catch {
        return null;
      }
    })();
    containerCache.set(path, cached);
  }
  return cached;
}
