import type { ExecutableTool, ToolResult } from '../providers/types.js';
import type { RunJournal } from '../kernel/index.js';
import * as renderer from '../tui/renderer.js';

let journal: RunJournal | undefined;
export function setQuestionJournal(value: RunJournal | undefined): void { journal = value; }

export const askUserTool: ExecutableTool = {
  name: 'ask_user',
  description: 'Ask the user a focused question when a decision is needed. Use choices when they make the answer easier.',
  input_schema: { type: 'object', properties: { question: { type: 'string' }, choices: { type: 'array', items: { type: 'string' } } }, required: ['question'] },
  async execute(input: { question: string; choices?: string[] }): Promise<ToolResult> {
    const question = String(input.question || '').trim();
    if (!question) return { content: 'ask_user requires a question', is_error: true };
    const id = `question-${Date.now()}`;
    journal?.append('user_questioned', { question_id: id, question, choices: input.choices || [] });
    journal?.transition('waiting_input', { question_id: id });
    if (!process.stdin.isTTY) return { content: `User input required: ${question}`, is_error: true };
    const suffix = input.choices?.length ? `\nChoices: ${input.choices.map((choice, index) => `${index + 1}. ${choice}`).join('  ')}` : '';
    const answer = await renderer.userPrompt(`\n(•?•) ${question}${suffix}\n› `);
    if (!answer?.trim()) return { content: 'User did not provide an answer.', is_error: true };
    journal?.append('user_answered', { question_id: id, answer: answer.trim() });
    journal?.transition('running');
    return { content: answer.trim() };
  },
};
