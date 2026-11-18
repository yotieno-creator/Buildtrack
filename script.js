'use strict';

const STORAGE_KEY = 'buildtrack_data_v1';
const CURRENCIES = ['KES', 'USD', 'EUR', 'GBP', 'UGX', 'TZS'];
const STATUSES = ['Planned', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
const TASK_STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Completed'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

const EXPENSE_CATEGORIES = [
  'Construction materials', 'Labour', 'Equipment hire', 'Transportation',
  'Permits', 'Professional services', 'Utilities', 'Miscellaneous'
];

const MATERIAL_CATEGORIES = [
  'Aggregates', 'Cement', 'Masonry', 'Steel', 'Timber',
  'Roofing', 'Finishes', 'Plumbing', 'Electrical', 'Other'
];

const $ = id => document.getElementById(id);

let data = loadData();
let activeChartInstances = {};
let currentModal = { type: null, id: null };
let toastTimer;

function emptyData() {
  return {
    projects: [],
    tasks: [],
    expenses: [],
    materials: [],
    reports: [],
    activity: []
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();

    const parsed = JSON.parse(raw);
    const result = emptyData();

    for (const key of Object.keys(result)) {
      result[key] = Array.isArray(parsed[key]) ? parsed[key] : [];
    }

    return result;
  } catch (error) {
    return emptyData();
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    showToast('Could not save data. Browser storage may be full or disabled.', true);
    return false;
  }
}

function uid(prefix = 'rec') {
  return prefix + '_' + Date.now().toString(36) + '_' +
    Math.random().toString(36).slice(2, 9);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[ch]);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value, currency = 'KES') {
  try {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2
    }).format(num(value));
  } catch {
    return currency + ' ' +
      num(value).toLocaleString('en-KE', { maximumFractionDigits: 2 });
  }
}

function fmtDate(value) {
  if (!value) return '—';

  const d = new Date(value + 'T00:00:00');

  return Number.isNaN(d.getTime())
    ? esc(value)
    : d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
}

function todayISO() {
  const d = new Date();

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  if (!a || !b) return 0;

  return Math.ceil(
    (new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) /
    86400000
  );
}

function project(id) {
  return data.projects.find(p => p.id === id);
}

function projectName(id) {
  return project(id)?.name || 'Unknown project';
}

function projectTasks(id) {
  return data.tasks.filter(t => t.projectId === id);
}

function projectExpenses(id) {
  return data.expenses.filter(e => e.projectId === id);
}

function projectMaterials(id) {
  return data.materials.filter(m => m.projectId === id);
}

// Weighted project progress.
// Formula: sum(completion × weight) / sum(weights).
// A project with no tasks has 0% progress.
function taskProgress(tasks) {
  const active = tasks || [];

  if (!active.length) return 0;

  const totalWeight = active.reduce(
    (sum, task) => sum + Math.max(0, num(task.weight) || 1),
    0
  );

  if (totalWeight <= 0) return 0;

  const weightedTotal = active.reduce((sum, task) => {
    const completion = Math.max(
      0,
      Math.min(100, num(task.completion))
    );

    const weight = Math.max(0, num(task.weight) || 1);

    return sum + completion * weight;
  }, 0);

  return Math.round(weightedTotal / totalWeight);
}

function projectProgress(p) {
  return taskProgress(projectTasks(p.id));
}

function spent(id) {
  return projectExpenses(id).reduce(
    (sum, expense) => sum + num(expense.amount),
    0
  );
}

// Remaining budget and budget variance.
function budgetRemaining(p) {
  return num(p.budget) - spent(p.id);
}

function projectDuration(p) {
  return p.startDate && p.endDate
    ? Math.max(0, daysBetween(p.startDate, p.endDate))
    : 0;
}

function daysRemaining(p) {
  return p.endDate ? daysBetween(todayISO(), p.endDate) : 0;
}

function overdueTasks() {
  return data.tasks.filter(task =>
    task.status !== 'Completed' &&
    task.dueDate &&
    task.dueDate < todayISO()
  );
}

function addActivity(message) {
  data.activity.unshift({
    id: uid('act'),
    message,
    date: new Date().toISOString()
  });

  data.activity = data.activity.slice(0, 20);
}

function showToast(message, error = false) {
  const el = $('toast');

  el.textContent = message;
  el.className = 'toast show' + (error ? ' error' : '');

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    el.className = 'toast';
  }, 4500);
}

function emptyState(title, description) {
  return `<div class="empty-state">
    <strong>${esc(title)}</strong>${esc(description)}
  </div>`;
}

function badge(status) {
  const cls = String(status || '')
    .toLowerCase()
    .replace(/\s+/g, '-');

  return `<span class="badge ${esc(cls)}">${esc(status || '—')}</span>`;
}

function progressHTML(value) {
  const v = Math.max(0, Math.min(100, num(value)));

  return `<div class="progress-cell">
    <div class="progress-line"><span style="width:${v}%"></span></div>
    <small>${v}%</small>
  </div>`;
}

function selectOptions(values, selected = '') {
  return values.map(value => `
    <option value="${esc(value)}"
      ${String(value) === String(selected) ? 'selected' : ''}>
      ${esc(value)}
    </option>
  `).join('');
}

function projectOptions(selected = '', includeEmpty = true) {
  return (includeEmpty ? '<option value="">Select project</option>' : '') +
    data.projects.map(p => `
      <option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>
        ${esc(p.name)}
      </option>
    `).join('');
}

function statCard(label, value, icon, foot = '') {
  return `<article class="stat-card">
    <div class="stat-top">
      <span class="stat-label">${esc(label)}</span>
      <span class="stat-icon">${icon}</span>
    </div>
    <div class="stat-value">${esc(value)}</div>
    <div class="stat-foot">${esc(foot)}</div>
  </article>`;
}

function renderAll() {
  renderDashboard();
  renderProjects();
  renderTasks();
  renderExpenses();
  renderMaterials();
  renderReports();
  renderFinanceSummary();
  refreshProjectSelects();
  renderComparisonSelects();
}

// DASHBOARD

