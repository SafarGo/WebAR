import { useEffect, useRef } from "react";
import {
  DrawingUtils,
  PoseLandmarker
} from "@mediapipe/tasks-vision";

import { usePose } from "../hooks/usePose";
import { getPoseLandmarker } from "../services/poseService";

export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { ready } = usePose(videoRef);

  useEffect(() => {
    let animationId: number;

    async function startCamera() {
      // 🎥 1. КАМЕРА (задняя + HD)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await video.play();

      // 📐 2. СИНХРОНИЗАЦИЯ РАЗМЕРОВ (ВАЖНО для качества)
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      };

      const detect = () => {
        const poseLandmarker = getPoseLandmarker();

        if (!poseLandmarker) {
          animationId = requestAnimationFrame(detect);
          return;
        }

        const results = poseLandmarker.detectForVideo(
          video,
          performance.now()
        );

        // 🧹 очистка canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 📷 рисуем видео на canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const drawingUtils = new DrawingUtils(ctx);

        // 🧍 рисуем скелет
        if (results.landmarks) {
          for (const landmarks of results.landmarks) {
            drawingUtils.drawLandmarks(landmarks);
            drawingUtils.drawConnectors(
              landmarks,
              PoseLandmarker.POSE_CONNECTIONS
            );
          }
        }

        animationId = requestAnimationFrame(detect);
      };

      detect();
    }

    startCamera();

    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <div style={{ position: "relative" }}>
      {/* скрытое видео */}
      <video ref={videoRef} style={{ display: "none" }} />

      {/* canvas с AR */}
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "auto" }}
      />

      {!ready && (
        <p style={{ position: "absolute", top: 10, left: 10 }}>
          Loading pose model...
        </p>
      )}
    </div>
  );
}