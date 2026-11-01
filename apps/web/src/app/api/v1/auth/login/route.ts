import { NextRequest, NextResponse } from "next/server";
import {
  authenticateWithJustapedia,
  signSessionToken,
  AUTH_COOKIE_NAME,
} from "@/lib/auth";
import { queryDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = (body.username || "").trim();
    const password = (body.password || "").trim();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Please enter your Justapedia username and password." },
        { status: 400 }
      );
    }

    const authResult = await authenticateWithJustapedia(username, password);

    if (!authResult.success || !authResult.user) {
      return NextResponse.json(
        { error: authResult.error || "Invalid Justapedia username or password." },
        { status: 401 }
      );
    }

    const token = await signSessionToken(authResult.user);

    // Record or update user in database
    try {
      await queryDb(
        `INSERT INTO users (id, display_name, created_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
        [authResult.user.id, authResult.user.username]
      );
    } catch (dbErr) {
      console.warn("User upsert non-critical warning:", dbErr);
    }

    const response = NextResponse.json({
      success: true,
      user: authResult.user,
    });

    // Set HTTP-only secure cookie
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });

    return response;
  } catch (err) {
    console.error("Login route error:", err);
    return NextResponse.json(
      { error: "Internal authentication error. Please try again." },
      { status: 500 }
    );
  }
}
