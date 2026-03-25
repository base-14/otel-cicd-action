import * as core from "@actions/core";
import type { components } from "@octokit/openapi-types";
import { type Attributes, context as otelContext, SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

type Step = NonNullable<components["schemas"]["job"]["steps"]>[number];

interface TraceStepOptions {
  step: Step;
  jobName: string;
  jobHtmlUrl?: string | undefined;
  logContent?: string | undefined;
}

function traceStep({ step, jobName, jobHtmlUrl, logContent }: TraceStepOptions) {
  const tracer = trace.getTracer("otel-cicd-action");

  if (!(step.completed_at && step.started_at)) {
    core.info(`Step ${step.name} is not completed yet.`);
    return;
  }

  if (step.conclusion === "skipped") {
    core.info(`Step ${step.name} did not run.`);
    return;
  }

  const startTime = new Date(step.started_at);
  const completedTime = new Date(step.completed_at);
  const attributes = stepToAttributes(step);

  tracer.startActiveSpan(step.name, { attributes, startTime }, (span) => {
    const code = step.conclusion === "failure" ? SpanStatusCode.ERROR : SpanStatusCode.OK;
    span.setStatus({ code });

    if (logContent) {
      const logger = logs.getLogger("otel-cicd-action");
      const severityNumber = step.conclusion === "failure" ? SeverityNumber.ERROR : SeverityNumber.INFO;
      const severityText = step.conclusion === "failure" ? "ERROR" : "INFO";

      logger.emit({
        severityNumber,
        severityText,
        body: logContent,
        timestamp: startTime,
        attributes: {
          "github.job.name": jobName,
          "github.job.html_url": jobHtmlUrl,
          "github.job.step.name": step.name,
          "github.job.step.number": step.number,
          "github.job.step.conclusion": step.conclusion ?? undefined,
        },
        context: otelContext.active(),
      });
    }

    // Some skipped and post jobs return completed_at dates that are older than started_at
    span.end(new Date(Math.max(startTime.getTime(), completedTime.getTime())));
  });
}

function stepToAttributes(step: Step): Attributes {
  return {
    "github.job.step.status": step.status,
    "github.job.step.conclusion": step.conclusion ?? undefined,
    "github.job.step.name": step.name,
    "github.job.step.number": step.number,
    "github.job.step.started_at": step.started_at ?? undefined,
    "github.job.step.completed_at": step.completed_at ?? undefined,
    error: step.conclusion === "failure",
  };
}

export { traceStep, type TraceStepOptions };
