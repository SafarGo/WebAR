import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  DrawingUtils,
  PoseLandmarker
} from "@mediapipe/tasks-vision";

import { usePose } from "../hooks/usePose";
import { getPoseLandmarker } from "../services/poseService";
import { loadGarmentSource, buildPivot } from "../services/garmentService";
import type { ClothingItem } from "../data/clothes";

interface CameraViewProps {
  selectedClothing: ClothingItem | null;
}

export default function CameraView(props: CameraViewProps) {
  const { selectedClothing } = props;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const threeCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const garmentRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const gltfSourceRef = useRef<THREE.Group | null>(null);
  const loadedModelUrlRef = useRef<string | null>(null);

  const [sceneReady, setSceneReady] = useState(false);
  const selectedClothingRef = useRef<ClothingItem | null>(selectedClothing);

  // 🛠 DEBUG
  const [debugMode, setDebugMode] = useState(true);
  const [lastClothingId, setLastClothingId] = useState(selectedClothing?.id ?? null);
  const [debugFitScaleX, setDebugFitScaleX] = useState(selectedClothing?.fitScaleX ?? 1.3);
  const [debugFitScaleY, setDebugFitScaleY] = useState(selectedClothing?.fitScaleY ?? 1.1);
  const [debugVerticalOffset, setDebugVerticalOffset] = useState(selectedClothing?.verticalOffset ?? 0.1);
  const [debugRotX, setDebugRotX] = useState(selectedClothing?.modelRotationOffset?.x ?? 0);
  const [debugRotY, setDebugRotY] = useState(selectedClothing?.modelRotationOffset?.y ?? 0);
  const [debugRotZ, setDebugRotZ] = useState(selectedClothing?.modelRotationOffset?.z ?? 0);

  if (selectedClothing && selectedClothing.id !== lastClothingId) {
    setLastClothingId(selectedClothing.id);
    setDebugFitScaleX(selectedClothing.fitScaleX ?? 1.3);
    setDebugFitScaleY(selectedClothing.fitScaleY ?? 1.1);
    setDebugVerticalOffset(selectedClothing.verticalOffset ?? 0.1);
    setDebugRotX(selectedClothing.modelRotationOffset?.x ?? 0);
    setDebugRotY(selectedClothing.modelRotationOffset?.y ?? 0);
    setDebugRotZ(selectedClothing.modelRotationOffset?.z ?? 0);
  }

  const debugFitScaleXRef = useRef(debugFitScaleX);
  const debugFitScaleYRef = useRef(debugFitScaleY);
  const debugVerticalOffsetRef = useRef(debugVerticalOffset);

  useEffect(() => { debugFitScaleXRef.current = debugFitScaleX; }, [debugFitScaleX]);
  useEffect(() => { debugFitScaleYRef.current = debugFitScaleY; }, [debugFitScaleY]);
  useEffect(() => { debugVerticalOffsetRef.current = debugVerticalOffset; }, [debugVerticalOffset]);

  const { ready } = usePose(videoRef);

  useEffect(() => {
    selectedClothingRef.current = selectedClothing;
  }, [selectedClothing]);

  // загрузка + сборка pivot
  useEffect(() => {
    if (!selectedClothing || !sceneRef.current) return;
    let cancelled = false;

    async function rebuild() {
      if (loadedModelUrlRef.current !== selectedClothing!.model) {
        gltfSourceRef.current = await loadGarmentSource(selectedClothing!.model);
        loadedModelUrlRef.current = selectedClothing!.model;
      }
      if (cancelled || !sceneRef.current || !gltfSourceRef.current) return;

      const pivot = buildPivot(gltfSourceRef.current, selectedClothing!.anchorEdge ?? "top", {
        x: debugRotX,
        y: debugRotY,
        z: debugRotZ
      });

      if (garmentRef.current) sceneRef.current.remove(garmentRef.current);
      pivot.visible = false;
      sceneRef.current.add(pivot);
      garmentRef.current = pivot;
    }

    rebuild().catch(console.error);
    return () => { cancelled = true; };
  }, [selectedClothing, sceneReady, debugRotX, debugRotY, debugRotZ]);

  useEffect(() => {
    let animationId: number;
    let stream: MediaStream | undefined;
    let cleanupResize: (() => void) | undefined;
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
      dirLight.position.set(0, 2, 3);
      scene.add(dirLight);

      const w = container.clientWidth;
      const h = container.clientHeight;
      const camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 100);
      // MediaPipe worldLandmarks: origin = центр бёдер, Z = глубина от камеры
      // Плечи у нас на Y=-0.46, значит камера должна смотреть примерно
      // на уровень центра торса (Y≈-0.23) с небольшого расстояния
      camera.position.set(0, -0.23, 1.2);
      camera.lookAt(0, -0.23, 0);
      cameraRef.current = camera;

      renderer = new THREE.WebGLRenderer({
        canvas: threeCanvasRef.current!,
        alpha: true,
        antialias: true
      });
      renderer.setClearColor(0x000000, 0);

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

        camera.aspect = w / h;
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
        if (!crop) {
          animationId = requestAnimationFrame(detect);
          return;
        }

        const screenLandmarks = results.landmarks?.[0];
        const worldLandmarks = results.worldLandmarks?.[0];

        // рисуем скелет
        if (screenLandmarks) {
          const drawingUtils = new DrawingUtils(ctx);
          const adjusted = screenLandmarks.map((lm) => {
            const p = toCanvasPoint(lm, crop);
            return { ...lm, x: p.x / canvas.width, y: p.y / canvas.height };
          });
          drawingUtils.drawLandmarks(adjusted, { color: "#00FF00", radius: 3 });
          drawingUtils.drawConnectors(adjusted, PoseLandmarker.POSE_CONNECTIONS, {
            color: "#00FF00",
            lineWidth: 2
          });
        }

        // накладываем одежду по worldLandmarks
        if (worldLandmarks && garmentRef.current) {
          const pivot = garmentRef.current;

          const LS = worldLandmarks[11]; // левое плечо
          const RS = worldLandmarks[12]; // правое плечо
          const LH = worldLandmarks[23]; // левое бедро
          const RH = worldLandmarks[24]; // правое бедро

          // центр торса
          const torsoCenter = new THREE.Vector3(
            (LS.x + RS.x + LH.x + RH.x) / 4,
            (LS.y + RS.y + LH.y + RH.y) / 4,
            (LS.z + RS.z + LH.z + RH.z) / 4
          );

          // ширина плеч и высота торса в метрах
          const shoulderWidthM = Math.hypot(RS.x - LS.x, RS.y - LS.y, RS.z - LS.z);
          const shoulderMidY = (LS.y + RS.y) / 2;
          const hipMidY = (LH.y + RH.y) / 2;
          const torsoHeightM = Math.abs(shoulderMidY - hipMidY);

          const naturalWidth = pivot.userData.naturalWidth as number;
          const naturalHeight = pivot.userData.naturalHeight as number;

          const fitScaleX = debugFitScaleXRef.current;
          const fitScaleY = debugFitScaleYRef.current;
          const verticalOffset = debugVerticalOffsetRef.current;

          // масштабируем X и Y независимо
          const scaleX = (shoulderWidthM * fitScaleX) / naturalWidth;
          const scaleY = (torsoHeightM * fitScaleY) / naturalHeight;

          pivot.scale.set(scaleX, scaleY, (scaleX + scaleY) / 2);

          // позиция: центр торса + небольшой сдвиг вниз
          pivot.position.set(
            torsoCenter.x,
            torsoCenter.y - verticalOffset * torsoHeightM,
            torsoCenter.z
          );

          // 🔑 ориентация через 3D-векторы
          const rightVec = new THREE.Vector3(
            RS.x - LS.x,
            RS.y - LS.y,
            RS.z - LS.z
          ).normalize();

          const upVec = new THREE.Vector3(
            (LS.x + RS.x) / 2 - (LH.x + RH.x) / 2,
            (LS.y + RS.y) / 2 - (LH.y + RH.y) / 2,
            (LS.z + RS.z) / 2 - (LH.z + RH.z) / 2
          ).normalize();

          const forwardVec = new THREE.Vector3()
            .crossVectors(rightVec, upVec)
            .normalize();

          const rotMatrix = new THREE.Matrix4().makeBasis(rightVec, upVec, forwardVec);
          pivot.quaternion.setFromRotationMatrix(rotMatrix);

          pivot.visible = true;
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
      stream?.getTracks().forEach((t) => t.stop());
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
        <div style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          background: "rgba(0,0,0,0.8)",
          color: "#fff",
          padding: "12px 16px",
          fontSize: 13,
          fontFamily: "monospace",
          boxSizing: "border-box",
          maxHeight: "55vh",
          overflowY: "auto"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <strong>DEBUG: {selectedClothing?.name ?? "—"}</strong>
            <button onClick={() => setDebugMode(false)}>скрыть</button>
          </div>

          <label style={{ display: "block", marginTop: 8 }}>
            fitScaleX (ширина): {debugFitScaleX.toFixed(2)}
            <input type="range" min={0.5} max={3} step={0.05}
              value={debugFitScaleX}
              onChange={(e) => setDebugFitScaleX(parseFloat(e.target.value))}
              style={{ width: "100%" }} />
          </label>

          <label style={{ display: "block", marginTop: 8 }}>
            fitScaleY (высота): {debugFitScaleY.toFixed(2)}
            <input type="range" min={0.5} max={3} step={0.05}
              value={debugFitScaleY}
              onChange={(e) => setDebugFitScaleY(parseFloat(e.target.value))}
              style={{ width: "100%" }} />
          </label>

          <label style={{ display: "block", marginTop: 8 }}>
            verticalOffset (+ вниз / − вверх): {debugVerticalOffset.toFixed(2)}
            <input type="range" min={-0.5} max={0.5} step={0.01}
              value={debugVerticalOffset}
              onChange={(e) => setDebugVerticalOffset(parseFloat(e.target.value))}
              style={{ width: "100%" }} />
          </label>

          <label style={{ display: "block", marginTop: 8 }}>
            modelRotation.x: {debugRotX}°
            <input type="range" min={-180} max={180} step={1}
              value={debugRotX}
              onChange={(e) => setDebugRotX(parseFloat(e.target.value))}
              style={{ width: "100%" }} />
          </label>

          <label style={{ display: "block", marginTop: 8 }}>
            modelRotation.y: {debugRotY}°
            <input type="range" min={-180} max={180} step={1}
              value={debugRotY}
              onChange={(e) => setDebugRotY(parseFloat(e.target.value))}
              style={{ width: "100%" }} />
          </label>

          <label style={{ display: "block", marginTop: 8 }}>
            modelRotation.z: {debugRotZ}°
            <input type="range" min={-180} max={180} step={1}
              value={debugRotZ}
              onChange={(e) => setDebugRotZ(parseFloat(e.target.value))}
              style={{ width: "100%" }} />
          </label>

          <div style={{ marginTop: 10, fontSize: 11, opacity: 0.7 }}>
            👉 скопируй в clothes.ts когда подберёшь:<br />
            fitScaleX: {debugFitScaleX.toFixed(2)}, fitScaleY: {debugFitScaleY.toFixed(2)},
            verticalOffset: {debugVerticalOffset.toFixed(2)},
            modelRotationOffset: {`{ x: ${debugRotX}, y: ${debugRotY}, z: ${debugRotZ} }`}
          </div>
        </div>
      )}
    </div>
  );
}