import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename, sep } from 'node:path';
import http from 'node:http';
import { createApp } from '../server.mjs';
import { calendar, isOverdue, normalizeRepo, openStore } from '../lib/core.mjs';
import { fetchCommits, githubService } from '../lib/github.mjs';

async function removeTestDirectory(dir) {
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep) && basename(dir).startsWith('team-oa-test-'));
  await rm(dir, { recursive: true, force: true });
}

test('Shanghai week and delivery-date boundaries are independent of server timezone', () => {
  assert.deepEqual(calendar(new Date('2026-09-20T15:59:59Z')), { today: '2026-09-20', weekStart: '2026-09-14', weekEnd: '2026-09-20' });
  assert.deepEqual(calendar(new Date('2026-09-20T16:00:00Z')), { today: '2026-09-21', weekStart: '2026-09-21', weekEnd: '2026-09-27' });
  assert.equal(calendar(new Date('2026-12-31T23:00:00Z')).weekStart, '2026-12-28');
  assert.equal(isOverdue({ due_date: '2026-09-22', stage: '开发中' }, '2026-09-22'), false);
  assert.equal(isOverdue({ due_date: '2026-09-22', stage: '开发中' }, '2026-09-23'), true);
  assert.equal(isOverdue({ due_date: '2026-09-22', stage: '已上线' }, '2026-09-23'), false);
  assert.equal(normalizeRepo('https://github.com/acme/app.git'), 'acme/app');
  assert.throws(() => normalizeRepo('https://evil.test/acme/app'));
  assert.throws(() => normalizeRepo('owner/..'));
});

test('GitHub maps empty, private, unauthorized, and unavailable responses safely', async () => {
  assert.deepEqual(await fetchCommits('acme/app', '', async () => new Response('', { status: 409 })), []);
  for (const status of [401, 403, 404, 429, 500]) await assert.rejects(fetchCommits('acme/app', 'secret-credential', async () => new Response('upstream-secret', { status })), error => !error.message.includes('secret'));
  await assert.rejects(fetchCommits('acme/app', '', async () => { throw new Error('network-secret'); }), /暂时无法连接/);
});

test('changing a repository during synchronization fetches the new repository immediately', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'team-oa-test-'));
  const store = await openStore(dir);
  try {
    const db = store.db, calls = [];
    db.prepare("INSERT INTO projects(name,owner_id,stage,progress,repo,created_at,updated_at) VALUES('test',1,'开发中',10,'acme/old','now','now')").run();
    let releaseOld;
    const held = new Promise(r => { releaseOld = r; });
    const service = githubService(store, '', async url => {
      calls.push(url);
      if (url.includes('/old/')) await held;
      return new Response(JSON.stringify([{ sha: url.includes('/new/') ? 'new-commit' : 'old-commit', commit: { message: 'demo', author: { name: 'dev' } } }]), { status: 200 });
    });
    const first = service.sync(db.prepare('SELECT * FROM projects WHERE id=1').get());
    db.prepare("UPDATE projects SET repo='acme/new' WHERE id=1").run();
    const second = service.sync(db.prepare('SELECT * FROM projects WHERE id=1').get());
    releaseOld(); await Promise.all([first, second]);
    assert.equal(calls.length, 2); assert.ok(calls[1].includes('/acme/new/'));
    assert.equal(JSON.parse(db.prepare('SELECT commits FROM github_cache WHERE project_id=1').get().commits)[0].sha, 'new-commit');
  } finally { store.db.close(); await removeTestDirectory(dir); }
});

