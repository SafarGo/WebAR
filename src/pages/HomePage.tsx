import ClothesCard from "../components/ClothesCard";
import { clothes } from "../data/clothes";

export default function HomePage() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        marginTop: 60
      }}
    >
      {clothes.map((item) => (
        <ClothesCard key={item.id} item={item} />
      ))}
    </div>
  );
}