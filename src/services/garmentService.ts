import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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

export function buildPivot(source: THREE.Group): THREE.Group {
  const mesh = source.clone(true);
  mesh.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  const maxSize = Math.max(size.x, size.y, size.z, 0.001);
  mesh.scale.setScalar(1 / maxSize);
  mesh.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(mesh);
  const center2 = new THREE.Vector3();
  box2.getCenter(center2);

  mesh.position.set(-center2.x, -center2.y, -center2.z);

  const pivot = new THREE.Group();
  pivot.add(mesh);

  const size2 = new THREE.Vector3();
  box2.getSize(size2);
  pivot.userData.naturalWidth = size2.x;
  pivot.userData.naturalHeight = size2.y;

  return pivot;
}