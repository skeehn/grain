"""Current Harbor external-agent adapter for Grain's machine-only bridge."""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class GrainAgent(BaseAgent):
    """Runs Grain on the host while every shell operation executes in Harbor."""

    SUPPORTS_ATIF = False

    @staticmethod
    def name() -> str:
        return "grain"

    def version(self) -> str | None:
        return os.environ.get("GRAIN_VERSION", "0.2.0")

    async def setup(self, environment: BaseEnvironment) -> None:
        probe = await environment.exec("pwd")
        if probe.return_code != 0:
            raise RuntimeError(f"Harbor environment probe failed: {probe.stderr or probe.stdout}")

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        model = self.model_name or os.environ.get("GRAIN_MODEL")
        if not model:
            raise RuntimeError("Harbor must provide --model or GRAIN_MODEL")
        provider = os.environ.get("GRAIN_PROVIDER", "openrouter")
        process = await asyncio.create_subprocess_exec(
            os.environ.get("GRAIN_BIN", "grain"),
            "--tb-bridge", "--provider", provider, "--model", model,
            "--max-turns", os.environ.get("GRAIN_MAX_TURNS", "30"),
            "--yes", instruction,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "GRAIN_BENCHMARK": "1", "GRAIN_DISABLE_GLOBAL_RECALL": "1"},
        )
        assert process.stdin and process.stdout and process.stderr
        tool_calls = 0
        protocol_errors: list[str] = []
        while line := await process.stdout.readline():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                protocol_errors.append(line.decode(errors="replace")[-500:])
                continue
            if event.get("type") == "done":
                break
            if event.get("type") != "bash":
                protocol_errors.append(f"unknown bridge event: {event.get('type')}")
                continue
            tool_calls += 1
            result = await environment.exec(event["cmd"])
            response = {
                "output": (result.stdout or "") + (result.stderr or ""),
                "exit_code": result.return_code,
            }
            process.stdin.write((json.dumps(response) + "\n").encode())
            await process.stdin.drain()
        return_code = await process.wait()
        stderr = (await process.stderr.read()).decode(errors="replace")
        context.metadata = {
            **(context.metadata or {}),
            "grain_version": self.version(),
            "grain_provider": provider,
            "grain_model": model,
            "tool_calls": tool_calls,
            "protocol_errors": protocol_errors,
            "stderr_tail": stderr[-2000:],
        }
        if return_code:
            raise RuntimeError(f"Grain exited {return_code}: {stderr[-2000:]}")
        if protocol_errors:
            raise RuntimeError(f"Grain emitted invalid bridge output: {protocol_errors[-1]}")
