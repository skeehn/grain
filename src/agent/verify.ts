import { inspectProject, type ProjectCommand } from './project.js';

export type VerifyCommand = ProjectCommand;

/**
 * Pick a FAST, high-signal correctness check for the project (compile/typecheck,
 * not the full test suite) to run after the agent edits code. Returns null when
 * nothing reliable is detectable — auto-verify then stays out of the way.
 *
 * `changedPaths` steers polyglot trees: a Python-only edit in a repo that also
 * has Cargo.toml should not cargo-check.
 */
export function detectVerifyCommand(cwd: string, changedPaths: string[] = []): VerifyCommand | null {
  return inspectProject(cwd, changedPaths).verify;
}
