import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  collection, getDocs, addDoc, updateDoc, doc, serverTimestamp,
  query, where, orderBy
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

let currentUser = null;
let currentMember = null;
let allTasks = [];
let allMembers = [];
let allProjects = [];
let currentTask = null;
const todayStr = new Date().toISOString().slice(0, 10);

const createModal = new bootstrap.Modal(document.getElementById('createModal'));
const detailModal = new bootstrap.Modal(document.getElementById('detailModal'));

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUser = user;
    await loadCurrentMember();
    await Promise.all([loadMembers(), loadProjects()]);
    await loadTasks();
    renderAll();
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
  const snap = await getDocs(collection(db, 'projects'));
  allProjects = [];
  snap.forEach(d => allProjects.push({ id: d.id, name: d.data().name }));
  allProjects.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadTasks() {
  const q = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  allTasks = [];
  snap.forEach(d => allTasks.push({ id: d.id, ...d.data() }));
}

// ========== 渲染 ==========
function renderAll() {
  populateFilters();
  applyFilters();
}

function populateFilters() {
  const assigneeSelect = document.getElementById('filterAssignee');
  assigneeSelect.innerHTML = '<option value="all">担当者：すべて</option>';
  allMembers.forEach(m => assigneeSelect.innerHTML += `<option value="${m.name}">${m.name}</option>`);

  const taskAssigneeSelect = document.getElementById('taskAssignee');
  taskAssigneeSelect.innerHTML = '';
  allMembers.forEach(m => taskAssigneeSelect.innerHTML += `<option value="${m.name}">${m.name}</option>`);

  const taskProjectSelect = document.getElementById('taskProject');
  taskProjectSelect.innerHTML = '<option value="">なし</option>';
  allProjects.forEach(p => taskProjectSelect.innerHTML += `<option value="${p.name}">${p.name}</option>`);

  const editProjectSelect = document.getElementById('editProject');
  if (editProjectSelect) {
    editProjectSelect.innerHTML = '<option value="">なし</option>';
    allProjects.forEach(p => editProjectSelect.innerHTML += `<option value="${p.name}">${p.name}</option>`);
  }
}

