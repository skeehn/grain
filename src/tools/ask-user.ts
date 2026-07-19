import type { ExecutableTool, ToolResult } from '../providers/types.js';
import { RunEngine, type RunJournal } from '../kernel/index.js';
import * as renderer from '../tui/renderer.js';

let journal: RunJournal | undefined;
let questionPrompt: ((message: string) => Promise<string | null>) | undefined;
export function setQuestionJournal(value: RunJournal | undefined): void { journal = value; }
export function setQuestionPrompt(value: ((message: string) => Promise<string | null>) | undefined): void { questionPrompt = value; }

/** Completes a durable question, including empty answers on unavailable input. */
function answerQuestion(questionId: string, answer: string): void {
  if (!journal) return;
  new RunEngine(journal).dispatch({ type: 'answer', questionId, answer });
}

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
    if (!process.stdin.isTTY) {
      answerQuestion(id, '');
      return { content: `User input required: ${question}`, is_error: true };
    }
    const suffix = input.choices?.length ? `\nChoices: ${input.choices.map((choice, index) => `${index + 1}. ${choice}`).join('  ')}` : '';
    const answer = await (questionPrompt || renderer.userPrompt)(`\n(•?•) ${question}${suffix}\n› `);
    if (!answer?.trim()) {
      answerQuestion(id, '');
      return { content: 'User did not provide an answer.', is_error: true };
    }
    answerQuestion(id, answer.trim());
    return { content: answer.trim() };
  },
};
