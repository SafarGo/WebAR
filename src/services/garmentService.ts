import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AnchorEdge } from "../data/clothes";

const loader = new GLTFLoader();
const sourceCache = new Map<string, THREE.Group>();

/**
 * Загружает glb (с кэшем по url) и возвращает "pivot" — группу,
 * у которой origin (0,0,0) совмещён с указанным краем bounding box модели.
 */
export async function loadGarmentPivot(
  url: string,
  anchorEdge: AnchorEdge = "top"
): Promise<THREE.Group> {
  let source = sourceCache.get(url);

  if (!source) {
    const gltf = await loader.loadAsync(url);
    source = gltf.scene;
    sourceCache.set(url, source);
  }

  return buildPivot(source.clone(true), anchorEdge);
}

function buildPivot(mesh: THREE.Group, anchorEdge: AnchorEdge): THREE.Group {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  let anchorY: number;
  if (anchorEdge === "top") anchorY = box.max.y;
  else if (anchorEdge === "bottom") anchorY = box.min.y;
  else anchorY = center.y;

  mesh.position.set(-center.x, -anchorY, -center.z);

  const pivot = new THREE.Group();
  pivot.add(mesh);
  pivot.userData.naturalWidth = size.x || 1;
  pivot.userData.naturalHeight = size.y || 1;

  return pivot;
}