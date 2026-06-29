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
  const containerRef = useRef<HTMLDivElement>(null);

  const { ready } = usePose(videoRef);

  useEffect(() => {
    let animationId: number;

    async function startCamera() {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          // не задаём жёстко 1920x1080 — пусть браузер сам выберет
          // оптимальное под устройство, или ставим адекватный ideal:
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await video.play();

      // 📐 РАЗМЕР КАНВАСА = РАЗМЕР КОНТЕЙНЕРА (экрана), А НЕ ВИДЕО
      const resizeCanvas = () => {
        const container = containerRef.current!;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = container.clientWidth * dpr;
        canvas.height = container.clientHeight * dpr;
        canvas.style.width = `${container.clientWidth}px`;
        canvas.style.height = `${container.clientHeight}px`;
      };

      resizeCanvas();
      window.addEventListener("resize", resizeCanvas);

      // Функция отрисовки видео по принципу object-fit: cover
      const drawVideoCover = () => {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const cw = canvas.width;
        const ch = canvas.height;

        if (!vw || !vh) return;

        const videoRatio = vw / vh;
        const canvasRatio = cw / ch;

        let sx, sy, sWidth, sHeight;

        if (videoRatio > canvasRatio) {
          // видео шире канваса -> обрезаем по горизонтали
          sHeight = vh;
          sWidth = vh * canvasRatio;
          sx = (vw - sWidth) / 2;
          sy = 0;
        } else {
          // видео выше канваса -> обрезаем по вертикали
          sWidth = vw;
          sHeight = vw / canvasRatio;
          sx = 0;
          sy = (vh - sHeight) / 2;
        }

        ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, cw, ch);

        // возвращаем параметры кропа, если нужно пересчитывать координаты landmarks
        return { sx, sy, sWidth, sHeight };
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

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const crop = drawVideoCover();

        if (results.landmarks && crop) {
          const drawingUtils = new DrawingUtils(ctx);
          for (const landmarks of results.landmarks) {
            // ВАЖНО: landmarks приходят в нормализованных координатах
            // относительно ИСХОДНОГО видео, а не обрезанного канваса.
            // Нужно пересчитать их под кроп, см. ниже.
            const adjusted = landmarks.map((lm) => ({
              ...lm,
              x: ((lm.x * video.videoWidth - crop.sx) / crop.sWidth),
              y: ((lm.y * video.videoHeight - crop.sy) / crop.sHeight)
            }));
            drawingUtils.drawLandmarks(adjusted);
            drawingUtils.drawConnectors(
              adjusted,
              PoseLandmarker.POSE_CONNECTIONS
            );
          }
        }

        animationId = requestAnimationFrame(detect);
      };

      detect();

      return () => window.removeEventListener("resize", resizeCanvas);
    }

    startCamera();

    return () => cancelAnimationFrame(animationId);
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
        style={{ display: "block" }}
      />

      {!ready && (
        <p style={{ position: "absolute", top: 10, left: 10, color: "#fff" }}>
          Loading pose model...
        </p>
      )}
    </div>
  );
}