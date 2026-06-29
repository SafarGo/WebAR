export interface ClothingItem {
  id: number;
  name: string;
  image: string;
  model: string;
  fitScale?: number; // во сколько раз одежда шире, чем расстояние между плечевыми суставами (по умолчанию ~1.7)
}

export const clothes: ClothingItem[] = [
  {
    id: 1,
    name: "White T-Shirt",
    image: "/images/tshirt.png",
    model: "/models/tshirt.glb",
    fitScale: 1.7
  }
];