function renderDashboard() {
  const active = data.projects.filter(p => p.status === 'In Progress').length;
  const done = data.projects.filter(p => p.status === 'Completed').length;
  const hold = data.projects.filter(p => p.status === 'On Hold').length;
  const overdue = overdueTasks().length;

  const budget = data.projects.reduce(
    (sum, p) => sum + num(p.budget), 0
  );

  const actual = data.expenses.reduce(
    (sum, e) => sum + num(e.amount), 0
  );

  const progress = data.projects.length
    ? Math.round(
        data.projects.reduce((sum, p) => sum + projectProgress(p), 0) /
        data.projects.length
      )
    : 0;

  $('dashboardStats').innerHTML = [
    statCard('Total projects', data.projects.length, '▤', 'All registered projects'),
    statCard('Ongoing projects', active, '↗', 'Currently in progress'),
    statCard('Completed projects', done, '✓', 'Marked completed'),
    statCard('Projects on hold', hold, 'Ⅱ', 'Awaiting restart'),
    statCard('Overdue tasks', overdue, '!', 'Past due and not completed'),
    statCard('Estimated budgets', money(budget), '◈', 'Across all projects'),
    statCard('Actual expenditure', money(actual), '◉', 'Recorded expenses'),
    statCard('Overall progress', progress + '%', '▥', 'Average weighted project progress')
  ].join('');

  const list = [...data.projects]
    .sort((a, b) =>
      (b.updatedAt || b.createdAt || '')
        .localeCompare(a.updatedAt || a.createdAt || '')
    )
    .slice(0, 6);

  $('dashboardProjects').innerHTML = list.length
    ? list.map(p => `
      <tr>
        <td>
          <div class="project-name">${esc(p.name)}</div>
          <div class="subline">
            ${esc(p.client || 'Client not specified')} ·
            ${esc(p.location || 'Location not specified')}
          </div>
        </td>
        <td>${badge(p.status)}</td>
        <td>${progressHTML(projectProgress(p))}</td>
        <td>${money(p.budget, p.currency)}</td>
        <td>${fmtDate(p.endDate)}</td>
        <td>
          <div class="action-group">
            <button class="small-btn" data-action="view-project" data-id="${esc(p.id)}">View</button>
            <button class="small-btn" data-action="edit-project" data-id="${esc(p.id)}">Edit</button>
          </div>
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="6">No projects yet. Add a project to start tracking.</td></tr>';

  const alerts = [];

  for (const t of overdueTasks().slice(0, 4)) {
    alerts.push({
      danger: true,
      text: `Overdue task: ${t.name}`,
      sub: `${projectName(t.projectId)} · due ${fmtDate(t.dueDate)}`
    });
  }

  for (const p of data.projects) {
    if (
      p.status !== 'Completed' &&
      p.status !== 'Cancelled' &&
      budgetRemaining(p) < 0
    ) {
      alerts.push({
        danger: true,
        text: `Budget exceeded: ${p.name}`,
        sub: `Over by ${money(Math.abs(budgetRemaining(p)), p.currency)}`
      });
    }

    if (
      p.status !== 'Completed' &&
      p.status !== 'Cancelled' &&
      daysRemaining(p) >= 0 &&
      daysRemaining(p) <= 7
    ) {
      alerts.push({
        danger: false,
        text: `Deadline approaching: ${p.name}`,
        sub: `Expected ${fmtDate(p.endDate)}`
      });
    }
  }

  for (const m of data.materials) {
    const stock = num(m.purchased) - num(m.used);
    const shortage = Math.max(0, num(m.required) - stock);

    if (shortage > 0) {
      alerts.push({
        danger: false,
        text: `Material shortage: ${m.name}`,
        sub: `${projectName(m.projectId)} · shortage ${shortage} ${m.unit || ''}`
      });
    }
  }

  $('dashboardAlerts').innerHTML = alerts.length
    ? alerts.slice(0, 8).map(a => `
      <div class="alert-row ${a.danger ? 'danger' : ''}">
        <strong>${esc(a.text)}</strong><br>${esc(a.sub)}
      </div>
    `).join('')
    : '<p class="no-alerts">No active alerts. Add projects, tasks, expenses and materials to monitor risks.</p>';

  renderCharts();
}

// CHARTS

function renderCharts() {
  const expenseTotal = data.expenses.reduce(
    (sum, e) => sum + num(e.amount), 0
  );

  const budgetData = data.projects.map(p => ({
    label: p.name,
    budget: num(p.budget),
    actual: spent(p.id)
  }));

  const catMap = {};

  data.expenses.forEach(e => {
    catMap[e.category] = (catMap[e.category] || 0) + num(e.amount);
  });

  const progressData = data.projects
    .filter(p => projectTasks(p.id).length)
    .map(p => ({
      label: p.name,
      progress: projectProgress(p)
    }));

  const taskCounts = TASK_STATUSES.map(
    status => data.tasks.filter(t => t.status === status).length
  );

  makeChart('budgetChart', 'bar', {
    labels: budgetData.map(x => x.label),
    datasets: [
      {
        label: 'Estimated budget',
        data: budgetData.map(x => x.budget),
        backgroundColor: '#8ebaa4'
      },
      {
        label: 'Actual expenditure',
        data: budgetData.map(x => x.actual),
        backgroundColor: '#245647'
      }
    ]
  }, budgetData.length > 0);

  makeChart('categoryChart', 'doughnut', {
    labels: Object.keys(catMap),
    datasets: [{
      data: Object.values(catMap),
      backgroundColor: [
        '#245647', '#7da98f', '#e0b36b', '#6b91b4',
        '#b7a3d1', '#d77e68', '#8b9d95', '#d0d9d3'
      ]
    }]
  }, expenseTotal > 0);

  makeChart('progressChart', 'bar', {
    labels: progressData.map(x => x.label),
    datasets: [{
      label: 'Progress %',
      data: progressData.map(x => x.progress),
      backgroundColor: '#43856b'
    }]
  }, progressData.length > 0, {
    indexAxis: 'y',
    scales: {
      x: {
        beginAtZero: true,
        max: 100,
        ticks: { callback: value => value + '%' }
      }
    }
  });

  makeChart('taskChart', 'doughnut', {
    labels: TASK_STATUSES,
    datasets: [{
      data: taskCounts,
      backgroundColor: ['#9aa9a1', '#4e9a75', '#e0b36b', '#245647']
    }]
  }, data.tasks.length > 0);
}

function makeChart(id, type, chartData, hasData, extra = {}) {
  const canvas = $(id);
  const empty = $(id + 'Empty');

  if (!canvas) return;

  if (activeChartInstances[id]) {
    activeChartInstances[id].destroy();
    delete activeChartInstances[id];
  }

  canvas.style.display = hasData ? 'block' : 'none';

  if (empty) {
    empty.style.display = hasData ? 'none' : 'block';
  }

  if (!hasData || typeof Chart === 'undefined') return;

  activeChartInstances[id] = new Chart(canvas, {
    type,
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: type === 'doughnut',
          position: 'bottom',
          labels: { boxWidth: 10, font: { size: 10 } }
        }
      },
      scales: type === 'bar' ? {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: '#edf1ee' } }
      } : undefined,
      ...extra
    }
  });
}

// PROJECT LIST

function renderProjects() {
  const q = ($('projectSearch')?.value || '').toLowerCase();
  const status = $('projectStatusFilter')?.value || '';
  const sort = $('projectSort')?.value || 'name';

  let list = data.projects.filter(p =>
    (`${p.name} ${p.client} ${p.location} ${p.id}`)
      .toLowerCase()
      .includes(q) &&
    (!status || p.status === status)
  );

  list.sort((a, b) => {
    if (sort === 'budget') return num(b.budget) - num(a.budget);
    if (sort === 'progress') return projectProgress(b) - projectProgress(a);
    if (sort === 'startDate') return (a.startDate || '').localeCompare(b.startDate || '');
    if (sort === 'endDate') return (a.endDate || '').localeCompare(b.endDate || '');
    return a.name.localeCompare(b.name);
  });

  $('projectsList').innerHTML = list.length
    ? list.map(p => {
      const expenses = spent(p.id);
      const remaining = budgetRemaining(p);
      const days = daysRemaining(p);

      return `
        <article class="project-card">
          <div class="project-card-head">
            <div>
              <h3>${esc(p.name)}</h3>
              <div class="subline">${esc(p.id)} · ${esc(p.buildingType || 'Building project')}</div>
            </div>
            ${badge(p.status)}
          </div>

          <div class="project-meta">
            <span>♙ ${esc(p.client || 'No client')}</span>
            <span>⌖ ${esc(p.location || 'No location')}</span>
            <span>▣ ${fmtDate(p.startDate)} – ${fmtDate(p.endDate)}</span>
          </div>

          <div class="project-card-progress">
            <div class="progress-cell">
              <strong>Project progress</strong>
              ${progressHTML(projectProgress(p))}
            </div>
          </div>

          <div class="project-metrics">
            <div>
              <small>Estimated budget</small>
              <strong>${money(p.budget, p.currency)}</strong>
            </div>
            <div>
              <small>Actual expenditure</small>
              <strong>${money(expenses, p.currency)}</strong>
            </div>
            <div>
              <small>${remaining < 0 ? 'Over budget' : 'Budget remaining'}</small>
              <strong style="color:${remaining < 0 ? 'var(--red)' : 'inherit'}">
                ${money(Math.abs(remaining), p.currency)}
              </strong>
            </div>
          </div>

          <div class="project-meta">
            <span>Duration: ${projectDuration(p)} days</span>
            <span>${p.status === 'Completed'
              ? 'Completed'
              : days < 0
                ? 'Overdue by ' + Math.abs(days) + ' days'
                : days + ' days remaining'}</span>
            <span>${projectTasks(p.id).length} tasks · ${projectMaterials(p.id).length} materials</span>
          </div>

          <div class="project-card-actions">
            <button class="btn btn-outline" data-action="view-project" data-id="${esc(p.id)}">Project report</button>
            <button class="btn btn-outline" data-action="edit-project" data-id="${esc(p.id)}">Edit</button>
            <button class="btn btn-outline" data-action="delete-project" data-id="${esc(p.id)}">Delete</button>
          </div>
        </article>
      `;
    }).join('')
    : emptyState('No projects found', 'Add a project or adjust your search and filters.');
}

// TASKS

function renderTasks() {
  const q = ($('taskSearch')?.value || '').toLowerCase();
  const pid = $('taskProjectFilter')?.value || '';
  const status = $('taskStatusFilter')?.value || '';
  const priority = $('taskPriorityFilter')?.value || '';

  const list = data.tasks.filter(t =>
    (`${t.name} ${t.assignee} ${t.description}`).toLowerCase().includes(q) &&
    (!pid || t.projectId === pid) &&
    (!status || t.status === status) &&
    (!priority || t.priority === priority)
  );

  $('tasksTable').innerHTML = list.length
    ? list.map(t => `
      <tr>
        <td>
          <div class="project-name">${esc(t.name)}</div>
          <div class="subline">Weight ${num(t.weight) || 1} · ${esc(t.description || 'No description')}</div>
        </td>
        <td>${esc(projectName(t.projectId))}</td>
        <td>${esc(t.assignee || '—')}</td>
        <td>
          ${fmtDate(t.dueDate)}
          ${t.status !== 'Completed' && t.dueDate < todayISO() ? badge('Overdue') : ''}
        </td>
        <td>${badge(t.priority)}</td>
        <td>${badge(t.status)}</td>
        <td>${progressHTML(t.completion)}</td>
        <td>
          <div class="action-group">
            <button class="small-btn" data-action="edit-task" data-id="${esc(t.id)}">Edit</button>
            <button class="small-btn" data-action="delete-task" data-id="${esc(t.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="8">No tasks match your filters.</td></tr>';
}

// FINANCIAL SUMMARY

function renderFinanceSummary() {
  const budget = data.projects.reduce((sum, p) => sum + num(p.budget), 0);
  const actual = data.expenses.reduce((sum, e) => sum + num(e.amount), 0);

  $('financeSummary').innerHTML = [
    statCard('Total estimated budget', money(budget), '◈', 'All projects'),
    statCard('Actual expenditure', money(actual), '◉', 'Recorded expenses'),
    statCard(
      actual > budget ? 'Budget overrun' : 'Budget remaining',
      money(Math.abs(budget - actual)),
      '↔',
      budget ? 'Utilization ' + Math.round(actual / budget * 100) + '%' : 'Budget not set'
    )
  ].join('');
}

// EXPENSES

function renderExpenses() {
  const q = ($('expenseSearch')?.value || '').toLowerCase();
  const pid = $('expenseProjectFilter')?.value || '';
  const cat = $('expenseCategoryFilter')?.value || '';
  const pay = $('expensePaymentFilter')?.value || '';

  const list = data.expenses.filter(e =>
    (`${e.description} ${e.supplier} ${e.notes}`).toLowerCase().includes(q) &&
    (!pid || e.projectId === pid) &&
    (!cat || e.category === cat) &&
    (!pay || e.paymentStatus === pay)
  );

  $('expensesTable').innerHTML = list.length
    ? list.map(e => `
      <tr>
        <td>${fmtDate(e.date)}</td>
        <td>${esc(projectName(e.projectId))}</td>
        <td>
          <div class="project-name">${esc(e.description)}</div>
          <div class="subline">${esc(e.notes || '')}</div>
        </td>
        <td>${esc(e.category)}</td>
        <td>${esc(e.supplier || '—')}</td>
        <td>${badge(e.paymentStatus)}</td>
        <td><strong>${money(e.amount, project(e.projectId)?.currency || 'KES')}</strong></td>
        <td>
          <div class="action-group">
            <button class="small-btn" data-action="edit-expense" data-id="${esc(e.id)}">Edit</button>
            <button class="small-btn" data-action="delete-expense" data-id="${esc(e.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="8">No expenses match your filters.</td></tr>';
}

// MATERIALS

function renderMaterials() {
  const q = ($('materialSearch')?.value || '').toLowerCase();
  const pid = $('materialProjectFilter')?.value || '';
  const cat = $('materialCategoryFilter')?.value || '';

  const list = data.materials.filter(m =>
    (`${m.name} ${m.supplier} ${m.notes}`).toLowerCase().includes(q) &&
    (!pid || m.projectId === pid) &&
    (!cat || m.category === cat)
  );

  $('materialsTable').innerHTML = list.length
    ? list.map(m => {
      const stock = num(m.purchased) - num(m.used);
      const shortage = Math.max(0, num(m.required) - stock);
      const cost = num(m.purchased) * num(m.unitPrice);

      return `
        <tr>
          <td>
            <div class="project-name">${esc(m.name)}</div>
            <div class="subline">${esc(m.category)} · ${esc(m.unit)}</div>
          </td>
          <td>${esc(projectName(m.projectId))}</td>
          <td>${num(m.required)} ${esc(m.unit)}</td>
          <td>${num(m.purchased)} ${esc(m.unit)}</td>
          <td>${num(m.used)} ${esc(m.unit)}</td>
          <td>${stock} ${esc(m.unit)}</td>
          <td>${shortage
            ? `<span class="badge overdue">${shortage} ${esc(m.unit)}</span>`
            : '—'}</td>
          <td>${money(cost, project(m.projectId)?.currency || 'KES')}</td>
          <td>
            <div class="action-group">
              <button class="small-btn" data-action="edit-material" data-id="${esc(m.id)}">Edit</button>
              <button class="small-btn" data-action="delete-material" data-id="${esc(m.id)}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join('')
    : '<tr><td colspan="9">No materials match your filters.</td></tr>';
}

// PROGRESS REPORTS

function renderReports() {
  const q = ($('reportSearch')?.value || '').toLowerCase();
  const pid = $('reportProjectFilter')?.value || '';

  const list = data.reports.filter(r =>
    (`${r.activity} ${r.description} ${r.challenges} ${r.recommendations}`)
      .toLowerCase()
      .includes(q) &&
    (!pid || r.projectId === pid)
  ).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  $('reportsList').innerHTML = list.length
    ? list.map(r => `
      <article class="report-card">
        <div class="report-card-head">
          <div>
            <h3>${esc(r.activity)} · ${esc(projectName(r.projectId))}</h3>
            <small>${fmtDate(r.date)} · Reported progress: ${num(r.progress)}%</small>
          </div>
          <div class="action-group">
            <button class="small-btn" data-action="edit-report" data-id="${esc(r.id)}">Edit</button>
            <button class="small-btn" data-action="delete-report" data-id="${esc(r.id)}">Delete</button>
          </div>
        </div>
        ${progressHTML(r.progress)}
        <p>${esc(r.description || 'No work description entered.')}</p>
        ${r.challenges ? `<p><strong>Challenges:</strong> ${esc(r.challenges)}</p>` : ''}
        ${r.recommendations ? `<p><strong>Recommendations:</strong> ${esc(r.recommendations)}</p>` : ''}
      </article>
    `).join('')
    : emptyState('No progress reports yet', 'Record a site update to build a history of work completed.');

  renderPrintPreview();
}

function refreshProjectSelects() {
  const ids = [
    'taskProjectFilter',
    'expenseProjectFilter',
    'materialProjectFilter',
    'reportProjectFilter',
    'printProjectSelect'
  ];

  for (const id of ids) {
    const el = $(id);
    if (!el) continue;

    const current = el.value;
    const first = id === 'printProjectSelect' ? 'Select project' : 'All projects';

    el.innerHTML = `<option value="">${first}</option>` +
      data.projects.map(p => `
        <option value="${esc(p.id)}">${esc(p.name)}</option>
      `).join('');

    if (data.projects.some(p => p.id === current)) {
      el.value = current;
    }
  }
}

function renderComparisonSelects() {
  for (const id of ['compareProjectA', 'compareProjectB']) {
    const el = $(id);
    const current = el.value;

    el.innerHTML = '<option value="">Select project</option>' +
      data.projects.map(p => `
        <option value="${esc(p.id)}">${esc(p.name)}</option>
      `).join('');

    if (data.projects.some(p => p.id === current)) {
      el.value = current;
    }
  }
}

// FORM DEFINITIONS

const schemas = {
  project: {
    title: 'Project',
    fields: [
      ['name', 'Project name', 'text', true],
      ['id', 'Project ID', 'text', true],
      ['client', 'Client name', 'text', true],
      ['contact', 'Client contact', 'text', false],
      ['location', 'Site location', 'text', true],
      ['buildingType', 'Building type', 'select', true,
        ['Residential', 'Commercial', 'Industrial', 'Institutional', 'Infrastructure', 'Other']],
      ['description', 'Project description', 'textarea', false],
      ['manager', 'Project manager', 'text', false],
      ['startDate', 'Start date', 'date', true],
      ['endDate', 'Expected completion date', 'date', true],
      ['budget', 'Estimated budget', 'number', true, { min: 0, step: '0.01' }],
      ['currency', 'Currency', 'select', true, CURRENCIES],
      ['status', 'Project status', 'select', true, STATUSES]
    ]
  },

  task: {
    title: 'Task',
    fields: [
      ['projectId', 'Project', 'project', true],
      ['name', 'Task name', 'text', true],
      ['description', 'Description', 'textarea', false],
      ['assignee', 'Assigned worker / supervisor', 'text', false],
      ['startDate', 'Planned start date', 'date', true],
      ['dueDate', 'Due date', 'date', true],
      ['priority', 'Priority', 'select', true, PRIORITIES],
      ['status', 'Task status', 'select', true, TASK_STATUSES],
      ['completion', 'Completion percentage', 'number', true, { min: 0, max: 100, step: 1 }],
      ['weight', 'Task weight', 'number', true, { min: 0.01, step: '0.1' }]
    ]
  },

  expense: {
    title: 'Expense',
    fields: [
      ['projectId', 'Project', 'project', true],
      ['description', 'Expense description', 'text', true],
      ['category', 'Expense category', 'select', true, EXPENSE_CATEGORIES],
      ['amount', 'Amount', 'number', true, { min: 0.01, step: '0.01' }],
      ['date', 'Expense date', 'date', true],
      ['supplier', 'Supplier / recipient', 'text', false],
      ['paymentStatus', 'Payment status', 'select', true, ['Paid', 'Pending', 'Part Paid']],
      ['notes', 'Notes', 'textarea', false]
    ]
  },

  material: {
    title: 'Material',
    fields: [
      ['projectId', 'Project', 'project', true],
      ['name', 'Material name', 'text', true],
      ['category', 'Category', 'select', true, MATERIAL_CATEGORIES],
      ['unit', 'Unit of measurement (e.g. bags, m³, kg)', 'text', true],
      ['required', 'Required quantity', 'number', true, { min: 0, step: '0.01' }],
      ['purchased', 'Total quantity purchased', 'number', true, { min: 0, step: '0.01' }],
      ['used', 'Total quantity used', 'number', true, { min: 0, step: '0.01' }],
      ['unitPrice', 'Unit purchase price', 'number', true, { min: 0, step: '0.01' }],
      ['supplier', 'Supplier', 'text', false],
      ['purchaseDate', 'Purchase date', 'date', false],
      ['notes', 'Notes', 'textarea', false]
    ]
  },

  report: {
    title: 'Progress report',
    fields: [
      ['projectId', 'Project', 'project', true],
      ['date', 'Reporting date', 'date', true],
      ['activity', 'Activity completed', 'text', true],
      ['progress', 'Activity progress (%)', 'number', true, { min: 0, max: 100, step: 1 }],
      ['description', 'Work performed', 'textarea', true],
      ['challenges', 'Challenges encountered', 'textarea', false],
      ['recommendations', 'Recommendations / notes', 'textarea', false]
    ]
  }
};

function openModal(type, id = null) {
  if (!schemas[type]) return;

  if (!data.projects.length && type !== 'project') {
    showToast('Create a project before adding related records.', true);
    return;
  }

  currentModal = { type, id };

  const schema = schemas[type];
  const collection = type === 'project'
    ? 'projects'
    : type === 'task'
      ? 'tasks'
      : type === 'expense'
        ? 'expenses'
        : type === 'material'
          ? 'materials'
          : 'reports';

  const record = id
    ? data[collection].find(x => x.id === id)
    : null;

  $('modalTitle').textContent = (id ? 'Edit ' : 'Add ') + schema.title;
  $('formError').textContent = '';

  $('modalFields').innerHTML = schema.fields.map(
    ([key, label, kind, required, extra]) => {
      let value = record?.[key] ?? defaultValue(type, key);

      if (key === 'id' && record) value = record.id;

      let control = '';

      if (kind === 'select') {
        const opts = key === 'projectId'
          ? projectOptions(value, false)
          : selectOptions(extra || [], value);

        control = `<select id="field_${key}" name="${key}" ${required ? 'required' : ''}>
          ${key === 'projectId' ? '<option value="">Select project</option>' : ''}
          ${opts}
        </select>`;
      } else if (kind === 'project') {
        control = `<select id="field_${key}" name="${key}" required>
          <option value="">Select project</option>
          ${projectOptions(value, false)}
        </select>`;
      } else if (kind === 'textarea') {
        control = `<textarea id="field_${key}" name="${key}" ${required ? 'required' : ''}>${esc(value)}</textarea>`;
      } else {
        const attrs = typeof extra === 'object' && extra
          ? Object.entries(extra)
              .map(([k, v]) => `${k}="${esc(v)}"`)
              .join(' ')
          : '';

        control = `<input id="field_${key}" name="${key}" type="${kind}"
          value="${esc(value)}" ${attrs}
          ${required ? 'required' : ''}
          ${key === 'id' && id ? 'readonly' : ''}>`;
      }

      const full = kind === 'textarea' ||
        ['description', 'challenges', 'recommendations'].includes(key);

      return `<div class="field ${full ? 'full' : ''}">
        <label for="field_${key}">${esc(label)}${required ? ' *' : ''}</label>
        ${control}
      </div>`;
    }
  ).join('');

  $('modalBackdrop').hidden = false;
  document.body.style.overflow = 'hidden';

  const first = $('modalFields').querySelector('input:not([readonly]),select,textarea');

  if (first) first.focus();
}

function defaultValue(type, key) {
  const today = todayISO();

  const defaults = {
    project: {
      id: generateProjectId(),
      status: 'Planned',
      currency: 'KES',
      buildingType: 'Residential',
      startDate: today,
      endDate: today,
      budget: 0
    },
    task: {
      startDate: today,
      dueDate: today,
      priority: 'Medium',
      status: 'Not Started',
      completion: 0,
      weight: 1
    },
    expense: {
      date: today,
      category: 'Construction materials',
      paymentStatus: 'Pending'
    },
    material: {
      category: 'Cement',
      required: 0,
      purchased: 0,
      used: 0,
      unitPrice: 0,
      purchaseDate: today,
      unit: 'bags'
    },
    report: {
      date: today,
      progress: 0
    }
  };

  return defaults[type]?.[key] ?? '';
}

function generateProjectId() {
  let n = 1;
  let id;

  do {
    id = 'BT-' + String(n++).padStart(4, '0');
  } while (data.projects.some(p => p.id === id));

  return id;
}

function closeModal() {
  $('modalBackdrop').hidden = true;
  document.body.style.overflow = '';
  currentModal = { type: null, id: null };
}

function getFormRecord() {
  const form = new FormData($('recordForm'));
  const out = {};

  for (const [key, value] of form.entries()) {
    out[key] = value.trim();
  }

  return out;
}

// FORM VALIDATION

function validateRecord(type, r) {
  const errors = [];

  if (type === 'project') {
    if (!r.name) errors.push('Project name is required.');
    if (!r.id) errors.push('Project ID is required.');

    if (data.projects.some(p => p.id === r.id && p.id !== currentModal.id)) {
      errors.push('This project ID is already in use.');
    }

    if (!r.client) errors.push('Client name is required.');
    if (!r.location) errors.push('Site location is required.');

    if (!r.startDate || !r.endDate) {
      errors.push('Start and expected completion dates are required.');
    }

    if (r.startDate && r.endDate && r.endDate < r.startDate) {
      errors.push('Expected completion date cannot be before the start date.');
    }

    if (num(r.budget) < 0 || !Number.isFinite(Number(r.budget))) {
      errors.push('Budget must be a valid non-negative number.');
    }
  }

  if (type === 'task') {
    if (!project(r.projectId)) errors.push('Select a valid project.');
    if (!r.name) errors.push('Task name is required.');

    if (r.startDate && r.dueDate && r.dueDate < r.startDate) {
      errors.push('Task due date cannot be before its start date.');
    }

    if (num(r.completion) < 0 || num(r.completion) > 100) {
      errors.push('Completion must be between 0 and 100%.');
    }

    if (num(r.weight) <= 0) {
      errors.push('Task weight must be greater than zero.');
    }

    if (r.status === 'Completed') r.completion = '100';

    if (num(r.completion) === 100 && r.status !== 'Completed') {
      errors.push('Set task status to Completed when completion reaches 100%.');
    }
  }

  if (type === 'expense') {
    if (!project(r.projectId)) errors.push('Select a valid project.');
    if (!r.description) errors.push('Expense description is required.');
    if (num(r.amount) <= 0) errors.push('Expense amount must be greater than zero.');
    if (!r.date) errors.push('Expense date is required.');
  }

  if (type === 'material') {
    if (!project(r.projectId)) errors.push('Select a valid project.');
    if (!r.name || !r.unit) errors.push('Material name and unit are required.');

    for (const key of ['required', 'purchased', 'used', 'unitPrice']) {
      if (!Number.isFinite(Number(r[key])) || num(r[key]) < 0) {
        errors.push(`${key} must be a valid non-negative number.`);
      }
    }

    if (num(r.used) > num(r.purchased)) {
      errors.push('Quantity used cannot exceed total purchased stock. Record the shortage separately if necessary.');
    }
  }

  if (type === 'report') {
    if (!project(r.projectId)) errors.push('Select a valid project.');
    if (!r.activity || !r.description) errors.push('Activity and work performed are required.');

    if (num(r.progress) < 0 || num(r.progress) > 100) {
      errors.push('Progress must be between 0 and 100%.');
    }

    if (!r.date) errors.push('Reporting date is required.');
  }

  return errors;
}

function collectionFor(type) {
  return type === 'project'
    ? 'projects'
    : type === 'task'
      ? 'tasks'
      : type === 'expense'
        ? 'expenses'
        : type === 'material'
          ? 'materials'
          : 'reports';
}

// SAVE NEW RECORDS AND EDIT EXISTING RECORDS

$('recordForm').addEventListener('submit', e => {
  e.preventDefault();

  const type = currentModal.type;
  const id = currentModal.id;
  const r = getFormRecord();

  if (!type) return;

  const errors = validateRecord(type, r);

  if (errors.length) {
    $('formError').textContent = errors.join(' ');
    return;
  }

  const key = collectionFor(type);
  const existing = id ? data[key].find(x => x.id === id) : null;

  const record = {
    ...(existing || {}),
    ...r,
    id: type === 'project' ? r.id : (existing?.id || uid(type)),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (type === 'project' && record.id !== id &&
      data.projects.some(p => p.id === record.id)) {
    $('formError').textContent = 'Project ID already exists.';
    return;
  }

  if (existing) {
    data[key] = data[key].map(x => x.id === id ? record : x);
  } else {
    data[key].push(record);
  }

  addActivity(
    `${existing ? 'Updated' : 'Added'} ${schemas[type].title.toLowerCase()}: ` +
    (record.name || record.description || record.activity || record.id)
  );

  saveData();
  closeModal();
  renderAll();

  showToast(`${schemas[type].title} ${existing ? 'updated' : 'saved'} successfully.`);
});

// DELETE RECORDS

function removeRecord(type, id) {
  const key = collectionFor(type);
  const record = data[key].find(x => x.id === id);

  if (!record) return;

  if (type === 'project') {
    const related = ['tasks', 'expenses', 'materials', 'reports']
      .reduce((sum, k) => sum + data[k].filter(x => x.projectId === id).length, 0);

    if (!confirm(`Delete project "${record.name}" and its ${related} related records? This cannot be undone.`)) {
      return;
    }

    for (const k of ['tasks', 'expenses', 'materials', 'reports']) {
      data[k] = data[k].filter(x => x.projectId !== id);
    }
  } else if (!confirm(`Delete this ${schemas[type].title.toLowerCase()} record? This cannot be undone.`)) {
    return;
  }

  data[key] = data[key].filter(x => x.id !== id);

  addActivity(
    `Deleted ${schemas[type].title.toLowerCase()}: ` +
    (record.name || record.description || record.activity || record.id)
  );

  saveData();
  renderAll();
  showToast(`${schemas[type].title} deleted.`);
}

function editOrAdd(type, id) {
  openModal(type, id || null);
}

// NAVIGATION AND ACTION BUTTONS

document.addEventListener('click', e => {
  const nav = e.target.closest('[data-view]');

  if (nav) {
    switchView(nav.dataset.view);
    return;
  }

  const go = e.target.closest('[data-go]');

  if (go) {
    switchView(go.dataset.go);
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const { action, id } = btn.dataset;
  const match = action.match(/^(view|edit|delete)-(project|task|expense|material|report)$/);

  if (!match) return;

  const [, verb, type] = match;

  if (verb === 'edit') editOrAdd(type, id);
  if (verb === 'delete') removeRecord(type, id);
  if (verb === 'view') viewProject(id);
});

function viewProject(id) {
  const p = project(id);
  if (!p) return;

  $('printProjectSelect').value = id;
  renderPrintPreview();
  switchView('reports');

  $('printPreview').scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });

  showToast('Project report preview updated.');
}

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === 'view-' + name);
  });

  document.querySelectorAll('.nav-link').forEach(button => {
    button.classList.toggle('active', button.dataset.view === name);
  });

  const labels = {
    dashboard: 'Dashboard',
    projects: 'Projects',
    tasks: 'Tasks',
    expenses: 'Budget & Expenses',
    materials: 'Materials',
    reports: 'Progress Reports',
    compare: 'Project Comparison',
    data: 'Data Management'
  };

  $('pageTitle').textContent = labels[name] || 'Dashboard';
  $('sidebar').classList.remove('open');

  if (name === 'dashboard') renderDashboard();
}

