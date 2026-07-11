import { LearningLedger } from '../learning/index.js';

export function handleLearningCommand(subcommand = 'list', argument?: string, extra?: string): void {
  const ledger = new LearningLedger();
  if (subcommand === 'list') {
    const entries = ledger.list();
    console.log(entries.length ? entries.map(entry => `${entry.id}  ${entry.status.padEnd(9)} ${entry.kind.padEnd(18)} ${entry.statement}`).join('\n') : 'No learned entries.');
    return;
  }
  if (subcommand === 'show') {
    const entry = ledger.list().find(item => item.id === argument);
    if (!entry) throw new Error(`Unknown learning ${argument || ''}`);
    console.log(JSON.stringify(entry, null, 2)); return;
  }
  if (subcommand === 'propose') {
    if (!argument) throw new Error('Usage: grain learning propose <statement> [run-id]');
    console.log(JSON.stringify(ledger.propose('procedure', argument, extra || 'manual'), null, 2)); return;
  }
  if (subcommand === 'promote') {
    if (!argument) throw new Error('Usage: grain learning promote <id>');
    console.log(JSON.stringify(ledger.promote(argument), null, 2)); return;
  }
  if (subcommand === 'validate') {
    if (!argument || !extra) throw new Error('Usage: grain learning validate <id> <independent-run-id>');
    const validated = ledger.validate(argument, { runId: extra, verifier: 'manual-confirmed-run', outcome: 'passed' });
    console.log(JSON.stringify(ledger.promote(validated.id), null, 2)); return;
  }
  throw new Error(`Unknown learning command: ${subcommand}`);
}
