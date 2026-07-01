import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AnchorEdge, ModelRotationOffset } from "../data/clothes";

const loader = new GLTFLoader();
const sourceCache = new Map<string, THREE.Group>();

export async function loadGarmentSource(url: string): Promise<THREE.Group> {
  let source = sourceCache.get(url);
  if (!source) {
    const gltf = await loader.loadAsync(url);
    source = gltf.scene;
    sourceCache.set(url, source);
  }
  return source;
}

export function buildPivot(
  source: THREE.Group,
  anchorEdge: AnchorEdge = "top",
  rotationOffsetDeg: ModelRotationOffset = {}
): THREE.Group {
  const mesh = source.clone(true);

  // корректирующий поворот
  mesh.rotation.set(
    THREE.MathUtils.degToRad(rotationOffsetDeg.x ?? 0),
    THREE.MathUtils.degToRad(rotationOffsetDeg.y ?? 0),
    THREE.MathUtils.degToRad(rotationOffsetDeg.z ?? 0)
  );
  mesh.updateMatrixWorld(true);

  // первый bounding box — для нормализации
  const box1 = new THREE.Box3().setFromObject(mesh);
  const size1 = new THREE.Vector3();
  box1.getSize(size1);

  // 🔑 нормализуем модель в единичный куб
  // это убирает проблему единиц (см vs м vs условные единицы в GLB)
  const maxSize = Math.max(size1.x, size1.y, size1.z, 0.001);
  mesh.scale.setScalar(1 / maxSize);
  mesh.updateMatrixWorld(true);

  // второй bounding box — уже нормализованный
  const box2 = new THREE.Box3().setFromObject(mesh);
  const size2 = new THREE.Vector3();
  box2.getSize(size2);
  const center2 = new THREE.Vector3();
  box2.getCenter(center2);

  let anchorY: number;
  if (anchorEdge === "top") anchorY = box2.max.y;
  else if (anchorEdge === "bottom") anchorY = box2.min.y;
  else anchorY = center2.y;

  mesh.position.set(-center2.x, -anchorY, -center2.z);

  const pivot = new THREE.Group();
  pivot.add(mesh);

  // теперь naturalWidth и naturalHeight в диапазоне 0-1
  // fitScaleX/Y становятся понятными: 1.0 = модель точно по ширине плеч
  pivot.userData.naturalWidth = size2.x;
  pivot.userData.naturalHeight = size2.y;

  return pivot;
}