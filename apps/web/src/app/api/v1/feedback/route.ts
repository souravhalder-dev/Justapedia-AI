import { NextRequest, NextResponse } from "next/server";
import { saveFeedback } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messageId = body.message_id || `msg_${Date.now()}`;
    const rating = body.rating || "up";
    const reason = body.reason || null;
    const comment = body.comment || null;

    const id = `fb_${Date.now()}`;
    await saveFeedback({
      id,
      message_id: messageId,
      rating,
      reason,
      comment,
    });

    return NextResponse.json({ status: "success", id });
  } catch (err) {
    console.error("Error saving feedback:", err);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
