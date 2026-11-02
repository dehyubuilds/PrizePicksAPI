/**
 * X (Twitter) OAuth 2.0 PKCE — server only. Lets creators connect their X account
 * and auto-post their Dropflow track links.
 *
 * Required env (Netlify / .env.local):
 *   DROPFLOW_X_CLIENT_ID      — X developer app OAuth 2.0 client ID
 *   DROPFLOW_X_CLIENT_SECRET  — X developer app OAuth 2.0 client secret
 *   DROPFLOW_X_TOKEN_SECRET   — random 32+ char secret; encrypts stored user tokens (AES-256-GCM)
 *
 * Callback URL to register on the X app: {baseUrl}/api/x/callback
 * Tokens are stored encrypted at rest on the creator's dropflow_users row and are
 * only ever decrypted server-side to call the X API on the creator's behalf.
 */

import crypto from "crypto";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, getTable } from "@/lib/dynamodb";
import { config } from "@/lib/config";

const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const X_USERS_ME_URL = "https://api.x.com/2/users/me";
export const X_TWEETS_URL = "https://api.x.com/2/tweets";

/** offline.access gives a refresh token; media.write lets Dropflow attach playable preview videos. */
const X_SCOPES = "tweet.read tweet.write users.read media.write offline.access";

const STATE_TTL_MS = 10 * 60 * 1000;

export type XOauthEnv = {
  clientId: string;
  clientSecret: string;
  tokenSecret: string;
};

export function readXOauthEnv(): XOauthEnv {
  return {
    clientId: process.env.DROPFLOW_X_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.DROPFLOW_X_CLIENT_SECRET?.trim() ?? "",
    tokenSecret: process.env.DROPFLOW_X_TOKEN_SECRET?.trim() ?? "",
  };
}

/** Direct posting available only when the X app + token-encryption secret are configured. */
export function xOauthConfigured(): boolean {
  const env = readXOauthEnv();
  return Boolean(env.clientId && env.clientSecret && env.tokenSecret);
}

export function xCallbackUrl(): string {
  return `${config.app.baseUrl}/api/x/callback`;
}

/* ---------- encryption (AES-256-GCM, key derived from DROPFLOW_X_TOKEN_SECRET) ---------- */

function encryptionKey(): Buffer {
  const { tokenSecret } = readXOauthEnv();
  if (!tokenSecret) throw new Error("DROPFLOW_X_TOKEN_SECRET is not set");
  return crypto.createHash("sha256").update(tokenSecret).digest();
}

export function encryptXSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${ct.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptXSecret(payload: string): string {
  const [ivB64, ctB64, tagB64] = payload.split(".");
  if (!ivB64 || !ctB64 || !tagB64) throw new Error("Malformed encrypted payload");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivB64, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/* ---------- authorize URL + stateless state (encrypted, authenticated, 10 min TTL) ---------- */

type XOauthState = { userId: string; verifier: string; exp: number };

export function buildXAuthorizeUrl(userId: string): { url: string } {
  const env = readXOauthEnv();
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = encryptXSecret(
    JSON.stringify({ userId, verifier, exp: Date.now() + STATE_TTL_MS } satisfies XOauthState)
  );
  const sp = new URLSearchParams({
    response_type: "code",
    client_id: env.clientId,
    redirect_uri: xCallbackUrl(),
    scope: X_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { url: `${X_AUTHORIZE_URL}?${sp.toString()}` };
}

/** Decrypt + validate the OAuth state param. Returns null when invalid or expired. */
export function parseXOauthState(state: string): XOauthState | null {
  try {
    const parsed = JSON.parse(decryptXSecret(state)) as XOauthState;
    if (!parsed.userId || !parsed.verifier) return null;
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ---------- token exchange / refresh ---------- */

type XTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function postTokenRequest(body: URLSearchParams): Promise<XTokenResponse> {
  const env = readXOauthEnv();
  const basic = Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64");
  const res = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  });
  return (await res.json().catch(() => ({}))) as XTokenResponse;
}

export async function exchangeXAuthCode(
  code: string,
  verifier: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number } | null> {
  const env = readXOauthEnv();
  const data = await postTokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: xCallbackUrl(),
      code_verifier: verifier,
      client_id: env.clientId,
    })
  );
  if (!data.access_token) {
    console.error("[x-oauth] code exchange failed:", data.error, data.error_description);
    return null;
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
  };
}

export async function refreshXAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number } | null> {
  const env = readXOauthEnv();
  const data = await postTokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.clientId,
    })
  );
  if (!data.access_token) {
    console.error("[x-oauth] token refresh failed:", data.error, data.error_description);
    return null;
  }
  return {
    accessToken: data.access_token,
    // X rotates refresh tokens — always persist the new one.
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
  };
}

