# Open Telemetry CI/CD Action

[![Unit Tests][ci-img]][ci]
![GitHub License][license-img]

This action exports Github CI/CD workflows to any endpoint compatible with OpenTelemetry.

This is a fork of [otel-export-trace-action](https://github.com/inception-health/otel-export-trace-action) with more features and better support.

Compliant with OpenTelemetry [CICD semconv](https://opentelemetry.io/docs/specs/semconv/attributes-registry/cicd/).
Look at [Sample OpenTelemetry Output](./src/__assets__/output_success.txt) for the list of attributes and their values.

![Example](./docs/scout-example.png)

## Usage

| Code Sample                 | File                                             |
| --------------------------- | ------------------------------------------------ |
| Inside an existing workflow | [build.yml](.github/workflows/build.yml)         |
| Scout (OAuth2)              | [scout.yml](.github/workflows/scout.yml)         |

### On workflow_run event

[workflow_run github documentation](<https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#workflow_run>)

```yaml
on:
  workflow_run:
    workflows:
      # The name of the workflow(s) that triggers the export
      - "Build"
    types: [completed]

jobs:
  otel-export:
    runs-on: ubuntu-latest
    steps:
      - name: Export workflow
        uses: base-14/otel-cicd-action@v1
        with:
          otlpEndpoint: https://otel.example.com/v1/traces
          otlpHeaders: ${{ secrets.OTLP_HEADERS }}
          githubToken: ${{ secrets.GITHUB_TOKEN }}
          runId: ${{ github.event.workflow_run.id }}
```

### Inside an existing workflow

```yaml
jobs:
  build:
    # ... existing code
  otel-export:
    if: always()
    name: OpenTelemetry Export Trace
    runs-on: ubuntu-latest
    needs: [build] # must run when all jobs are completed
    steps:
      - name: Export workflow
        uses: base-14/otel-cicd-action@v1
        with:
          otlpEndpoint: https://otel.example.com/v1/traces
          otlpHeaders: ${{ secrets.OTLP_HEADERS }}
          githubToken: ${{ secrets.GITHUB_TOKEN }}
```

### `On workflow_run event` vs `Inside an existing workflow`

Both methods must be run when the workflow is completed, otherwise, the trace will be incomplete.

| Differences                                         | On workflow_run event | Inside an existing workflow |
| --------------------------------------------------- | --------------------- | --------------------------- |
| Shows in PR page                                    | No                    | Yes                         |
| Shows in Actions tab                                | Yes                   | Yes                         |
| Needs extra consideration to be run as the last job | No                    | Yes                         |
| Must be duplicated for multiple workflows           | No                    | Yes                         |

### Private Repository

If you are using a private repository, you need to set the following permissions in your workflow file.
It can be done at the global level or at the job level.

```yaml
permissions:
  contents: read # Required. To access the private repository
  actions: read # Required. To read workflow runs
  pull-requests: read # Optional. To read PR labels
  checks: read # Optional. To read run annotations
```

### OAuth2 Authentication (client_credentials)

If your OTLP endpoint requires OAuth2 authentication, you can use the built-in client_credentials flow instead of static headers. The action will exchange the credentials for a bearer token and inject it as an `Authorization` header automatically.

```yaml
- name: Export workflow
  uses: base-14/otel-cicd-action@v1
  with:
    otlpEndpoint: https://otel.example.com/v1/traces
    tokenUrl: https://auth.example.com/realms/myrealm/protocol/openid-connect/token
    appName: ${{ secrets.OAUTH_CLIENT_ID }}
    apiKey: ${{ secrets.OAUTH_CLIENT_SECRET }}
    audience: my-collector
    githubToken: ${{ secrets.GITHUB_TOKEN }}
    runId: ${{ github.event.workflow_run.id }}
```

All four OAuth inputs (`tokenUrl`, `appName`, `apiKey`, `audience`) must be provided together. When present, the action fetches a token before exporting traces. The `otlpHeaders` input is optional and can still be used alongside OAuth to pass additional headers.

### Adding arbitrary resource attributes

You can use `extraAttributes` to set any additional string resource attributes.
Attributes are split on `,` and then each key/value is split on the first `=`.

```yaml
- name: Export workflow
  uses: base-14/otel-cicd-action@v1
  with:
    otlpEndpoint: https://otel.example.com/v1/traces
    githubToken: ${{ secrets.GITHUB_TOKEN }}
    extraAttributes: "extra.attribute=1,key2=value2"
```

### Action Inputs

| name            | description                                                                                                          | required | default                               | example                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------- | ------------------------------------------------------------------------ |
| otlpEndpoint    | The destination endpoint to export OpenTelemetry traces to. Supports `https://`, `http://` and `grpc://` endpoints.  | true     |                                       | `https://otel.example.com/v1/traces`                                     |
| otlpHeaders     | Headers to add to the OpenTelemetry exporter.                                                                        | false    | `""`                                  | `Authorization=Bearer token123`                                          |
| otelServiceName | OpenTelemetry service name                                                                                           | false    | `<The name of the exported workflow>` | `my-repo-CI`                                                             |
| githubToken     | The repository token with Workflow permissions. Required for private repos                                           | false    |                                       | `${{ secrets.GITHUB_TOKEN }}`                                            |
| runId           | Workflow Run ID to Export                                                                                            | false    | env.GITHUB_RUN_ID                     | `${{ github.event.workflow_run.id }}`                                    |
| extraAttributes | Extra resource attributes to add to each span                                                                        | false    |                                       | `extra.attribute=1,key2=value2`                                          |
| tokenUrl        | OAuth2 token endpoint URL for client_credentials flow                                                                | false    | `""`                                  | `https://auth.example.com/realms/myrealm/protocol/openid-connect/token` |
| appName         | OAuth2 client ID (application name)                                                                                  | false    | `""`                                  | `${{ secrets.OAUTH_CLIENT_ID }}`                                         |
| apiKey          | OAuth2 client secret (API key)                                                                                       | false    | `""`                                  | `${{ secrets.OAUTH_CLIENT_SECRET }}`                                     |
| audience        | OAuth2 audience                                                                                                      | false    | `""`                                  | `my-collector`                                                           |

### Action Outputs

| name    | description                                 |
| ------- | ------------------------------------------- |
| traceId | The OpenTelemetry Trace ID of the root span |

[ci-img]: https://github.com/base-14/otel-cicd-action/actions/workflows/build.yml/badge.svg?branch=main
[ci]: https://github.com/base-14/otel-cicd-action/actions/workflows/build.yml?query=branch%3Amain
[license-img]: https://img.shields.io/github/license/base-14/otel-cicd-action
