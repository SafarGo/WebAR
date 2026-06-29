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

  const { ready } = usePose(videoRef);

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
            const fitScale = clothing?.fitScale ?? 1.7;
            const scale = (refWidthPx * fitScale) / naturalWidth;

            const verticalOffsetPx = refWidthPx * (clothing?.verticalOffset ?? 0);

            pivot.scale.setScalar(scale);
            pivot.position.set(
              refCenter.x,
              canvas.height - (refCenter.y + verticalOffsetPx),
              0
            );

            // 🔁 roll (наклон) с переключателем инверсии
            const rollAngle = Math.atan2(
              rightPt.y - leftPt.y,
              rightPt.x - leftPt.x
            );
            const rollSign = clothing?.invertRoll ? 1 : -1;
            pivot.rotation.z = rollSign * rollAngle;

            // 🔁 yaw (поворот корпуса) с переключателем инверсии
            const yawSign = clothing?.invertYaw ? -1 : 1;
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
    </div>
  );
}