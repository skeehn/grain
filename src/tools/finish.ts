import type { ToolResult } from '../providers/types.js';

export const finishTool = {
  name: 'finish',
  description: 'Signal that the requested task is complete and verified. This tool has no filesystem, memory, Git, or network side effects.',
  input_schema: {
    type: 'object',
    properties: {
      result: { type: 'string', description: 'Concise summary of the verified outcome' },
      evidence: { type: 'array', items: { type: 'string' }, description: 'Tests, commands, or artifacts proving completion' },
      remaining_uncertainty: { type: 'array', items: { type: 'string' }, description: 'Anything not independently verified' },
    },
    required: ['result', 'evidence'],
  },
};

export async function executeFinish(input: {
  result: string; evidence?: string[]; remaining_uncertainty?: string[];
}, _cwd?: string): Promise<ToolResult> {
  if (!input.result?.trim()) return { content: 'finish requires a result', is_error: true };
  if (!input.evidence?.length) return { content: 'finish requires verification evidence', is_error: true };
  return { content: `TASK_COMPLETE: ${input.result}` };
}
