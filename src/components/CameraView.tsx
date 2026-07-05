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
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const trackerRef = useRef<Awaited<ReturnType<typeof setupTracker>> | null>(null);
  const stopCameraRef = useRef<(() => void) | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animationIdRef = useRef<number>(0);

  const addLog = (msg: string) => {
    console.log(msg);
    setDebugLogs(prev => [...prev.slice(-10), msg]);
  };

  useEffect(() => {
    let cancelled = false;

    async function initTracker() {
      try {
        addLog("Инициализация трекера...");
        const tracker = await setupTracker({
          ignoreLegs: true,
          ignoreFace: true,
          displayScale: 1,
        });
        if (!cancelled) {
          trackerRef.current = tracker;
          addLog("✅ Трекер готов");
        }
      } catch (e) {
        addLog("❌ Ошибка трекера: " + String(e));
      }
    }

    initTracker();
    return () => { cancelled = true; };
  }, []);

  const handleStart = async () => {
    if (!selectedClothing || !containerRef.current) return;

    const container = containerRef.current;

    try {
      if (!trackerRef.current) {
        setStatus("loading-tracker");
        addLog("Ожидание трекера...");
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

      setStatus("loading-camera");
      addLog("Запрос камеры...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      addLog("✅ Камера получена");

      const videoEl = document.createElement("video");
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.setAttribute("playsinline", "");
      videoEl.style.position = "absolute";
      videoEl.style.top = "0";
      videoEl.style.left = "0";
      videoEl.style.width = "100%";
      videoEl.style.height = "100%";
      videoEl.style.objectFit = "cover";
      videoEl.style.zIndex = "0";
      container.insertBefore(videoEl, container.firstChild);
      await videoEl.play();
      addLog("✅ Видео запущено");

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
      threeCanvas.style.zIndex = "2";
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
      addLog("Загрузка модели: " + selectedClothing.model);
      const gltf = await new GLTFLoader().loadAsync(selectedClothing.model);
      addLog("✅ Модель загружена");

      // выводим структуру на экран
      const objects: string[] = [];
      gltf.scene.traverse((obj) => {
        objects.push(`${obj.type} | ${obj.name} | skinned:${(obj as THREE.SkinnedMesh).isSkinnedMesh ?? false}`);
      });
      addLog("Объекты: " + objects.slice(0, 5).join(" / "));

      let rig =
        gltf.scene.getObjectByName("rig") as THREE.Object3D | undefined ??
        gltf.scene.getObjectByName("Armature") as THREE.Object3D | undefined;

      if (!rig) {
        gltf.scene.traverse((obj) => {
          if ((obj as THREE.SkinnedMesh).isSkinnedMesh && !rig) {
            rig = obj.parent ?? obj;
          }
        });
      }

      if (!rig) {
        throw new Error("Арматура не найдена. Объекты: " + objects.join(", "));
      }

      addLog("✅ Арматура: " + rig.name + " (" + rig.type + ")");

      scene.add(gltf.scene);
      const binding = tracker.bind(rig);
      addLog("✅ Binding создан");

      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices
      );
      navigator.mediaDevices.getUserMedia = async () => stream;

      addLog("Запуск трекера...");
      const cameraHandle = await tracker.start();
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
      addLog("✅ Трекер запущен");

      setTimeout(() => {
        const allCanvases = container.querySelectorAll("canvas");
        allCanvases.forEach((c) => {
          if (c !== threeCanvas) {
            c.style.position = "absolute";
            c.style.top = "0";
            c.style.left = "0";
            c.style.width = "100%";
            c.style.height = "100%";
            c.style.zIndex = "1";
            c.style.pointerEvents = "none";
          }
        });
        addLog("✅ Canvas настроены");
      }, 500);

      stopCameraRef.current = () => {
        cameraHandle.stop();
        stream.getTracks().forEach(t => t.stop());
        videoEl.remove();
      };

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
      console.error("Ошибка запуска:", e);
      setErrorMessage(e instanceof Error ? e.message : String(e));
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
    "loading-model": "Загрузка модели одежды...",
    "loading-camera": "Запрос доступа к камере...",
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

      {/* debug лог — показывается всегда поверх камеры */}
      {debugLogs.length > 0 && status !== "error" && (
        <div style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: "rgba(0,0,0,0.75)",
          color: "#0f0",
          fontSize: 11,
          fontFamily: "monospace",
          padding: "8px 12px",
          zIndex: 20,
          maxHeight: "40vh",
          overflowY: "auto"
        }}>
          {debugLogs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
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
          zIndex: 10,
          padding: "0 24px"
        }}>
          <p style={{ color: "#ff4444", fontSize: 18, textAlign: "center" }}>
            Что-то пошло не так
          </p>
          {errorMessage && (
            <p style={{
              color: "rgba(255,255,255,0.6)",
              fontSize: 13,
              textAlign: "center",
              fontFamily: "monospace",
              maxWidth: 320
            }}>
              {errorMessage}
            </p>
          )}
          <button
            onClick={() => {
              setStatus("idle");
              setErrorMessage("");
              setDebugLogs([]);
            }}
            style={{
              padding: "12px 28px",
              fontSize: 15,
              borderRadius: 12,
              border: "none",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 600,
              marginTop: 8
            }}
          >
            Попробовать снова
          </button>
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}