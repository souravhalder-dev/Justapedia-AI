import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({
    id,
    title: body.title || "Updated Discussion",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return new NextResponse(null, { status: 204 });
}
