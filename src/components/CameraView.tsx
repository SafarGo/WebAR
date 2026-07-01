import { useEffect, useRef } from "react";
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
  const gltfSourceRef = useRef<THREE.Group | null>(null);
  const loadedModelUrlRef = useRef<string | null>(null);

  const selectedClothingRef = useRef<ClothingItem | null>(selectedClothing);
  const sceneReadyRef = useRef(false);

  const { ready } = usePose(videoRef);

  useEffect(() => {
    selectedClothingRef.current = selectedClothing;
  }, [selectedClothing]);

  // загрузка модели при смене одежды
  useEffect(() => {
    if (!selectedClothing) return;

    let cancelled = false;

    async function rebuild() {
      // ждём пока сцена будет готова
      if (!sceneRef.current) return;

      if (loadedModelUrlRef.current !== selectedClothing!.model) {
        gltfSourceRef.current = await loadGarmentSource(selectedClothing!.model);
        loadedModelUrlRef.current = selectedClothing!.model;
      }

      if (cancelled || !sceneRef.current || !gltfSourceRef.current) return;

      const pivot = buildPivot(
        gltfSourceRef.current,
        "center",
        { x: 0, y: 0, z: 0 }
      );

      if (garmentRef.current) sceneRef.current.remove(garmentRef.current);
      pivot.visible = false;
      sceneRef.current.add(pivot);
      garmentRef.current = pivot;
    }

    // если сцена ещё не готова — ждём через интервал
    const tryRebuild = () => {
      if (sceneReadyRef.current) {
        rebuild().catch(console.error);
      } else {
        const interval = setInterval(() => {
          if (sceneReadyRef.current) {
            clearInterval(interval);
            rebuild().catch(console.error);
          }
        }, 100);
        return () => clearInterval(interval);
      }
    };

    tryRebuild();
    return () => { cancelled = true; };
  }, [selectedClothing]);

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

      // камера смотрит в (0,0,0) с позиции z=2
      // объекты на z=0 в NDC координатах отображаются 1-к-1 на экран
      const w = container.clientWidth;
      const h = container.clientHeight;
      const camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 100);
      camera.position.set(0, 0, 2);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({
        canvas: threeCanvasRef.current!,
        alpha: true,
        antialias: true
      });
      renderer.setClearColor(0x000000, 0);

      sceneRef.current = scene;
      sceneReadyRef.current = true;

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

        if (screenLandmarks && worldLandmarks && garmentRef.current) {
          const pivot = garmentRef.current;
          const clothing = selectedClothingRef.current;

          // 🔑 ПРОСТОЙ СПОСОБ: screenLandmarks (0..1) → NDC (-1..1)
          // x: 0..1 → -1..1
          // y: 0..1 → 1..-1 (инвертируем Y — в экране Y вниз, в NDC вверх)
          const toNDC = (lm: { x: number; y: number }) => ({
            x: (lm.x - 0.5) * 2,
            y: -(lm.y - 0.5) * 2
          });

          const LS = toNDC(screenLandmarks[11]); // левое плечо
          const RS = toNDC(screenLandmarks[12]); // правое плечо
          const LH = toNDC(screenLandmarks[23]); // левое бедро
          const RH = toNDC(screenLandmarks[24]); // правое бедро

          const shoulderMid = {
            x: (LS.x + RS.x) / 2,
            y: (LS.y + RS.y) / 2
          };
          const hipMid = {
            x: (LH.x + RH.x) / 2,
            y: (LH.y + RH.y) / 2
          };

          const shoulderWidthNDC = Math.hypot(RS.x - LS.x, RS.y - LS.y);
          const torsoHeightNDC = Math.hypot(
            shoulderMid.x - hipMid.x,
            shoulderMid.y - hipMid.y
          );

          const naturalWidth = pivot.userData.naturalWidth as number;
          const naturalHeight = pivot.userData.naturalHeight as number;
          const maxNatural = Math.max(naturalWidth, naturalHeight);

          const fitScaleX = clothing?.fitScaleX ?? 1.3;
          const fitScaleY = clothing?.fitScaleY ?? 1.1;
          const verticalOffset = clothing?.verticalOffset ?? 0.3;

          const scaleX = (shoulderWidthNDC * fitScaleX) / (naturalWidth / maxNatural);
          const scaleY = (torsoHeightNDC * fitScaleY) / (naturalHeight / maxNatural);
          const scaleZ = scaleX * 0.3;
          pivot.scale.set(scaleX, scaleY, scaleZ);

          // позиция: центр плеч смещённый вниз на verticalOffset * высота торса
          pivot.position.set(
            shoulderMid.x,
            shoulderMid.y - verticalOffset * torsoHeightNDC,
            0
          );

          // ориентация из worldLandmarks (инвертируем Y для совместимости с Three.js)
          const WLS = { x: worldLandmarks[11].x, y: -worldLandmarks[11].y, z: worldLandmarks[11].z };
          const WRS = { x: worldLandmarks[12].x, y: -worldLandmarks[12].y, z: worldLandmarks[12].z };
          const WLH = { x: worldLandmarks[23].x, y: -worldLandmarks[23].y, z: worldLandmarks[23].z };
          const WRH = { x: worldLandmarks[24].x, y: -worldLandmarks[24].y, z: worldLandmarks[24].z };

          const rightVec = new THREE.Vector3(
            WLS.x - WRS.x,
            WLS.y - WRS.y,
            WLS.z - WRS.z
          ).normalize();

          const upVec = new THREE.Vector3(
            (WLS.x + WRS.x) / 2 - (WLH.x + WRH.x) / 2,
            (WLS.y + WRS.y) / 2 - (WLH.y + WRH.y) / 2,
            (WLS.z + WRS.z) / 2 - (WLH.z + WRH.z) / 2
          ).normalize();

          const forwardVec = new THREE.Vector3()
            .crossVectors(rightVec, upVec)
            .normalize();

          const bodyQ = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(rightVec, upVec, forwardVec)
          );

          // корректирующий поворот из clothes.ts
          const rot = clothing?.modelRotationOffset;
          const correctionQ = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              THREE.MathUtils.degToRad(rot?.x ?? 0),
              THREE.MathUtils.degToRad(rot?.y ?? 0),
              THREE.MathUtils.degToRad(rot?.z ?? 0)
            )
          );

          pivot.quaternion.multiplyQuaternions(bodyQ, correctionQ);
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
      sceneReadyRef.current = false;
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
    </div>
  );
}