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
  const [debugVerticalOffset, setDebugVerticalOffset] = useState(selectedClothing?.verticalOffset ?? 0.0);
  const [debugRotX, setDebugRotX] = useState(selectedClothing?.modelRotationOffset?.x ?? 0);
  const [debugRotY, setDebugRotY] = useState(selectedClothing?.modelRotationOffset?.y ?? 0);
  const [debugRotZ, setDebugRotZ] = useState(selectedClothing?.modelRotationOffset?.z ?? 0);

  if (selectedClothing && selectedClothing.id !== lastClothingId) {
    setLastClothingId(selectedClothing.id);
    setDebugFitScaleX(selectedClothing.fitScaleX ?? 1.3);
    setDebugFitScaleY(selectedClothing.fitScaleY ?? 1.1);
    setDebugVerticalOffset(selectedClothing.verticalOffset ?? 0.0);
    setDebugRotX(selectedClothing.modelRotationOffset?.x ?? 0);
    setDebugRotY(selectedClothing.modelRotationOffset?.y ?? 0);
    setDebugRotZ(selectedClothing.modelRotationOffset?.z ?? 0);
  }

  const debugFitScaleXRef = useRef(debugFitScaleX);
  const debugFitScaleYRef = useRef(debugFitScaleY);
  const debugVerticalOffsetRef = useRef(debugVerticalOffset);
  const debugRotXRef = useRef(debugRotX);
  const debugRotYRef = useRef(debugRotY);
  const debugRotZRef = useRef(debugRotZ);

  useEffect(() => { debugFitScaleXRef.current = debugFitScaleX; }, [debugFitScaleX]);
  useEffect(() => { debugFitScaleYRef.current = debugFitScaleY; }, [debugFitScaleY]);
  useEffect(() => { debugVerticalOffsetRef.current = debugVerticalOffset; }, [debugVerticalOffset]);
  useEffect(() => { debugRotXRef.current = debugRotX; }, [debugRotX]);
  useEffect(() => { debugRotYRef.current = debugRotY; }, [debugRotY]);
  useEffect(() => { debugRotZRef.current = debugRotZ; }, [debugRotZ]);

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

      const pivot = buildPivot(
        gltfSourceRef.current,
        selectedClothing!.anchorEdge ?? "top",
        { x: 0, y: 0, z: 0 } // поворот теперь управляется через Euler в detect()
      );

      if (garmentRef.current) sceneRef.current.remove(garmentRef.current);
      pivot.visible = false;
      sceneRef.current.add(pivot);
      garmentRef.current = pivot;
    }

    rebuild().catch(console.error);
    return () => { cancelled = true; };
  }, [selectedClothing, sceneReady]);

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
      camera.position.set(0, 0, 2);
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
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;

        renderer!.setSize(cw, ch);
        renderer!.setPixelRatio(dpr);

        camera.aspect = cw / ch;
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

        if (screenLandmarks && worldLandmarks && garmentRef.current && cameraRef.current) {
          const pivot = garmentRef.current;
          const cam = cameraRef.current;

          const unprojectPoint = (nx: number, ny: number, targetZ: number) => {
            const ndc = new THREE.Vector3(nx * 2 - 1, -(ny * 2 - 1), 0.5);
            ndc.unproject(cam);
            const dir = ndc.sub(cam.position).normalize();
            const t = (targetZ - cam.position.z) / dir.z;
            return cam.position.clone().add(dir.multiplyScalar(t));
          };

          const avgShoulderZ = (worldLandmarks[11].z + worldLandmarks[12].z) / 2;

          const LSw = unprojectPoint(screenLandmarks[11].x, screenLandmarks[11].y, avgShoulderZ);
          const RSw = unprojectPoint(screenLandmarks[12].x, screenLandmarks[12].y, avgShoulderZ);
          const LHw = unprojectPoint(screenLandmarks[23].x, screenLandmarks[23].y, avgShoulderZ);
          const RHw = unprojectPoint(screenLandmarks[24].x, screenLandmarks[24].y, avgShoulderZ);

          const shoulderWidthW = LSw.distanceTo(RSw);
          const shoulderMidW = LSw.clone().add(RSw).multiplyScalar(0.5);
          const hipMidW = LHw.clone().add(RHw).multiplyScalar(0.5);
          const torsoHeightW = shoulderMidW.distanceTo(hipMidW);

          const naturalWidth = pivot.userData.naturalWidth as number;
          const naturalHeight = pivot.userData.naturalHeight as number;

          const fitScaleX = debugFitScaleXRef.current;
          const fitScaleY = debugFitScaleYRef.current;
          const verticalOffset = debugVerticalOffsetRef.current;

          const scaleX = (shoulderWidthW * fitScaleX) / naturalWidth;
          const scaleY = (torsoHeightW * fitScaleY) / naturalHeight;
          const scaleZ = (scaleX + scaleY) / 2;
          pivot.scale.set(scaleX, scaleY, scaleZ);

          const torsoCenterW = shoulderMidW.clone().add(hipMidW).multiplyScalar(0.5);
          torsoCenterW.y -= verticalOffset * torsoHeightW;
          pivot.position.copy(torsoCenterW);

          // 🔑 ДИАГНОСТИКА: фиксированный Euler поворот через слайдеры
          // Найди углы при которых модель стоит правильно (лицом к тебе, не перевёрнута)
          // Потом скажи мне эти значения — встрою их в makeBasis для отслеживания поворота тела
          pivot.quaternion.setFromEuler(new THREE.Euler(
            THREE.MathUtils.degToRad(debugRotXRef.current),
            THREE.MathUtils.degToRad(debugRotYRef.current),
            THREE.MathUtils.degToRad(debugRotZRef.current)
          ));

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
          background: "rgba(0,0,0,0.82)",
          color: "#fff",
          padding: "12px 16px",
          fontSize: 13,
          fontFamily: "monospace",
          boxSizing: "border-box",
          maxHeight: "60vh",
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
            rotX: {debugRotX}°
            <input type="range" min={-180} max={180} step={1}
              value={debugRotX}
              onChange={(e) => setDebugRotX(parseFloat(e.target.value))}
              style={{ width: "100%" }} />
          </label>

          <label style={{ display: "block", marginTop: 8 }}>
            rotY: {debugRotY}°
            <input type="range" min={-180} max={180} step={1}
              value={debugRotY}
              onChange={(e) => setDebugRotY(parseFloat(e.target.value))}
              style={{ width: "100%" }} />
          </label>

          <label style={{ display: "block", marginTop: 8 }}>
            rotZ: {debugRotZ}°
            <input type="range" min={-180} max={180} step={1}
              value={debugRotZ}
              onChange={(e) => setDebugRotZ(parseFloat(e.target.value))}
              style={{ width: "100%" }} />
          </label>

          <div style={{ marginTop: 10, fontSize: 11, opacity: 0.7 }}>
            👉 найди углы при которых модель стоит правильно и скажи мне:<br />
            rotX: {debugRotX}°, rotY: {debugRotY}°, rotZ: {debugRotZ}°<br />
            fitScaleX: {debugFitScaleX.toFixed(2)}, fitScaleY: {debugFitScaleY.toFixed(2)},
            verticalOffset: {debugVerticalOffset.toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
}