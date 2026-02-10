interface OAuthConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  audience: string;
}

async function fetchAccessToken(config: OAuthConfig): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    audience: config.audience,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`OAuth token request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { access_token?: string };

  if (!data.access_token) {
    throw new Error("OAuth response missing access_token");
  }

  return data.access_token;
}

export { fetchAccessToken };
export type { OAuthConfig };
