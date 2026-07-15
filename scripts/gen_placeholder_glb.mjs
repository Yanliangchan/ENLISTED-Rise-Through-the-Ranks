/**
 * Generates a real (but placeholder) HDB-tower .glb so the .glb loading
 * pipeline can be verified end-to-end without downloading anything. This is
 * NOT an accurate model — it's a unit-cube-footprint slab with balcony
 * banding, meant to be replaced by a real CC0 Singapore-HDB model dropped in
 * at the same path (public/models/buildings/hdb.glb). All geometry is built
 * to a 1x1 footprint and ~1 tall so the game can scale it to each building.
 */
import { NullEngine, Scene, MeshBuilder, StandardMaterial, Color3, Vector3 } from "@babylonjs/core";
import { GLTF2Export } from "@babylonjs/serializers";
import { writeFileSync } from "node:fs";

const engine = new NullEngine();
const scene = new Scene(engine);

const wall = new StandardMaterial("wall", scene);
wall.diffuseColor = new Color3(0.72, 0.72, 0.7);
const accent = new StandardMaterial("accent", scene);
accent.diffuseColor = new Color3(0.35, 0.5, 0.62);

// Body: 1x1 footprint, 1 tall, origin at base centre.
const body = MeshBuilder.CreateBox("hdb_body", { width: 1, height: 1, depth: 1 }, scene);
body.position = new Vector3(0, 0.5, 0);
body.material = wall;

// Balcony bands up the face.
for (let i = 1; i <= 5; i++) {
  const band = MeshBuilder.CreateBox(`hdb_band_${i}`, { width: 1.02, height: 0.03, depth: 1.02 }, scene);
  band.position = new Vector3(0, i / 6, 0);
  band.material = accent;
}
// Roof trim.
const roof = MeshBuilder.CreateBox("hdb_roof", { width: 1.04, height: 0.03, depth: 1.04 }, scene);
roof.position = new Vector3(0, 1.0, 0);
roof.material = accent;

const glb = await GLTF2Export.GLBAsync(scene, "hdb");
const blob = glb.glTFFiles["hdb.glb"];
const buf = Buffer.from(await blob.arrayBuffer());
writeFileSync("public/models/buildings/hdb.glb", buf);
console.log("wrote public/models/buildings/hdb.glb", buf.length, "bytes");
