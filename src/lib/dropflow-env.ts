/**
 * Dropflow environment variables (Netlify, .env.local).
 * Cognito / AWS / Stripe / Twilio use the same names as the shared Statics backend;
 * DROPFLOW_* overrides are optional. Never commit secrets.
 */

function trimEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/** First non-empty value among the given env keys (left = preferred). */
function envFirst(...keys: string[]): string {
  for (const key of keys) {
    const v = trimEnv(key);
    if (v) return v;
  }
  return "";
}

export function getAwsCredentials(): {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
} {
  return {
    accessKeyId: envFirst(
      "DROPFLOW_AWS_ACCESS_KEY_ID",
      "STATICS_AWS_ACCESS_KEY_ID",
      "AWS_ACCESS_KEY_ID"
    ),
    secretAccessKey: envFirst(
      "DROPFLOW_AWS_SECRET_ACCESS_KEY",
      "STATICS_AWS_SECRET_ACCESS_KEY",
      "AWS_SECRET_ACCESS_KEY"
    ),
    region: envFirst("DROPFLOW_AWS_REGION", "STATICS_AWS_REGION", "AWS_REGION") || "us-east-1",
  };
}

export function awsCredentialsConfigured(): boolean {
  const { accessKeyId, secretAccessKey } = getAwsCredentials();
  return Boolean(accessKeyId && secretAccessKey);
}

export type DropflowSecrets = {
  aws: { accessKeyId: string; secretAccessKey: string; region: string };
  cognito: {
    region: string;
    userPoolId: string;
    userPoolWebClientId: string;
  };
  twilio: {
    accountSid: string;
    authToken: string;
    phoneNumber: string;
    verifyServiceId: string;
  };
  stripe: {
    secretKey: string;
    webhookSecret: string;
  };
  youtubeDataApiKey: string;
  resend: {
    apiKey: string;
    from: string;
  };
  s3: {
    tracksBucket: string;
    cdnBaseUrl: string;
    avatarBucket: string;
    avatarBaseUrl: string;
  };
  adminEmail: string;
};

export function readDropflowSecrets(): DropflowSecrets {
  const aws = getAwsCredentials();
  const cdnBase =
    envFirst("DROPFLOW_CDN_BASE_URL") || "https://df31ebpsie5st.cloudfront.net";
  const avatarBase = envFirst(
    "NEXT_PUBLIC_DROPFLOW_AVATAR_BASE_URL",
    "NEXT_PUBLIC_AVATAR_BASE_URL",
    "DROPFLOW_AVATAR_BASE_URL"
  );

  return {
    aws,
    cognito: {
      region:
        envFirst("NEXT_PUBLIC_COGNITO_REGION", "NEXT_PUBLIC_DROPFLOW_COGNITO_REGION") ||
        aws.region,
      userPoolId: envFirst(
        "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
        "NEXT_PUBLIC_DROPFLOW_USER_POOL_ID"
      ),
      userPoolWebClientId: envFirst(
        "NEXT_PUBLIC_COGNITO_CLIENT_ID",
        "NEXT_PUBLIC_DROPFLOW_CLIENT_ID"
      ),
    },
    twilio: {
      accountSid: envFirst("DROPFLOW_TWILIO_ACCOUNT_SID", "TWILIO_ACCOUNT_SID"),
      authToken: envFirst("DROPFLOW_TWILIO_AUTH_TOKEN", "TWILIO_AUTH_TOKEN"),
      phoneNumber: envFirst("DROPFLOW_TWILIO_PHONE_NUMBER", "TWILIO_PHONE_NUMBER"),
      verifyServiceId: envFirst(
        "DROPFLOW_TWILIO_VERIFY_SERVICE_ID",
        "TWILIO_VERIFY_SERVICE_ID"
      ),
    },
    stripe: {
      secretKey: envFirst("DROPFLOW_STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY"),
      webhookSecret: envFirst("DROPFLOW_STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET"),
    },
    youtubeDataApiKey: envFirst("DROPFLOW_YOUTUBE_DATA_API_KEY", "YOUTUBE_DATA_API_KEY"),
    resend: {
      apiKey: envFirst("DROPFLOW_RESEND_API_KEY", "RESEND_API_KEY"),
      from:
        envFirst("DROPFLOW_RESEND_FROM", "RESEND_FROM") ||
        "Dropflow <receipts@dropflow.us>",
    },
    s3: {
      tracksBucket:
        envFirst("DROPFLOW_S3_BUCKET", "STATICS_DROPFLOW_BUCKET") ||
        "statics-dropflow-142770202579",
      cdnBaseUrl: cdnBase,
      avatarBucket:
        envFirst("DROPFLOW_AVATAR_BUCKET", "AWS_S3_AVATAR_BUCKET") ||
        "statics-avatars-142770202579",
      avatarBaseUrl:
        avatarBase || "https://statics-avatars-142770202579.s3.us-east-1.amazonaws.com",
    },
    adminEmail: envFirst("DROPFLOW_ADMIN_EMAIL", "STATICS_ADMIN_EMAIL"),
  };
}

