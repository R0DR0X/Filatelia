import { NextRequest, NextResponse } from "next/server";
import { getUserCollection, addCollectionItem, updateCollectionItem, deleteCollectionItem } from "@/lib/db/collection";
import { ListType, ConditionGrade, isValidListType, isValidCondition } from "@/types/collection";

// A quantity is only "present" when the caller sent something other than
// undefined; when absent, addCollectionItem/updateCollectionItem default it
// to 1. When present, it must be a positive integer — anything else
// (0, negative, a float, a non-numeric string, etc.) is a 400.
function isValidQuantityIfPresent(value: unknown): boolean {
  if (value === undefined) return true;
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

import { verifySession } from "@/lib/session";

export const runtime = 'edge';

async function getUserIdFromSession(request: NextRequest): Promise<string | null> {
  const sessionCookie = request.cookies.get("fp_session")?.value;
  if (!sessionCookie) {
    return null;
  }

  const payload = await verifySession(sessionCookie);
  return payload?.id || null;
}

export async function GET(request: NextRequest) {
  const userId = await getUserIdFromSession(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const listTypeParam = searchParams.get("list_type") as ListType | null;

  try {
    const items = await getUserCollection(userId, listTypeParam || undefined);
    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const userId = await getUserIdFromSession(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { stampId, listType, condition, quantity, notes } = body;

    if (!stampId || !listType || !isValidListType(listType)) {
      return NextResponse.json({ error: "Invalid list_type or stampId parameter" }, { status: 400 });
    }

    if (condition && !isValidCondition(condition)) {
      return NextResponse.json({ error: "Invalid condition grade" }, { status: 400 });
    }

    if (!isValidQuantityIfPresent(quantity)) {
      return NextResponse.json({ error: "Invalid quantity: must be an integer >= 1" }, { status: 400 });
    }

    // `condition` is forwarded as `undefined` when absent rather than
    // defaulted to 'MNH' here: addCollectionItem distinguishes "the caller
    // supplied this field" (overwrite an existing row) from "the caller
    // omitted it" (leave an existing row alone, default only on insert), and
    // defaulting at this layer would erase that distinction and silently
    // downgrade a stored 'Used' to 'MNH' on every bare re-add.
    const item = await addCollectionItem(userId, {
      stampId,
      listType: listType as ListType,
      condition: condition ? (condition as ConditionGrade) : undefined,
      quantity,
      notes,
    });

    return NextResponse.json({ success: true, item }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  const userId = await getUserIdFromSession(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, condition, quantity, notes } = body;

    if (!id) {
      return NextResponse.json({ error: "Item ID is required" }, { status: 400 });
    }

    if (condition && !isValidCondition(condition)) {
      return NextResponse.json({ error: "Invalid condition grade" }, { status: 400 });
    }

    if (!isValidQuantityIfPresent(quantity)) {
      return NextResponse.json({ error: "Invalid quantity: must be an integer >= 1" }, { status: 400 });
    }

    const item = await updateCollectionItem(userId, Number(id), { condition, quantity, notes });
    return NextResponse.json({ success: true, item });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const userId = await getUserIdFromSession(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id");

    if (!id) {
      const body = await request.json().catch(() => ({}));
      id = body.id;
    }

    if (!id) {
      return NextResponse.json({ error: "Item ID is required" }, { status: 400 });
    }

    const success = await deleteCollectionItem(userId, Number(id));
    if (!success) {
      return NextResponse.json({ error: "Item not found or unauthorized" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
