import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
const sourceCache = new Map<string, THREE.Group>();

/**
 * Загружает glb (с кэшем по url) и возвращает готовый к использованию
 * "pivot" — группу, у которой origin (0,0,0) совпадает с верхней
 * центральной точкой одежды (воротник/линия плеч).
 */
export async function loadGarmentPivot(url: string): Promise<THREE.Group> {
  let source = sourceCache.get(url);

  if (!source) {
    const gltf = await loader.loadAsync(url);
    source = gltf.scene;
    sourceCache.set(url, source);
  }

  return buildPivot(source.clone(true));
}

function buildPivot(mesh: THREE.Group): THREE.Group {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  // якорь = верхняя центральная точка модели
  mesh.position.set(-center.x, -box.max.y, -center.z);

  const pivot = new THREE.Group();
  pivot.add(mesh);
  pivot.userData.naturalWidth = size.x || 1;
  pivot.userData.naturalHeight = size.y || 1;

  return pivot;
}