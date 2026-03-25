import { credentials, Metadata } from "@grpc/grpc-js";
import type { Attributes } from "@opentelemetry/api";
import { OTLPLogExporter as GrpcOTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { OTLPLogExporter as ProtoOTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  LoggerProvider,
  type LogRecordExporter,
} from "@opentelemetry/sdk-logs";
import { stringToRecord } from "./tracer";

const OTEL_CONSOLE_ONLY = process.env["OTEL_CONSOLE_ONLY"] === "true";

function isHttpEndpoint(endpoint: string) {
  return endpoint.startsWith("https://") || endpoint.startsWith("http://");
}

function createLoggerProvider(endpoint: string, headers: string, attributes: Attributes) {
  let exporter: LogRecordExporter = new ConsoleLogRecordExporter();

  if (!OTEL_CONSOLE_ONLY) {
    if (isHttpEndpoint(endpoint)) {
      exporter = new ProtoOTLPLogExporter({
        url: endpoint,
        headers: stringToRecord(headers),
      });
    } else {
      exporter = new GrpcOTLPLogExporter({
        url: endpoint,
        credentials: credentials.createSsl(),
        metadata: Metadata.fromHttp2Headers(stringToRecord(headers)),
      });
    }
  }

  const provider = new LoggerProvider({
    resource: resourceFromAttributes({
      ...defaultResource().attributes,
      ...attributes,
    }),
    processors: [new BatchLogRecordProcessor(exporter)],
  });

  return provider;
}

export { createLoggerProvider };
