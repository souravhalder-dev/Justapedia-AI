import { NextRequest, NextResponse } from "next/server";
import { listConversations, upsertConversation } from "@/lib/db";

export async function GET() {
  try {
    const conversations = await listConversations();
    return NextResponse.json(conversations);
  } catch (err) {
    console.error("Error listing conversations:", err);
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = body.id || `conv_${Date.now()}`;
    const title = body.title || "New Discussion";
    await upsertConversation(id, title, body.user_id || null);
    return NextResponse.json(
      {
        id,
        title,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Error creating conversation:", err);
    const fallbackId = `conv_${Date.now()}`;
    return NextResponse.json(
      {
        id: fallbackId,
        title: "New Discussion",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { status: 201 }
    );
  }
}
