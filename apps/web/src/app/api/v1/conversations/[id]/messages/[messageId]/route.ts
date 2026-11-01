import { NextRequest, NextResponse } from "next/server";
import { queryDb } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;
  try {
    await queryDb("DELETE FROM sources WHERE message_id = $1", [messageId]);
    await queryDb("DELETE FROM messages WHERE id = $1", [messageId]);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("Error deleting message:", err);
    return new NextResponse(null, { status: 204 });
  }
}
