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

steps = json.loads(os.environ.get("GRAIN_PTY_STEPS", '[{"wait":"Tab views","send":"/help\\r"},{"wait":"/workflow MODE TASK","send":"/quit\\r"}]'))
pid, master = pty.fork()
if pid == 0:
    os.execvpe(sys.argv[1], sys.argv[1:], os.environ)

fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 38, 120, 0, 0))
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
        elif step_index >= len(steps):
            break
    if step_index < len(steps) and steps[step_index]["wait"].encode() in recent:
        os.write(master, steps[step_index]["send"].encode())
        step_index += 1
        recent = b""
    finished, status = os.waitpid(pid, os.WNOHANG)
    if finished:
        break
if status is None:
    try:
        os.kill(pid, 15)
    except ProcessLookupError:
        pass
    _, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
