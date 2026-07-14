import {
  Scene,
  HemisphericLight,
  DirectionalLight,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
} from "@babylonjs/core";

/**
 * Milestone-1 blockout: a flat ground plane, a handful of collidable crates
 * for cover, and basic lighting. Stands in for the "urban strongpoint"
 * sector from the story until real level art/GLTF props replace it.
 */
export function buildLevel(scene: Scene): void {
  const hemi = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.65;

  const sun = new DirectionalLight("sunLight", new Vector3(-0.5, -1, 0.3), scene);
  sun.intensity = 0.9;

  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.28, 0.3, 0.27);
  groundMat.specularColor = Color3.Black();

  const ground = MeshBuilder.CreateGround("ground", { width: 200, height: 200 }, scene);
  ground.material = groundMat;
  ground.checkCollisions = true;

  const crateMat = new StandardMaterial("crateMat", scene);
  crateMat.diffuseColor = new Color3(0.4, 0.35, 0.25);
  crateMat.specularColor = Color3.Black();

  const crateLayout: Array<[number, number, number]> = [
    [4, 1, 4],
    [-6, 1, 8],
    [10, 1.5, -3],
    [-10, 1, -8],
    [0, 2, 15],
    [15, 1, 15],
  ];
  crateLayout.forEach(([x, halfHeight, z], i) => {
    const crate = MeshBuilder.CreateBox(
      `crate_${i}`,
      { width: 2, height: halfHeight * 2, depth: 2 },
      scene
    );
    crate.position.set(x, halfHeight, z);
    crate.material = crateMat;
    crate.checkCollisions = true;
  });

  const wallMat = new StandardMaterial("wallMat", scene);
  wallMat.diffuseColor = new Color3(0.5, 0.5, 0.52);
  wallMat.specularColor = Color3.Black();

  const perimeter: Array<[number, number, number, number, number]> = [
    // x, z, width, depth, rotationY
    [0, -100, 200, 1, 0],
    [0, 100, 200, 1, 0],
    [-100, 0, 1, 200, 0],
    [100, 0, 1, 200, 0],
  ];
  perimeter.forEach(([x, z, width, depth], i) => {
    const wall = MeshBuilder.CreateBox(`boundary_${i}`, { width, height: 6, depth }, scene);
    wall.position.set(x, 3, z);
    wall.material = wallMat;
    wall.checkCollisions = true;
    wall.isVisible = false; // invisible playspace boundary for Milestone 1
  });
}