// 渲染列表（带状态边框和排序）
function renderTaskList(tasks) {
  const container = document.getElementById('taskList');
  if (tasks.length === 0) {
    container.innerHTML = '<div class="empty-hint">タスクがありません</div>';
    return;
  }
  container.innerHTML = tasks.map(t => {
    const status = t.status || 'open';
    const statusClass = `status-${status}`;
    const isCompleted = status === 'completed';

    // 状态文字
    let statusLabel = '未着手';
    let badgeClass = 'badge-open';
    if (status === 'in_progress') { statusLabel = '進行中'; badgeClass = 'badge-progress'; }
    else if (status === 'completed') { statusLabel = '完了'; badgeClass = 'badge-completed'; }

    // 截止日期
    const dueDate = t.dueDate ? (t.dueDate.toDate ? t.dueDate.toDate() : new Date(t.dueDate)) : null;
    const dueText = isCompleted ? '完了' : `締切日：${dueDate ? `${dueDate.getMonth()+1}/${dueDate.getDate()}` : '未設定'}`;
    const isOverdue = !isCompleted && dueDate && dueDate < new Date(todayStr);
    const dueClass = isCompleted ? 'task-due completed' : (isOverdue ? 'task-due overdue' : 'task-due');
    const dueDisplay = isOverdue ? `${dueText}（期限超過）` : dueText;

    return `
      <div class="task-card ${statusClass}" data-id="${t.id}">
        <div class="task-info">
          <div class="task-title">${escapeHtml(t.title || '無題')}</div>
          <div class="task-meta">
            <span>👤 ${escapeHtml(t.assignee || '未定')}</span>
            <span>📁 ${escapeHtml(t.project || 'なし')}</span>
          </div>
        </div>
        <span class="status-badge ${badgeClass}">${statusLabel}</span>
        <div class="${dueClass}">📅 ${dueDisplay}</div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', () => {
      currentTask = allTasks.find(t => t.id === card.dataset.id);
      if (currentTask) openDetailModal(currentTask);
    });
  });
}

// ========== 排序：已完成沉底，未完成按截止时间升序 ==========
function sortTasks(tasks) {
  return tasks.sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1;
    if (a.status !== 'completed' && b.status === 'completed') return -1;

    const aDue = a.dueDate ? (a.dueDate.toDate ? a.dueDate.toDate() : new Date(a.dueDate)) : null;
    const bDue = b.dueDate ? (b.dueDate.toDate ? b.dueDate.toDate() : new Date(b.dueDate)) : null;
    if (aDue && bDue) return aDue - bDue;
    if (aDue) return -1;
    if (bDue) return 1;
    return 0;
  });
}

// ========== 过滤 + 排序 ==========
function applyFilters() {
  const statusFilter = document.getElementById('filterStatus').value;
  const assigneeFilter = document.getElementById('filterAssignee').value;
  let filtered = [...allTasks];

  if (statusFilter !== 'all') {
    if (statusFilter === 'overdue') {
      filtered = filtered.filter(t => {
        if (t.status === 'completed') return false;
        const due = t.dueDate;
        if (!due) return false;
        const dueDate = due.toDate ? due.toDate() : new Date(due);
        return dueDate < new Date(todayStr);
      });
    } else {
      filtered = filtered.filter(t => t.status === statusFilter);
    }
  }
  if (assigneeFilter !== 'all') {
    filtered = filtered.filter(t => t.assignee === assigneeFilter);
  }

  sortTasks(filtered);
  renderTaskList(filtered);
}

// ========== 详情弹窗 ==========
function openDetailModal(task) {
  document.getElementById('viewAssignee').textContent = task.assignee || '未定';
  document.getElementById('viewProject').textContent = task.project || 'なし';
  const dueDate = task.dueDate ? (task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate)) : null;
  document.getElementById('viewDue').textContent = dueDate ? dueDate.toLocaleDateString('ja-JP') : '未設定';
  const statusText = task.status === 'open' ? '未着手' : task.status === 'in_progress' ? '進行中' : '完了';
  document.getElementById('viewStatus').textContent = statusText;
  document.getElementById('viewDesc').textContent = task.desc || '説明なし';
  document.getElementById('detailTitle').textContent = task.title || '無題';

  document.getElementById('editTitle').value = task.title || '';
  document.getElementById('editDesc').value = task.desc || '';
  document.getElementById('editDue').value = dueDate ? dueDate.toISOString().slice(0, 10) : '';
  document.getElementById('editStatus').value = task.status || 'open';

  const editProjectSelect = document.getElementById('editProject');
  editProjectSelect.innerHTML = '<option value="">なし</option>';
  allProjects.forEach(p => {
    editProjectSelect.innerHTML += `<option value="${p.name}" ${task.project === p.name ? 'selected' : ''}>${p.name}</option>`;
  });

  const editAssigneeSelect = document.getElementById('editAssignee');
  editAssigneeSelect.innerHTML = '';
  allMembers.forEach(m => {
    editAssigneeSelect.innerHTML += `<option value="${m.name}" ${task.assignee === m.name ? 'selected' : ''}>${m.name}</option>`;
  });

  document.getElementById('viewMode').style.display = 'block';
  document.getElementById('editMode').style.display = 'none';
  document.getElementById('editToggleBtn').style.display = 'inline-block';
  document.getElementById('saveEditBtn').style.display = 'none';

  document.getElementById('adminActions').style.display = hasAdminPermission() ? 'block' : 'none';

  detailModal.show();
}

// ========== 事件绑定 ==========
function attachEvents() {
  document.getElementById('addTaskBtn').addEventListener('click', () => {
    document.getElementById('taskName').value = '';
    document.getElementById('taskDesc').value = '';
    document.getElementById('taskDue').value = '';
    createModal.show();
  });

  document.getElementById('saveTaskBtn').addEventListener('click', async () => {
    const title = document.getElementById('taskName').value.trim();
    if (!title) { alert('タスク名を入力してください。'); return; }
    const assignee = document.getElementById('taskAssignee').value;
    const project = document.getElementById('taskProject').value;
    const desc = document.getElementById('taskDesc').value.trim();
    const due = document.getElementById('taskDue').value;

    const newTask = {
      title, assignee, project, desc,
      dueDate: due || null,
      status: 'in_progress',
      createdAt: serverTimestamp()
    };
    const docRef = await addDoc(collection(db, 'tasks'), newTask);
    newTask.id = docRef.id;
    allTasks.unshift(newTask);
    createModal.hide();
    applyFilters();
  });

  document.getElementById('filterStatus').addEventListener('change', applyFilters);
  document.getElementById('filterAssignee').addEventListener('change', applyFilters);

  document.getElementById('editToggleBtn').addEventListener('click', () => {
    document.getElementById('viewMode').style.display = 'none';
    document.getElementById('editMode').style.display = 'block';
    document.getElementById('editToggleBtn').style.display = 'none';
    document.getElementById('saveEditBtn').style.display = 'inline-block';
  });

  document.getElementById('saveEditBtn').addEventListener('click', async () => {
    if (!currentTask) return;
    const title = document.getElementById('editTitle').value.trim();
    const assignee = document.getElementById('editAssignee').value;
    const project = document.getElementById('editProject').value;
    const desc = document.getElementById('editDesc').value.trim();
    const due = document.getElementById('editDue').value;
    const status = document.getElementById('editStatus').value;

    await updateDoc(doc(db, 'tasks', currentTask.id), {
      title, assignee, project, desc,
      dueDate: due || null,
      status
    });

    currentTask.title = title;
    currentTask.assignee = assignee;
    currentTask.project = project;
    currentTask.desc = desc;
    currentTask.dueDate = due || null;
    currentTask.status = status;

    openDetailModal(currentTask);
    applyFilters();
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
