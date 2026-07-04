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
  const [status, setStatus] = useState<"idle" | "loading-tracker" | "loading-model" | "loading-camera" | "running" | "error">("idle");
  const trackerRef = useRef<Awaited<ReturnType<typeof setupTracker>> | null>(null);
  const stopCameraRef = useRef<(() => void) | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animationIdRef = useRef<number>(0);

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
    if (!selectedClothing || !containerRef.current) return;

    const container = containerRef.current;

    try {
      // если трекер ещё не загрузился — ждём
      if (!trackerRef.current) {
        setStatus("loading-tracker");
        await new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (trackerRef.current) {
              clearInterval(interval);
              resolve();
            }
          }, 100);
        });
      }

      const tracker = trackerRef.current!;

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

      setStatus("loading-model");
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

      setStatus("loading-camera");
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

  const statusLabel: Record<string, string> = {
    "loading-tracker": "Загрузка трекера...",
    "loading-model":   "Загрузка модели одежды...",
    "loading-camera":  "Запрос доступа к камере...",
  };

  const isLoading = status.startsWith("loading");

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
      {(status === "idle" || isLoading) && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          zIndex: 10
        }}>
          {/* спиннер — показывается только во время загрузки */}
          {isLoading && (
            <div style={{
              width: 48,
              height: 48,
              border: "4px solid rgba(255,255,255,0.2)",
              borderTopColor: "#fff",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite"
            }} />
          )}

          <p style={{
            color: "#fff",
            fontSize: 16,
            opacity: 0.85,
            textAlign: "center",
            padding: "0 24px"
          }}>
            {isLoading ? statusLabel[status] : "Нажми чтобы начать примерку"}
          </p>

          <button
            onClick={handleStart}
            disabled={isLoading}
            style={{
              padding: "14px 32px",
              fontSize: 16,
              borderRadius: 12,
              border: "none",
              background: isLoading ? "rgba(255,255,255,0.3)" : "#fff",
              color: isLoading ? "rgba(0,0,0,0.4)" : "#000",
              cursor: isLoading ? "not-allowed" : "pointer",
              fontWeight: 600,
              transition: "all 0.2s",
              minWidth: 200
            }}
          >
            {isLoading ? "Загрузка..." : "Включить камеру"}
          </button>
        </div>
      )}

      {status === "error" && (
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
          <p style={{ color: "#ff4444", fontSize: 18 }}>
            Что-то пошло не так
          </p>
          <button
            onClick={() => setStatus("idle")}
            style={{
              padding: "12px 28px",
              fontSize: 15,
              borderRadius: 12,
              border: "none",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 600
            }}
          >
            Попробовать снова
          </button>
        </div>
      )}

      {/* CSS анимация спиннера */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}