$('menuBtn').addEventListener('click', () => {
  $('sidebar').classList.toggle('open');
});

$('modalClose').addEventListener('click', closeModal);
$('modalCancel').addEventListener('click', closeModal);

$('modalBackdrop').addEventListener('click', e => {
  if (e.target === $('modalBackdrop')) closeModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('modalBackdrop').hidden) closeModal();
});

$('addProjectBtn').addEventListener('click', () => editOrAdd('project'));
$('quickAddBtn').addEventListener('click', () => editOrAdd('project'));
$('addTaskBtn').addEventListener('click', () => editOrAdd('task'));
$('addExpenseBtn').addEventListener('click', () => editOrAdd('expense'));
$('addMaterialBtn').addEventListener('click', () => editOrAdd('material'));
$('addReportBtn').addEventListener('click', () => editOrAdd('report'));

$('dashboardRefresh').addEventListener('click', () => {
  renderAll();
  showToast('Dashboard refreshed from saved records.');
});

for (const id of ['projectSearch', 'projectStatusFilter', 'projectSort']) {
  $(id).addEventListener('input', renderProjects);
}

for (const id of ['taskSearch', 'taskProjectFilter', 'taskStatusFilter', 'taskPriorityFilter']) {
  $(id).addEventListener('input', renderTasks);
}

