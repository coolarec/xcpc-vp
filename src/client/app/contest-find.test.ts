import { expect, it } from 'vitest';
import { filterFindInput } from './contest-find';

it('removes Chinese committed by an IME while keeping English, digits and punctuation', () => {
  expect(filterFindInput({ value: '', start: 0, end: 0 }, '中文', 2)).toEqual({ value: '', caret: 0 });
  expect(filterFindInput({ value: '', start: 0, end: 0 }, 'Team A-123!', 11)).toEqual({ value: 'Team A-123!', caret: 11 });
  expect(filterFindInput({ value: 'team', start: 4, end: 4 }, 'team中文ABC', 9)).toEqual({ value: 'teamABC', caret: 7 });
});

it('preserves pasted Chinese before and after an English edit', () => {
  expect(filterFindInput({ value: '北京大学', start: 2, end: 2 }, '北京A大学', 3)).toEqual({ value: '北京A大学', caret: 3 });
  expect(filterFindInput({ value: '北京大学', start: 4, end: 4 }, '北京大学ABC', 7)).toEqual({ value: '北京大学ABC', caret: 7 });
  expect(filterFindInput({ value: '北京大学', start: 0, end: 0 }, 'A北京大学', 1)).toEqual({ value: 'A北京大学', caret: 1 });
});

it('removes only newly composed Chinese next to pasted text, even for identical characters', () => {
  expect(filterFindInput({ value: '北京大学', start: 2, end: 2 }, '北京中文大学', 4)).toEqual({ value: '北京大学', caret: 2 });
  expect(filterFindInput({ value: '中文', start: 1, end: 1 }, '中中文', 2)).toEqual({ value: '中文', caret: 1 });
  expect(filterFindInput({ value: '中中', start: 1, end: 1 }, '中中中', 2)).toEqual({ value: '中中', caret: 1 });
});

it('supports selection replacement and deletion without stripping unrelated pasted characters', () => {
  expect(filterFindInput({ value: '北京大学', start: 0, end: 2 }, 'ABC大学', 3)).toEqual({ value: 'ABC大学', caret: 3 });
  expect(filterFindInput({ value: '北京大学', start: 0, end: 2 }, '中文大学', 2)).toEqual({ value: '大学', caret: 0 });
  expect(filterFindInput({ value: '北京大学', start: 2, end: 2 }, '北大学', 1)).toEqual({ value: '北大学', caret: 1 });
  expect(filterFindInput({ value: '北京大学', start: 1, end: 1 }, '北大学', 1)).toEqual({ value: '北大学', caret: 1 });
});

it('handles non-BMP input without leaving a broken surrogate or damaging pasted text', () => {
  expect(filterFindInput({ value: '𠮷', start: 2, end: 2 }, '𠮷𠮷a', 5)).toEqual({ value: '𠮷a', caret: 3 });
  expect(filterFindInput({ value: '', start: 0, end: 0 }, '😀A', 3)).toEqual({ value: 'A', caret: 1 });
});

it('leaves a sanitized value unchanged on the trailing input event after compositionend', () => {
  expect(filterFindInput({ value: '北京A大学', start: 3, end: 3 }, '北京A大学', 3)).toEqual({ value: '北京A大学', caret: 3 });
});
