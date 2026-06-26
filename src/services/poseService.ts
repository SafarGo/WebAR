import {
  PoseLandmarker,
  FilesetResolver
} from "@mediapipe/tasks-vision";

let poseLandmarker: PoseLandmarker | null = null;

export async function initPose() {
  if (poseLandmarker) return poseLandmarker;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
    },
    runningMode: "VIDEO"
  });

  return poseLandmarker;
}

export function getPoseLandmarker() {
  return poseLandmarker;
}