for (const id of ['expenseSearch', 'expenseProjectFilter', 'expenseCategoryFilter', 'expensePaymentFilter']) {
  $(id).addEventListener('input', renderExpenses);
}

for (const id of ['materialSearch', 'materialProjectFilter', 'materialCategoryFilter']) {
  $(id).addEventListener('input', renderMaterials);
}

for (const id of ['reportSearch', 'reportProjectFilter']) {
  $(id).addEventListener('input', renderReports);
}

$('printProjectSelect').addEventListener('change', renderPrintPreview);

// PRINTABLE PROJECT REPORT

function renderPrintPreview() {
  const id = $('printProjectSelect')?.value;
  const p = project(id);

  if (!p) {
    $('printPreview').innerHTML = '';
    return;
  }

  const tasks = projectTasks(id);
  const expenses = projectExpenses(id);
  const materials = projectMaterials(id);

  const reports = data.reports
    .filter(r => r.projectId === id)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const actual = spent(id);
  const remaining = budgetRemaining(p);

  $('printPreview').innerHTML = `
    <div class="print-report">
      <p class="eyebrow">BUILDTRACK · PROJECT REPORT</p>
      <h2>${esc(p.name)}</h2>
      <p>${esc(p.description || 'Building construction project summary')}</p>

      <div class="print-kpis">
        <div><small>Estimated budget</small><h3>${money(p.budget, p.currency)}</h3></div>
        <div><small>Actual expenditure</small><h3>${money(actual, p.currency)}</h3></div>
        <div>
          <small>${remaining < 0 ? 'Budget overrun' : 'Remaining budget'}</small>
          <h3>${money(Math.abs(remaining), p.currency)}</h3>
        </div>
      </div>

      <h3>Project details</h3>
      <table><tbody>
        ${[
          ['Project ID', p.id],
          ['Client', p.client],
          ['Contact', p.contact],
          ['Site location', p.location],
          ['Building type', p.buildingType],
          ['Project manager', p.manager],
          ['Status', p.status],
          ['Start date', fmtDate(p.startDate)],
          ['Expected completion', fmtDate(p.endDate)],
          ['Planned duration', projectDuration(p) + ' calendar days'],
          ['Days remaining', p.status === 'Completed'
            ? 'Completed'
            : daysRemaining(p) < 0
              ? 'Overdue by ' + Math.abs(daysRemaining(p)) + ' days'
              : daysRemaining(p) + ' days'],
          ['Weighted task progress', projectProgress(p) + '%']
        ].map(([label, value]) => `
          <tr><th>${esc(label)}</th><td>${esc(value || '—')}</td></tr>
        `).join('')}
      </tbody></table>

      <h3>Task summary</h3>
      <table>
        <thead><tr><th>Task</th><th>Assignee</th><th>Due date</th><th>Status</th><th>Progress</th><th>Weight</th></tr></thead>
        <tbody>
          ${tasks.length ? tasks.map(t => `
            <tr>
              <td>${esc(t.name)}</td>
              <td>${esc(t.assignee || '—')}</td>
              <td>${fmtDate(t.dueDate)}</td>
              <td>${esc(t.status)}</td>
              <td>${num(t.completion)}%</td>
              <td>${num(t.weight) || 1}</td>
            </tr>
          `).join('') : '<tr><td colspan="6">No tasks recorded.</td></tr>'}
        </tbody>
      </table>

      <h3>Material requirements and stock</h3>
      <table>
        <thead><tr><th>Material</th><th>Required</th><th>Purchased</th><th>Used</th><th>Stock</th><th>Shortage</th><th>Purchase cost</th></tr></thead>
        <tbody>
          ${materials.length ? materials.map(m => {
            const stock = num(m.purchased) - num(m.used);

            return `<tr>
              <td>${esc(m.name)}</td>
              <td>${num(m.required)} ${esc(m.unit)}</td>
              <td>${num(m.purchased)}</td>
              <td>${num(m.used)}</td>
              <td>${stock}</td>
              <td>${Math.max(0, num(m.required) - stock)}</td>
              <td>${money(num(m.purchased) * num(m.unitPrice), p.currency)}</td>
            </tr>`;
          }).join('') : '<tr><td colspan="7">No materials recorded.</td></tr>'}
        </tbody>
      </table>

      <h3>Expense breakdown</h3>
      <table>
        <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Supplier</th><th>Payment status</th><th>Amount</th></tr></thead>
        <tbody>
          ${expenses.length ? expenses.map(e => `
            <tr>
              <td>${fmtDate(e.date)}</td>
              <td>${esc(e.description)}</td>
              <td>${esc(e.category)}</td>
              <td>${esc(e.supplier || '—')}</td>
              <td>${esc(e.paymentStatus)}</td>
              <td>${money(e.amount, p.currency)}</td>
            </tr>
          `).join('') : '<tr><td colspan="6">No expenses recorded.</td></tr>'}
        </tbody>
      </table>

      <h3>Progress report history</h3>
      <table>
        <thead><tr><th>Date</th><th>Activity</th><th>Progress</th><th>Work performed</th><th>Challenges</th></tr></thead>
        <tbody>
          ${reports.length ? reports.map(r => `
            <tr>
              <td>${fmtDate(r.date)}</td>
              <td>${esc(r.activity)}</td>
              <td>${num(r.progress)}%</td>
              <td>${esc(r.description)}</td>
              <td>${esc(r.challenges || '—')}</td>
            </tr>
          `).join('') : '<tr><td colspan="5">No progress reports recorded.</td></tr>'}
        </tbody>
      </table>

      <p class="muted-small">
        Generated ${new Date().toLocaleString()}.
        Planning and monitoring report; verify all figures before making procurement or engineering decisions.
      </p>
    </div>
  `;
}

