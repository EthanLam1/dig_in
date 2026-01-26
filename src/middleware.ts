// src/middleware.ts
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "session_id";

export function middleware(req: NextRequest) {
  const existing = req.cookies.get(COOKIE_NAME)?.value;

  // If cookie already exists, continue
  if (existing) return NextResponse.next();

  // Otherwise create a new session id
  const sessionId = crypto.randomUUID();

  const res = NextResponse.next();

  res.cookies.set({
    name: COOKIE_NAME,
    value: sessionId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return res;
}

// Run middleware on all routes except Next.js static assets
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};