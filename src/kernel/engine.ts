import { RunJournal, replayRun } from './journal.js';
import type { RunCommand, RunState } from './types.js';

export class RunEngine {
  constructor(private readonly journal: RunJournal) {}
  state(): RunState { return replayRun(this.journal.metadata.run_id); }

  dispatch(command: RunCommand): RunState {
    const state = this.state();
    if (command.type === 'start') {
      if (state.status !== 'created') throw new Error(`Cannot start run in ${state.status}`);
      this.journal.transition('running');
    } else if (command.type === 'pause') {
      if (!['running', 'waiting_approval'].includes(state.status)) throw new Error(`Cannot pause run in ${state.status}`);
      this.journal.command(command);
    } else if (command.type === 'resume') {
      if (state.status !== 'paused') throw new Error(`Cannot resume run in ${state.status}`);
      this.journal.command(command);
    } else if (command.type === 'cancel') {
      if (['succeeded', 'failed', 'cancelled'].includes(state.status)) throw new Error(`Cannot cancel terminal run in ${state.status}`);
      this.journal.command(command);
      // The first request is durable but gives in-flight work a chance to stop
      // cleanly. A forced request is the explicit terminal transition.
      if (command.force) this.journal.transition('cancelled', { forced: true });
    } else if (command.type === 'answer') {
      if (state.status !== 'waiting_input') throw new Error(`Cannot answer run in ${state.status}`);
      this.journal.append('user_answered', { question_id: command.questionId, answer: command.answer });
      this.journal.transition('running');
    } else {
      this.journal.command(command);
    }
    return this.state();
  }
}