$('printReportBtn').addEventListener('click', () => {
  if (!$('printProjectSelect').value) {
    showToast('Select a project first.', true);
    return;
  }

  renderPrintPreview();
  window.print();
});

// PROJECT COMPARISON

$('compareBtn').addEventListener('click', () => {
  const a = project($('compareProjectA').value);
  const b = project($('compareProjectB').value);

  if (!a || !b) {
    showToast('Select two projects to compare.', true);
    return;
  }

  if (a.id === b.id) {
    showToast('Choose two different projects.', true);
    return;
  }

  const rows = [
    ['Status', a.status, b.status],
    ['Estimated budget', money(a.budget, a.currency), money(b.budget, b.currency)],
    ['Actual expenditure', money(spent(a.id), a.currency), money(spent(b.id), b.currency)],
    ['Budget variance', money(budgetRemaining(a), a.currency), money(budgetRemaining(b), b.currency)],
    [
      'Budget utilization',
      num(a.budget) ? Math.round(spent(a.id) / num(a.budget) * 100) + '%' : 'N/A',
      num(b.budget) ? Math.round(spent(b.id) / num(b.budget) * 100) + '%' : 'N/A'
    ],
    ['Task progress', projectProgress(a) + '%', projectProgress(b) + '%'],
    ['Planned duration', projectDuration(a) + ' days', projectDuration(b) + ' days'],
    [
      'Overdue tasks',
      overdueTasks().filter(t => t.projectId === a.id).length,
      overdueTasks().filter(t => t.projectId === b.id).length
    ],
    [
      'Material purchase cost',
      money(projectMaterials(a.id).reduce((s, m) => s + num(m.purchased) * num(m.unitPrice), 0), a.currency),
      money(projectMaterials(b.id).reduce((s, m) => s + num(m.purchased) * num(m.unitPrice), 0), b.currency)
    ],
    ['Task count', projectTasks(a.id).length, projectTasks(b.id).length]
  ];

  $('comparisonResult').innerHTML = `
    <div class="panel comparison-table">
      <h3>Comparison results</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Metric</th><th>${esc(a.name)}</th><th>${esc(b.name)}</th></tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <th>${esc(r[0])}</th>
                <td>${esc(r[1])}</td>
                <td>${esc(r[2])}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="comparison-callout">
        Progress uses weighted task completion. Budget variance is estimated budget minus recorded expenditure.
        Compare amounts only when both projects use the same currency.
      </div>
    </div>
  `;
});

