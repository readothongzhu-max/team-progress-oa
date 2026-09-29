const $ = (selector, parent = document) => parent.querySelector(selector);
const app = $('#app'), modal = $('#modal');
const projectSortKey = 'team-progress-oa.project-sort';
function loadProjectSort() {
  try { return localStorage.getItem(projectSortKey) === 'name' ? 'name' : 'priority'; }
  catch { return 'priority'; }
}
const state = { user: null, csrf: null, projects: [], users: [], view: 'overview', filter: 'all', owner: '', query: '', sort: loadProjectSort(), presenting: false };
const projectNameOrder = new Intl.Collator('zh-CN-u-co-pinyin', { numeric: true, sensitivity: 'base' });
function projectPriority(project) {
  const match = (project.description || '').match(/^[\t ]*(?:优先级|優先級|项目等级|項目等級)[\t ]*[:：][\t ]*([高中低])[\t \r]*$/m);
  return ({ 高: 0, 中: 1, 低: 2 })[match?.[1]] ?? 3;
}
function compareProjects(a, b) {
  const priority = state.sort === 'priority' ? projectPriority(a) - projectPriority(b) : 0;
  return priority || projectNameOrder.compare(a.name, b.name) || a.id - b.id;
}
const stages = ['想法', '开发中', '测试中', '已上线', '暂停', '待确认'];
const stageClass = { 想法: 'idea', 开发中: 'building', 测试中: 'testing', 已上线: 'live', 暂停: 'paused', 待确认: 'paused' };
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H5a2 2 0 0 1-2-2z"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/>',
  github: '<path d="M9 19c-4 1-4-2-6-2m12 5v-3.5a3 3 0 0 0-.8-2.4c2.7-.3 5.5-1.3 5.5-6a4.7 4.7 0 0 0-1.3-3.3 4.3 4.3 0 0 0-.1-3.3s-1-.3-3.4 1.3a11.7 11.7 0 0 0-6.2 0C6.3 3.2 5.3 3.5 5.3 3.5a4.3 4.3 0 0 0-.1 3.3 4.7 4.7 0 0 0-1.3 3.3c0 4.7 2.8 5.7 5.5 6a3 3 0 0 0-.8 2.4V22"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m12 5-7 7 7 7M5 12h15"/>',
  link: '<path d="M15 3h6v6m0-6L11 13M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<path d="m12 3 10 18H2zM12 9v4m0 4h.01"/>',
  edit: '<path d="m15 5 4 4M4 20l4-1L20 7a3 3 0 0 0-4-4L4 15z"/>',
  screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  refresh: '<path d="M20 7a9 9 0 1 0 1 9M20 2v6h-6"/>',
  exit: '<path d="M9 4H4v16h5m6-12 4 4-4 4m-7-4h12"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>'
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.folder}</svg>`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const dateLabel = (value) => value ? value.slice(5).replace('-', '/') : '未设置';
const stamp = (value) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '尚未同步';
const avatar = (name, id = 0) => `<span class="avatar color-${id % 5}">${esc((name || '?').slice(0, 1))}</span>`;
const badge = (stage) => `<span class="badge ${stageClass[stage]}"><span class="stage-dot"></span>${esc(stage)}</span>`;
const canEdit = (p) => state.user?.role === 'admin' || p.owner_id === state.user?.id;
const weekText = () => `${dateLabel(state.weekStart)} — ${dateLabel(state.weekEnd)}`;
const linksHtml = (links = []) => links.map(l => `<a class="result-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${icon('link')}${esc(l.label)}</a>`).join('');
const progressHtml = (p) => p.progress === null ? '<div class="progress-heading"><span>完成度</span><span>未填写</span></div><div class="progress-track unknown" aria-hidden="true"></div>' : `<div class="progress-heading"><span>完成度</span><strong>${p.progress}<small>%</small></strong></div><div class="progress-track ${stageClass[p.stage]}" role="progressbar" aria-label="项目完成度" aria-valuenow="${p.progress}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p.progress}%"></span></div>`;
let toastTimer;
function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.className = `visible${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = '', 3800);
}
async function api(path, options = {}) {
  const headers = { ...options.headers };
  if (options.body !== undefined) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(options.body); }
  if (options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrf || '';
  let response;
  try { response = await fetch(`/api${path}`, { ...options, headers }); }
  catch { throw new Error('连接中断，请检查网络后重试。尚未提交的内容仍保留在表单中。'); }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/login') {
      state.user = null;
      if (!modal.open) renderLogin();
    }
    throw new Error(data.error || '操作未完成，请重试');
  }
  return data;
}
function renderLogin() {
  app.innerHTML = `<div class="login-page"><div class="login-story"><div class="brand"><span class="brand-mark"><i></i><i></i></span><span>同频<span class="brand-en">TEAMSPACE</span></span></div><div class="login-message"><span class="eyebrow">项目 · 进度 · 每周成果</span><h1>每个人的进展，<br>都在同一页。</h1><p>给小团队的一张项目进度表。</p><div class="login-lines"><span></span><span></span><span></span></div></div><span class="login-footer">少一点追问，多一点同步。</span></div><div class="login-panel"><form id="login-form"><span class="eyebrow">团队工作台</span><h2>欢迎回来</h2><p class="muted">登录后，看看项目的新进展。</p><label>账号<input name="username" autocomplete="username" placeholder="输入管理员分配的账号" required maxlength="40" /></label><label>密码<input type="password" name="password" autocomplete="current-password" placeholder="输入密码" required maxlength="128" /></label><div class="form-error" role="alert"></div><button class="button primary login-submit" type="submit">登录工作台${icon('arrow')}</button><p class="login-help">账号由管理员创建。忘记密码时，请联系管理员重置。</p></form></div></div>`;
}
function shell() {
  app.innerHTML = `<div class="workspace${state.presenting ? ' presenting' : ''}"><aside class="sidebar"><a class="brand" href="#overview"><span class="brand-mark"><i></i><i></i></span><span>同频<span class="brand-en">TEAMSPACE</span></span></a><div class="space-label">团队工作空间</div><nav aria-label="主导航"><a href="#overview" data-nav="overview">${icon('grid')}项目总览</a><a href="#mine" data-nav="mine">${icon('folder')}我的项目<span class="nav-count">${state.projects.filter(p => p.owner_id === state.user.id).length}</span></a>${state.user.role === 'admin' ? `<div class="nav-divider"></div><a href="#team" data-nav="team">${icon('users')}团队管理</a><a href="#github" data-nav="github">${icon('github')}GitHub 设置</a>` : ''}</nav><div class="sidebar-bottom"><div class="week-note">${icon('calendar')}<span>本周周期<strong>${weekText()}</strong></span></div><div class="profile">${avatar(state.user.name, state.user.id)}<div><strong>${esc(state.user.name)}</strong><span>${state.user.role === 'admin' ? '管理员' : '团队成员'}</span></div><button class="icon-button" data-action="logout" title="退出登录" aria-label="退出登录">${icon('exit')}</button></div><button class="password-button" data-action="password">${icon('lock')}修改密码</button></div></aside><main id="content" tabindex="-1"></main></div>`;
}
function header(title, subtitle, actions = '') {
  return `<header class="page-heading"><div><div class="breadcrumb">工作空间 <span>/</span> ${esc(title)}</div><h1>${esc(title)}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></header>`;
}
function renderCard(p, index) {
  return `<article class="project-card" style="--order:${index}"><div class="card-top"><span class="project-symbol ${stageClass[p.stage]}">${icon('folder')}</span>${badge(p.stage)}</div><a class="project-title" href="#project/${p.id}">${esc(p.name)}${icon('arrow')}</a><p class="project-desc">${esc(p.description || '还没有填写项目简介')}</p><div class="card-owner">${avatar(p.owner_name, p.owner_id)}<span>${esc(p.owner_name)}</span><span class="due${p.overdue ? ' overdue' : ''}">${icon('calendar')}${p.due_date ? `${dateLabel(p.due_date)} 交付` : '待定交付'}</span></div><div class="card-progress">${progressHtml(p)}</div><div class="card-week"><div class="section-label">本周完成${p.report ? `<span class="updated">${icon('check')}已更新</span>` : ''}</div><p class="week-copy${p.report ? '' : ' placeholder'}">${esc(p.report?.completed || (p.stage === '已上线' ? '项目已上线' : p.stage === '暂停' ? '项目已暂停' : '本周还没有更新，等你记录新进展。'))}</p>${p.report ? `<div class="next-line"><span>下一步</span><p>${esc(p.report.next_plan)}</p></div>` : ''}</div>${p.links.length ? `<div class="card-links">${linksHtml(p.links.slice(0, 2))}${p.links.length > 2 ? `<span class="muted">+${p.links.length - 2}</span>` : ''}</div>` : ''}<div class="card-bottom"><span class="repo-hint" title="${esc(p.repo ? `GitHub ${p.repo}；默认分支最后提交` : '未关联 GitHub')}" >${icon(p.repo ? 'github' : 'folder')}${p.repo ? (p.github?.status === 'error' ? '<span class="warning-text">同步待处理</span>' : p.github?.last_commit_at ? `${stamp(p.github.last_commit_at)}` : '等待同步') : '未关联 GitHub'}</span>${p.overdue ? '<span class="mini-flag danger">已逾期</span>' : p.missing_report ? '<span class="mini-flag">待周更</span>' : '<span class="mini-flag calm">已同步进展</span>'}${canEdit(p) ? `<button class="text-button card-update" data-action="report" data-id="${p.id}">${p.report ? '编辑周报' : '写周报'}${icon('edit')}</button>` : `<a class="text-button" href="#project/${p.id}">查看${icon('arrow')}</a>`}</div></article>`;
}
function renderOverview() {
  const mine = state.view === 'mine';
  const pool = mine ? state.projects.filter(p => p.owner_id === state.user.id) : state.projects;
  const pending = pool.filter(p => p.missing_report).length, overdue = pool.filter(p => p.overdue).length;
  const content = $('#content');
  content.innerHTML = header(mine ? '我的项目' : '项目总览', `本周 <strong>${weekText()}</strong><span class="heading-dot">·</span>${state.today.replaceAll('-', '.')}<span class="heading-dot">·</span>上海时间`, `<button class="button secondary" data-action="present">${icon('screen')}${state.presenting ? '退出汇报' : '汇报模式'}</button><button class="button primary edit-control" data-action="new-project">${icon('plus')}新建项目</button>`) +
    `<section class="stats" aria-label="项目统计"><div class="stat"><span>全部项目</span><div><strong>${pool.length.toString().padStart(2, '0')}</strong><span class="stat-icon blue">${icon('folder')}</span></div></div><div class="stat"><span>正在推进</span><div><strong>${pool.filter(p => ['开发中', '测试中'].includes(p.stage)).length.toString().padStart(2, '0')}</strong><span class="stat-icon purple">${icon('refresh')}</span></div></div><button class="stat clickable${state.filter === 'pending' ? ' selected' : ''}" data-action="filter" data-filter="pending"><span>本周待更新</span><div><strong>${pending.toString().padStart(2, '0')}</strong><span class="stat-icon amber">${icon('clock')}</span></div></button><button class="stat clickable${state.filter === 'overdue' ? ' selected' : ''}" data-action="filter" data-filter="overdue"><span>交付已逾期</span><div><strong>${overdue.toString().padStart(2, '0')}</strong><span class="stat-icon rose">${icon('alert')}</span></div></button></section>
    <section class="projects-section"><div class="project-toolbar"><div class="filter-tabs" aria-label="筛选项目">${[['all', '全部项目'], ['active', '进行中'], ['live', '已上线']].map(([id, label]) => `<button class="filter-tab${state.filter === id ? ' active' : ''}" data-action="filter" data-filter="${id}">${label}</button>`).join('')}${['pending', 'overdue'].includes(state.filter) ? `<button class="filter-tab active" data-action="filter" data-filter="${state.filter}">${state.filter === 'pending' ? '本周待更新' : '交付已逾期'}</button>` : ''}</div><div class="toolbar-controls">${!mine ? `<select id="owner-filter" aria-label="按负责人筛选"><option value="">全部负责人</option>${state.users.map(u => `<option value="${u.id}" ${String(u.id) === state.owner ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}<select id="project-sort" aria-label="项目排序"><option value="priority" ${state.sort === 'priority' ? 'selected' : ''}>按等级：高 → 低</option><option value="name" ${state.sort === 'name' ? 'selected' : ''}>按名称：拼音 / A–Z</option></select><div class="search-field">${icon('search')}<input id="search" aria-label="搜索项目" placeholder="搜索项目" value="${esc(state.query)}" /></div></div></div><div id="project-grid" class="project-grid"></div></section><footer class="page-footer"><span>每一次小进展，都算数。</span><span>周一至周日 · 每周记录一次</span></footer>`;
  renderGrid();
}
function renderGrid() {
  let projects = state.projects.filter(p => (state.view !== 'mine' || p.owner_id === state.user.id) && (!state.owner || state.view === 'mine' || p.owner_id === Number(state.owner)) && `${p.name} ${p.description} ${p.owner_name}`.toLowerCase().includes(state.query.toLowerCase()));
  if (state.filter === 'pending') projects = projects.filter(p => p.missing_report);
  if (state.filter === 'overdue') projects = projects.filter(p => p.overdue);
  if (state.filter === 'active') projects = projects.filter(p => ['开发中', '测试中'].includes(p.stage));
  if (state.filter === 'live') projects = projects.filter(p => p.stage === '已上线');
  projects.sort(compareProjects);
  $('#project-grid').innerHTML = projects.length ? projects.map(renderCard).join('') : `<div class="empty-state"><span class="empty-icon">${icon(state.projects.length ? 'search' : 'folder')}</span><h2>${state.projects.length ? '没有符合条件的项目' : '从第一个项目开始'}</h2><p>${state.projects.length ? '调整筛选条件，看看其他项目的进展。' : '记录负责人、当前阶段和交付日期，让团队一起看到进展。'}</p><button class="button ${state.projects.length ? 'secondary' : 'primary'}" data-action="${state.projects.length ? 'clear-filter' : 'new-project'}">${icon(state.projects.length ? 'refresh' : 'plus')}${state.projects.length ? '清除筛选' : '新建项目'}</button></div>`;
}
async function renderDetail(id) {
  const p = await api(`/projects/${id}`);
  if (location.hash !== `#project/${id}`) return;
  state.detail = p;
  const current = p.reports.find(r => r.week_start === state.weekStart);
  $('#content').innerHTML = `<a class="back-link" href="#overview">${icon('back')}返回项目总览</a>` + header(p.name, esc(p.description || '记录项目每周的进展与成果。'), canEdit(p) ? `<button class="button secondary" data-action="edit-project" data-id="${p.id}">${icon('edit')}编辑项目</button><button class="button primary" data-action="report" data-id="${p.id}">${icon('plus')}${current ? '编辑本周周报' : '写本周周报'}</button>` : '') +
    `<div class="detail-layout"><div class="detail-main"><section class="panel current-report"><div class="panel-heading"><h2>本周进展</h2><span class="muted">${weekText()}</span></div>${current ? `<div class="report-block"><span class="section-label">本周完成</span><p class="prewrap">${esc(current.completed)}</p></div><div class="report-block"><span class="section-label">下周计划</span><p class="prewrap">${esc(current.next_plan)}</p></div>${current.links.length ? `<div class="report-block"><span class="section-label">本周成果</span><div class="result-links">${linksHtml(current.links)}</div></div>` : ''}<div class="report-meta">${avatar(current.author_name, current.author_id)}${esc(current.author_name)} 更新于 ${stamp(current.updated_at)}</div>` : `<div class="inline-empty">${icon('edit')}<h3>本周的进展，等你来记录</h3><p>${canEdit(p) ? '写下已完成的工作和下一步计划。' : `等待 ${esc(p.owner_name)} 更新本周周报。`}</p>${canEdit(p) ? `<button class="button secondary" data-action="report" data-id="${p.id}">写本周周报</button>` : ''}</div>`}</section><section class="panel"><div class="panel-heading"><h2>历史周报</h2><span class="count-label">${p.reports.filter(r => r.week_start !== state.weekStart).length} 份</span></div>${p.reports.filter(r => r.week_start !== state.weekStart).map(r => `<details class="history-item"><summary><span>${r.week_start} 当周</span><span>${badge(r.stage)}<strong>${r.progress}%</strong>${icon('arrow')}</span></summary><div class="history-body"><div class="section-label">本周完成</div><p class="prewrap">${esc(r.completed)}</p><div class="section-label">下周计划</div><p class="prewrap">${esc(r.next_plan)}</p><div class="result-links">${linksHtml(r.links)}</div><div class="muted">当时预计交付：${esc(r.due_date || '未设置')} · ${esc(r.author_name)} · ${stamp(r.updated_at)}</div></div></details>`).join('') || '<p class="panel-empty">还没有历史周报。每周的记录都会保存在这里。</p>'}</section></div><aside class="detail-aside"><section class="panel"><div class="panel-heading"><h2>项目概况</h2>${badge(p.stage)}</div><div class="detail-progress">${progressHtml(p)}</div><dl class="project-facts"><div><dt>负责人</dt><dd>${avatar(p.owner_name, p.owner_id)}${esc(p.owner_name)}</dd></div><div><dt>预计交付</dt><dd class="${p.overdue ? 'overdue' : ''}">${esc(p.due_date || '未设置')}${p.overdue ? ' · 已逾期' : ''}</dd></div><div><dt>最近更新</dt><dd>${stamp(p.updated_at)}</dd></div></dl>${p.links.length ? `<div class="aside-links"><span class="section-label">成果与演示</span>${linksHtml(p.links)}</div>` : ''}</section><section class="panel github-panel"><div class="panel-heading"><h2>${icon('github')}开发动态</h2>${p.repo ? `<button class="icon-button" data-action="sync" data-id="${p.id}" aria-label="刷新 GitHub" title="刷新 GitHub">${icon('refresh')}</button>` : ''}</div>${p.repo ? `<a class="repo-link" href="https://github.com/${esc(p.repo)}" target="_blank" rel="noopener noreferrer">${esc(p.repo)}${icon('link')}</a><p class="small muted">默认分支最近 5 次提交 · 每 15 分钟同步</p>${p.github?.error ? `<div class="notice warning">${icon('alert')}<span>${esc(p.github.error)}${p.github.synced_at ? '<br>以下保留上次成功同步的数据。' : ''}</span></div>` : ''}<div class="commits">${p.github?.commits?.map(c => `<a class="commit" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer"><span class="commit-dot"></span><strong>${esc(c.message)}</strong><span>${esc(c.author)} · ${stamp(c.date)} <code>${esc(c.sha.slice(0, 7))}</code></span></a>`).join('') || `<p class="panel-empty">${p.github?.status === 'ok' ? '仓库还没有提交记录。' : '尚未获取提交记录，可点击刷新。'}</p>`}</div><div class="sync-note">上次成功同步：${stamp(p.github?.synced_at)}</div>` : '<div class="local-note">尚未关联 GitHub 仓库。<br>进度和周报由负责人手动更新。</div>'}</section>${state.user.role === 'admin' ? `<button class="delete-project" data-action="delete-project" data-id="${p.id}">删除这个项目</button>` : ''}</aside></div>`;
}
function renderTeam() {
  $('#content').innerHTML = header('团队管理', '分配账号，让每个人维护自己负责的项目。', `<button class="button primary" data-action="new-user">${icon('plus')}添加成员</button>`) + `<section class="panel team-panel"><div class="panel-heading"><h2>团队成员 <span class="count-label">${state.users.filter(u => u.active).length} 人</span></h2><span class="muted">管理员可以维护所有项目</span></div><div class="table-wrap"><table><thead><tr><th>成员</th><th>角色</th><th>负责项目</th><th>状态</th><th><span class="sr-only">操作</span></th></tr></thead><tbody>${state.users.map(u => `<tr><td><div class="member-cell">${avatar(u.name, u.id)}<div><strong>${esc(u.name)}</strong><span>${esc(u.username)}</span></div></div></td><td>${u.role === 'admin' ? '<span class="role-label">管理员</span>' : '成员'}</td><td>${state.projects.filter(p => p.owner_id === u.id).length} 个</td><td><span class="${u.active ? 'active-label' : 'muted'}">${u.active ? '使用中' : '已停用'}</span></td><td><button class="button secondary small-button" data-action="edit-user" data-id="${u.id}">管理</button></td></tr>`).join('')}</tbody></table></div></section>`;
}
async function renderGithub() {
  const settings = await api('/settings/github');
  if (state.view !== 'github') return;
  $('#content').innerHTML = header('GitHub 设置', '将代码的最近动态，放到项目进展旁边。') + `<div class="settings-layout"><section class="panel"><div class="panel-heading"><h2>${icon('github')}只读访问凭据</h2><span class="badge ${settings.configured ? 'live' : 'paused'}">${settings.configured ? '已配置' : '未配置'}</span></div><p class="settings-description">公开仓库可以直接同步。私有仓库需要配置有读取权限的 GitHub Token。</p><div class="notice">${icon('lock')}<span>凭据仅在服务器加密保存，保存后不会回显。</span></div>${settings.scopes.length ? `<div class="credential-list">${settings.scopes.map(owner => `<div><span>${esc(owner || '默认凭据')}</span><button class="text-button danger-text" type="button" data-action="clear-token" data-owner="${esc(owner)}">移除</button></div>`).join('')}</div>` : ''}${settings.source === 'environment' ? '<p class="muted small">服务器已配置默认凭据；仍可为指定账号或组织添加凭据。</p>' : ''}<form id="github-form"><label>适用的 GitHub 账号或组织<span class="field-hint">填写仓库地址中的 owner；留空则作为默认凭据</span><input name="owner" maxlength="39" placeholder="例如 my-team" /></label><label>GitHub Token<input name="token" type="password" autocomplete="new-password" placeholder="输入只读 Token" maxlength="500" required /></label><div class="form-error" role="alert"></div><button class="button primary" type="submit">保存凭据</button></form></section><section class="panel settings-help"><h2>如何连接项目</h2><ol><li>在 GitHub 创建 Fine-grained personal access token，选择允许读取的仓库。</li><li>将仓库权限中的 <strong>Contents</strong> 设为 <strong>Read-only</strong>。</li><li>在左侧保存凭据，再打开项目，填写 GitHub 仓库地址。</li></ol><p>不同个人或组织名下的私有仓库，可以分别保存凭据。组织要求审批时，需要获批后才能读取私有仓库。</p><p>系统只读取默认分支的最近提交。代码提交不会自动改变项目进度或生成周报。</p><a class="result-link" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">前往 GitHub 创建凭据${icon('link')}</a></section></div>`;
}
async function renderRoute() {
  if (!state.user) return renderLogin();
  const route = location.hash.slice(1) || 'overview';
  state.view = route.startsWith('project/') ? 'detail' : ['overview', 'mine', 'team', 'github'].includes(route) ? route : 'overview';
  if (['team', 'github'].includes(state.view) && state.user.role !== 'admin') { location.hash = '#overview'; return; }
  if (!$('#content')) shell();
  document.querySelectorAll('[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav === state.view));
  document.title = `${({ overview: '项目总览', mine: '我的项目', team: '团队管理', github: 'GitHub 设置', detail: '项目详情' })[state.view]} · 同频`;
  try {
    if (state.view === 'detail') { $('#content').innerHTML = '<div class="boot">正在加载项目…</div>'; await renderDetail(route.split('/')[1]); }
    else if (state.view === 'team') renderTeam();
    else if (state.view === 'github') await renderGithub();
    else renderOverview();
  } catch (error) { $('#content').innerHTML = `<div class="empty-state"><h2>暂时无法打开</h2><p>${esc(error.message)}</p><a class="button secondary" href="#overview">返回总览</a></div>`; }
}
async function reload() {
  const [projects, users, session] = await Promise.all([api('/projects'), api('/users'), api('/session')]);
  state.projects = projects; state.users = users; Object.assign(state, session);
}
const formValue = (form, name) => form.elements[name]?.value || '';
function stageFields(p = {}, required = false) {
  return `<div class="form-row"><label>项目阶段<select name="stage" aria-label="项目阶段">${stages.map(s => `<option ${p.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label>完成度（%）<input type="number" name="progress" min="0" max="100" step="1" ${required ? 'required' : ''} placeholder="未填写" value="${p.progress === null ? '' : p.progress || 0}" /></label></div><label>预计交付日期<input type="date" name="due_date" value="${esc(p.due_date || '')}" /></label>`;
}
function linkFields(links = []) {
  return `<label>成果或演示链接<span class="field-hint">每行一个网址，可写成「名称 | 网址」，最多 8 个</span><textarea name="links" rows="2" placeholder="在线演示 | https://example.com">${esc(links.map(l => `${l.label} | ${l.url}`).join('\n'))}</textarea></label>`;
}
function parseLinks(form) {
  return formValue(form, 'links').split('\n').map(s => s.trim()).filter(Boolean).map(s => { const at = s.indexOf('|'); return at < 0 ? { label: '查看成果', url: s } : { label: s.slice(0, at).trim(), url: s.slice(at + 1).trim() }; });
}
function openModal(title, description, body, kind, id = '') {
  modal.innerHTML = `<form id="dialog-form" data-kind="${kind}" data-id="${id}"><div class="dialog-heading"><div><h2 id="dialog-title">${title}</h2><p>${description}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><div class="dialog-body">${body}<div class="form-error" role="alert"></div></div><div class="dialog-footer"><button class="button secondary" type="button" data-action="close-modal">取消</button><button class="button primary" type="submit">${kind === 'report' ? '保存本周周报' : '保存'}</button></div></form>`;
  modal.dataset.dirty = ''; modal.showModal();
}
function projectForm(p) {
  openModal(p ? '编辑项目' : '新建项目', '先记录当前状态，之后每周更新一次。', `<label>项目名称<input name="name" value="${esc(p?.name || '')}" placeholder="例如：客户管理工具" required maxlength="80" /></label><label>项目简介<textarea name="description" rows="2" maxlength="1000" placeholder="这个项目要解决什么问题？">${esc(p?.description || '')}</textarea></label>${state.user.role === 'admin' ? `<label>负责人<select name="owner_id" aria-label="负责人">${state.users.filter(u => u.active).map(u => `<option value="${u.id}" ${u.id === (p?.owner_id || state.user.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>` : ''}${stageFields(p)}<label>GitHub 仓库<span class="field-hint">本地项目留空即可</span><input name="repo" value="${esc(p?.repo || '')}" placeholder="owner/repo 或 https://github.com/owner/repo" maxlength="250" /></label>${linkFields(p?.links)}`, 'project', p?.id || '');
}
function reportForm(p) {
  const r = p.report;
  openModal('更新本周进展', `${esc(p.name)} · ${weekText()}`, `<div class="form-row single"><label>本周完成<textarea name="completed" rows="4" required maxlength="6000" placeholder="这周交付了什么？有什么可演示的成果？">${esc(r?.completed || '')}</textarea></label><label>下周计划<textarea name="next_plan" rows="3" required maxlength="6000" placeholder="下一步准备完成什么？">${esc(r?.next_plan || '')}</textarea></label></div>${stageFields(p, true)}${linkFields(p.links)}<div class="form-note">保存后同时更新项目状态。本周可继续修改，往周记录会保留。</div>`, 'report', p.id);
}
function userForm(u) {
  openModal(u ? '管理成员' : '添加成员', u ? `账号：${esc(u.username)}` : '创建完成后，把账号和密码交给对应成员。', `<label>姓名<input name="name" value="${esc(u?.name || '')}" required maxlength="40" /></label>${!u ? '<label>登录账号<input name="username" required minlength="2" maxlength="40" pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{1,39}" autocomplete="off" placeholder="字母、数字、点、横线或下划线" /></label>' : ''}<label>${u ? '重置密码（不修改请留空）' : '初始密码'}<input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="128" ${u ? '' : 'required'} placeholder="至少 10 个字符" /></label><label>角色<select name="role" aria-label="角色" ${u?.id === state.user.id ? 'disabled' : ''}><option value="member" ${u?.role !== 'admin' ? 'selected' : ''}>成员 · 编辑自己负责的项目</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>管理员 · 编辑全部项目</option></select></label>${u && u.id !== state.user.id ? `<label>账号状态<select name="active" aria-label="账号状态"><option value="true" ${u.active ? 'selected' : ''}>使用中</option><option value="false" ${!u.active ? 'selected' : ''}>已停用</option></select></label><div class="form-note">停用前需要先转交该成员负责的项目。重置密码后，该成员需要重新登录。</div>` : ''}`, 'user', u?.id || '');
}
function closeModal() { if (modal.dataset.dirty && !confirm('还有未保存的内容，确定关闭吗？')) return; modal.close(); }
modal.addEventListener('cancel', e => { e.preventDefault(); closeModal(); });
modal.addEventListener('input', () => modal.dataset.dirty = 'yes');
document.addEventListener('input', e => { if (e.target.id === 'search') { state.query = e.target.value; renderGrid(); } });
document.addEventListener('change', e => {
  if (e.target.id === 'owner-filter') { state.owner = e.target.value; renderGrid(); }
  if (e.target.id === 'project-sort' && ['priority', 'name'].includes(e.target.value)) {
    state.sort = e.target.value;
    try { localStorage.setItem(projectSortKey, state.sort); } catch { /* Sorting still works when browser storage is unavailable. */ }
    renderGrid();
  }
});
window.addEventListener('hashchange', () => { state.filter = 'all'; state.query = ''; state.owner = ''; void renderRoute(); });

document.addEventListener('click', async e => {
  const button = e.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action, id = Number(button.dataset.id);
  const p = state.projects.find(p => p.id === id);
  try {
    if (action === 'new-project') projectForm();
    if (action === 'edit-project') projectForm(p);
    if (action === 'report') reportForm(p);
    if (action === 'close-modal') closeModal();
    if (action === 'new-user') userForm();
    if (action === 'edit-user') userForm(state.users.find(u => u.id === id));
    if (action === 'password') openModal('修改密码', '设置一个只有你知道的新密码。', '<label>当前密码<input type="password" name="old_password" autocomplete="current-password" required /></label><label>新密码<input type="password" name="password" autocomplete="new-password" minlength="10" maxlength="128" required placeholder="至少 10 个字符" /></label><label>再次输入新密码<input type="password" name="confirm_password" autocomplete="new-password" minlength="10" maxlength="128" required /></label>', 'password');
    if (action === 'logout') { await api('/logout', { method: 'POST' }); state.user = null; state.csrf = null; renderLogin(); }
    if (action === 'present') { state.presenting = !state.presenting; $('.workspace').classList.toggle('presenting', state.presenting); renderOverview(); }
    if (action === 'filter') { state.filter = state.filter === button.dataset.filter && ['pending', 'overdue'].includes(state.filter) ? 'all' : button.dataset.filter; renderOverview(); }
    if (action === 'clear-filter') { state.filter = 'all'; state.owner = ''; state.query = ''; renderOverview(); }
    if (action === 'sync') {
      button.disabled = true; button.classList.add('spinning');
      const updated = await api(`/projects/${id}/sync`, { method: 'POST' });
      await reload(); await renderDetail(id); toast(updated.github?.error || '开发动态已刷新', Boolean(updated.github?.error));
    }
    if (action === 'delete-project' && confirm(`确定删除「${p.name}」及其全部历史周报吗？此操作无法撤销。`)) {
      await api(`/projects/${id}`, { method: 'DELETE' }); await reload(); location.hash = '#overview'; toast('项目已删除');
    }
    if (action === 'clear-token' && confirm('移除后，使用该凭据的私有仓库可能无法继续同步。确定移除吗？')) { await api('/settings/github', { method: 'PUT', body: { token: '', owner: button.dataset.owner || '' } }); await renderGithub(); toast('凭据已移除'); }
  } catch (error) { toast(error.message, true); }
  finally { if (button.isConnected) { button.disabled = false; button.classList.remove('spinning'); } }
});
document.addEventListener('submit', async e => {
  e.preventDefault(); const form = e.target, submit = $('[type="submit"]', form), errorEl = $('.form-error', form);
  if (errorEl) errorEl.textContent = '';
  if (submit.disabled) return;
  submit.disabled = true; const previousText = submit.innerHTML; submit.textContent = '正在保存…';
  try {
    if (form.id === 'login-form') {
      Object.assign(state, await api('/login', { method: 'POST', body: { username: formValue(form, 'username'), password: formValue(form, 'password') } }));
      await reload(); shell(); await renderRoute(); return;
    }
    if (form.id === 'github-form') {
      const token = formValue(form, 'token').trim(); if (!token) throw new Error('请输入要保存的只读 Token');
      await api('/settings/github', { method: 'PUT', body: { token, owner: formValue(form, 'owner').trim() } }); await renderGithub(); toast('凭据已保存，可到项目详情刷新动态'); return;
    }
    const kind = form.dataset.kind, id = form.dataset.id;
    if (kind === 'password') {
      if (formValue(form, 'password') !== formValue(form, 'confirm_password')) throw new Error('两次输入的新密码不一致');
      await api('/password', { method: 'PUT', body: { old_password: formValue(form, 'old_password'), password: formValue(form, 'password') } });
    }
    if (kind === 'project') {
      const payload = { name: formValue(form, 'name'), description: formValue(form, 'description'), stage: formValue(form, 'stage'), progress: formValue(form, 'progress') === '' ? null : Number(formValue(form, 'progress')), due_date: formValue(form, 'due_date'), repo: formValue(form, 'repo'), links: parseLinks(form) };
      if (state.user.role === 'admin') payload.owner_id = Number(formValue(form, 'owner_id'));
      await api(id ? `/projects/${id}` : '/projects', { method: id ? 'PATCH' : 'POST', body: payload });
    }
    if (kind === 'report') await api(`/projects/${id}/reports`, { method: 'PUT', body: { week_start: state.weekStart, completed: formValue(form, 'completed'), next_plan: formValue(form, 'next_plan'), stage: formValue(form, 'stage'), progress: formValue(form, 'progress') === '' ? null : Number(formValue(form, 'progress')), due_date: formValue(form, 'due_date'), links: parseLinks(form) } });
    if (kind === 'user') {
      const payload = { name: formValue(form, 'name'), role: formValue(form, 'role') || 'admin' };
      if (formValue(form, 'password')) payload.password = formValue(form, 'password');
      if (id && form.elements.active) payload.active = formValue(form, 'active') === 'true';
      if (!id) payload.username = formValue(form, 'username');
      await api(id ? `/users/${id}` : '/users', { method: id ? 'PATCH' : 'POST', body: payload });
    }
    modal.dataset.dirty = ''; modal.close(); await reload(); shell(); await renderRoute(); toast(kind === 'report' ? '本周进展已保存，团队现在可以看到了' : '已保存');
  } catch (error) { if (errorEl) errorEl.textContent = error.message; else toast(error.message, true); }
  finally { if (submit.isConnected) { submit.disabled = false; submit.innerHTML = previousText; } }
});
async function init() {
  try { Object.assign(state, await api('/session')); if (state.user) { await reload(); shell(); } await renderRoute(); }
  catch (error) { app.innerHTML = `<div class="empty-state"><h1>暂时无法连接工作台</h1><p>${esc(error.message)}</p><button class="button primary" id="retry">重新连接</button></div>`; $('#retry').onclick = init; }
}
void init();
// Keep a long-open dashboard current, without overwriting an open form.
setInterval(async () => {
  if (!state.user || modal.open || document.hidden || document.activeElement?.matches('input,textarea,select') || !['overview', 'mine'].includes(state.view)) return;
  try { await reload(); renderOverview(); } catch { /* Keep the last visible data; explicit actions surface connection errors. */ }
}, 60000);

// Optional browser-native tool: read the same authenticated project list as the UI.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'list_team_projects', title: '查看团队项目进度',
      description: '读取当前登录团队的项目、负责人、进度和本周周报，不修改数据。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('无需提供参数');
        const projects = await api('/projects');
        return projects.map(p => ({ id: p.id, name: p.name, owner: p.owner_name, stage: p.stage, progress: p.progress, dueDate: p.due_date, overdue: p.overdue, needsWeeklyReport: p.missing_report, completed: p.report?.completed || '', next: p.report?.next_plan || '' }));
      }
    }, { signal: lifecycle.signal })).catch(() => {});
  } catch { /* Unsupported browser versions use the normal UI. */ }
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
