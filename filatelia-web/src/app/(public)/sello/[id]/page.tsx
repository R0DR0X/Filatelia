import SelloDetailClient from "./SelloDetailClient";

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export default function SelloDetallePage({ params }: { params: { id: string } }) {
  return <SelloDetailClient id={params.id} />;
}
