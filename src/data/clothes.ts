export type AnchorPoint = "shoulders" | "hips" | "feet" | "head";
export type AnchorEdge = "top" | "center" | "bottom";

export interface ModelRotationOffset {
  x?: number;
  y?: number;
  z?: number;
}

export interface ClothingItem {
  id: number;
  name: string;
  image: string;
  model: string;
  fitScaleX?: number;
  fitScaleY?: number;
  anchor?: AnchorPoint;
  anchorEdge?: AnchorEdge;
  verticalOffset?: number;
  modelRotationOffset?: ModelRotationOffset;
}

export const clothes: ClothingItem[] = [
  {
    id: 1,
    name: "White T-Shirt",
    image: "/images/tshirt.png",
    model: "/models/tshirt.glb",
    fitScaleX: 1.3,
    fitScaleY: 1.1,
    anchor: "shoulders",
    anchorEdge: "top",
    verticalOffset: 0.0,
    modelRotationOffset: { x: 0, y: 0, z: 0 }
  }
];