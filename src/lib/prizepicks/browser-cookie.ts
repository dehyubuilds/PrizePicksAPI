function envCookieParts(): string[] {
  const names = [
    "PRIZEPICKS_BROWSER_COOKIE",
    "PRIZEPICKS_BROWSER_COOKIE_PART2",
    "PRIZEPICKS_BROWSER_COOKIE_PART3",
  ];
  return names
    .map((name) => process.env[name]?.trim() ?? "")
    .filter(Boolean);
}

export function prizepicksBrowserCookieFromEnv(): string | null {
  const parts = envCookieParts();
  if (!parts.length) return null;
  return parts.join("");
}

export async function loadPrizepicksBrowserCookie(): Promise<string | null> {
  return prizepicksBrowserCookieFromEnv();
}

export function prizepicksBrowserCookieStatus(): {
  source: "env" | "none";
  length: number;
} {
  const fromEnv = prizepicksBrowserCookieFromEnv();
  if (fromEnv) return { source: "env", length: fromEnv.length };
  return { source: "none", length: 0 };
}
