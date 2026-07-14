// Enhanced semantic search using engram
import { spawn } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { loadConfig } from '../config.js';

export const semanticSearchTool = {
  name: 'semantic_search',
  description: 'Search codebase semantically using engram hybrid search (vector + FTS). Better than grep for finding concepts, patterns, or similar code.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for (semantic query, not regex)' },
      limit: { type: 'number', description: 'Max results', default: 10 },
    },
    required: ['query'],
  },
};

export async function executeSemanticSearch(input: {
  query: string;
  limit?: number;
}): Promise<{ content: string }> {
  const engramBin = join(homedir(), 'bin', 'engram');
  const config = loadConfig();
  const dbPath = config.engram_db.replace('~', homedir());
  const limit = input.limit || 10;

  return new Promise((resolve) => {
    const proc = spawn(
      engramBin,
      ['-d', dbPath, 'search', input.query, '--top-k', limit.toString()],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      }
    );

    let output = '';
    let errors = '';

    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      errors += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0 || errors) {
        resolve({
          content: `engram search failed: ${errors || 'unknown error'}`,
        });
      } else if (!output.trim()) {
        resolve({
          content: `No results found for: "${input.query}"`,
        });
      } else {
        resolve({
          content: `🔍 Semantic search results for "${input.query}":\n\n${output}`,
        });
      }
    });

    proc.on('error', () => {
      resolve({
        content: 'engram not available or search failed',
      });
    });
  });
}
