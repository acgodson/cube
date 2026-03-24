import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db, users } from "./db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

const JWT_SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || "cube-protocol-secret-key"
);

export interface Session {
  userId: string;
  hederaAccountId: string;
}

export async function createSession(hederaAccountId: string): Promise<string> {
  let user = await db
    .select()
    .from(users)
    .where(eq(users.hederaAccountId, hederaAccountId))
    .limit(1);

  if (!user[0]) {
    const userId = `user_${nanoid()}`;
    await db.insert(users).values({
      id: userId,
      hederaAccountId,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });

    user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
  } else {
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user[0].id));
  }

  const token = await new SignJWT({
    userId: user[0].id,
    hederaAccountId: user[0].hederaAccountId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(JWT_SECRET);

  return token;
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("cube-session")?.value;

  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      userId: payload.userId as string,
      hederaAccountId: payload.hederaAccountId as string,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set("cube-session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete("cube-session");
}
