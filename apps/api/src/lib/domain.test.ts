import { describe, expect, it } from 'vitest';
import {
  assertRestorablePage,
  isRestoreWindowOpen,
  isStrictlyEditable,
  normalizeMoodTags,
  RESTORE_WINDOW_MS,
  restoreWindowStart,
  validatePageRange,
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

  it('computes the restore window start used for page-count boundaries', () => {
    const now = new Date('2026-09-24T12:00:00.000Z');
    expect(restoreWindowStart(now).getTime()).toBe(now.getTime() - RESTORE_WINDOW_MS);
    // 窗口起点删除的痕迹恰好仍可恢复，边界复算必须把它算进去
    expect(isRestoreWindowOpen(restoreWindowStart(now), now)).toBe(true);
    expect(isRestoreWindowOpen(new Date(restoreWindowStart(now).getTime() - 1), now)).toBe(false);
  });

  it('rejects restoring traces beyond the current page count', () => {
    expect(() => assertRestorablePage(100, 100)).not.toThrow();
    expect(() => assertRestorablePage(100, null)).not.toThrow();
    try {
      assertRestorablePage(100, 50);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(409);
      expect((error as AppError).code).toBe('PAGE_OUT_OF_RANGE');
    }
  });
});
