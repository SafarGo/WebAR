import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  DrawingUtils,
  PoseLandmarker
} from "@mediapipe/tasks-vision";

import { usePose } from "../hooks/usePose";
import { getPoseLandmarker } from "../services/poseService";
import { loadGarmentSource, buildPivot } from "../services/garmentService";
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
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const gltfSourceRef = useRef<THREE.Group | null>(null);
  const loadedModelUrlRef = useRef<string | null>(null);

  const [sceneReady, setSceneReady] = useState(false);
  const selectedClothingRef = useRef<ClothingItem | null>(selectedClothing);

  // 🛠 DEBUG-панель
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
  const [debugRotX, setDebugRotX] = useState(
    selectedClothing?.modelRotationOffset?.x ?? 0
  );
  const [debugRotY, setDebugRotY] = useState(
    selectedClothing?.modelRotationOffset?.y ?? 0
  );
  const [debugRotZ, setDebugRotZ] = useState(
    selectedClothing?.modelRotationOffset?.z ?? 0
  );
  const [debugCameraZ, setDebugCameraZ] = useState(2);

  // сброс debug-стейтов при смене товара — во время рендера, без setState в эффекте
  if (selectedClothing && selectedClothing.id !== lastClothingId) {
    setLastClothingId(selectedClothing.id);
    setDebugFitScale(selectedClothing.fitScale ?? 1);
    setDebugVerticalOffset(selectedClothing.verticalOffset ?? 0);
    setDebugRotX(selectedClothing.modelRotationOffset?.x ?? 0);
    setDebugRotY(selectedClothing.modelRotationOffset?.y ?? 0);
    setDebugRotZ(selectedClothing.modelRotationOffset?.z ?? 0);
  }

  // refs для debug-значений — читаются внутри detect() без перезапуска камеры
  const debugFitScaleRef = useRef(debugFitScale);
  const debugVerticalOffsetRef = useRef(debugVerticalOffset);
  const debugCameraZRef = useRef(debugCameraZ);

  useEffect(() => { debugFitScaleRef.current = debugFitScale; }, [debugFitScale]);
  useEffect(() => { debugVerticalOffsetRef.current = debugVerticalOffset; }, [debugVerticalOffset]);
  useEffect(() => {
    debugCameraZRef.current = debugCameraZ;
    if (cameraRef.current) {
      cameraRef.current.position.z = debugCameraZ;
    }
  }, [debugCameraZ]);

  const { ready } = usePose(videoRef);

  useEffect(() => {
    selectedClothingRef.current = selectedClothing;
  }, [selectedClothing]);

  // загрузка + пересборка pivot при смене товара, сцены или debug-поворота
  useEffect(() => {
    if (!selectedClothing || !sceneRef.current) return;

    let cancelled = false;
    const anchorEdge = selectedClothing.anchorEdge ?? "top";

    async function rebuild() {
      if (loadedModelUrlRef.current !== selectedClothing!.model) {
        gltfSourceRef.current = await loadGarmentSource(selectedClothing!.model);
        loadedModelUrlRef.current = selectedClothing!.model;
      }

      if (cancelled || !sceneRef.current || !gltfSourceRef.current) return;

      const pivot = buildPivot(gltfSourceRef.current, anchorEdge, {
        x: debugRotX,
        y: debugRotY,
        z: debugRotZ
      });

      if (garmentRef.current) {
        sceneRef.current.remove(garmentRef.current);
      }
      pivot.visible = false;
      sceneRef.current.add(pivot);
      garmentRef.current = pivot;
    }

    rebuild().catch((err) => {
      console.error("Не удалось загрузить/собрать модель:", err);
    });

    return () => { cancelled = true; };
  }, [selectedClothing, sceneReady, debugRotX, debugRotY, debugRotZ]);

  // запуск камеры + рендер-цикл
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

      // 🧊 Three.js сцена
      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 1.2));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(0, 2, 3);
      scene.add(dirLight);

      // 🔑 PerspectiveCamera вместо Orthographic — работает в метрическом 3D
      const w = container.clientWidth;
      const h = container.clientHeight;
      const camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 100);
      camera.position.set(0, 0, debugCameraZRef.current);
      camera.lookAt(0, 0, 0);
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

      // object-fit: cover для 2D canvas с видео
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

      // пересчёт экранных landmarks для рисования скелета
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

        // экранные landmarks — только для рисования скелета
        const screenLandmarks = results.landmarks?.[0];
        // 🔑 world landmarks — метрические 3D координаты, Y вверх (как в Three.js)
        const worldLandmarks = results.worldLandmarks?.[0];

        if (screenLandmarks && crop) {
          const adjusted = screenLandmarks.map((lm) => {
            const p = toCanvasPoint(lm, crop);
            return { ...lm, x: p.x / canvas.width, y: p.y / canvas.height };
          });
          drawingUtils.drawLandmarks(adjusted);
          drawingUtils.drawConnectors(adjusted, PoseLandmarker.POSE_CONNECTIONS);
        }

        if (worldLandmarks && garmentRef.current) {
          const pivot = garmentRef.current;
          const clothing = selectedClothingRef.current;

          const anchorPoint = clothing?.anchor ?? "shoulders";
          const { left: leftIdx, right: rightIdx } = ANCHOR_LANDMARKS[anchorPoint];

          // 🔑 координаты в метрах, Y смотрит вверх — совпадает с Three.js
          const L = worldLandmarks[leftIdx];
          const R = worldLandmarks[rightIdx];

          const centerX = (L.x + R.x) / 2;
          const centerY = (L.y + R.y) / 2;
          const centerZ = (L.z + R.z) / 2;

          // ширина опорной линии в метрах
          const refWidthM = Math.hypot(
            R.x - L.x,
            R.y - L.y,
            R.z - L.z
          );

          const naturalWidth = pivot.userData.naturalWidth as number;
          const fitScale = debugFitScaleRef.current;
          const verticalOffset = debugVerticalOffsetRef.current;

          pivot.scale.setScalar((refWidthM * fitScale) / naturalWidth);

          pivot.position.set(
            centerX,
            centerY - verticalOffset * refWidthM, // + вниз, − вверх
            centerZ
          );

          // 🔑 ориентация через честные 3D-векторы, без пикселей и atan2
          const rightVec = new THREE.Vector3(
            R.x - L.x,
            R.y - L.y,
            R.z - L.z
          ).normalize();

          // вертикаль: от бедра к плечу (тот же индекс, правая сторона)
          const hipIdx = anchorPoint === "shoulders" ? 24
            : anchorPoint === "hips" ? 28
            : 24;
          const hip = worldLandmarks[hipIdx];
          const shoulder = worldLandmarks[rightIdx];

          const upVec = new THREE.Vector3(
            shoulder.x - hip.x,
            shoulder.y - hip.y,
            shoulder.z - hip.z
          ).normalize();

          // forward = right × up (стандартная правая система координат)
          const forwardVec = new THREE.Vector3()
            .crossVectors(rightVec, upVec)
            .normalize();

          // собираем матрицу вращения из трёх базисных векторов
          const rotMatrix = new THREE.Matrix4().makeBasis(
            rightVec,
            upVec,
            forwardVec
          );
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

      {/* 🛠 DEBUG-ПАНЕЛЬ — удалить перед продом */}
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
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>DEBUG: {selectedClothing?.name ?? "—"}</strong>
            <button onClick={() => setDebugMode(false)}>скрыть</button>
          </div>

          {/* fitScale */}
          <label style={{ display: "block", marginTop: 8 }}>
            fitScale (размер): {debugFitScale.toFixed(2)}
            <input type="range" min={0.1} max={5} step={0.05}
              value={debugFitScale}
              onChange={(e) => setDebugFitScale(parseFloat(e.target.value))}
              style={{ width: "100%" }}
            />
          </label>

          {/* verticalOffset */}
          <label style={{ display: "block", marginTop: 8 }}>
            verticalOffset (+ вниз / − вверх): {debugVerticalOffset.toFixed(2)}
            <input type="range" min={-1} max={1} step={0.01}
              value={debugVerticalOffset}
              onChange={(e) => setDebugVerticalOffset(parseFloat(e.target.value))}
              style={{ width: "100%" }}
            />
          </label>

          {/* camera Z */}
          <label style={{ display: "block", marginTop: 8 }}>
            cameraZ (расстояние камеры, м): {debugCameraZ.toFixed(1)}
            <input type="range" min={0.5} max={5} step={0.1}
              value={debugCameraZ}
              onChange={(e) => setDebugCameraZ(parseFloat(e.target.value))}
              style={{ width: "100%" }}
            />
          </label>

          {/* model rotation */}
          <label style={{ display: "block", marginTop: 8 }}>
            modelRotation.x (вперёд/назад): {debugRotX}°
            <input type="range" min={-180} max={180} step={1}
              value={debugRotX}
              onChange={(e) => setDebugRotX(parseFloat(e.target.value))}
              style={{ width: "100%" }}
            />
          </label>

          <label style={{ display: "block", marginTop: 8 }}>
            modelRotation.y (вокруг вертикали): {debugRotY}°
            <input type="range" min={-180} max={180} step={1}
              value={debugRotY}
              onChange={(e) => setDebugRotY(parseFloat(e.target.value))}
              style={{ width: "100%" }}
            />
          </label>

          <label style={{ display: "block", marginTop: 8 }}>
            modelRotation.z (перевёрнутость): {debugRotZ}°
            <input type="range" min={-180} max={180} step={1}
              value={debugRotZ}
              onChange={(e) => setDebugRotZ(parseFloat(e.target.value))}
              style={{ width: "100%" }}
            />
          </label>

          <div style={{ marginTop: 10, fontSize: 11, opacity: 0.7 }}>
            👉 найди нужные значения и скопируй в clothes.ts:
            <br />
            fitScale: {debugFitScale.toFixed(2)},
            verticalOffset: {debugVerticalOffset.toFixed(2)},
            modelRotationOffset: {`{ x: ${debugRotX}, y: ${debugRotY}, z: ${debugRotZ} }`}
          </div>
        </div>
      )}
    </div>
  );
}