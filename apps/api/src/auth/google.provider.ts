import { decodeIdToken, Google } from "arctic";
import { z } from "zod";
import type { Env } from "../config/env";

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export interface GoogleOAuth {
  authorizationUrl(state: string, codeVerifier: string): URL;
  exchange(code: string, codeVerifier: string): Promise<GoogleProfile>;
}

export const GOOGLE_OAUTH = Symbol("GOOGLE_OAUTH");

const idTokenClaims = z.object({
  iss: z.enum(["accounts.google.com", "https://accounts.google.com"]),
  aud: z.string(),
  exp: z.number(),
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.boolean(),
  name: z.string().optional(),
});

export const googleRedirectUri = (env: Pick<Env, "WEB_ORIGIN">) =>
  `${env.WEB_ORIGIN}/api/v1/auth/google/callback`;

export class ArcticGoogleOAuth implements GoogleOAuth {
  private readonly client: Google;

  constructor(
    private readonly clientId: string,
    clientSecret: string,
    redirectUri: string,
  ) {
    this.client = new Google(clientId, clientSecret, redirectUri);
  }

  authorizationUrl(state: string, codeVerifier: string): URL {
    const url = this.client.createAuthorizationURL(state, codeVerifier, [
      "openid",
      "email",
      "profile",
    ]);
    url.searchParams.set("prompt", "select_account");
    return url;
  }

  async exchange(code: string, codeVerifier: string): Promise<GoogleProfile> {
    const tokens = await this.client.validateAuthorizationCode(code, codeVerifier);
    const claims = idTokenClaims.parse(decodeIdToken(tokens.idToken()));
    if (claims.aud !== this.clientId) throw new Error("id_token para outro client_id");
    if (claims.exp * 1000 < Date.now()) throw new Error("id_token expirado");
    return {
      sub: claims.sub,
      email: claims.email.toLowerCase(),
      emailVerified: claims.email_verified,
      name: claims.name ?? null,
    };
  }
}

export function createGoogleOAuth(env: Env): GoogleOAuth | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return new ArcticGoogleOAuth(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri(env),
  );
}
