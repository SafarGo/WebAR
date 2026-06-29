import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AnchorEdge, ModelRotationOffset } from "../data/clothes";

const loader = new GLTFLoader();
const sourceCache = new Map<string, THREE.Group>();

/** Загружает (с кэшем) исходную сцену .glb без какой-либо обработки. */
export async function loadGarmentSource(url: string): Promise<THREE.Group> {
  let source = sourceCache.get(url);
  if (!source) {
    const gltf = await loader.loadAsync(url);
    source = gltf.scene;
    sourceCache.set(url, source);
  }
  return source;
}

/**
 * Строит "pivot" из уже загруженной сцены: применяет корректирующий поворот
 * (если модель экспортирована в "неправильной" ориентации), затем выставляет
 * origin (0,0,0) на нужный край bounding box — ПОСЛЕ поворота, поэтому
 * ширина/высота для fitScale считаются уже с учётом коррекции.
 */
export function buildPivot(
  source: THREE.Group,
  anchorEdge: AnchorEdge = "top",
  rotationOffsetDeg: ModelRotationOffset = {}
): THREE.Group {
  const mesh = source.clone(true);

  mesh.rotation.set(
    THREE.MathUtils.degToRad(rotationOffsetDeg.x ?? 0),
    THREE.MathUtils.degToRad(rotationOffsetDeg.y ?? 0),
    THREE.MathUtils.degToRad(rotationOffsetDeg.z ?? 0)
  );
  mesh.updateMatrixWorld(true);

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