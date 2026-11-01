import { NextRequest, NextResponse } from "next/server";
import { queryDb, DbMessage } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const messages = await queryDb<DbMessage>(
      "SELECT id, conversation_id, role, content, status, model, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
      [id]
    );
    return NextResponse.json(messages);
  } catch (err) {
    console.error("Error fetching messages:", err);
    return NextResponse.json([]);
  }
}
