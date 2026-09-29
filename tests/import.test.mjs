import test from 'node:test';
import assert from 'node:assert/strict';
import { planSheetImport } from '../lib/sheet-import.mjs';
import { isOverdue } from '../lib/core.mjs';

test('sheet mapping preserves unknown progress, grouping, standalone rows, and name aliases', () => {
  const source = { spreadsheetId:'sheet', sheetId:1, sheetName:'Gantt 進度表', firstRow:3, dailyReports:[['header']], rows:[
    ['黃永銳 / 黃佳堂','【專案】內部','高','2026-08-01','2026-09-25'],
    ['黃佳堂','　↳ 釘釘考勤管理','中','2026-08-01','2026-08-25'],
    ['黄佳堂','乘风雇佣ai','高','2026-09-14','2026-09-19']
  ] };
  const plan = planSheetImport(source);
  assert.equal(plan.items.length, 2); assert.equal(plan.groups.length, 1); assert.equal(plan.owners.length, 1);
  assert.equal(plan.items[0].category, '內部'); assert.equal(plan.items[1].category, null);
  assert.equal(plan.items[1].owner, '黃佳堂'); assert.equal(plan.items[1].stage, '待确认'); assert.equal(plan.items[1].progress, null);
  assert.equal(plan.items[1].sourceKey, 'sheet:1:5'); assert.equal(plan.items[1].dueDate, '2026-09-19');
  assert.match(plan.items[0].description, /优先级：中/); assert.match(plan.items[0].description, /2026-08-01/);
  assert.equal(isOverdue({ stage:'待确认', due_date:'2026-08-25' }, '2026-09-22'), false);
});
