import SubastasClient from "./SubastasClient";

export const metadata = {
  title: "Subastas Filatélicas en Vivo | Filatelia Perú",
  description: "Participa en tiempo real en subastas de sellos postales raros y piezas filatélicas históricas.",
};

export default function SubastasPage() {
  return <SubastasClient />;
}
