import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  collection, getDocs, addDoc, updateDoc, doc, serverTimestamp,
  query, where, orderBy
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

let currentUser = null;
let currentMember = null;
let allProjects = [];
let allMembers = [];
let currentProject = null;
let currentTasks = [];

const createModal = new bootstrap.Modal(document.getElementById('createModal'));
const detailModal = new bootstrap.Modal(document.getElementById('detailModal'));
const noPermissionModal = new bootstrap.Modal(document.getElementById('noPermissionModal'));

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUser = user;
    await loadCurrentMember();
    await loadMembers();
    await loadProjects();
    renderList();
    attachEvents();
  });
});

async function loadCurrentMember() {
  const q = query(collection(db, 'members'), where('email', '==', currentUser.email));
  const snap = await getDocs(q);
  if (!snap.empty) {
    currentMember = { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
}

function hasAdminPermission() {
  return currentMember && (currentMember.role === 'President' || currentMember.role === 'Admin');
}

async function loadMembers() {
  const q = query(collection(db, 'members'), where('active', '==', true));
  const snap = await getDocs(q);
  allMembers = [];
  snap.forEach(d => allMembers.push({ id: d.id, name: d.data().name }));
  allMembers.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadProjects() {
  const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  allProjects = [];
  snap.forEach(d => {
    const data = d.data();
    allProjects.push({
      id: d.id,
      name: data.name || '',
      owner: data.owner || '',
      status: data.status || 'active',
      desc: data.desc || ''
    });
  });
}

async function fetchTasksForProject(projectName) {
  const q = query(collection(db, 'tasks'), where('project', '==', projectName));
  const snap = await getDocs(q);
  const tasks = [];
  snap.forEach(doc => tasks.push({ id: doc.id, ...doc.data() }));
  return tasks;
}

function getProgress(tasks) {
  if (!tasks || tasks.length === 0) return 0;
  const done = tasks.filter(t => t.status === 'completed').length;
  return Math.round((done / tasks.length) * 100);
}

// ========== 渲染列表（含进度条） ==========
function renderList() {
  const filter = document.getElementById('filterStatus').value;
  const filtered = filter === 'all' ? allProjects : allProjects.filter(p => p.status === filter);
  const container = document.getElementById('projectList');

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-hint">プロジェクトがありません</div>';
    return;
  }

  container.innerHTML = filtered.map(p => {
    const statusLabel = p.status === 'active' ? '進行中' : p.status === 'paused' ? '一時停止' : '完了';
    return `
      <div class="project-card ${p.status}" data-id="${p.id}">
        <div class="project-header">
          <div class="project-info">
            <div class="project-name">${escapeHtml(p.name)}</div>
            <div class="project-meta">
              <span>👤 ${escapeHtml(p.owner)}</span>
              <span class="project-status status-${p.status}">${statusLabel}</span>
            </div>
          </div>
        </div>
        <div class="progress-bar-wrap" id="progressWrap-${p.id}">
          <div class="progress-bar-fill" style="width: 0%;"></div>
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', () => openDetailModal(card.dataset.id));
    // 异步更新进度条
    const projectId = card.dataset.id;
    const project = allProjects.find(p => p.id === projectId);
    if (project) {
      fetchTasksForProject(project.name).then(tasks => {
        const progress = getProgress(tasks);
        const fill = document.querySelector(`#progressWrap-${projectId} .progress-bar-fill`);
        if (fill) fill.style.width = progress + '%';
      });
    }
  });
}

// ========== 详情弹窗 ==========
async function openDetailModal(id) {
  currentProject = allProjects.find(p => p.id === id);
  if (!currentProject) return;

  currentTasks = await fetchTasksForProject(currentProject.name);

  document.getElementById('detailTitle').textContent = currentProject.name || '無題';
  document.getElementById('detailOwner').textContent = currentProject.owner || '未定';
  const statusText = currentProject.status === 'active' ? '進行中' : currentProject.status === 'paused' ? '一時停止' : '完了';
  document.getElementById('detailStatus').textContent = statusText;

  // ★ 进度条 ★
  const progress = getProgress(currentTasks);
  document.getElementById('progressBar').style.width = progress + '%';

  // 任务列表
  const taskList = document.getElementById('taskList');
  if (currentTasks.length === 0) {
    taskList.innerHTML = '<li class="text-muted small">タスクはまだありません（タスク管理ページで追加できます）</li>';
  } else {
    taskList.innerHTML = currentTasks.map(t => {
      const done = t.status === 'completed';
      return `
        <li class="task-item-inline">
          <div class="task-check ${done ? 'checked' : ''}" data-task-id="${t.id}"></div>
          <span class="task-text ${done ? 'completed' : ''}">${escapeHtml(t.title || t.name || '無題')}</span>
        </li>
      `;
    }).join('');

    taskList.querySelectorAll('.task-check').forEach(check => {
      check.addEventListener('click', async function(e) {
        e.stopPropagation();
        const taskId = this.dataset.taskId;
        const task = currentTasks.find(t => t.id === taskId);
        if (!task) return;
        const newStatus = task.status === 'completed' ? 'in_progress' : 'completed';
        task.status = newStatus;
        await updateDoc(doc(db, 'tasks', taskId), { status: newStatus });
        openDetailModal(currentProject.id);
        renderList();
      });
    });
  }

  document.getElementById('adminProjectActions').style.display = hasAdminPermission() ? 'block' : 'none';
  detailModal.show();
}

// ========== 事件绑定 ==========
function attachEvents() {
  document.getElementById('addProjectBtn').addEventListener('click', () => {
    document.getElementById('projectName').value = '';
    document.getElementById('projectDesc').value = '';
    const ownerSelect = document.getElementById('projectOwner');
    ownerSelect.innerHTML = allMembers.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
    createModal.show();
  });

  document.getElementById('saveProjectBtn').addEventListener('click', async () => {
    const name = document.getElementById('projectName').value.trim();
    if (!name) { alert('プロジェクト名を入力してください。'); return; }
    const owner = document.getElementById('projectOwner').value;
    const desc = document.getElementById('projectDesc').value.trim();
    const newProject = { name, owner, desc, status: 'active', createdAt: serverTimestamp() };
    const docRef = await addDoc(collection(db, 'projects'), newProject);
    newProject.id = docRef.id;
    allProjects.unshift(newProject);
    createModal.hide();
    renderList();
  });

  document.getElementById('filterStatus').addEventListener('change', renderList);

  document.getElementById('pauseProjectBtn').addEventListener('click', async () => {
    if (!hasAdminPermission()) { noPermissionModal.show(); return; }
    if (!currentProject) return;
    currentProject.status = 'paused';
    await updateDoc(doc(db, 'projects', currentProject.id), { status: 'paused' });
    openDetailModal(currentProject.id);
    renderList();
  });

  document.getElementById('completeProjectBtn').addEventListener('click', async () => {
    if (!hasAdminPermission()) { noPermissionModal.show(); return; }
    if (!currentProject) return;
    const allDone = currentTasks.length > 0 && currentTasks.every(t => t.status === 'completed');
    if (!allDone && currentTasks.length > 0) {
      alert('未完了のタスクが残っています。すべてのタスクを完了してください。');
      return;
    }
    currentProject.status = 'completed';
    await updateDoc(doc(db, 'projects', currentProject.id), { status: 'completed' });
    openDetailModal(currentProject.id);
    renderList();
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}