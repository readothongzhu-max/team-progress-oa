import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { backup } from 'node:sqlite';
import { resolve, dirname, join } from 'node:path';
import { openStore, hashPassword, now, requireValue, safeUser } from '../lib/core.mjs';
import { canonicalOwner, planSheetImport } from '../lib/sheet-import.mjs';

const args = process.argv.slice(2);
const sourcePath = resolve(args.find(arg => !arg.startsWith('--')) || 'data/imports/it-project-20260922/source.json');
const apply = args.includes('--apply');
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const plan = planSheetImport(source);
await writeFile(join(dirname(sourcePath), 'plan.json'), JSON.stringify(plan, null, 2), { mode: 0o600 });
const summary = { mode: apply ? 'apply' : 'dry-run', projects: plan.items.length, parentGroups: plan.groups.length, owners: plan.owners, unspecifiedProgress: plan.items.filter(i => i.progress === null).length, dailyRecords: 0 };
if (!apply) { console.log(JSON.stringify(summary, null, 2)); process.exit(0); }

const dataDir = resolve(process.env.DATA_DIR || './data');
const store = await openStore(dataDir), { db } = store;
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const backupDir = resolve('backups', `before-sheet-import-${runId}`);
let transaction = false;
try {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  await backup(db, join(backupDir, 'team.sqlite'));
  await copyFile(join(dataDir, 'encryption.key'), join(backupDir, 'encryption.key'));
  const existingUsers = db.prepare('SELECT * FROM users').all();
  const newUsers = [];
  for (const owner of plan.owners) {
    const matches = existingUsers.filter(u => canonicalOwner(u.name) === owner.name);
    requireValue(matches.length <= 1, `系统里有多个 ${owner.name} 账号，无法自动分配`);
    if (matches.length) { requireValue(matches[0].active, `${owner.name} 的现有账号已停用`); continue; }
    requireValue(!existingUsers.some(u => u.username.toLowerCase() === owner.username.toLowerCase()), `账号 ${owner.username} 已被其他姓名使用`);
    const password = randomBytes(15).toString('base64url');
    newUsers.push({ ...owner, password, hash: await hashPassword(password) });
  }
  // Save bootstrap credentials locally before committing users; never print them or send them externally.
  let credentialsPath = null;
  if (newUsers.length) {
    credentialsPath = join(dirname(sourcePath), `member-accounts-${runId}.txt`);
    await writeFile(credentialsPath, ['导入成员初始账号（仅本机保管）', '角色均为成员，请由管理员分别交给本人；首次登录后修改密码。', '',
      ...newUsers.map(u => `姓名：${u.name}\n账号：${u.username}\n初始密码：${u.password}\n`)].join('\n'), { mode: 0o600, flag: 'wx' });
  }
  db.exec('BEGIN IMMEDIATE'); transaction = true;
  db.exec(`CREATE TABLE IF NOT EXISTS sheet_import_items (
    source_key TEXT PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    source_hash TEXT NOT NULL, original_json TEXT NOT NULL, imported_at TEXT NOT NULL);`);
  for (const u of newUsers) db.prepare('INSERT INTO users(username,name,password_hash,role,created_at) VALUES(?,?,?,?,?)').run(u.username, u.name, u.hash, 'member', now());
  const users = db.prepare('SELECT * FROM users WHERE active=1').all();
  const imported = [], skipped = [];
  for (const item of plan.items) {
    const prior = db.prepare('SELECT * FROM sheet_import_items WHERE source_key=?').get(item.sourceKey);
    if (prior?.project_id) { skipped.push({ name: item.name, id: prior.project_id, reason: '此源记录已导入；保留系统内的后续修改' }); continue; }
    requireValue(!db.prepare('SELECT id FROM projects WHERE name=?').get(item.name), `系统中已有同名项目「${item.name}」，未覆盖`);
    const owner = users.find(u => canonicalOwner(u.name) === item.owner);
    requireValue(owner, `找不到负责人 ${item.owner}`);
    const stamp = now();
    const result = db.prepare(`INSERT INTO projects(name,description,owner_id,stage,progress,progress_known,due_date,repo,links,created_at,updated_at)
      VALUES(?,?,?,'待确认',0,0,?,'','[]',?,?)`).run(item.name, item.description, owner.id, item.dueDate, stamp, stamp);
    const id = Number(result.lastInsertRowid);
    db.prepare(`INSERT INTO sheet_import_items(source_key,project_id,source_hash,original_json,imported_at) VALUES(?,?,?,?,?)
      ON CONFLICT(source_key) DO UPDATE SET project_id=excluded.project_id,source_hash=excluded.source_hash,original_json=excluded.original_json,imported_at=excluded.imported_at`)
      .run(item.sourceKey, id, item.sourceHash, JSON.stringify(item.original), stamp);
    imported.push({ name: item.name, id, owner: owner.name, category: item.category, dueDate: item.dueDate, sourceRow: item.rowNumber });
  }
  db.exec('COMMIT'); transaction = false;
  const receipt = { ...summary, completedAt: now(), imported, skipped, membersCreated: newUsers.map(u => ({ name: u.name, username: u.username })),
    members: users.filter(u => plan.owners.some(o => o.name === canonicalOwner(u.name))).map(safeUser), credentialsPath, backupDir, sourcePath };
  const receiptPath = join(dirname(sourcePath), `receipt-${runId}.json`);
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ imported: imported.length, skipped: skipped.length, membersCreated: newUsers.length, receiptPath, credentialsPath, backupDir }, null, 2));
} catch (error) {
  if (transaction) db.exec('ROLLBACK');
  console.error(error.message); process.exitCode = 1;
} finally { db.close(); }
