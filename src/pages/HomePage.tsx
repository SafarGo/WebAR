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

            <ClothesCard
                name={clothes[0].name}
                image={clothes[0].image}
                model={clothes[0].model}
            />

        </div>

    );

}