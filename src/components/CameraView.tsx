import { useEffect, useRef, useState } from "react";
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
  const [status, setStatus] = useState<"idle" | "loading" | "running" | "error">("idle");
  const trackerRef = useRef<Awaited<ReturnType<typeof setupTracker>> | null>(null);
  const stopCameraRef = useRef<(() => void) | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animationIdRef = useRef<number>(0);

  // инициализируем трекер заранее (без камеры)
  useEffect(() => {
    let cancelled = false;

    async function initTracker() {
      try {
        const tracker = await setupTracker({
          ignoreLegs: true,
          ignoreFace: true,
          displayScale: 1,
        });
        if (!cancelled) {
          trackerRef.current = tracker;
        }
      } catch (e) {
        console.error("Ошибка инициализации трекера:", e);
      }
    }

    initTracker();
    return () => { cancelled = true; };
  }, []);

  const handleStart = async () => {
    if (!selectedClothing || !trackerRef.current || !containerRef.current) return;

    setStatus("loading");
    const container = containerRef.current;
    const tracker = trackerRef.current;

    try {
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
      threeCanvas.style.width = `${w}px`;
      threeCanvas.style.height = `${h}px`;
      container.appendChild(threeCanvas);

      const renderer = new THREE.WebGLRenderer({
        canvas: threeCanvas,
        alpha: true,
        antialias: true
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      rendererRef.current = renderer;

      const resizeObserver = new ResizeObserver(() => {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        renderer.setSize(cw, ch);
        camera.aspect = cw / ch;
        camera.updateProjectionMatrix();
        threeCanvas.style.width = `${cw}px`;
        threeCanvas.style.height = `${ch}px`;
      });
      resizeObserver.observe(container);

      const gltf = await new GLTFLoader().loadAsync(selectedClothing.model);

      let rig = gltf.scene.getObjectByName("rig") as THREE.Object3D | undefined;
      if (!rig) {
        gltf.scene.traverse((obj) => {
          if ((obj as THREE.SkinnedMesh).isSkinnedMesh && !rig) {
            rig = obj.parent ?? obj;
          }
        });
      }

      if (!rig) {
        setStatus("error");
        console.error("Арматура не найдена. Назови объект арматуры 'rig' в Blender.");
        return;
      }

      scene.add(gltf.scene);

      const binding = tracker.bind(rig);

      const cameraHandle = await tracker.start();
      stopCameraRef.current = () => cameraHandle.stop();

      setStatus("running");

      const clock = new THREE.Clock();
      const animate = () => {
        animationIdRef.current = requestAnimationFrame(animate);
        const delta = clock.getDelta();
        binding.update(delta);
        renderer.render(scene, camera);
      };
      animate();

    } catch (e) {
      console.error("Ошибка запуска камеры:", e);
      setStatus("error");
    }
  };

  useEffect(() => {
    return () => {
      if (stopCameraRef.current) stopCameraRef.current();
      cancelAnimationFrame(animationIdRef.current);
      if (rendererRef.current) rendererRef.current.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#000"
      }}
    >
      {status === "idle" && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          zIndex: 10
        }}>
          <p style={{ color: "#fff", fontSize: 18 }}>
            Нажми чтобы начать примерку
          </p>
          <button
            onClick={handleStart}
            style={{
              padding: "14px 32px",
              fontSize: 16,
              borderRadius: 12,
              border: "none",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 600
            }}
          >
            Включить камеру
          </button>
        </div>
      )}

      {status === "loading" && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10
        }}>
          <p style={{ color: "#fff", fontSize: 18 }}>
            Загрузка модели...
          </p>
        </div>
      )}

      {status === "error" && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10
        }}>
          <p style={{ color: "red", fontSize: 18 }}>
            Ошибка. Проверь консоль браузера.
          </p>
        </div>
      )}
    </div>
  );
}