import type { Attributes } from "@opentelemetry/api";
import type { LoggerProvider } from "@opentelemetry/sdk-logs";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { ATTR_SERVICE_INSTANCE_ID, ATTR_SERVICE_NAMESPACE } from "@opentelemetry/semantic-conventions/incubating";
import { createLoggerProvider } from "./logger";

describe("createLoggerProvider", () => {
  let provider: LoggerProvider;
  const attributes: Attributes = {
    [ATTR_SERVICE_NAME]: "workflow-name",
    [ATTR_SERVICE_VERSION]: "head-sha",
    [ATTR_SERVICE_INSTANCE_ID]: "test/repo/1/1/1",
    [ATTR_SERVICE_NAMESPACE]: "test/repo",
  };

  afterEach(async () => {
    await provider.shutdown();
  });

  it("creates a provider for gRPC endpoint", () => {
    provider = createLoggerProvider("localhost", "test=foo", attributes);
    expect(provider).toBeDefined();
  });

  it("creates a provider for https endpoint", () => {
    provider = createLoggerProvider("https://localhost", "test=foo", attributes);
    expect(provider).toBeDefined();
  });

  it("creates a provider for http endpoint", () => {
    provider = createLoggerProvider("http://localhost", "test=foo", attributes);
    expect(provider).toBeDefined();
  });
});
