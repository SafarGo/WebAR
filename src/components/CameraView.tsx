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
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const gltfSourceRef = useRef<THREE.Group | null>(null);
  const loadedModelUrlRef = useRef<string | null>(null);
  const sceneReadyRef = useRef(false);

  const selectedClothingRef = useRef<ClothingItem | null>(selectedClothing);

  const { ready } = usePose(videoRef);

  useEffect(() => {
    selectedClothingRef.current = selectedClothing;
  }, [selectedClothing]);

  useEffect(() => {
    if (!selectedClothing) return;
    let cancelled = false;

    async function rebuild() {
      if (!sceneRef.current) return;

      if (loadedModelUrlRef.current !== selectedClothing!.model) {
        gltfSourceRef.current = await loadGarmentSource(selectedClothing!.model);
        loadedModelUrlRef.current = selectedClothing!.model;
      }

      if (cancelled || !sceneRef.current || !gltfSourceRef.current) return;

      const pivot = buildPivot(
        gltfSourceRef.current,
        "center",
        selectedClothing!.modelRotationOffset ?? {}
      );

      if (garmentRef.current) sceneRef.current.remove(garmentRef.current);
      pivot.visible = false;
      sceneRef.current.add(pivot);
      garmentRef.current = pivot;
    }

    if (sceneReadyRef.current) {
      rebuild().catch(console.error);
    } else {
      const interval = setInterval(() => {
        if (sceneReadyRef.current) {
          clearInterval(interval);
          rebuild().catch(console.error);
        }
      }, 50);
      return () => clearInterval(interval);
    }

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
      scene.add(new THREE.AmbientLight(0xffffff, 1.0));
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
      dirLight.position.set(0, 2, 3);
      scene.add(dirLight);
      const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
      backLight.position.set(0, -1, -2);
      scene.add(backLight);

      const w = container.clientWidth;
      const h = container.clientHeight;
      const FOV = 60;
      const CAM_Z = 2;
      const camera = new THREE.PerspectiveCamera(FOV, w / h, 0.01, 100);
      camera.position.set(0, 0, CAM_Z);
      camera.lookAt(0, 0, 0);
      cameraRef.current = camera;

      renderer = new THREE.WebGLRenderer({
        canvas: threeCanvasRef.current!,
        alpha: true,
        antialias: true
      });
      renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.enabled = true;

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

      // 🔑 правильный unproject: экранные coords (0-1) → world coords
      // учитывает FOV и aspect ratio в отличие от прямого NDC
      const screenToWorld = (nx: number, ny: number): THREE.Vector3 => {
        const ndcX = (nx - 0.5) * 2;
        const ndcY = -(ny - 0.5) * 2;

        // вычисляем размер вьюпорта на плоскости z=0
        const halfH = CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
        const halfW = halfH * camera.aspect;

        return new THREE.Vector3(ndcX * halfW, ndcY * halfH, 0);
      };

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

        if (screenLandmarks && worldLandmarks && garmentRef.current) {
          const pivot = garmentRef.current;
          const clothing = selectedClothingRef.current;

          // 🔑 переводим screen coords → world coords с учётом FOV и aspect
          const LSw = screenToWorld(screenLandmarks[11].x, screenLandmarks[11].y);
          const RSw = screenToWorld(screenLandmarks[12].x, screenLandmarks[12].y);
          const LHw = screenToWorld(screenLandmarks[23].x, screenLandmarks[23].y);
          const RHw = screenToWorld(screenLandmarks[24].x, screenLandmarks[24].y);

          const shoulderWidthW = LSw.distanceTo(RSw);
          const shoulderMidW = LSw.clone().add(RSw).multiplyScalar(0.5);
          const hipMidW = LHw.clone().add(RHw).multiplyScalar(0.5);
          const torsoHeightW = shoulderMidW.distanceTo(hipMidW);

          // naturalWidth теперь нормализован (0-1), fitScale = множитель
          const naturalWidth = pivot.userData.naturalWidth as number;
          const naturalHeight = pivot.userData.naturalHeight as number;

          const fitScaleX = clothing?.fitScaleX ?? 1.3;
          const fitScaleY = clothing?.fitScaleY ?? 1.1;
          const verticalOffset = clothing?.verticalOffset ?? 0.3;

          const scaleX = (shoulderWidthW * fitScaleX) / naturalWidth;
          const scaleY = (torsoHeightW * fitScaleY) / naturalHeight;
          const scaleZ = scaleX * 0.3;

          pivot.scale.set(scaleX, scaleY, scaleZ);

          // позиция: центр плеч смещённый вниз
          const anchorPos = shoulderMidW.clone();
          anchorPos.y -= verticalOffset * torsoHeightW;
          pivot.position.copy(anchorPos);

          // ориентация из worldLandmarks (Y инвертируем: MediaPipe Y↓, Three.js Y↑)
          const WLS = { x: worldLandmarks[11].x, y: -worldLandmarks[11].y, z: worldLandmarks[11].z };
          const WRS = { x: worldLandmarks[12].x, y: -worldLandmarks[12].y, z: worldLandmarks[12].z };
          const WLH = { x: worldLandmarks[23].x, y: -worldLandmarks[23].y, z: worldLandmarks[23].z };
          const WRH = { x: worldLandmarks[24].x, y: -worldLandmarks[24].y, z: worldLandmarks[24].z };

          const rightVec = new THREE.Vector3(
            WRS.x - WLS.x,
            WRS.y - WLS.y,
            WRS.z - WLS.z
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