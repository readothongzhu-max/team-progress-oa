import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, copyFile, chmod, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const dataDir = resolve(process.env.DATA_DIR || './data');
const destination = resolve('backups', new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-') + '-' + process.pid);
await mkdir(destination, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(join(dataDir, 'team.sqlite'), { readOnly: true });
try {
  await backup(db, join(destination, 'team.sqlite'));
  await copyFile(join(dataDir, 'encryption.key'), join(destination, 'encryption.key'));
  await chmod(join(destination, 'team.sqlite'), 0o600);
  await chmod(join(destination, 'encryption.key'), 0o600);
  await writeFile(join(destination, '恢复说明.txt'), '恢复前先停止应用，将 team.sqlite 和 encryption.key 一起放入新的空数据目录。不要覆盖正在运行的数据库。备份包含账号和私有仓库凭据，请妥善保管。\n', { mode: 0o600 });
  console.log(`备份完成：${destination}`);
} finally { db.close(); }
