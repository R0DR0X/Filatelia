import { Suspense } from "react";
import BibliotecaClient from "./BibliotecaClient";

export const metadata = {
  title: "Biblioteca Filatélica | Filatelia Peruana",
  description: "Explora más de 44,000 sellos de todo el mundo. Busca por país, denominación, año o tema.",
};

// BibliotecaClient reads the query string (E3.6: the detail page links country,
// theme and series into this catalogue). A statically rendered page whose
// Client Component calls `useSearchParams` fails the production build unless
// it sits behind a Suspense boundary. Passing `searchParams` down from here
// instead would work too, but it would force the whole route dynamic — and
// this page fetches its stamps client-side anyway, so there is nothing to gain
// by giving up the prerendered shell.
export default function BibliotecaPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <BibliotecaClient />
    </Suspense>
  );
}
