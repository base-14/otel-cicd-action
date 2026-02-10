import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const { fetchAccessToken } = await import("./oauth");

describe("fetchAccessToken", () => {
  const config = {
    tokenUrl: "https://auth.example.com/oauth/token",
    clientId: "my-app",
    clientSecret: "my-secret",
    audience: "https://api.example.com",
  };

  const originalFetch = globalThis.fetch;
  let mockFetch: jest.Mock<typeof globalThis.fetch>;

  beforeEach(() => {
    mockFetch = jest.fn<typeof globalThis.fetch>();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("should return an access token on success", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "tok_abc123", token_type: "Bearer", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const token = await fetchAccessToken(config);

    expect(token).toBe("tok_abc123");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://auth.example.com/oauth/token");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });

    const body = new URLSearchParams(options.body as string);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("my-app");
    expect(body.get("client_secret")).toBe("my-secret");
    expect(body.get("audience")).toBe("https://api.example.com");
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unauthorized_client" }), {
        status: 401,
        statusText: "Unauthorized",
      })
    );

    await expect(fetchAccessToken(config)).rejects.toThrow("OAuth token request failed: 401 Unauthorized");
  });

  it("should throw when access_token is missing in response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ token_type: "Bearer", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(fetchAccessToken(config)).rejects.toThrow("OAuth response missing access_token");
  });

  it("should throw on network error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(fetchAccessToken(config)).rejects.toThrow("fetch failed");
  });
});
