import { NextRequest, NextResponse } from "next/server";
import { getUserCollection, addCollectionItem, updateCollectionItem, deleteCollectionItem } from "@/lib/db/collection";
import { ListType, ConditionGrade } from "@/types/collection";

function getUserIdFromSession(request: NextRequest): string | null {
  const sessionCookie = request.cookies.get("fp_session")?.value;
  if (!sessionCookie) {
    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      if (token.startsWith("usr_")) return token;
    }
    return null;
  }

  try {
    const parsed = JSON.parse(sessionCookie);
    return parsed.id || null;
  } catch {
    return sessionCookie.startsWith("usr_") ? sessionCookie : null;
  }
}

export async function GET(request: NextRequest) {
  const userId = getUserIdFromSession(request);
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
  const userId = getUserIdFromSession(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { stampId, listType, condition, notes } = body;

    const validListTypes = ['collection', 'wishlist', 'trade'];
    const validConditions = ['MNH', 'MH', 'Used', 'FDC'];

    if (!stampId || !listType || !validListTypes.includes(listType)) {
      return NextResponse.json({ error: "Invalid list_type or stampId parameter" }, { status: 400 });
    }

    if (condition && !validConditions.includes(condition)) {
      return NextResponse.json({ error: "Invalid condition grade" }, { status: 400 });
    }

    const item = await addCollectionItem(userId, {
      stampId,
      listType: listType as ListType,
      condition: (condition as ConditionGrade) || 'MNH',
      notes,
    });

    return NextResponse.json({ success: true, item }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  const userId = getUserIdFromSession(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, condition, notes } = body;

    if (!id) {
      return NextResponse.json({ error: "Item ID is required" }, { status: 400 });
    }

    const item = await updateCollectionItem(userId, Number(id), { condition, notes });
    return NextResponse.json({ success: true, item });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const userId = getUserIdFromSession(request);
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
