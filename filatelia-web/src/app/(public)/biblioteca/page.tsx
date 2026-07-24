import BibliotecaClient from "./BibliotecaClient";

export const metadata = {
  title: "Biblioteca Filatélica | Filatelia Peruana",
  description: "Explora más de 44,000 sellos de todo el mundo. Busca por país, denominación, año o tema.",
};

export default function BibliotecaPage() {
  return <BibliotecaClient />;
}
