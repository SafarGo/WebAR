export type AnchorPoint = "shoulders" | "hips" | "feet" | "head";
export type AnchorEdge = "top" | "center" | "bottom";

export interface ClothingItem {
  id: number;
  name: string;
  image: string;
  model: string;
  fitScale?: number;        // ширина модели относительно ширины опорной линии
  anchor?: AnchorPoint;     // к какой части тела привязываем (по умолчанию "shoulders")
  anchorEdge?: AnchorEdge;  // какой край модели совмещается с опорной линией (по умолчанию "top")
  verticalOffset?: number;  // доп. сдвиг: + вниз, − вверх, в долях от ширины опорной линии
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
    verticalOffset: 0.2
  },
  {
    id: 2,
    name: "Test Cube",
    image: "/images/tshirt.png",
    model: "/models/cube.glb",
    fitScale: 1,
    anchor: "shoulders",
    anchorEdge: "top",
    verticalOffset: 0.3
  }
];