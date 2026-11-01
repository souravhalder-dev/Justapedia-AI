import { NextRequest, NextResponse } from "next/server";
import { queryDb, DbMessage, DbSource } from "@/lib/db";
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
    const messages = await queryDb<DbMessage>(
      "SELECT id, conversation_id, role, content, status, model, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
      [id]
    );

    if (messages.length === 0) {
      return NextResponse.json([]);
    }

    const messageIds = messages.map((m) => m.id);
    const sources = await queryDb<DbSource>(
      "SELECT id, message_id, title, url, page_id, snippet, section_title, relevance_score, created_at FROM sources WHERE message_id = ANY($1) ORDER BY relevance_score DESC",
      [messageIds]
    );

    const messagesWithSources = messages.map((m) => ({
      ...m,
      sources: sources.filter((s) => s.message_id === m.id) || [],
      related_articles: [],
      suggested_questions: [],
    }));

    return NextResponse.json(messagesWithSources);
  } catch (err) {
    console.error("Error fetching messages:", err);
    return NextResponse.json([]);
  }
}
