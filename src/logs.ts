import * as core from "@actions/core";
import type { context } from "@actions/github";
import type { components } from "@octokit/openapi-types";
import type { Octokit } from "./github";

type Context = typeof context;
type Job = components["schemas"]["job"];

/** Map of jobName → Map of stepNumber → logContent. Step number 0 = full job log (per-job fallback). */
type StepLogs = Map<string, Map<number, string>>;

const MAX_LOG_SIZE = 64 * 1024; // 64KB per step/job

/** Step number key used to store the full job log when per-step logs aren't available */
const JOB_LOG_KEY = 0;

// Matches "JobName/StepNumber_StepName.txt"
const ENTRY_PATTERN = /^(.+?)\/(\d+)_.+\.txt$/;

async function downloadWorkflowLogs(context: Context, octokit: Octokit, runId: number, jobs: Job[]): Promise<StepLogs> {
  // Try downloading full workflow run logs (ZIP with per-step files).
  // This only works when the entire workflow run has completed.
  const zipLogs = await downloadWorkflowRunLogsZip(context, octokit, runId);
  if (zipLogs.size > 0) {
    return zipLogs;
  }

  // Fallback: download logs per completed job individually.
  // This works even when the workflow run is still in progress (e.g., when
  // this action runs as part of the same workflow via needs + if: always()).
  core.info("Falling back to per-job log downloads");
  return await downloadJobLogsIndividually(context, octokit, jobs);
}

async function downloadWorkflowRunLogsZip(context: Context, octokit: Octokit, runId: number): Promise<StepLogs> {
  try {
    const res = await octokit.rest.actions.downloadWorkflowRunLogs({
      ...context.repo,
      run_id: runId,
    });

    // The response data is an ArrayBuffer
    const buffer = Buffer.from(res.data as ArrayBuffer);
    return parseLogsZip(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.info(`Workflow run logs not available (expected when run is still in progress): ${message}`);
    return new Map();
  }
}

async function downloadJobLogsIndividually(context: Context, octokit: Octokit, jobs: Job[]): Promise<StepLogs> {
  const result: StepLogs = new Map();

  for (const job of jobs) {
    if (!job.completed_at) {
      continue;
    }

    try {
      const res = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
        ...context.repo,
        job_id: job.id,
      });

      const logText = typeof res.data === "string" ? res.data : String(res.data);

      // Try to split job log into per-step sections using step timestamps
      const stepLogs = job.steps ? parseJobLogByTimestamps(logText, job.steps) : new Map<number, string>();

      if (stepLogs.size > 0) {
        result.set(job.name, stepLogs);
      } else {
        // Fallback: store full job log under JOB_LOG_KEY
        let content = logText;
        if (content.length > MAX_LOG_SIZE) {
          content = content.slice(-MAX_LOG_SIZE);
        }
        const map = new Map<number, string>();
        map.set(JOB_LOG_KEY, content);
        result.set(job.name, map);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      core.info(`Failed to download logs for job "${job.name}": ${message}`);
    }
  }

  if (result.size > 0) {
    core.info(`Downloaded logs for ${result.size} job(s) via per-job fallback`);
  } else {
    core.warning("Failed to download workflow logs. Traces will still be exported without logs.");
  }

  return result;
}

/** Timestamp pattern at start of GitHub Actions log lines: "2026-03-25T07:23:01.0062665Z ..." */
const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/;

/**
 * Split a job log into per-step sections by matching log line timestamps
 * against each step's started_at/completed_at time range.
 */
function parseJobLogByTimestamps(logText: string, steps: NonNullable<Job["steps"]>): Map<number, string> {
  const result = new Map<number, string>();
  const lines = logText.split("\n");

  // Parse timestamps once for all lines
  const timedLines: Array<{ time: number; line: string }> = [];
  for (const line of lines) {
    const match = TIMESTAMP_PATTERN.exec(line);
    if (match) {
      timedLines.push({ time: new Date(match[1]).getTime(), line });
    }
  }

  if (timedLines.length === 0) {
    return result;
  }

  for (const step of steps) {
    if (!(step.started_at && step.completed_at)) {
      continue;
    }

    const startTime = new Date(step.started_at).getTime();
    const endTime = new Date(step.completed_at).getTime();

    const stepLines: string[] = [];
    for (const tl of timedLines) {
      if (tl.time >= startTime && tl.time <= endTime) {
        stepLines.push(tl.line);
      }
    }

    if (stepLines.length > 0) {
      let content = stepLines.join("\n");
      if (content.length > MAX_LOG_SIZE) {
        content = content.slice(-MAX_LOG_SIZE);
      }
      result.set(step.number, content);
    }
  }

  return result;
}

function parseLogsZip(buffer: Buffer): StepLogs {
  const result: StepLogs = new Map();

  // Find End of Central Directory record (search from end of buffer)
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06_05_4b_50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    return result;
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(centralDirOffset) !== 0x02_01_4b_50) {
      break;
    }

    const compressedSize = buffer.readUInt32LE(centralDirOffset + 20);
    const nameLength = buffer.readUInt16LE(centralDirOffset + 28);
    const extraLength = buffer.readUInt16LE(centralDirOffset + 30);
    const commentLength = buffer.readUInt16LE(centralDirOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralDirOffset + 42);

    const name = buffer.subarray(centralDirOffset + 46, centralDirOffset + 46 + nameLength).toString("utf-8");

    const match = ENTRY_PATTERN.exec(name);
    if (match) {
      const jobName = match[1];
      const stepNumber = Number.parseInt(match[2], 10);

      // Read content from local file header
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;

      let content = buffer.subarray(dataOffset, dataOffset + compressedSize).toString("utf-8");

      // Truncate to last 64KB if too large
      if (content.length > MAX_LOG_SIZE) {
        content = content.slice(-MAX_LOG_SIZE);
      }

      if (!result.has(jobName)) {
        result.set(jobName, new Map());
      }
      result.get(jobName)?.set(stepNumber, content);
    }

    centralDirOffset += 46 + nameLength + extraLength + commentLength;
  }

  return result;
}

export {
  downloadWorkflowLogs,
  parseLogsZip,
  parseJobLogByTimestamps,
  downloadJobLogsIndividually,
  JOB_LOG_KEY,
  type StepLogs,
};
