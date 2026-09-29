import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const scrypt = promisify(scryptCallback);
export const STAGES = ['想法', '开发中', '测试中', '已上线', '暂停', '待确认'];
export const now = () => new Date().toISOString();
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function requireValue(condition, message, status = 400) { if (!condition) throw new HttpError(status, message); }
export function calendar(date = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const monday = new Date(`${today}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 6);
  return { today, weekStart: monday.toISOString().slice(0, 10), weekEnd: sunday.toISOString().slice(0, 10) };
}
export function isOverdue(project, today = calendar().today) { return Boolean(project.due_date && project.due_date < today && !['已上线', '待确认'].includes(project.stage)); }
export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, encoded] = hash.split(':');
  const key = await scrypt(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return key.length === Buffer.from(encoded, 'hex').length && timingSafeEqual(key, Buffer.from(encoded, 'hex'));
}
export function validatePassword(password) { requireValue(typeof password === 'string' && password.length >= 10 && password.length <= 128, '密码需要 10～128 个字符'); }
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const safeUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: Boolean(u.active) });
export function textField(value, label, max = 3000, required = false) {
  requireValue(typeof value === 'string', `${label}格式不正确`);
  const text = value.trim();
  requireValue(text.length <= max && (!required || text.length > 0), `${label}${required ? '不能为空，且' : ''}最多 ${max} 个字符`);
  return text;
}
export function validDate(value) {
  if (value === '' || value === null) return null;
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), '日期格式不正确');
  const date = new Date(`${value}T00:00:00Z`);
  requireValue(!isNaN(date) && date.toISOString().slice(0, 10) === value, '日期不存在');
  return value;
}
export function normalizeRepo(value) {
  if (!value) return '';
  requireValue(typeof value === 'string', 'GitHub 仓库格式不正确');
  let repo = value.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '').replace(/\.git$/, '');
  requireValue(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/[a-zA-Z0-9_.-]{1,100}$/.test(repo) && !repo.split('/').some(x => x === '.' || x === '..'), '请填写 GitHub 的 owner/repo 或完整仓库地址');
  return repo;
}
export function validLinks(value) {
  requireValue(Array.isArray(value) && value.length <= 8, '最多添加 8 个成果链接');
  return value.map(item => {
    const label = textField(item.label || '查看成果', '链接名称', 60, true);
    const url = textField(item.url, '链接地址', 2000, true);
    let parsed; try { parsed = new URL(url); } catch { throw new HttpError(400, '成果链接需要完整网址'); }
    requireValue(['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password, '成果链接仅支持 http 或 https 网址');
    return { label, url };
  });
}
export function validateProject(input, existing, user, db) {
  const owner_id = input.owner_id === undefined ? (existing?.owner_id || user.id) : Number(input.owner_id);
  requireValue(Number.isInteger(owner_id) && db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(owner_id), '请选择有效的负责人');
  requireValue(user.role === 'admin' || owner_id === user.id, '成员只能创建或维护自己负责的项目', 403);
  const stage = input.stage ?? existing?.stage ?? '想法';
  const progress = input.progress === undefined ? (existing?.progress_known === 0 ? null : existing?.progress ?? 0) : input.progress;
  requireValue(STAGES.includes(stage), '项目阶段不正确');
  requireValue(progress === null || (typeof progress === 'number' && Number.isInteger(progress) && progress >= 0 && progress <= 100), '完成度需要是 0～100 的整数，也可以留空');
  return {
    name: textField(input.name ?? existing?.name ?? '', '项目名称', 80, true),
    description: textField(input.description ?? existing?.description ?? '', '项目简介', 1000),
    owner_id, stage, progress: progress ?? 0, progress_known: progress === null ? 0 : 1,
    due_date: validDate(input.due_date === undefined ? (existing?.due_date || null) : input.due_date),
    repo: normalizeRepo(input.repo ?? existing?.repo ?? ''),
    links: JSON.stringify(validLinks(input.links ?? (existing ? JSON.parse(existing.links) : [])))
  };
}
export async function openStore(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDir, 'team.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      owner_id INTEGER NOT NULL REFERENCES users(id), stage TEXT NOT NULL, progress INTEGER NOT NULL CHECK(progress BETWEEN 0 AND 100),
      progress_known INTEGER NOT NULL DEFAULT 1 CHECK(progress_known IN (0,1)),
      due_date TEXT, repo TEXT NOT NULL DEFAULT '', links TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      week_start TEXT NOT NULL, completed TEXT NOT NULL, next_plan TEXT NOT NULL,
      stage TEXT NOT NULL, progress INTEGER NOT NULL, due_date TEXT, links TEXT NOT NULL,
      author_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(project_id,week_start));
    CREATE TABLE IF NOT EXISTS github_cache (
      project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      commits TEXT NOT NULL DEFAULT '[]', last_commit_at TEXT, checked_at TEXT, synced_at TEXT,
      error TEXT, status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  if (!db.prepare('PRAGMA table_info(projects)').all().some(c => c.name === 'progress_known')) {
    db.exec('ALTER TABLE projects ADD COLUMN progress_known INTEGER NOT NULL DEFAULT 1 CHECK(progress_known IN (0,1))');
  }
  db.exec('PRAGMA user_version=2');
  const keyPath = join(dataDir, 'encryption.key');
  if (!existsSync(keyPath)) {
    requireValue(!db.prepare("SELECT key FROM settings WHERE key='github_token' OR key LIKE 'github_token:%' LIMIT 1").get(), '数据加密密钥缺失，请恢复 data/encryption.key', 500);
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
  }
  const key = readFileSync(keyPath);
  requireValue(key.length === 32, '数据加密密钥无效', 500);
  const seal = (value) => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  };
  const unseal = (value) => {
    const data = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  };
  if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
    const password = randomBytes(15).toString('base64url');
    const password_hash = await hashPassword(password);
    db.prepare('INSERT INTO users(username,name,password_hash,role,created_at) VALUES(?,?,?,?,?)').run('admin', '管理员', password_hash, 'admin', now());
    writeFileSync(join(dataDir, 'initial-access.txt'), `项目进度 OA 初始账号\n账号：admin\n密码：${password}\n\n首次登录后，请在右下角的「修改密码」中设置自己的密码。\n此文件仅用于本机首次登录，请勿提交到代码仓库或发送给其他成员。\n`, { mode: 0o600 });
  }
  return { db, seal, unseal };
}
