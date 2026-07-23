# Grain evaluations

The Harbor adapter runs Grain through a JSON-line terminal bridge inside each
disposable benchmark container. In bridge mode the model receives only `bash`
(proxied through Harbor) and the side-effect-free `finish` tool. Host filesystem,
MCP, skills, Engram, repository-index, delegation, and native mutation tools are
excluded to prevent benchmark contamination. Benchmark runs must set
`GRAIN_MODEL`, start from a clean container, disable global memory, and retain
the generated run journal.

The release comparison pins Grain, Pi, Hermes, Harbor, Terminal-Bench 2.0, model routes, container digests, timeouts, concurrency, and trial count. A result is publishable only after trajectory redaction and manifest verification.

## Local Harbor canary

Run the bridge canary before any paid or multi-task qualification:

```bash
HARBOR_TELEMETRY=off \
PYTHONPATH="$PWD" \
GRAIN_BIN="$PWD/dist/cli.js" \
GRAIN_PROVIDER=openrouter \
uvx --python 3.12 \
  --with 'litellm==1.83.14' \
  'harbor==0.20.0' run \
  --path benchmarks/harbor/canary \
  --agent benchmarks.harbor.grain_agent:GrainAgent \
  --model openrouter/free \
  --n-concurrent 1 \
  --jobs-dir .grain/cache/harbor \
  --yes
```

Harbor 0.20.0 permits LiteLLM 1.83.14. Pinning that version on macOS uses
the portable wheel; unconstrained LiteLLM 1.93.0 currently has Linux-only
wheels and makes UV build the large source distribution locally.

The canary passes only when the model creates the exact requested file inside
Harbor's disposable container and creates no other top-level file. It does not
grant the agent access to Grain's host workspace. Harbor's Docker provider does
not currently support enforcing `no-network` on Docker Desktop/macOS, so this
task declares public verifier networking even though its verifier performs no
network operations. Linux release qualification must retain a separately
enforced no-network verifier gate.

The checked-in [canary evidence](./results/harbor-canary-2026-07-22.json)
records a real 2026-07-22 run: Harbor 0.20.0, Docker Desktop 4.81.0,
`openrouter/free` selecting `poolside/laguna-xs-2.1:free`, three container tool
calls, zero protocol errors, zero trial exceptions, and reward 1.0. The canary
explicitly required shell redirection so it also exercises bridge policy.

Do not use Harbor's process exit code as the benchmark gate: Harbor can exit
zero while one or more trials are errored. Validate every completed job's
authoritative `result.json` before accepting or aggregating it:

```bash
bun run benchmark:harbor:verify .grain/cache/harbor/<job>/result.json
```

The verifier fails closed for unfinished, pending, cancelled, errored, partially
evaluated, exception-bearing, or below-threshold results. Its default minimum
mean reward is `1`; pass `--min-reward N` only when the benchmark's documented
release gate uses a different threshold.

To bind one or more Harbor jobs into an immutable local qualification artifact,
provide either one path or a JSON array of paths:

```bash
GRAIN_QUAL_HARBOR_RESULTS='[".grain/cache/harbor/job-a/result.json",".grain/cache/harbor/job-b/result.json"]' \
  bun run qualify:local 1
```

The qualification records each job ID, counters, minimum mean reward, errors,
and source SHA-256 without retaining the local source path. Invalid external
evidence makes the qualification fail before the repeated suite starts.

The release manifest is `harbor/terminal-bench-2.0.yaml`. Release trials must
override `n_attempts` according to the gate being measured (three for nightly,
five for a release claim) and retain the complete redacted Harbor job directory.
