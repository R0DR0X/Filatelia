import ColeccionesClient from "./ColeccionesClient";

export const metadata = {
  title: "Mi Colección | Filatelia Peruana",
  description: "Gestiona tu colección, lista de deseos, sellos para intercambio y sellos ignorados.",
};

export default function ColeccionesPage() {
  return <ColeccionesClient />;
}
