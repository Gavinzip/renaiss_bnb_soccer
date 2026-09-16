import {
  BufferGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const FULL_ARTWORK_UV = [
  0, 1,
  0, 0,
  1, 0,
  1, 1,
];

function createQuad(name, positions, uvs, material) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions.flat(), 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();

  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

/**
 * Creates an intentionally pseudo-3D prize box: the user-approved top photo
 * remains factual, while unseen sides are simple neutral carton material.
 * It is interactive, but does not claim to reconstruct hidden package art.
 */
export function createPokemon30SealedBoosterBoxModel(referenceTexture) {
  const root = new Group();
  root.name = "pokemon30-sealed-booster-box-root";
  root.userData.sculptRuntime = {
    pivots: ["pokemon30-sealed-booster-box-root", "booster-box-shell"],
    sockets: { lidEdge: "lid-to-front-seam" },
    colliders: ["booster-box-shell"],
    destructionGroups: [],
  };

  const width = 6.42;
  const height = 0.76;
  const depth = 6.42;
  const topY = height / 2;
  root.position.y = height / 2;

  const cartonMaterial = new MeshPhysicalMaterial({
    color: "#152b59",
    roughness: 0.76,
    metalness: 0,
    clearcoat: 0.04,
    clearcoatRoughness: 0.72,
  });
  const carton = new Mesh(
    new RoundedBoxGeometry(width, height, depth, 7, 0.12),
    cartonMaterial,
  );
  carton.name = "booster-box-shell";
  carton.castShadow = true;
  carton.receiveShadow = true;
  root.add(carton);

  referenceTexture.anisotropy = Math.max(referenceTexture.anisotropy, 12);

  const printedTop = createQuad(
    "printed-top-artwork",
    [
      [-width / 2, topY + 0.014, -depth / 2],
      [-width / 2, topY + 0.014, depth / 2],
      [width / 2, topY + 0.014, depth / 2],
      [width / 2, topY + 0.014, -depth / 2],
    ],
    FULL_ARTWORK_UV,
    new MeshBasicMaterial({ map: referenceTexture, toneMapped: false, side: FrontSide }),
  );
  root.add(printedTop);

  return root;
}
