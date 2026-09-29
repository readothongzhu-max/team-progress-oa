import { now } from './core.mjs';

export async function fetchCommits(repo, token, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`https://api.github.com/repos/${repo}/commits?per_page=5`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'team-progress-oa', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(12000)
    });
  } catch { throw new Error('暂时无法连接 GitHub，请稍后重试'); }
  if (response.status === 409) return [];
  if (response.status === 401) throw new Error('GitHub 凭据无效或已过期，请联系管理员');
  if (response.status === 404) throw new Error('仓库不存在，或当前凭据没有该仓库的读取权限');
  if (response.status === 403 || response.status === 429) throw new Error('GitHub 权限不足或请求受限，请稍后重试或检查只读权限');
  if (!response.ok) throw new Error('GitHub 暂时无法提供提交记录，请稍后重试');
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('GitHub 返回的数据格式异常');
  return data.slice(0, 5).map(commit => ({
    sha: String(commit.sha).slice(0, 40),
    message: String(commit.commit?.message || '').split('\n')[0].slice(0, 500),
    author: String(commit.commit?.author?.name || '未知作者').slice(0, 100),
    date: commit.commit?.committer?.date || commit.commit?.author?.date || null,
    url: `https://github.com/${repo}/commit/${encodeURIComponent(commit.sha)}`
  }));
}
export function githubService(store, envToken = '', fetcher = fetch) {
  const { db, seal, unseal } = store;
  const pending = new Map();
  const token = (repo) => {
    const scoped = db.prepare('SELECT value FROM settings WHERE key=?').get(`github_token:${repo.split('/')[0].toLowerCase()}`);
    if (scoped) return unseal(scoped.value);
    if (envToken) return envToken;
    const setting = db.prepare("SELECT value FROM settings WHERE key='github_token'").get();
    return setting ? unseal(setting.value) : '';
  };
  return {
    configured: () => Boolean(envToken || db.prepare("SELECT key FROM settings WHERE key='github_token' OR key LIKE 'github_token:%' LIMIT 1").get()),
    source: () => envToken ? 'environment' : 'settings',
    scopes: () => db.prepare("SELECT key FROM settings WHERE key='github_token' OR key LIKE 'github_token:%' ORDER BY key").all().map(row => row.key === 'github_token' ? '' : row.key.slice(13)),
    saveToken(value, owner = '') {
      const key = owner ? `github_token:${owner}` : 'github_token';
      if (!value) db.prepare('DELETE FROM settings WHERE key=?').run(key);
      else db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, seal(value));
    },
    async sync(project) {
      if (!project.repo) return;
      const inFlight = pending.get(project.id);
      if (inFlight) {
        if (inFlight.repo === project.repo) return inFlight.work;
        await inFlight.work;
        if (pending.get(project.id) === inFlight) pending.delete(project.id);
        const latest = db.prepare('SELECT * FROM projects WHERE id=?').get(project.id);
        if (latest?.repo) return this.sync(latest);
        return;
      }
      const old = db.prepare('SELECT * FROM github_cache WHERE project_id=?').get(project.id);
      if (old?.checked_at && Date.now() - Date.parse(old.checked_at) < 30000) return;
      const work = (async () => {
        try {
          const commits = await fetchCommits(project.repo, token(project.repo), fetcher);
          // A project can be deleted or its repository changed while the request is in flight.
          const current = db.prepare('SELECT repo FROM projects WHERE id=?').get(project.id);
          if (!current || current.repo !== project.repo) return;
          const timestamp = now();
          db.prepare(`INSERT INTO github_cache(project_id,commits,last_commit_at,checked_at,synced_at,status,error)
            VALUES(?,?,?,?,?,'ok',NULL) ON CONFLICT(project_id) DO UPDATE SET commits=excluded.commits,
            last_commit_at=excluded.last_commit_at,checked_at=excluded.checked_at,synced_at=excluded.synced_at,status='ok',error=NULL`)
            .run(project.id, JSON.stringify(commits), commits[0]?.date || null, timestamp, timestamp);
        } catch (error) {
          const current = db.prepare('SELECT repo FROM projects WHERE id=?').get(project.id);
          if (!current || current.repo !== project.repo) return;
          const message = /^(暂时无法|GitHub|仓库不存在)/.test(error.message) ? error.message : 'GitHub 同步失败，请检查凭据配置';
          db.prepare(`INSERT INTO github_cache(project_id,checked_at,status,error) VALUES(?,?,'error',?)
            ON CONFLICT(project_id) DO UPDATE SET checked_at=excluded.checked_at,status='error',error=excluded.error`).run(project.id, now(), message);
        }
      })();
      pending.set(project.id, { repo: project.repo, work });
      try { await work; } finally { if (pending.get(project.id)?.work === work) pending.delete(project.id); }
    }
  };
}
