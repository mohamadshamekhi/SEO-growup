// Server Components don't get a NextRequest the way Route Handlers do — Next's `cookies()`
// (next/headers) is the supported way to read the session cookie there. Route Handlers keep
// using lib/access.ts's requireUser()/getCurrentUser(req) instead of this.
import { cookies } from "next/headers";
import { COOKIE } from "../http-env";
import { userFromToken, type User } from "../auth";

export async function currentUser(): Promise<User | undefined> {
  const jar = await cookies();
  return userFromToken(jar.get(COOKIE)?.value ?? null);
}
