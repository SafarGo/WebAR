export interface ClothingItem {
  id: number;
  name: string;
  image: string;
  model: string;
}

export const clothes: ClothingItem[] = [
  {
    id: 1,
    name: "White T-Shirt",
    image: "/images/tshirt.png",
    model: "/models/tshirt.glb"
  }
];