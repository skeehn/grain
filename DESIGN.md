# Design System — Grain Field Instrument

## Product Context

- Grain is a coding-first terminal agent operating system for solo, long-running, and multi-agent repository work.
- The interface must make model, tool, filesystem, policy, verification, cost, and recovery state understandable under pressure.
- Machine output and redirected output remain stable protocols; decoration belongs only in an interactive TTY.

## Aesthetic Direction

- Direction: industrial field instrument with warm agricultural materials.
- Decoration: intentional. Ordered bitmap texture identifies Grain and communicates activity, but never reduces log or diff readability.
- Layout: grid-disciplined and compact, with responsive panels at 80 and 120 columns.
- Mood: calm, capable, inspectable, and serious about consequences.

## Color

| Role | Truecolor | Use |
| --- | --- | --- |
| Background | `#161713` | Full-screen field |
| Panel | `#1D1F1A` | Persistent regions |
| Raised | `#25271F` | Selected and overlay surfaces |
| Structure | `#393A31` | Rules and inactive boundaries |
| Text | `#E7E0D2` | Primary content |
| Muted | `#929084` | Metadata and inactive state |
| Grain gold | `#D6A85F` | Brand, focus, active progress |
| Success sage | `#88A678` | Verified success |
| Warning amber | `#E5B567` | Approval and reconciliation |
| Failure red | `#E06C75` | Errors and denied operations |
| Information blue | `#7FA7B8` | Filesystem and context evidence |

ANSI-256, ANSI-16, and no-color modes retain the same semantic hierarchy. Color is never the only state signal.

## Typography and Density

- Grain uses the terminal's monospace font and never requires font installation.
- All numeric columns use tabular alignment.
- Compact density is default: one row per event, 1-column internal padding, and no decorative blank rows inside active panels.
- Comfortable density adds vertical separation without changing information architecture.

## Dithering

- Use the deterministic 4×4 Bayer matrix for the banner, active progress, budget bars, panel transitions, and empty states.
- Do not place dithering behind body text, source code, diffs, logs, diagnostics, or approval details.
- Animated phases stop when reduced motion is requested.

## Interaction

- Every action is keyboard accessible; mouse support is additive.
- `Tab` moves focus, `Enter` inspects, `:` opens commands, and single-letter shortcuts open major operational views.
- `q` leaves the view without cancelling work.
- First `Ctrl+C` requests graceful cancellation; a second press forces termination and journals it.
- Alternate-screen state, raw input, cursor visibility, and mouse modes must always restore on exit and exceptions.

## Workshop Companion

- The rice-ball companion is a status instrument: it changes only for meaningful work states (thinking, tools, questions, approval, verification, recovery, success, failure).
- `/theme field|studio|arcade|system` persists the visual mode. `t` cycles it in the run viewer.
- `grain lab` is a loopback-only companion surface for journal-backed cards, attachment context, and sandboxed experiments. It never grants generated browser artifacts direct filesystem or command access.
- The `ask_user` tool journals a question and answer, allowing a run to pause for a real decision rather than guessing.

## Decisions Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-07-11 | Custom retained-mode differential renderer | Grain needs exact streaming and recovery control without React/Ink runtime weight. |
| 2026-07-11 | Dark Field Instrument default | The warm restrained palette distinguishes Grain while preserving dense terminal readability. |
| 2026-07-11 | Classic and machine modes remain first-class | CI, Harbor, pipes, and automation cannot depend on terminal presentation behavior. |
