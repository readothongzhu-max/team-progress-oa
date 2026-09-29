import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore, now, calendar, isOverdue, HttpError, requireValue, digest, safeUser, hashPassword, verifyPassword, textField, validateProject } from './lib/core.mjs';
import { githubService } from './lib/github.mjs';

const root = dirname(fileURLToPath(import.meta.url));
export async function createApp(options = {}) {
  const dataDir = resolve(options.dataDir || process.env.DATA_DIR || join(root, 'data'));
  const store = await openStore(dataDir), { db } = store;
  const github = githubService(store, options.githubToken ?? process.env.GITHUB_TOKEN ?? '', options.fetcher);
  const configuredOrigin = options.origin ?? process.env.APP_ORIGIN ?? '';
  const secure = options.secure ?? process.env.COOKIE_SECURE === 'true';
  const attempts = new Map();
  const dummyHash = await hashPassword(randomBytes(24).toString('hex'));
  let syncing = false;
  const cleanTimer = setInterval(() => {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
    for (const [key, value] of attempts) if (value.resetAt < Date.now()) attempts.delete(key);
  }, 60000).unref();
  async function syncAll() {
    if (syncing) return;
    syncing = true;
    try { for (const project of db.prepare("SELECT * FROM projects WHERE repo<>''").all()) await github.sync(project); }
    finally { syncing = false; }
  }
  const syncTimer = options.backgroundSync === false ? null : setInterval(syncAll, 15 * 60 * 1000).unref();
  const startupTimer = options.backgroundSync === false ? null : setTimeout(syncAll, 5000).unref();
  function parseSession(req) {
    const raw = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('team_session='))?.slice(13);
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
    return db.prepare(`SELECT s.csrf,s.token_hash,u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(digest(raw), now()) || null;
  }
  const sessionBody = (session) => ({ user: session ? safeUser(session) : null, csrf: session?.csrf || null, ...calendar() });
  function projectView(p) {
    const week = calendar();
    const report = db.prepare('SELECT * FROM reports WHERE project_id=? AND week_start=?').get(p.id, week.weekStart);
    const cached = db.prepare('SELECT * FROM github_cache WHERE project_id=?').get(p.id);
    const owner = db.prepare('SELECT name,active FROM users WHERE id=?').get(p.owner_id);
    return { ...p, progress: p.progress_known ? p.progress : null, owner_name: owner?.name || '', owner_active: Boolean(owner?.active), links: JSON.parse(p.links), overdue: isOverdue(p, week.today),
      missing_report: !report && !['已上线', '暂停'].includes(p.stage),
      report: report ? { ...report, links: JSON.parse(report.links) } : null,
      github: cached ? { ...cached, commits: JSON.parse(cached.commits) } : null };
  }
  const getProject = (id) => {
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(Number(id));
    requireValue(project, '项目不存在', 404); return project;
  };
  const requireEditor = (user, project) => requireValue(user.role === 'admin' || project.owner_id === user.id, '只有项目负责人或管理员可以修改', 403);
  const requireAdmin = (user) => requireValue(user.role === 'admin', '只有管理员可以操作', 403);
  async function readBody(req) {
    requireValue((req.headers['content-type'] || '').startsWith('application/json'), '请求需要使用 JSON', 415);
    const chunks = []; let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; requireValue(bytes <= 65536, '提交内容过大', 413); chunks.push(chunk); }
    try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); requireValue(body && typeof body === 'object' && !Array.isArray(body), '提交内容格式不正确'); return body; }
    catch (error) { if (error.status) throw error; throw new HttpError(400, 'JSON 格式不正确'); }
  }
  const cookie = (token, age) => `team_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname, method = req.method;
      if (path === '/healthz' && method === 'GET') { db.prepare('SELECT 1').get(); return json({ ok: true }); }
      if (!path.startsWith('/api/')) {
        requireValue(method === 'GET' || method === 'HEAD', '不支持的请求方式', 405);
        const staticFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
        const item = staticFiles[path]; requireValue(item, '页面不存在', 404);
        const content = await readFile(join(root, 'web', item[0]));
        res.writeHead(200, { 'Content-Type': item[1], 'Cache-Control': 'no-cache' }); return res.end(method === 'HEAD' ? undefined : content);
      }
      let session = parseSession(req);
      let parsedBody = {};
      const refreshSession = () => {
        session = parseSession(req);
        requireValue(session && req.headers['x-csrf-token'] === session.csrf, '登录已过期，请重新登录', 403);
        return session;
      };
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const expected = configuredOrigin || `http://${req.headers.host}`;
        requireValue(req.headers.origin === expected, '请求来源不正确，请从系统页面重新操作', 403);
        if (path !== '/api/login') requireValue(session && req.headers['x-csrf-token'] === session.csrf, '登录已过期，请重新登录', 403);
        if (Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding']) parsedBody = await readBody(req);
        // Body streaming may yield: re-read identity and permissions before any mutation.
        if (path !== '/api/login') refreshSession();
      }
      if (path === '/api/session' && method === 'GET') return json(sessionBody(session));
      if (path === '/api/login' && method === 'POST') {
        const body = parsedBody;
        const username = textField(body.username, '账号', 40, true).toLowerCase();
        const key = `${req.socket.remoteAddress}:${username}`;
        const recent = attempts.get(key);
        requireValue(!recent || recent.resetAt < Date.now() || recent.count < 8, '尝试次数过多，请 15 分钟后重试', 429);
        // Reserve the attempt before the expensive password check, so concurrent requests count.
        attempts.set(key, { count: recent && recent.resetAt > Date.now() ? recent.count + 1 : 1, resetAt: recent && recent.resetAt > Date.now() ? recent.resetAt : Date.now() + 900000 });
        const user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username);
        const valid = await verifyPassword(body.password, user?.password_hash || dummyHash);
        const currentUser = user ? db.prepare('SELECT * FROM users WHERE id=? AND active=1 AND password_hash=?').get(user.id, user.password_hash) : null;
        if (!currentUser || !valid) {
          throw new HttpError(401, '账号或密码不正确，或账号已停用');
        }
        attempts.delete(key);
        if (session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);
        const raw = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
        db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').run(digest(raw), user.id, csrf, new Date(Date.now() + 7 * 86400000).toISOString());
        res.setHeader('Set-Cookie', cookie(raw, 7 * 86400)); return json(sessionBody({ ...currentUser, csrf }));
      }
      requireValue(session, '请先登录', 401);
      if (path === '/api/logout' && method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);
        res.setHeader('Set-Cookie', cookie('', 0)); return json({ ok: true });
      }
      if (path === '/api/password' && method === 'PUT') {
        const body = parsedBody;
        requireValue(await verifyPassword(body.old_password, session.password_hash), '当前密码不正确', 400);
        const hash = await hashPassword(body.password);
        refreshSession();
        db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, session.id);
        db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(session.id, session.token_hash);
        if (session.username === 'admin') await unlink(join(dataDir, 'initial-access.txt')).catch(() => {});
        return json({ ok: true });
      }
      if (path === '/api/users' && method === 'GET') return json(db.prepare('SELECT * FROM users ORDER BY active DESC,id').all().map(safeUser));
      if (path === '/api/users' && method === 'POST') {
        requireAdmin(session); const body = parsedBody;
        const username = textField(body.username, '账号', 40, true).toLowerCase();
        requireValue(/^[a-z0-9][a-z0-9_.-]{1,39}$/.test(username), '账号使用 2～40 位字母、数字、点、横线或下划线');
        const name = textField(body.name, '姓名', 40, true), role = body.role || 'member';
        requireValue(['admin', 'member'].includes(role), '角色不正确');
        requireValue(!db.prepare('SELECT id FROM users WHERE username=?').get(username), '该账号已存在', 409);
        const hash = await hashPassword(body.password);
        requireAdmin(refreshSession());
        requireValue(!db.prepare('SELECT id FROM users WHERE username=?').get(username), '该账号已存在', 409);
        const result = db.prepare('INSERT INTO users(username,name,password_hash,role,created_at) VALUES(?,?,?,?,?)').run(username, name, hash, role, now());
        return json(safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid)), 201);
      }
      const userMatch = path.match(/^\/api\/users\/(\d+)$/);
      if (userMatch && method === 'PATCH') {
        requireAdmin(session); const body = parsedBody, id = Number(userMatch[1]);
        const newHash = body.password ? await hashPassword(body.password) : null;
        requireAdmin(refreshSession());
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(id); requireValue(user, '账号不存在', 404);
        const name = textField(body.name ?? user.name, '姓名', 40, true), role = body.role ?? user.role;
        requireValue(['admin', 'member'].includes(role), '角色不正确');
        requireValue(body.active === undefined || typeof body.active === 'boolean', '账号状态不正确');
        const active = body.active === undefined ? user.active : Number(body.active);
        requireValue(id !== session.id || (active && role === 'admin'), '不能停用自己或取消自己的管理员权限');
        if (!active) requireValue(!db.prepare('SELECT id FROM projects WHERE owner_id=? LIMIT 1').get(id), '请先将该成员的项目转交给其他负责人');
        const hash = newHash || user.password_hash;
        db.prepare('UPDATE users SET name=?,role=?,active=?,password_hash=? WHERE id=?').run(name, role, active, hash, id);
        if (!active || body.password || role !== user.role) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
        return json(safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)));
      }
      if (path === '/api/projects' && method === 'GET') return json(db.prepare('SELECT * FROM projects ORDER BY updated_at DESC,id DESC').all().map(projectView));
      if (path === '/api/projects' && method === 'POST') {
        const body = parsedBody, p = validateProject(body, null, session, db), stamp = now();
        const result = db.prepare(`INSERT INTO projects(name,description,owner_id,stage,progress,progress_known,due_date,repo,links,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(p.name, p.description, p.owner_id, p.stage, p.progress, p.progress_known, p.due_date, p.repo, p.links, stamp, stamp);
        const project = getProject(result.lastInsertRowid);
        if (project.repo) void github.sync(project);
        return json(projectView(project), 201);
      }
      const projectMatch = path.match(/^\/api\/projects\/(\d+)(?:\/(reports|sync))?$/);
      if (projectMatch) {
        const project = getProject(projectMatch[1]), action = projectMatch[2];
        if (!action && method === 'GET') {
          const reports = db.prepare(`SELECT r.*,u.name AS author_name FROM reports r JOIN users u ON u.id=r.author_id WHERE r.project_id=? ORDER BY week_start DESC`).all(project.id);
          return json({ ...projectView(project), reports: reports.map(r => ({ ...r, links: JSON.parse(r.links) })) });
        }
        if (!action && method === 'PATCH') {
          requireEditor(session, project);
          const p = validateProject(parsedBody, project, session, db);
          db.prepare('UPDATE projects SET name=?,description=?,owner_id=?,stage=?,progress=?,progress_known=?,due_date=?,repo=?,links=?,updated_at=? WHERE id=?')
            .run(p.name, p.description, p.owner_id, p.stage, p.progress, p.progress_known, p.due_date, p.repo, p.links, now(), project.id);
          if (p.repo !== project.repo) db.prepare('DELETE FROM github_cache WHERE project_id=?').run(project.id);
          const updated = getProject(project.id);
          if (p.repo && p.repo !== project.repo) void github.sync(updated);
          return json(projectView(updated));
        }
        if (!action && method === 'DELETE') { requireAdmin(session); db.prepare('DELETE FROM projects WHERE id=?').run(project.id); return json({ ok: true }); }
        if (action === 'reports' && method === 'PUT') {
          requireEditor(session, project); const body = parsedBody;
          requireValue(body.week_start === calendar().weekStart, '周次已经变化，请关闭表单并刷新页面，再提交本周周报', 409);
          const completed = textField(body.completed, '本周完成', 6000, true), next = textField(body.next_plan, '下周计划', 6000, true);
          const p = validateProject({ stage: body.stage, progress: body.progress, due_date: body.due_date, links: body.links }, project, session, db);
          requireValue(p.progress_known && p.stage !== '待确认', '请先填写完成度并确认项目阶段，再提交周报');
          const week = calendar().weekStart, stamp = now();
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare(`INSERT INTO reports(project_id,week_start,completed,next_plan,stage,progress,due_date,links,author_id,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,week_start) DO UPDATE SET completed=excluded.completed,next_plan=excluded.next_plan,
              stage=excluded.stage,progress=excluded.progress,due_date=excluded.due_date,links=excluded.links,author_id=excluded.author_id,updated_at=excluded.updated_at`)
              .run(project.id, week, completed, next, p.stage, p.progress, p.due_date, p.links, session.id, stamp, stamp);
            db.prepare('UPDATE projects SET stage=?,progress=?,progress_known=1,due_date=?,links=?,updated_at=? WHERE id=?').run(p.stage, p.progress, p.due_date, p.links, stamp, project.id);
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          return json(projectView(getProject(project.id)));
        }
        if (action === 'sync' && method === 'POST') {
          requireValue(project.repo, '该项目还没有关联 GitHub 仓库');
          await github.sync(project); return json(projectView(getProject(project.id)));
        }
      }
      if (path === '/api/settings/github' && method === 'GET') {
        requireAdmin(session); return json({ configured: github.configured(), source: github.source(), scopes: github.scopes() });
      }
      if (path === '/api/settings/github' && method === 'PUT') {
        requireAdmin(session); const body = parsedBody;
        const owner = textField(body.owner || '', '资源所有者', 39).toLowerCase();
        requireValue(!owner || /^[a-z0-9][a-z0-9-]{0,38}$/.test(owner), '资源所有者需要是 GitHub 用户名或组织名称');
        requireValue(owner || github.source() !== 'environment', '默认凭据由服务器环境变量管理；仍可为指定用户或组织单独配置');
        const token = textField(body.token, 'GitHub 凭据', 500);
        requireValue(!/\s/.test(token), '凭据不能包含空格或换行');
        github.saveToken(token, owner); db.prepare('UPDATE github_cache SET checked_at=NULL').run();
        return json({ configured: github.configured(), source: github.source(), scopes: github.scopes() });
      }
      throw new HttpError(404, '接口不存在');
    } catch (error) {
      if (error.status) return json({ error: error.message }, error.status);
      console.error('Request failed:', error.code || error.name);
      return json({ error: '操作未完成，请重试；如果仍然失败，请联系管理员' }, 500);
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return { server, db, dataDir, async close() { clearInterval(cleanTimer); clearInterval(syncTimer); clearTimeout(startupTimer); await new Promise(r => server.close(r)); db.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = await createApp();
  const port = Number(process.env.PORT || 3210), host = process.env.HOST || '127.0.0.1';
  app.server.listen(port, host, () => {
    console.log(`项目进度 OA 已启动：http://${host}:${port}`);
    console.log(`数据目录：${app.dataDir}`);
    console.log('首次登录信息见数据目录中的 initial-access.txt；如已修改密码则该文件已清除。');
  });
  const stop = async () => { await app.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