export async function fetchXProfile(
  accessToken: string
): Promise<{ id: string; username: string } | null> {
  const res = await fetch(X_USERS_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as {
    data?: { id?: string; username?: string };
  };
  if (!res.ok || !data.data?.id) return null;
  return { id: data.data.id, username: data.data.username ?? "" };
}

/* ---------- encrypted token storage on dropflow_users ---------- */

export type StoredXAuth = {
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: number;
  xUserId: string;
  xUsername: string;
  connectedAt: string;
};

const USERS_TABLE = () => getTable("dropflow_users");

export async function saveXAuthForUser(
  userId: string,
  tokens: { accessToken: string; refreshToken: string; expiresAt: number },
  profile: { id: string; username: string }
): Promise<void> {
  const xAuth: StoredXAuth = {
    accessTokenEnc: encryptXSecret(tokens.accessToken),
    refreshTokenEnc: tokens.refreshToken ? encryptXSecret(tokens.refreshToken) : "",
    expiresAt: tokens.expiresAt,
    xUserId: profile.id,
    xUsername: profile.username,
    connectedAt: new Date().toISOString(),
  };
  await docClient.send(
    new UpdateCommand({
      TableName: USERS_TABLE(),
      Key: { userId },
      UpdateExpression: "SET xAuth = :x, updatedAt = :now",
      ExpressionAttributeValues: { ":x": xAuth, ":now": new Date().toISOString() },
    })
  );
  console.log(
    JSON.stringify({ audit: "x_account_connected", userId, xUsername: profile.username, at: new Date().toISOString() })
  );
}

export async function getXAuthForUser(userId: string): Promise<StoredXAuth | null> {
  const res = await docClient.send(
    new GetCommand({ TableName: USERS_TABLE(), Key: { userId }, ProjectionExpression: "xAuth" })
  );
  const xAuth = (res.Item as { xAuth?: StoredXAuth } | undefined)?.xAuth;
  return xAuth?.accessTokenEnc ? xAuth : null;
}

export async function removeXAuthForUser(userId: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: USERS_TABLE(),
      Key: { userId },
      UpdateExpression: "REMOVE xAuth SET updatedAt = :now",
      ExpressionAttributeValues: { ":now": new Date().toISOString() },
    })
  );
  console.log(
    JSON.stringify({ audit: "x_account_disconnected", userId, at: new Date().toISOString() })
  );
}

/** Valid access token for the user, refreshing (and re-persisting) when near expiry. */
export async function getFreshXAccessToken(
  userId: string
): Promise<{ accessToken: string; xUsername: string } | { error: "not_connected" | "reconnect_required" }> {
  const stored = await getXAuthForUser(userId);
  if (!stored) return { error: "not_connected" };

  if (stored.expiresAt > Date.now() + 60_000) {
    return { accessToken: decryptXSecret(stored.accessTokenEnc), xUsername: stored.xUsername };
  }

  if (!stored.refreshTokenEnc) return { error: "reconnect_required" };
  const refreshed = await refreshXAccessToken(decryptXSecret(stored.refreshTokenEnc));
  if (!refreshed) {
    await removeXAuthForUser(userId);
    return { error: "reconnect_required" };
  }
  await saveXAuthForUser(userId, refreshed, { id: stored.xUserId, username: stored.xUsername });
  return { accessToken: refreshed.accessToken, xUsername: stored.xUsername };
}
