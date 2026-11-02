import { constants, createSign } from "crypto";
import { kalshiApiKeyId, kalshiPrivateKeyPem } from "./config";

/** RSA-PSS signature for authenticated Kalshi requests. */
export function signKalshiRequest(method: string, signPath: string, timestampMs: number): string | null {
  const keyId = kalshiApiKeyId();
  const privateKey = kalshiPrivateKeyPem();
  if (!keyId || !privateKey) return null;

  const message = `${timestampMs}${method.toUpperCase()}${signPath}`;
  const signer = createSign("RSA-SHA256");
  signer.update(message);
  signer.end();
  return signer
    .sign({
      key: privateKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString("base64");
}

export function kalshiAuthHeaders(method: string, signPath: string): Record<string, string> | null {
  const keyId = kalshiApiKeyId();
  const timestampMs = Date.now();
  const signature = signKalshiRequest(method, signPath, timestampMs);
  if (!keyId || !signature) return null;
  return {
    "KALSHI-ACCESS-KEY": keyId,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "KALSHI-ACCESS-TIMESTAMP": String(timestampMs),
  };
}
