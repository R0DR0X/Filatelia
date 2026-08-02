import SelloDetailClient from "./SelloDetailClient";

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export default async function SelloDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SelloDetailClient id={id} />;
}
