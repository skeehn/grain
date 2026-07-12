import { startLabServer } from '../lab/index.js';
export function handleLabCommand(runId?: string, port = 7332): void { startLabServer(port, '127.0.0.1', runId); console.log(`Grain Lab: http://127.0.0.1:${port}${runId ? `/?run=${encodeURIComponent(runId)}` : ''}`); }