test('End-to-end API: authentication, ownership, weekly history, persistence, encrypted tokens', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'team-oa-test-'));
  let upstreamStatus = 200, observedAuthorization = '', observedUrl = '';
  const fetcher = async (url, options) => {
    observedAuthorization = options.headers.Authorization; observedUrl = url;
    return new Response(JSON.stringify(upstreamStatus === 200 ? [{ sha: '1234567890abcdef', commit: { message: '完成测试\n详情', author: { name: 'Developer', date: '2026-09-21T08:00:00Z' }, committer: { date: '2026-09-21T09:00:00Z' } } }] : { message: 'never leak upstream errors' }), { status: upstreamStatus });
  };
  let app = await createApp({ dataDir: dir, backgroundSync: false, githubToken: '', fetcher });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  let base = `http://127.0.0.1:${app.server.address().port}`;
  const initial = await readFile(join(dir, 'initial-access.txt'), 'utf8');
  const adminPassword = initial.match(/密码：([^\n]+)/)[1];
  const request = async (path, { method = 'GET', body, as, origin = base, csrf = as?.csrf } = {}) => {
    const response = await fetch(base + '/api' + path, { method, headers: { Origin: origin, ...(as ? { Cookie: as.cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
  };
  const login = async (username, password) => {
    const res = await request('/login', { method: 'POST', body: { username, password } });
    assert.equal(res.status, 200); assert.match(res.cookie, /HttpOnly/); assert.match(res.cookie, /SameSite=Strict/);
    return { cookie: res.cookie.split(';')[0], csrf: res.body.csrf, id: res.body.user.id };
  };
  let admin, member, other, project;
  try {
    await t.test('no anonymous reads, sessions require login and writes enforce origin/CSRF', async () => {
      assert.equal((await request('/projects')).status, 401);
      assert.equal((await request('/login', { method: 'POST', body: { username: 'admin', password: adminPassword }, origin: 'https://evil.test' })).status, 403);
      admin = await login('admin', adminPassword);
      assert.equal((await request('/users', { method: 'POST', body: {}, as: admin, csrf: 'wrong' })).status, 403);
      const response = await request('/users', { as: admin });
      assert.ok(!JSON.stringify(response.body).includes('password_hash'));
      assert.equal((await fetch(base + '/data/initial-access.txt')).status, 404);
    });
    await t.test('admin can create members; members cannot edit roles or other projects', async () => {
      for (const username of ['member', 'other']) assert.equal((await request('/users', { method: 'POST', as: admin, body: { username, name: username, role: 'member', password: 'Member-pass-123' } })).status, 201);
      member = await login('member', 'Member-pass-123'); other = await login('other', 'Member-pass-123');
      const res = await request('/projects', { method: 'POST', as: member, body: { name: '真实本地项目', stage: '开发中', progress: 20, due_date: calendar().today } });
      assert.equal(res.status, 201); project = res.body;
      assert.equal((await request('/projects', { as: other })).body.length, 1);
      assert.equal((await request(`/projects/${project.id}`, { method: 'PATCH', as: other, body: { name: '越权' } })).status, 403);
      assert.equal((await request(`/projects/${project.id}`, { method: 'PATCH', as: member, body: { owner_id: other.id } })).status, 403);
      assert.equal((await request('/projects', { method: 'POST', as: member, body: { name: '冒领', owner_id: other.id } })).status, 403);
      assert.equal((await request('/users', { method: 'POST', as: member, body: {} })).status, 403);
      assert.equal((await request(`/users/${member.id}`, { method: 'PATCH', as: member, body: { role: 'admin' } })).status, 403);
      assert.equal((await request(`/projects/${project.id}`, { method: 'DELETE', as: member })).status, 403);
    });
    await t.test('missing imported progress remains unknown on edits, while explicit zero remains zero', async () => {
      const result = await request('/projects', { method: 'POST', as: admin, body: { name: '空值导入测试', stage: '待确认', progress: null, due_date: '2020-01-01' } });
      assert.equal(result.status, 201); assert.equal(result.body.progress, null); assert.equal(result.body.overdue, false);
      const id = result.body.id;
      const edited = await request(`/projects/${id}`, { method: 'PATCH', as: admin, body: { description: '仅修改简介' } });
      assert.equal(edited.body.progress, null); assert.equal(edited.body.stage, '待确认');
      const zero = await request(`/projects/${id}`, { method: 'PATCH', as: admin, body: { progress: 0 } });
      assert.equal(zero.body.progress, 0); assert.equal(zero.body.progress_known, 1);
      await request(`/projects/${id}`, { method: 'DELETE', as: admin });
    });
    await t.test('reports are unique per week, preserve past snapshots and update current status atomically', async () => {
      assert.equal(project.missing_report, true);
      await request(`/projects/${project.id}`, { method: 'PATCH', as: member, body: { progress: 25 } });
      assert.equal((await request(`/projects/${project.id}`, { as: member })).body.missing_report, true);
      const payload = { week_start: calendar().weekStart, completed: '完成首页', next_plan: '联调', stage: '测试中', progress: 65, due_date: '2026-09-28', links: [{ label: '演示', url: 'https://example.com' }] };
      assert.equal((await request(`/projects/${project.id}/reports`, { method: 'PUT', as: other, body: payload })).status, 403);
      assert.equal((await request(`/projects/${project.id}/reports`, { method: 'PUT', as: member, body: { ...payload, week_start: '2020-01-01' } })).status, 409);
      const saved = await request(`/projects/${project.id}/reports`, { method: 'PUT', as: member, body: payload });
      assert.equal(saved.status, 200); assert.equal(saved.body.missing_report, false); assert.equal(saved.body.progress, 65);
      const week = new Date(calendar().weekStart + 'T00:00:00Z'); week.setUTCDate(week.getUTCDate() - 7);
      app.db.prepare('INSERT INTO reports(project_id,week_start,completed,next_plan,stage,progress,due_date,links,author_id,created_at,updated_at) SELECT project_id,?,completed,next_plan,stage,progress,due_date,links,author_id,created_at,updated_at FROM reports WHERE project_id=?').run(week.toISOString().slice(0, 10), project.id);
      await request(`/projects/${project.id}/reports`, { method: 'PUT', as: member, body: { ...payload, completed: '修正周报', progress: 75 } });
      const detail = (await request(`/projects/${project.id}`, { as: admin })).body;
      assert.equal(detail.reports.length, 2); assert.equal(detail.reports[0].completed, '修正周报'); assert.equal(detail.reports[1].completed, '完成首页');
      assert.equal((await request(`/projects/${project.id}/reports`, { method: 'PUT', as: member, body: { ...payload, progress: 999 } })).status, 400);
      assert.equal((await request(`/projects/${project.id}`, { as: member })).body.progress, 75);
      assert.equal((await request(`/projects/${project.id}`, { method: 'PATCH', as: member, body: { links: [{ label: 'bad', url: 'javascript:alert(1)' }] } })).status, 400);
    });
    await t.test('ownership is rechecked after a delayed upload, preventing old owners from reclaiming a project', async () => {
      const payload = Buffer.from(JSON.stringify({ name: 'should not apply' }));
      let client, finish;
      const result = new Promise(r => { finish = r; });
      const arrived = new Promise(r => app.server.once('request', r));
      client = http.request(base + `/api/projects/${project.id}`, { method: 'PATCH', headers: {
        Origin: base, Cookie: member.cookie, 'X-CSRF-Token': member.csrf,
        'Content-Type': 'application/json', 'Content-Length': payload.length
      } }, res => { res.resume(); res.on('end', () => finish(res.statusCode)); });
      client.write(payload.subarray(0, 5));
      await arrived;
      assert.equal((await request(`/projects/${project.id}`, { method: 'PATCH', as: admin, body: { owner_id: other.id } })).status, 200);
      client.end(payload.subarray(5));
      assert.equal(await result, 403);
      assert.equal((await request(`/projects/${project.id}`, { as: admin })).body.owner_id, other.id);
      await request(`/projects/${project.id}`, { method: 'PATCH', as: admin, body: { owner_id: member.id } });
    });
    await t.test('concurrent failed logins are counted before asynchronous password hashing', async () => {
      const results = await Promise.all(Array.from({ length: 12 }, () => request('/login', { method: 'POST', body: { username: 'rate-test', password: 'incorrect-password' } })));
      assert.equal(results.filter(r => r.status === 401).length, 8);
      assert.equal(results.filter(r => r.status === 429).length, 4);
      assert.equal((await request('/login', { method: 'POST', body: { username: 'rate-test', password: 'incorrect-password' } })).status, 429);
    });
    await t.test('private GitHub uses owner-scoped encrypted credentials and retains last successful data on failure', async () => {
      assert.equal((await request('/settings/github', { as: member })).status, 403);
      assert.equal((await request('/settings/github', { method: 'PUT', as: member, body: { token: 'bad' } })).status, 403);
      await request('/settings/github', { method: 'PUT', as: admin, body: { token: 'default-secret' } });
      await request('/settings/github', { method: 'PUT', as: admin, body: { token: 'scoped-secret', owner: 'acme' } });
      const settings = (await request('/settings/github', { as: admin })).body;
      assert.ok(settings.configured); assert.deepEqual(settings.scopes, ['', 'acme']); assert.ok(!JSON.stringify(settings).includes('secret'));
      assert.ok(!app.db.prepare("SELECT value FROM settings WHERE key='github_token:acme'").get().value.includes('scoped-secret'));
      await request(`/projects/${project.id}`, { method: 'PATCH', as: member, body: { repo: 'acme/private-app' } });
      await request(`/projects/${project.id}/sync`, { method: 'POST', as: member });
      assert.equal(observedAuthorization, 'Bearer scoped-secret'); assert.ok(observedUrl.startsWith('https://api.github.com/repos/acme/private-app/commits'));
      let detail = (await request(`/projects/${project.id}`, { as: member })).body;
      assert.equal(detail.github.commits[0].message, '完成测试'); assert.equal(detail.github.status, 'ok');
      upstreamStatus = 404; app.db.prepare('UPDATE github_cache SET checked_at=NULL').run();
      detail = (await request(`/projects/${project.id}/sync`, { method: 'POST', as: member })).body;
      assert.equal(detail.github.status, 'error'); assert.equal(detail.github.commits.length, 1); assert.ok(detail.github.synced_at);
      assert.ok(!JSON.stringify(detail).includes('secret')); assert.equal(detail.progress, 75);
    });
    await t.test('account disable/reset revokes sessions and assigned owners cannot be disabled', async () => {
      assert.equal((await request(`/users/${member.id}`, { method: 'PATCH', as: admin, body: { active: false } })).status, 400);
      assert.equal((await request(`/users/${admin.id}`, { method: 'PATCH', as: admin, body: { role: 'member' } })).status, 400);
      await request(`/users/${other.id}`, { method: 'PATCH', as: admin, body: { active: false } });
      assert.equal((await request('/projects', { as: other })).status, 401);
      await request(`/users/${member.id}`, { method: 'PATCH', as: admin, body: { password: 'Changed-pass-123' } });
      assert.equal((await request('/projects', { as: member })).status, 401);
    });
    await t.test('data, accounts and weekly history survive a server restart', async () => {
      await app.close();
      app = await createApp({ dataDir: dir, backgroundSync: false, githubToken: '', fetcher });
      await new Promise(r => app.server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${app.server.address().port}`;
      member = await login('member', 'Changed-pass-123');
      const detail = (await request(`/projects/${project.id}`, { as: member })).body;
      assert.equal(detail.progress, 75); assert.equal(detail.reports.length, 2);
      assert.equal((await request('/settings/github', { as: admin })).body.configured, true);
    });
  } finally { await app.close(); await removeTestDirectory(dir); }
});
