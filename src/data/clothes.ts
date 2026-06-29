export type AnchorPoint = "shoulders" | "hips" | "feet" | "head";
export type AnchorEdge = "top" | "center" | "bottom";

export interface ModelRotationOffset {
  x?: number; // градусы
  y?: number;
  z?: number;
}

export interface ClothingItem {
  id: number;
  name: string;
  image: string;
  model: string;
  fitScale?: number;
  anchor?: AnchorPoint;
  anchorEdge?: AnchorEdge;
  verticalOffset?: number;
  invertRoll?: boolean;
  invertYaw?: boolean;
  modelRotationOffset?: ModelRotationOffset; // корректирующий поворот модели при загрузке
}

export const clothes: ClothingItem[] = [
  {
    id: 1,
    name: "White T-Shirt",
    image: "/images/tshirt.png",
    model: "/models/tshirt.glb",
    fitScale: 1.7,
    anchor: "shoulders",
    anchorEdge: "top",
    verticalOffset: 0.2,
    invertRoll: false,
    invertYaw: true, // 🔑 то же значение, что уже сработало для куба — это свойство трекинга, а не модели
    modelRotationOffset: { x: 0, y: 0, z: 0 } // подбери через debug-слайдеры
  },
  {
    id: 2,
    name: "Test Cube",
    image: "/images/tshirt.png",
    model: "/models/cube.glb",
    fitScale: 1,
    anchor: "shoulders",
    anchorEdge: "top",
    verticalOffset: 1.2,
    invertRoll: false,
    invertYaw: true,
    modelRotationOffset: { x: 0, y: 0, z: 0 }
  }
];