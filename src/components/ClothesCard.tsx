import { useNavigate } from "react-router-dom";
import type { ClothingItem } from "../data/clothes";

interface ClothesCardProps {
  item: ClothingItem;
}

export default function ClothesCard({ item }: ClothesCardProps) {
  const { name, image } = item;
  const navigate = useNavigate();

  function handleTryOn() {
    navigate("/camera", {
      state: { clothing: item }
    });
  }

  return (
    <div
      style={{
        width: 300,
        padding: 20,
        border: "1px solid gray",
        borderRadius: 10,
        textAlign: "center"
      }}
    >
      <img src={image} width="250" />
      <h2>{name}</h2>
      <button onClick={handleTryOn}>Примерить</button>
    </div>
  );
}