#!/usr/bin/env python3
"""Run a command in a real PTY, exercise Grain help/quit, and copy the transcript."""
import fcntl
import json
import os
import pty
import select
import struct
import sys
import termios
import time

steps = json.loads(os.environ.get("GRAIN_PTY_STEPS", '[{"wait":"grain>","send":"/help\\r"},{"wait":"/workflow MODE TASK","send":"/quit\\r"}]'))
pid, master = pty.fork()
if pid == 0:
    os.execvpe(sys.argv[1], sys.argv[1:], os.environ)

fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 38, int(os.environ.get("GRAIN_PTY_COLUMNS", "120")), 0, 0))
deadline = time.monotonic() + float(os.environ.get("GRAIN_PTY_TIMEOUT_SECONDS", "15"))
step_index = 0
recent = b""
status = None
while time.monotonic() < deadline:
    chunk = b""
    ready, _, _ = select.select([master], [], [], 0.05)
    if ready:
        try:
            chunk = os.read(master, 65536)
        except OSError:
            chunk = b""
        if chunk:
            os.write(1, chunk)
            recent = (recent + chunk)[-131072:]
    if step_index < len(steps) and steps[step_index]["wait"].encode() in recent:
        step = steps[step_index]
        tail = recent.split(step["wait"].encode(), 1)[1]
        if "columns" in step:
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 38, step["columns"], 0, 0))
        os.write(master, step.get("send", "").encode())
        step_index += 1
        # An assertion-only step may share a read with the following prompt.
        # After sending input, discard old output so it cannot acknowledge it.
        recent = b"" if step.get("send", "") else tail
    finished, child_status = os.waitpid(pid, os.WNOHANG)
    if finished:
        status = child_status
        break
if status is None:
    try:
        os.kill(pid, 15)
    except ProcessLookupError:
        pass
    for _ in range(20):
        finished, child_status = os.waitpid(pid, os.WNOHANG)
        if finished:
            status = child_status
            break
        time.sleep(0.05)
    if status is None:
        try:
            os.kill(pid, 9)
        except ProcessLookupError:
            pass
        _, status = os.waitpid(pid, 0)
    print("PTY timed out before child exit", file=sys.stderr)
    sys.exit(124)
if step_index < len(steps):
    print(f"PTY stopped at step {step_index + 1}/{len(steps)}", file=sys.stderr)
    sys.exit(125)
sys.exit(os.waitstatus_to_exitcode(status))
