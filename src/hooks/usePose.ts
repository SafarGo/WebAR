import { useEffect, useRef, useState } from "react";
import { initPose } from "../services/poseService";

export function usePose(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const requestRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let running = true;

    async function setup() {
      await initPose();
      setReady(true);

      const loop = () => {
        if (!running) return;

        requestRef.current = requestAnimationFrame(loop);
      };

      loop();
    }

    setup();

    return () => {
      running = false;
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [videoRef]);

  return { ready };
}