/** Production canonical origin — never use Statics `NEXT_PUBLIC_APP_URL` (e.g. statics-ai.com). */
export const DROPFLOW_PUBLIC_ORIGIN_DEFAULT = "https://dropflow.us";

const LEGACY_NON_DROPFLOW_HOSTS = new Set([
  "statics-ai.com",
  "www.statics-ai.com",
  "statics.ai",
  "www.statics.ai",
  // Wrong TLD — the canonical domain is dropflow.us.
  "dropflow.com",
  "www.dropflow.com",
]);

function isLocalDevHost(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1";
}

function isCanonicalDropflowHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "dropflow.us" || h === "www.dropflow.us";
}

/** Share links, OG metadata, Stripe return URLs, and receipt download links. */
export function sanitizePublicAppUrl(url: string): string {
  const raw = url.trim();
  if (!raw) return DROPFLOW_PUBLIC_ORIGIN_DEFAULT;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    if (isLocalDevHost(host)) return u.origin;
    if (isCanonicalDropflowHost(host)) return u.origin;
    if (LEGACY_NON_DROPFLOW_HOSTS.has(host) || host.includes("statics-ai")) {
      return DROPFLOW_PUBLIC_ORIGIN_DEFAULT;
    }
    /** Netlify branch/preview deploys — purchases and share links must use production. */
    if (host.endsWith(".netlify.app")) {
      return DROPFLOW_PUBLIC_ORIGIN_DEFAULT;
    }
    return u.origin;
  } catch {
    return DROPFLOW_PUBLIC_ORIGIN_DEFAULT;
  }
}

export function readPublicAppUrl(): string {
  const configured = envFirst("NEXT_PUBLIC_DROPFLOW_APP_URL");
  if (configured) return sanitizePublicAppUrl(configured);
  const netlify = envFirst("URL", "DEPLOY_PRIME_URL");
  if (netlify) return sanitizePublicAppUrl(netlify);
  return DROPFLOW_PUBLIC_ORIGIN_DEFAULT;
}

/** True when shared Cognito app client env is present (Statics or Dropflow-prefixed). */
/** SMS / Verify — off unless `DROPFLOW_ENABLE_TWILIO=true` and credentials are set. */
export function twilioFeatureEnabled(): boolean {
  if (process.env.DROPFLOW_ENABLE_TWILIO?.trim() !== "true") return false;
  const s = readDropflowSecrets();
  return Boolean(s.twilio.accountSid && s.twilio.authToken);
}

export function cognitoAppClientConfigured(): boolean {
  const s = readDropflowSecrets();
  return Boolean(s.cognito.userPoolId && s.cognito.userPoolWebClientId);
}

/** User-facing hint when Cognito public env vars are missing. */
export function cognitoConfigErrorMessage(action: "sign-in" | "sign-up"): string {
  const local = readPublicAppUrl().includes("localhost");
  const vars =
    "NEXT_PUBLIC_COGNITO_USER_POOL_ID and NEXT_PUBLIC_COGNITO_CLIENT_ID (or NEXT_PUBLIC_DROPFLOW_* equivalents)";
  if (local) {
    return `Sign-${action === "sign-in" ? "in" : "up"} is not configured. Set ${vars} in Dropflow/.env.local (same values as Statics / Netlify). See .env.example.`;
  }
  return `Sign-${action === "sign-in" ? "in" : "up"} is not configured. Set ${vars} in Netlify, then redeploy.`;
}
