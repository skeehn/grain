import { describe, expect, test } from 'bun:test';
import { extractTextToolCalls } from '../src/agent/text-tool-calls.js';

const allowed = new Set(['workspace_scan', 'read', 'grep', 'finish']);

describe('text tool-call recovery', () => {
  test('turns an empty invoke dump into a Grain tool call', () => {
    const extracted = extractTextToolCalls('<invoke name="workspace_scan">\n</invoke>', allowed);
    expect(extracted.calls).toEqual([{ name: 'workspace_scan', input: {} }]);
    expect(extracted.text).toBe('');
  });

  test('reads parameter tags and JSON tool_call wrappers', () => {
    const xml = extractTextToolCalls(
      'looking\n<invoke name="read"><parameter name="path">aaiaiaiai</parameter></invoke>',
      allowed,
    );
    expect(xml.calls).toEqual([{ name: 'read', input: { path: 'aaiaiaiai' } }]);
    expect(xml.text).toBe('looking');

    const json = extractTextToolCalls(
      '<tool_call>{"name":"grep","arguments":{"pattern":"TODO","path":"src"}}</tool_call>',
      allowed,
    );
    expect(json.calls).toEqual([{ name: 'grep', input: { pattern: 'TODO', path: 'src' } }]);
  });

  test('leaves unknown tools in the prose so they are not executed', () => {
    const extracted = extractTextToolCalls('<invoke name="rm_rf"></invoke> still here', allowed);
    expect(extracted.calls).toEqual([]);
    expect(extracted.text).toContain('rm_rf');
  });
});
