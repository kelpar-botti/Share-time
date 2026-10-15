import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const loadedModule = { exports: {} };
const output = ts.transpileModule(readFileSync(new URL('../src/lib/date.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(`(function(module,exports) { ${output}\n})`, { Date })(loadedModule, loadedModule.exports);
const { isValidDateString, isValidMonthString } = loadedModule.exports;

test('calendar date validator rejects impossible days and accepts actual leap years', () => {
  for (const value of [undefined, null, '', '2026-2-01', '2026-02-30', '2026-02-29', '2100-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-10-00', '0001-01-01']) assert.equal(isValidDateString(value), false, String(value));
  for (const value of ['2026-10-15', '2026-04-30', '2028-02-29', '2000-02-29', '1999-12-31']) assert.equal(isValidDateString(value), true, value);
});

test('month validator rejects malformed and out of range month URL values', () => {
  for (const value of [undefined, null, '', '2026-1', '2026-00', '2026-13', '2026-10-15', '0001-01']) assert.equal(isValidMonthString(value), false, String(value));
  for (const value of ['2026-01', '2026-12', '1999-12']) assert.equal(isValidMonthString(value), true, value);
});
