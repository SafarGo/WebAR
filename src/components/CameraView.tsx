import { useEffect, useRef } from "react";
import * as THREE from "three";
import { setupTracker } from "three-mediapipe-rig";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ClothingItem } from "../data/clothes";

interface CameraViewProps {
  selectedClothing: ClothingItem | null;
}

export default function CameraView(props: CameraViewProps) {
  const { selectedClothing } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    let stopped = false;
    let stopCamera: (() => void) | undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    let animationId: number;

    async function init() {
      const container = containerRef.current!;
      const w = container.clientWidth;
      const h = container.clientHeight;

      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 1.2));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(0, 2, 3);
      scene.add(dirLight);

      const camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 100);
      camera.position.set(0, 0, 2);
      camera.lookAt(0, 0, 0);

      const threeCanvas = document.createElement("canvas");
      threeCanvas.style.position = "absolute";
      threeCanvas.style.top = "0";
      threeCanvas.style.left = "0";
      threeCanvas.style.pointerEvents = "none";
      container.appendChild(threeCanvas);

      renderer = new THREE.WebGLRenderer({
        canvas: threeCanvas,
        alpha: true,
        antialias: true
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      const resizeObserver = new ResizeObserver(() => {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        renderer!.setSize(cw, ch);
        camera.aspect = cw / ch;
        camera.updateProjectionMatrix();
        threeCanvas.style.width = `${cw}px`;
        threeCanvas.style.height = `${ch}px`;
      });
      resizeObserver.observe(container);

      const tracker = await setupTracker({
        ignoreLegs: true,
        ignoreFace: true,
        displayScale: 1,
      });

      if (stopped) return;

      if (!selectedClothing) return;

      const gltf = await new GLTFLoader().loadAsync(selectedClothing.model);

      if (stopped) return;

      // ищем арматуру по имени "rig", иначе берём первый SkinnedMesh
      let rig = gltf.scene.getObjectByName("rig") as THREE.Object3D | undefined;

      if (!rig) {
        gltf.scene.traverse((obj) => {
          if ((obj as THREE.SkinnedMesh).isSkinnedMesh && !rig) {
            rig = obj.parent ?? obj;
          }
        });
      }

      if (!rig) {
        console.error(
          "Арматура не найдена. Назови объект арматуры 'rig' в Blender."
        );
        return;
      }

      scene.add(gltf.scene);

      const binding = tracker.bind(rig);

      const cameraHandle = await tracker.start();
      stopCamera = () => cameraHandle.stop();

      if (stopped) {
        stopCamera();
        return;
      }

      const clock = new THREE.Clock();

      const animate = () => {
        animationId = requestAnimationFrame(animate);
        const delta = clock.getDelta();
        binding.update(delta);
        renderer!.render(scene, camera);
      };

      animate();
    }

    init().catch(console.error);

    return () => {
      stopped = true;
      stopCamera?.();
      cancelAnimationFrame(animationId);
      renderer?.dispose();
      mountedRef.current = false;
    };
  }, [selectedClothing]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        overflow: "hidden"
      }}
    />
  );
}