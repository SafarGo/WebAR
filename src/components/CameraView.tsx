import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  DrawingUtils,
  PoseLandmarker
} from "@mediapipe/tasks-vision";

import { usePose } from "../hooks/usePose";
import { getPoseLandmarker } from "../services/poseService";
import { loadGarmentPivot } from "../services/garmentService";
import type { ClothingItem } from "../data/clothes";

interface CameraViewProps {
  selectedClothing: ClothingItem | null;
}

export default function CameraView({ selectedClothing }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const threeCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const garmentRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  // 🔑 флаг готовности Three.js сцены — без него эффект загрузки модели
  // может сработать раньше, чем сцена создана внутри startCamera()
  const [sceneReady, setSceneReady] = useState(false);

  // 🔑 актуальная одежда доступна внутри detect() без перезапуска камеры
  const selectedClothingRef = useRef<ClothingItem | null>(selectedClothing);

  const { ready } = usePose(videoRef);

  // обновляем ref при смене пропа
  useEffect(() => {
    selectedClothingRef.current = selectedClothing;
  }, [selectedClothing]);

  // загрузка/замена 3D-модели при смене выбранной одежды
  // ИЛИ когда сцена становится готовой (sceneReady)
  useEffect(() => {
    if (!selectedClothing || !sceneRef.current) return;

    let cancelled = false;

    loadGarmentPivot(selectedClothing.model)
      .then((pivot) => {
        if (cancelled || !sceneRef.current) return;

        if (garmentRef.current) {
          sceneRef.current.remove(garmentRef.current);
        }
        pivot.visible = false;
        sceneRef.current.add(pivot);
        garmentRef.current = pivot;
      })
      .catch((err) => {
        console.error("Не удалось загрузить модель одежды:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedClothing, sceneReady]);

  // запуск камеры + рендер-цикл — запускается ОДИН РАЗ
  useEffect(() => {
    let animationId: number;
    let cleanupResize: (() => void) | undefined;
    let stream: MediaStream | undefined;
    let renderer: THREE.WebGLRenderer | undefined;

    async function startCamera() {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      const container = containerRef.current!;

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      // 🧊 Three.js сцена для одежды
      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 1.2));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(0, 1, 1);
      scene.add(dirLight);

      renderer = new THREE.WebGLRenderer({
        canvas: threeCanvasRef.current!,
        alpha: true,
        antialias: true
      });
      renderer.setClearColor(0x000000, 0);

      const camera = new THREE.OrthographicCamera(0, 0, 0, 0, 0.1, 2000);
      camera.position.z = 1000;

      sceneRef.current = scene;
      setSceneReady(true); // 🔑 триггерим повторный запуск эффекта загрузки модели

      const resizeCanvas = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;

        // ВАЖНО: без updateStyle=true (или вызова без 3-го аргумента вовсе)
        // canvas.style у threeCanvas не выставляется, и браузер показывает
        // его в w*dpr × h*dpr CSS-пикселях — отсюда "куб на весь экран"
        renderer!.setSize(w, h);
        renderer!.setPixelRatio(dpr);

        camera.left = 0;
        camera.right = w * dpr;
        camera.top = h * dpr;
        camera.bottom = 0;
        camera.updateProjectionMatrix();
      };

      resizeCanvas();
      window.addEventListener("resize", resizeCanvas);
      cleanupResize = () => window.removeEventListener("resize", resizeCanvas);

      const drawVideoCover = () => {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const cw = canvas.width;
        const ch = canvas.height;
        if (!vw || !vh) return null;

        const videoRatio = vw / vh;
        const canvasRatio = cw / ch;
        let sx: number, sy: number, sWidth: number, sHeight: number;

        if (videoRatio > canvasRatio) {
          sHeight = vh;
          sWidth = vh * canvasRatio;
          sx = (vw - sWidth) / 2;
          sy = 0;
        } else {
          sWidth = vw;
          sHeight = vw / canvasRatio;
          sx = 0;
          sy = (vh - sHeight) / 2;
        }

        ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, cw, ch);
        return { sx, sy, sWidth, sHeight };
      };

      const toCanvasPoint = (
        lm: { x: number; y: number; z: number },
        crop: { sx: number; sy: number; sWidth: number; sHeight: number }
      ) => ({
        x: ((lm.x * video.videoWidth - crop.sx) / crop.sWidth) * canvas.width,
        y: ((lm.y * video.videoHeight - crop.sy) / crop.sHeight) * canvas.height,
        z: lm.z
      });

      const detect = () => {
        const poseLandmarker = getPoseLandmarker();

        if (!poseLandmarker) {
          animationId = requestAnimationFrame(detect);
          return;
        }

        const results = poseLandmarker.detectForVideo(video, performance.now());

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const crop = drawVideoCover();

        const drawingUtils = new DrawingUtils(ctx);
        const landmarksSet = results.landmarks?.[0];

        if (landmarksSet && crop) {
          const adjusted = landmarksSet.map((lm) => {
            const p = toCanvasPoint(lm, crop);
            return { ...lm, x: p.x / canvas.width, y: p.y / canvas.height };
          });
          drawingUtils.drawLandmarks(adjusted);
          drawingUtils.drawConnectors(adjusted, PoseLandmarker.POSE_CONNECTIONS);

          if (garmentRef.current) {
            const pivot = garmentRef.current;
            const leftShoulder = toCanvasPoint(landmarksSet[11], crop);
            const rightShoulder = toCanvasPoint(landmarksSet[12], crop);

            const chestCenter = {
              x: (leftShoulder.x + rightShoulder.x) / 2,
              y: (leftShoulder.y + rightShoulder.y) / 2
            };

            const shoulderWidthPx = Math.hypot(
              rightShoulder.x - leftShoulder.x,
              rightShoulder.y - leftShoulder.y
            );

            const naturalWidth = pivot.userData.naturalWidth as number;
            const fitScale = selectedClothingRef.current?.fitScale ?? 1.7;
            const scale = (shoulderWidthPx * fitScale) / naturalWidth;

            pivot.scale.setScalar(scale);
            pivot.position.set(
              chestCenter.x,
              canvas.height - chestCenter.y,
              0
            );

            const rollAngle = Math.atan2(
              rightShoulder.y - leftShoulder.y,
              rightShoulder.x - leftShoulder.x
            );
            pivot.rotation.z = -rollAngle;

            const yawRaw = (rightShoulder.z - leftShoulder.z) * 4;
            pivot.rotation.y = THREE.MathUtils.clamp(yawRaw, -0.6, 0.6);

            pivot.visible = true;
          }
        } else if (garmentRef.current) {
          garmentRef.current.visible = false;
        }

        renderer!.render(scene, camera);
        animationId = requestAnimationFrame(detect);
      };

      detect();
    }

    startCamera();

    return () => {
      cancelAnimationFrame(animationId);
      cleanupResize?.();
      stream?.getTracks().forEach((track) => track.stop());
      renderer?.dispose();
    };
  }, []); // ← пусто и корректно: всё изменяемое читается через ref

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
    >
      <video ref={videoRef} style={{ display: "none" }} />

      <canvas
        ref={canvasRef}
        style={{ position: "absolute", top: 0, left: 0, display: "block" }}
      />

      <canvas
        ref={threeCanvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          display: "block",
          pointerEvents: "none"
        }}
      />

      {!ready && (
        <p style={{ position: "absolute", top: 10, left: 10, color: "#fff" }}>
          Loading pose model...
        </p>
      )}
    </div>
  );
}