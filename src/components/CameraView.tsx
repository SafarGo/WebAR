import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  DrawingUtils,
  PoseLandmarker
} from "@mediapipe/tasks-vision";

import { usePose } from "../hooks/usePose";
import { getPoseLandmarker } from "../services/poseService";
import { loadGarmentPivot } from "../services/garmentService";
import { ANCHOR_LANDMARKS } from "../config/anchorLandmarks";
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

  const [sceneReady, setSceneReady] = useState(false);
  const selectedClothingRef = useRef<ClothingItem | null>(selectedClothing);

  // 🛠 DEBUG-панель калибровки
  const [debugMode, setDebugMode] = useState(true);
  const [lastClothingId, setLastClothingId] = useState(
    selectedClothing?.id ?? null
  );
  const [debugFitScale, setDebugFitScale] = useState(
    selectedClothing?.fitScale ?? 1
  );
  const [debugVerticalOffset, setDebugVerticalOffset] = useState(
    selectedClothing?.verticalOffset ?? 0
  );
  const [debugInvertRoll, setDebugInvertRoll] = useState(
    selectedClothing?.invertRoll ?? false
  );
  const [debugInvertYaw, setDebugInvertYaw] = useState(
    selectedClothing?.invertYaw ?? false
  );

  // 🔑 "сброс состояния при смене пропа" — во время рендера, без useEffect.
  // Так рекомендует сама документация React вместо setState внутри эффекта.
  if (selectedClothing && selectedClothing.id !== lastClothingId) {
    setLastClothingId(selectedClothing.id);
    setDebugFitScale(selectedClothing.fitScale ?? 1);
    setDebugVerticalOffset(selectedClothing.verticalOffset ?? 0);
    setDebugInvertRoll(selectedClothing.invertRoll ?? false);
    setDebugInvertYaw(selectedClothing.invertYaw ?? false);
  }

  const debugFitScaleRef = useRef(debugFitScale);
  const debugVerticalOffsetRef = useRef(debugVerticalOffset);
  const debugInvertRollRef = useRef(debugInvertRoll);
  const debugInvertYawRef = useRef(debugInvertYaw);

  useEffect(() => {
    debugFitScaleRef.current = debugFitScale;
  }, [debugFitScale]);

  useEffect(() => {
    debugVerticalOffsetRef.current = debugVerticalOffset;
  }, [debugVerticalOffset]);

  useEffect(() => {
    debugInvertRollRef.current = debugInvertRoll;
  }, [debugInvertRoll]);

  useEffect(() => {
    debugInvertYawRef.current = debugInvertYaw;
  }, [debugInvertYaw]);

  const { ready } = usePose(videoRef);

  // эта синхронизация безопасна — здесь нет setState, только мутация ref
  useEffect(() => {
    selectedClothingRef.current = selectedClothing;
  }, [selectedClothing]);

  // загрузка/замена 3D-модели при смене выбранной одежды
  useEffect(() => {
    if (!selectedClothing || !sceneRef.current) return;

    let cancelled = false;
    const anchorEdge = selectedClothing.anchorEdge ?? "top";

    loadGarmentPivot(selectedClothing.model, anchorEdge)
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
      setSceneReady(true);

      const resizeCanvas = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;

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
            const clothing = selectedClothingRef.current;

            const anchorPoint = clothing?.anchor ?? "shoulders";
            const { left: leftIdx, right: rightIdx } = ANCHOR_LANDMARKS[anchorPoint];

            const leftPt = toCanvasPoint(landmarksSet[leftIdx], crop);
            const rightPt = toCanvasPoint(landmarksSet[rightIdx], crop);

            const refCenter = {
              x: (leftPt.x + rightPt.x) / 2,
              y: (leftPt.y + rightPt.y) / 2
            };

            const refWidthPx = Math.hypot(
              rightPt.x - leftPt.x,
              rightPt.y - leftPt.y
            );

            const naturalWidth = pivot.userData.naturalWidth as number;

            const fitScale = debugFitScaleRef.current;
            const verticalOffset = debugVerticalOffsetRef.current;
            const invertRoll = debugInvertRollRef.current;
            const invertYaw = debugInvertYawRef.current;

            const scale = (refWidthPx * fitScale) / naturalWidth;
            const verticalOffsetPx = refWidthPx * verticalOffset;

            pivot.scale.setScalar(scale);
            pivot.position.set(
              refCenter.x,
              canvas.height - (refCenter.y + verticalOffsetPx),
              0
            );

            const rollAngle = Math.atan2(
              rightPt.y - leftPt.y,
              rightPt.x - leftPt.x
            );
            const rollSign = invertRoll ? 1 : -1;
            pivot.rotation.z = rollSign * rollAngle;

            const yawSign = invertYaw ? -1 : 1;
            const yawRaw = yawSign * (rightPt.z - leftPt.z) * 4;
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

      {debugMode && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "100%",
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            padding: "12px 16px",
            fontSize: 13,
            fontFamily: "monospace",
            boxSizing: "border-box"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>DEBUG: {selectedClothing?.name ?? "—"}</strong>
            <button onClick={() => setDebugMode(false)}>скрыть</button>
          </div>

          <label style={{ display: "block", marginTop: 8 }}>
            fitScale: {debugFitScale.toFixed(2)}
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.05}
              value={debugFitScale}
              onChange={(e) => setDebugFitScale(parseFloat(e.target.value))}
              style={{ width: "100%" }}
            />
          </label>

          <label style={{ display: "block", marginTop: 8 }}>
            verticalOffset: {debugVerticalOffset.toFixed(2)}
            <input
              type="range"
              min={-2}
              max={2}
              step={0.05}
              value={debugVerticalOffset}
              onChange={(e) =>
                setDebugVerticalOffset(parseFloat(e.target.value))
              }
              style={{ width: "100%" }}
            />
          </label>

          <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
            <label>
              <input
                type="checkbox"
                checked={debugInvertRoll}
                onChange={(e) => setDebugInvertRoll(e.target.checked)}
              />
              invertRoll
            </label>
            <label>
              <input
                type="checkbox"
                checked={debugInvertYaw}
                onChange={(e) => setDebugInvertYaw(e.target.checked)}
              />
              invertYaw
            </label>
          </div>

          <div style={{ marginTop: 8, opacity: 0.7 }}>
            👉 скопируй эти значения в clothes.ts когда подберёшь
          </div>
        </div>
      )}
    </div>
  );
}