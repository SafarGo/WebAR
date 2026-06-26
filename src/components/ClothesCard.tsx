import { useNavigate } from "react-router-dom";

interface ClothesProps {
    name: string;
    image: string;
    model: string;
}

export default function ClothesCard({
    name,
    image,
    model,
}: ClothesProps) {

    const navigate = useNavigate();

    function handleTryOn() {
        navigate("/camera", {
            state: {
                model
            }
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

            <img
                src={image}
                width="250"
            />

            <h2>{name}</h2>

            <button onClick={handleTryOn}>
                Примерить
            </button>

        </div>
    );
}