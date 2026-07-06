export interface ClothingItem {
  id: number;
  name: string;
  image: string;
  model: string;
  fitScaleX?: number;
  fitScaleY?: number;
  verticalOffset?: number;
}

export const clothes: ClothingItem[] = [
  {
    id: 1,
    name: "White T-Shirt",
    image: "/images/tshirt.png",
    model: "/models/tshirt.glb",
    fitScaleX: 1.0,
    fitScaleY: 1.0,
    verticalOffset: 0.3
  }
];