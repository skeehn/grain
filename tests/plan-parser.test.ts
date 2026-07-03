import { describe, test, expect } from 'bun:test';
import { parsePlanFromText } from '../src/agent/loop/plan-parser.js';

describe('parsePlanFromText', () => {
  test('parses numbered steps after PLAN:', () => {
    const steps = parsePlanFromText('PLAN:\n1. Read the file\n2. Edit it\n3) Run tests');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ id: 1, description: 'Read the file', status: 'pending' });
    expect(steps[2].description).toBe('Run tests');
  });

  test('ignores text before PLAN:', () => {
    const steps = parsePlanFromText('Here is my thinking.\n1. not a step\nPLAN:\n1. real step');
    expect(steps).toHaveLength(1);
    expect(steps[0].description).toBe('real step');
  });

  test('stops at first non-numbered non-empty line', () => {
    const steps = parsePlanFromText('PLAN:\n1. step one\n2. step two\nNow executing:\n3. not included');
    expect(steps).toHaveLength(2);
  });

  test('returns empty array when no PLAN: marker', () => {
    expect(parsePlanFromText('1. one\n2. two')).toEqual([]);
  });

  test('handles empty input', () => {
    expect(parsePlanFromText('')).toEqual([]);
  });

  test('plan marker is case-insensitive', () => {
    const steps = parsePlanFromText('plan:\n1. lowercase works');
    expect(steps).toHaveLength(1);
  });
});
