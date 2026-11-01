import { SignJWT, jwtVerify } from "jose";
import { NextRequest } from "next/server";

export const AUTH_COOKIE_NAME = "justapedia_ai_session";

const JWT_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ||
    process.env.JWT_SECRET ||
    "justapedia-ai-secret-encryption-key-2026-production"
);

export interface AuthUser {
  id: string;
  username: string;
}

export interface LoginResult {
  success: boolean;
  user?: AuthUser;
  error?: string;
}

/**
 * Authenticate directly and securely against the official Justapedia MediaWiki API
 */
export async function authenticateWithJustapedia(
  username: string,
  password: string
): Promise<LoginResult> {
  const trimmedUser = username.trim();
  const trimmedPass = password.trim();

  if (!trimmedUser || !trimmedPass) {
    return { success: false, error: "Username and password are required." };
  }

  try {
    // Step 1: Request login token and capture session cookies
    const tokenUrl =
      "https://justapedia.org/api.php?action=query&meta=tokens&type=login&format=json";
    const tokenRes = await fetch(tokenUrl, {
      headers: {
        "User-Agent":
          "JustapediaAI/1.0 (https://ig.justapedia.org; chatbot-auth)",
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!tokenRes.ok) {
      return {
        success: false,
        error: "Unable to connect to Justapedia authentication server.",
      };
    }

    const tokenData = await tokenRes.json();
    const loginToken = tokenData.query?.tokens?.logintoken;

    if (!loginToken) {
      return {
        success: false,
        error: "Failed to obtain login token from Justapedia.",
      };
    }

    // Extract cookies from token response
    let cookieString = "";
    if (typeof tokenRes.headers.getSetCookie === "function") {
      cookieString = tokenRes.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
    } else {
      const single = tokenRes.headers.get("set-cookie");
      if (single) {
        cookieString = single.split(";")[0];
      }
    }

    // Step 2: Post login credentials with token and cookies
    const loginParams = new URLSearchParams({
      action: "login",
      lgname: trimmedUser,
      lgpassword: trimmedPass,
      lgtoken: loginToken,
      format: "json",
    });

    const loginRes = await fetch("https://justapedia.org/api.php", {
      method: "POST",
      headers: {
        "User-Agent":
          "JustapediaAI/1.0 (https://ig.justapedia.org; chatbot-auth)",
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieString,
      },
      body: loginParams.toString(),
      cache: "no-store",
    });

    if (!loginRes.ok) {
      return {
        success: false,
        error: "Justapedia authentication service returned an error.",
      };
    }

    const loginData = await loginRes.json();
    const result = loginData.login?.result;

    if (result === "Success") {
      const user: AuthUser = {
        id: String(loginData.login.lguserid),
        username: String(loginData.login.lgusername || trimmedUser),
      };
      return { success: true, user };
    }

    // Extract helpful error message from MediaWiki response
    const reason =
      loginData.login?.reason ||
      loginData.login?.message ||
      "Invalid Justapedia username or password.";

    return { success: false, error: reason };
  } catch (err) {
    console.error("Justapedia authentication error:", err);
    return {
      success: false,
      error: "Authentication service encountered an unexpected error.",
    };
  }
}

/**
 * Sign JWT session token (valid for 7 days)
 */
export async function signSessionToken(user: AuthUser): Promise<string> {
  return new SignJWT({ id: user.id, username: user.username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

/**
 * Verify JWT session token
 */
export async function verifySessionToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (payload && payload.id && payload.username) {
      return {
        id: String(payload.id),
        username: String(payload.username),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get authenticated user from request cookie
 */
export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const cookie = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!cookie) {
    // Check Authorization Bearer header as fallback
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const bearerToken = authHeader.slice(7).trim();
      return verifySessionToken(bearerToken);
    }
    return null;
  }
  return verifySessionToken(cookie);
}
