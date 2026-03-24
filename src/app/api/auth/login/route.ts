import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { hederaAccountId } = await req.json();

    if (!hederaAccountId || !/^0\.0\.\d+$/.test(hederaAccountId)) {
      return NextResponse.json(
        { error: "Invalid Hedera account ID" },
        { status: 400 }
      );
    }

    const token = await createSession(hederaAccountId);
    await setSessionCookie(token);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: error.message || "Login failed" },
      { status: 500 }
    );
  }
}
