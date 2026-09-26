import { describe, expect, it } from 'vitest';
import {
  assertPageCountCoversTraces,
  assertRestorablePage,
  isRestoreWindowOpen,
  isStrictlyEditable,
  normalizeMoodTags,
  validatePageRange,
  validateSinglePage,
  validateStatusTransition
} from './domain.js';
import { AppError } from './errors.js';

describe('domain rules', () => {
  it('allows declared status transitions', () => {
    expect(() => validateStatusTransition('READING', 'READ')).not.toThrow();
    expect(() => validateStatusTransition('READ', 'READING')).not.toThrow();
  });

  it('rejects illegal status transitions', () => {
    expect(() => validateStatusTransition('TO_READ', 'READ')).toThrow(AppError);
    expect(() => validateStatusTransition('ABANDONED', 'READING')).toThrow(AppError);
  });

  it('validates page ranges and page count', () => {
    expect(() => validatePageRange(42, 44, 300)).not.toThrow();
    expect(() => validatePageRange(44, 42, 300)).toThrow(AppError);
    expect(() => validatePageRange(42, 301, 300)).toThrow(AppError);
  });

  it('validates single pages against the current page count', () => {
    expect(() => validateSinglePage(300, 300)).not.toThrow();
    expect(() => validateSinglePage(301, 300)).toThrow(AppError);
    // 未填写总页数时不施加页码上界
    expect(() => validateSinglePage(9999, null)).not.toThrow();
  });

  it('rejects shrinking page count below the maximum active trace page', () => {
    expect(() => assertPageCountCoversTraces(100, 100)).not.toThrow();
    expect(() => assertPageCountCoversTraces(100, 0)).not.toThrow();
    expect(() => assertPageCountCoversTraces(99, 100)).toThrow(AppError);
  });

  it('blocks restoring a trace whose page is beyond the current page count', () => {
    expect(() => assertRestorablePage(300, 300)).not.toThrow();
    expect(() => assertRestorablePage(301, 300)).toThrow(AppError);
    // 总页数被清空后恢复不再受上界阻挡
    expect(() => assertRestorablePage(301, null)).not.toThrow();
  });

  it('normalizes mood tags and rejects empty or duplicate overrun', () => {
    expect(normalizeMoodTags(['MOVED', 'MOVED', 'CALM'])).toEqual(['MOVED', 'CALM']);
    expect(() => normalizeMoodTags([])).toThrow(AppError);
  });

  it('enforces restore and edit windows', () => {
    const now = new Date('2026-09-24T12:00:00.000Z');
    expect(isRestoreWindowOpen(new Date('2026-09-24T00:00:00.000Z'), now)).toBe(true);
    expect(isRestoreWindowOpen(new Date('2026-09-22T00:00:00.000Z'), now)).toBe(false);
    expect(isStrictlyEditable(new Date('2026-09-25T00:00:00.000Z'), now)).toBe(true);
    expect(isStrictlyEditable(new Date('2026-09-23T00:00:00.000Z'), now)).toBe(false);
  });
});
