import { useEffect, useRef } from "react";

export default function CameraView() {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        async function startCamera() {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
            });

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        }

        startCamera();
    }, []);

    return (
        <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{
                width: "100%",
                maxWidth: 800,
            }}
        />
    );
}