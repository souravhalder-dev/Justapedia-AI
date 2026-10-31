import { NextRequest, NextResponse } from "next/server";

// Fallback in-memory store for serverless environments
export async function GET() {
  return NextResponse.json([]);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = `conv_${Date.now()}`;
  return NextResponse.json({
    id,
    title: body.title || "New Discussion",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { status: 201 });
}
