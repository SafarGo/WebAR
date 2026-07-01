import { useEffect, useRef } from "react";
import {
  DrawingUtils,
  PoseLandmarker
} from "@mediapipe/tasks-vision";

import { usePose } from "../hooks/usePose";
import { getPoseLandmarker } from "../services/poseService";
import type { ClothingItem } from "../data/clothes";

interface CameraViewProps {
  selectedClothing: ClothingItem | null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function CameraView({ selectedClothing }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { ready } = usePose(videoRef);

  useEffect(() => {
    let animationId: number;
    let stream: MediaStream | undefined;

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

      const resizeCanvas = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      };

      resizeCanvas();
      window.addEventListener("resize", resizeCanvas);

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

        const screenLandmarks = results.landmarks?.[0];
        const worldLandmarks = results.worldLandmarks?.[0];

        if (screenLandmarks && crop) {
          const drawingUtils = new DrawingUtils(ctx);

          const adjusted = screenLandmarks.map((lm) => {
            const p = toCanvasPoint(lm, crop);
            return { ...lm, x: p.x / canvas.width, y: p.y / canvas.height };
          });

          // стандартный скелет по экранным координатам
          drawingUtils.drawLandmarks(adjusted, {
            color: "#00FF00",
            radius: 4
          });
          drawingUtils.drawConnectors(adjusted, PoseLandmarker.POSE_CONNECTIONS, {
            color: "#00FF00",
            lineWidth: 2
          });

          // 🔑 дополнительно рисуем ключевые точки из worldLandmarks,
          // спроецированные обратно через screenLandmarks — чтобы видеть,
          // что трекер "знает" о 3D-положении плеч и бёдер
          if (worldLandmarks) {
            const keyPoints = [
              { idx: 11, label: "L.shoulder" },
              { idx: 12, label: "R.shoulder" },
              { idx: 23, label: "L.hip" },
              { idx: 24, label: "R.hip" }
            ];

            keyPoints.forEach(({ idx, label }) => {
              const screen = toCanvasPoint(screenLandmarks[idx], crop);
              const world = worldLandmarks[idx];

              // красный круг на ключевой точке
              ctx.beginPath();
              ctx.arc(screen.x, screen.y, 8, 0, Math.PI * 2);
              ctx.fillStyle = "rgba(255, 0, 0, 0.8)";
              ctx.fill();

              // подпись с 3D-координатами в метрах
              ctx.fillStyle = "#fff";
              ctx.font = `${Math.round(canvas.width / 40)}px monospace`;
              ctx.fillText(
                `${label} x:${world.x.toFixed(2)} y:${world.y.toFixed(2)} z:${world.z.toFixed(2)}`,
                screen.x + 10,
                screen.y
              );
            });

            // линия между плечами
            const ls = toCanvasPoint(screenLandmarks[11], crop);
            const rs = toCanvasPoint(screenLandmarks[12], crop);
            ctx.beginPath();
            ctx.moveTo(ls.x, ls.y);
            ctx.lineTo(rs.x, rs.y);
            ctx.strokeStyle = "rgba(255, 100, 0, 0.9)";
            ctx.lineWidth = 3;
            ctx.stroke();

            // ширина плеч в метрах поверх линии
            const wL = worldLandmarks[11];
            const wR = worldLandmarks[12];
            const shoulderWidthM = Math.hypot(
              wR.x - wL.x,
              wR.y - wL.y,
              wR.z - wL.z
            ).toFixed(3);

            const midX = (ls.x + rs.x) / 2;
            const midY = (ls.y + rs.y) / 2;
            ctx.fillStyle = "orange";
            ctx.font = `bold ${Math.round(canvas.width / 35)}px monospace`;
            ctx.fillText(`${shoulderWidthM}m`, midX, midY - 10);
          }
        }

        animationId = requestAnimationFrame(detect);
      };

      detect();
    }

    startCamera();

    return () => {
      cancelAnimationFrame(animationId);
      stream?.getTracks().forEach((t) => t.stop());
      window.removeEventListener("resize", () => {});
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

      {!ready && (
        <p style={{ position: "absolute", top: 10, left: 10, color: "#fff" }}>
          Loading pose model...
        </p>
      )}
    </div>
  );
}