import { NextResponse } from "next/server";

export async function DELETE() {
  return new NextResponse(null, { status: 204 });
}
