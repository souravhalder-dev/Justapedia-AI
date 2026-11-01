import { NextRequest, NextResponse } from "next/server";
import { getConversationWithMessages, queryDb } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const conversation = await getConversationWithMessages(id);
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    return NextResponse.json(conversation);
  } catch (err) {
    console.error("Error retrieving conversation:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const title = body.title || "Updated Discussion";
  try {
    await queryDb(
      "UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2 AND (user_id = $3 OR user_id IS NULL)",
      [title, id, user.id]
    );
    return NextResponse.json({
      id,
      title,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error updating conversation:", err);
    return NextResponse.json({ id, title, updated_at: new Date().toISOString() });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    await queryDb("DELETE FROM conversations WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)", [id, user.id]);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("Error deleting conversation:", err);
    return new NextResponse(null, { status: 204 });
  }
}
