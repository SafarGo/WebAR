import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  DrawingUtils,
  PoseLandmarker
} from "@mediapipe/tasks-vision";
import { setupTracker } from "three-mediapipe-rig";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { usePose } from "../hooks/usePose";
import { getPoseLandmarker } from "../services/poseService";
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
  const sceneReadyRef = useRef(false);
  const bindingRef = useRef<{ update: (delta: number) => void } | null>(null);
  const trackerRef = useRef<Awaited<ReturnType<typeof setupTracker>> | null>(null);

  const selectedClothingRef = useRef<ClothingItem | null>(selectedClothing);
  const { ready } = usePose(videoRef);

  useEffect(() => {
    selectedClothingRef.current = selectedClothing;
  }, [selectedClothing]);

  // инициализируем трекер только для binding — без запуска камеры
  useEffect(() => {
    let cancelled = false;

    async function initTracker() {
      try {
        const tracker = await setupTracker({
          ignoreLegs: true,
          ignoreFace: true,
        });
        if (!cancelled) {
          trackerRef.current = tracker;
        }
      } catch (e) {
        console.error("Ошибка инициализации трекера:", e);
      }
    }

    initTracker();
    return () => { cancelled = true; };
  }, []);

  // загрузка модели
  useEffect(() => {
    if (!selectedClothing || !sceneRef.current || !trackerRef.current) return;
    let cancelled = false;

    async function loadModel() {
      const gltf = await new GLTFLoader().loadAsync(selectedClothing!.model);

      if (cancelled || !sceneRef.current || !trackerRef.current) return;

      let rig =
        gltf.scene.getObjectByName("rig") as THREE.Object3D | undefined ??
        gltf.scene.getObjectByName("Armature") as THREE.Object3D | undefined;

      if (!rig) {
        gltf.scene.traverse((obj) => {
          if ((obj as THREE.SkinnedMesh).isSkinnedMesh && !rig) {
            rig = obj.parent ?? obj;
          }
        });
      }

      if (!rig) {
        console.error("Арматура не найдена");
        return;
      }

      if (garmentRef.current) {
        sceneRef.current.remove(garmentRef.current);
      }

      sceneRef.current.add(gltf.scene);
      garmentRef.current = gltf.scene;

      // binding костей к трекеру — но трекер не запущен как камера
      // он будет получать landmarks вручную от нашего MediaPipe
      bindingRef.current = trackerRef.current.bind(rig);
    }

    if (sceneReadyRef.current) {
      loadModel().catch(console.error);
    } else {
      const interval = setInterval(() => {
        if (sceneReadyRef.current && trackerRef.current) {
          clearInterval(interval);
          loadModel().catch(console.error);
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
      scene.add(new THREE.AmbientLight(0xffffff, 1.2));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(0, 2, 3);
      scene.add(dirLight);

      const w = container.clientWidth;
      const h = container.clientHeight;
      const FOV = 60;
      const CAM_Z = 2;
      const threeCamera = new THREE.PerspectiveCamera(FOV, w / h, 0.01, 100);
      threeCamera.position.set(0, 0, CAM_Z);
      threeCamera.lookAt(0, 0, 0);
      cameraRef.current = threeCamera;

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

        threeCamera.aspect = cw / ch;
        threeCamera.updateProjectionMatrix();
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

      const screenToWorld = (nx: number, ny: number): THREE.Vector3 => {
        const ndcX = (nx - 0.5) * 2;
        const ndcY = -(ny - 0.5) * 2;
        const halfH = CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
        const halfW = halfH * threeCamera.aspect;
        return new THREE.Vector3(ndcX * halfW, ndcY * halfH, 0);
      };

      const clock = new THREE.Clock();

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

        // обновляем кости через binding
        if (bindingRef.current) {
          const delta = clock.getDelta();
          bindingRef.current.update(delta);
        }

        // позиционируем модель по скелету вручную
        if (screenLandmarks && worldLandmarks && garmentRef.current) {
          const clothing = selectedClothingRef.current;

          const LSw = screenToWorld(screenLandmarks[11].x, screenLandmarks[11].y);
          const RSw = screenToWorld(screenLandmarks[12].x, screenLandmarks[12].y);
          const LHw = screenToWorld(screenLandmarks[23].x, screenLandmarks[23].y);
          const RHw = screenToWorld(screenLandmarks[24].x, screenLandmarks[24].y);

          const shoulderMidW = LSw.clone().add(RSw).multiplyScalar(0.5);
          const hipMidW = LHw.clone().add(RHw).multiplyScalar(0.5);
          const torsoHeightW = shoulderMidW.distanceTo(hipMidW);
          const shoulderWidthW = LSw.distanceTo(RSw);

          const verticalOffset = clothing?.verticalOffset ?? 0.3;
          const fitScaleX = clothing?.fitScaleX ?? 1.0;

          // масштаб модели относительно ширины плеч
          const modelScale = shoulderWidthW * fitScaleX;
          garmentRef.current.scale.setScalar(modelScale);

          // позиция центра торса
          const anchorPos = shoulderMidW.clone();
          anchorPos.y -= verticalOffset * torsoHeightW;
          garmentRef.current.position.copy(anchorPos);

          // поворот из worldLandmarks
          const WLS = { x: worldLandmarks[11].x, y: -worldLandmarks[11].y, z: worldLandmarks[11].z };
          const WRS = { x: worldLandmarks[12].x, y: -worldLandmarks[12].y, z: worldLandmarks[12].z };
          const WLH = { x: worldLandmarks[23].x, y: -worldLandmarks[23].y, z: worldLandmarks[23].z };
          const WRH = { x: worldLandmarks[24].x, y: -worldLandmarks[24].y, z: worldLandmarks[24].z };

          const rightVec = new THREE.Vector3(WLS.x - WRS.x, WLS.y - WRS.y, WLS.z - WRS.z).normalize();
          const upVec = new THREE.Vector3(
            (WLS.x + WRS.x) / 2 - (WLH.x + WRH.x) / 2,
            (WLS.y + WRS.y) / 2 - (WLH.y + WRH.y) / 2,
            (WLS.z + WRS.z) / 2 - (WLH.z + WRH.z) / 2
          ).normalize();
          const forwardVec = new THREE.Vector3().crossVectors(rightVec, upVec).normalize();

          garmentRef.current.quaternion.setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(rightVec, upVec, forwardVec)
          );
        }

        renderer!.render(scene, threeCamera);
        animationId = requestAnimationFrame(detect);
      };

      detect();
    }

    startCamera();

    return () => {
      cancelAnimationFrame(animationId);
      cleanupResize?.();
      stream?.getTracks().forEach(t => t.stop());
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