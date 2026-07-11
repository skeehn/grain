# Grain evaluations

The Harbor adapter runs Grain through a JSON-line terminal bridge inside each disposable benchmark container. Benchmark runs must set `GRAIN_MODEL`, start from a clean container, disable global memory, and retain the generated run journal.

The release comparison pins Grain, Pi, Hermes, Harbor, Terminal-Bench 2.0, model routes, container digests, timeouts, concurrency, and trial count. A result is publishable only after trajectory redaction and manifest verification.
