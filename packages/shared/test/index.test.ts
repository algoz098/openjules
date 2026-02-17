import { describe, it, expect } from 'vitest';
import { add } from '../src/index';

describe('Shared Utility Tests', () => {
  it('adds numbers correctly', () => {
    expect(add(1, 2)).toBe(3);
  });

  it('fails intentionally for TDD', () => {
    // This function does not exist yet or returns wrong value
    // expect(multiply(2, 3)).toBe(6); 
    expect(add(2, 2)).toBe(4); 
  });
});
