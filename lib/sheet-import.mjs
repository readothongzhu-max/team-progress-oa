import { createHash } from 'node:crypto';
import { requireValue, validDate } from './core.mjs';

export const canonicalOwner = (name) => name.trim() === '黄佳堂' ? '黃佳堂' : name.trim();
const usernames = { '黃永銳': 'huangyongrui', '黃佳堂': 'huangjiatang', '張超拓': 'zhangchaotuo' };
export function planSheetImport(source) {
  requireValue(source.sheetName === 'Gantt 進度表' && Array.isArray(source.rows), '源工作表格式不正确');
  requireValue(source.dailyReports?.length === 1, '日报表出现数据，需要先确定如何迁移历史记录');
  const items = [], groups = []; let group = '';
  for (const [index, row] of source.rows.entries()) {
    if (!row.some(value => value !== null && value !== '')) continue;
    const [rawOwner = '', rawName = '', priority = '', start = '', due = '', progress = '', , status = '', risks = '', next = ''] = row;
    const rowNumber = source.firstRow + index, rawTitle = String(rawName).trim();
    requireValue(rawTitle, `第 ${rowNumber} 行缺少名称`);
    if (rawTitle.startsWith('【專案】')) {
      group = rawTitle.replace(/^【專案】\s*/, '').trim(); groups.push({ name: group, rowNumber, original: row }); continue;
    }
    const isChild = /^↳/.test(rawTitle);
    requireValue(!isChild || group, `第 ${rowNumber} 行子项没有所属大项`);
    const name = rawTitle.replace(/^↳\s*/, '').trim();
    const owner = canonicalOwner(String(rawOwner));
    requireValue(owner && !/[\/、,，]/.test(owner), `第 ${rowNumber} 行负责人不唯一，需要明确负责人`);
    requireValue(progress === '' || progress === null, `第 ${rowNumber} 行已有进度数据，需要核对百分比格式`);
    requireValue(status === '' || status === null, `第 ${rowNumber} 行已有状态，需要核对阶段映射`);
    const category = isChild ? group : null;
    const startDate = validDate(start || null), dueDate = validDate(due || null);
    const description = [category ? `所属大项：${category}` : '所属大项：未分类（原表未标注）', priority ? `优先级：${priority}` : '', startDate ? `原计划开始：${startDate}` : '', risks ? `原表风险／阻塞：${risks}` : '', next ? `原表下一步与备注：${next}` : ''].filter(Boolean).join('\n');
    requireValue(name.length <= 80 && description.length <= 1000, `第 ${rowNumber} 行内容超出系统字段长度，未截断`);
    const sourceKey = `${source.spreadsheetId}:${source.sheetId}:${rowNumber}`;
    items.push({ name, owner, username: usernames[owner] || `member-${createHash('sha256').update(owner).digest('hex').slice(0, 8)}`, category,
      priority, startDate, dueDate, description, stage: '待确认', progress: null, rowNumber, sourceKey,
      sourceHash: createHash('sha256').update(JSON.stringify(row)).digest('hex'), original: row });
  }
  requireValue(new Set(items.map(i => i.name)).size === items.length, '源表出现重名工作，需要核对是否重复');
  return { source: { title: source.title, url: source.url, sheetName: source.sheetName, fetchedAt: source.fetchedAt }, groups, items,
    owners: [...new Set(items.map(i => i.owner))].map(name => ({ name, username: items.find(i => i.owner === name).username, count: items.filter(i => i.owner === name).length })) };
}
