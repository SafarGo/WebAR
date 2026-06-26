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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: 
        {
            facingMode: { ideal: 'environment' }
        }
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const detect = () => {
        const video = videoRef.current!;
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;

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
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const drawingUtils = new DrawingUtils(ctx);

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
    <div>
      <video ref={videoRef} style={{ display: "none" }} />
      <canvas ref={canvasRef} width={640} height={480} />
      {!ready && <p>Loading pose model...</p>}
    </div>
  );
}