// JSON EXPORT

$('exportBtn').addEventListener('click', () => {
  const payload = {
    app: 'BuildTrack',
    version: 1,
    exportedAt: new Date().toISOString(),
    data
  };

  const blob = new Blob(
    [JSON.stringify(payload, null, 2)],
    { type: 'application/json' }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = `buildtrack-backup-${todayISO()}.json`;

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
  showToast('JSON backup exported.');
});

// JSON IMPORT

$('importFile').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    const incoming = parsed.data || parsed;

    const keys = [
      'projects', 'tasks', 'expenses',
      'materials', 'reports', 'activity'
    ];

    if (
      !incoming ||
      !Array.isArray(incoming.projects) ||
      !keys.every(k => incoming[k] === undefined || Array.isArray(incoming[k]))
    ) {
      throw new Error('The file does not contain a valid BuildTrack data structure.');
    }

    const clean = emptyData();

    for (const key of keys) {
      clean[key] = Array.isArray(incoming[key]) ? incoming[key] : [];
    }

    const projectIds = new Set();

    for (const p of clean.projects) {
      if (!p.id || !p.name || projectIds.has(p.id)) {
        throw new Error('Imported projects contain missing or duplicate project IDs or names.');
      }

      projectIds.add(p.id);

      if (!Number.isFinite(Number(p.budget)) || num(p.budget) < 0) {
        throw new Error('Imported project budget is invalid.');
      }
    }

    for (const key of ['tasks', 'expenses', 'materials', 'reports']) {
      for (const record of clean[key]) {
        if (!record.id || !projectIds.has(record.projectId)) {
          throw new Error(`Imported ${key} contain a missing ID or a reference to an unknown project.`);
        }
      }
    }

    if (!confirm(
      'Import this backup and replace all BuildTrack records currently stored in this browser? Export current data first if needed.'
    )) {
      return;
    }

    data = clean;

    if (!saveData()) return;

    renderAll();
    showToast('Backup imported successfully.');
  } catch (error) {
    showToast(error.message || 'Could not import this file.', true);
  } finally {
    e.target.value = '';
  }
});

// CLEAR ALL DATA

$('clearDataBtn').addEventListener('click', () => {
  if (!confirm(
    'Delete ALL projects, tasks, expenses, materials and reports from this browser? This cannot be undone.'
  )) {
    return;
  }

  data = emptyData();
  saveData();
  renderAll();

  $('comparisonResult').innerHTML = '';
  showToast('All BuildTrack records have been cleared.');
});

// INITIALIZE APPLICATION

$('todayLabel').textContent = new Date().toLocaleDateString('en-KE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric'
});

renderAll();