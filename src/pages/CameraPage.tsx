import { useLocation, Navigate } from "react-router-dom";
import CameraView from "../components/CameraView";
import type { ClothingItem } from "../data/clothes";

interface CameraPageState {
  clothing: ClothingItem;
}

export default function CameraPage() {
  const location = useLocation();
  const state = location.state as CameraPageState | null;

  // если зайти на /camera напрямую (например, обновить страницу) — state будет null
  if (!state?.clothing) {
    return <Navigate to="/" replace />;
  }

  return (
    <div>
      <h1>Virtual Try-On</h1>
      <CameraView selectedClothing={state.clothing} />
    </div>
  );
}