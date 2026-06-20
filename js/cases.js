import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  collection, getDocs, addDoc, updateDoc, doc, serverTimestamp,
  query, where, orderBy
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

let currentUser = null;
let currentMember = null;
let allCases = [];
let allMembers = [];
let currentCase = null;

const createModal = new bootstrap.Modal(document.getElementById('createModal'));
const detailModal = new bootstrap.Modal(document.getElementById('detailModal'));

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUser = user;
    await loadCurrentMember();
    await loadMembers();
    await loadCases();
    renderList();
    attachEvents();
  });
});

// ========== 用户信息 ==========
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

// ========== 加载 Cases ==========
async function loadCases() {
  const q = query(collection(db, 'cases'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  allCases = [];
  snap.forEach(d => allCases.push({ id: d.id, ...d.data() }));
}

// ========== 渲染列表 ==========
function renderList() {
  const filter = document.getElementById('filterStatus').value;
  let filtered = allCases;
  if (filter !== 'all') {
    filtered = filtered.filter(c => c.status === filter);
  }
  const container = document.getElementById('caseList');

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-hint">ケースがありません</div>';
    return;
  }

  container.innerHTML = filtered.map(c => {
    const urgencyClass = c.urgency === 'urgent' ? 'urgent' : c.urgency === 'low' ? 'low' : 'normal';
    let statusBadge = '';
    if (c.status === 'open') statusBadge = '<span class="case-badge badge-open">未着手</span>';
    else if (c.status === 'in_progress') statusBadge = '<span class="case-badge badge-progress">対応中</span>';
    else if (c.status === 'resolved') statusBadge = '<span class="case-badge badge-resolved">解決済</span>';
    else if (c.status === 'upgraded') statusBadge = '<span class="case-badge badge-upgraded">プロジェクト化</span>';

    const date = c.createdAt?.toDate().toLocaleDateString('ja-JP') || '';
    const preview = (c.desc || '').slice(0, 40) + ((c.desc || '').length > 40 ? '...' : '');

    return `
      <div class="case-card ${urgencyClass}" data-id="${c.id}">
        <div class="case-header">
          <div class="case-title">${escapeHtml(c.title || '無題')}</div>
          ${statusBadge}
        </div>
        <div class="case-meta">
          <span>👤 ${escapeHtml(c.reporter || '不明')}</span>
          <span>📅 ${date}</span>
        </div>
        <div class="case-preview">${escapeHtml(preview)}</div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.case-card').forEach(card => {
    card.addEventListener('click', () => {
      currentCase = allCases.find(c => c.id === card.dataset.id);
      if (currentCase) openDetailModal(currentCase);
    });
  });
}

// ========== 详情弹窗 ==========
function openDetailModal(c) {
  document.getElementById('viewReporter').textContent = c.reporter || '不明';
  const urgencyText = c.urgency === 'urgent' ? '緊急' : c.urgency === 'low' ? '低' : '通常';
  document.getElementById('viewUrgency').textContent = urgencyText;

  let statusText = c.status === 'open' ? '未着手' : c.status === 'in_progress' ? '対応中' : c.status === 'resolved' ? '解決済' : 'プロジェクト化';
  if (c.upgradedTo) statusText += ` → ${c.upgradedTo}`;
  document.getElementById('viewStatus').textContent = statusText;
  document.getElementById('viewDate').textContent = c.createdAt?.toDate().toLocaleDateString('ja-JP') || '';
  document.getElementById('viewDesc').textContent = c.desc || '説明なし';
  document.getElementById('detailTitle').textContent = c.title || '無題';

  // 填充编辑表单
  document.getElementById('editTitle').value = c.title || '';
  document.getElementById('editReporter').value = c.reporter || '';
  document.getElementById('editUrgency').value = c.urgency || 'normal';
  // 状态选择（upgraded 不可再编辑）
  const editStatus = document.getElementById('editStatus');
  if (c.status === 'upgraded') {
    editStatus.innerHTML = '<option value="upgraded" selected>プロジェクト化</option>';
    editStatus.disabled = true;
  } else {
    editStatus.innerHTML = `
      <option value="open" ${c.status === 'open' ? 'selected' : ''}>未着手</option>
      <option value="in_progress" ${c.status === 'in_progress' ? 'selected' : ''}>対応中</option>
      <option value="resolved" ${c.status === 'resolved' ? 'selected' : ''}>解決済</option>
    `;
    editStatus.disabled = false;
  }
  document.getElementById('editDesc').value = c.desc || '';

  document.getElementById('viewMode').style.display = 'block';
  document.getElementById('editMode').style.display = 'none';
  document.getElementById('editToggleBtn').style.display = 'inline-block';
  document.getElementById('saveEditBtn').style.display = 'none';

  // 升级区域
  const upgradeSection = document.getElementById('upgradeSection');
  if (!c.upgradedTo && c.status !== 'resolved' && c.status !== 'upgraded' && hasAdminPermission()) {
    upgradeSection.style.display = 'block';
  } else {
    upgradeSection.style.display = 'none';
  }
  document.getElementById('upgradeResult').innerHTML = '';

  // 权限控制
  const adminActions = document.getElementById('adminActions');
  if (hasAdminPermission() && c.status !== 'upgraded') {
    adminActions.style.display = 'block';
  } else {
    adminActions.style.display = 'none';
  }

  detailModal.show();
}

// ========== 事件绑定 ==========
function attachEvents() {
  // 新建按钮
  document.getElementById('addCaseBtn').addEventListener('click', () => {
    document.getElementById('caseTitle').value = '';
    document.getElementById('caseDesc').value = '';
    const reporterSelect = document.getElementById('caseReporter');
    reporterSelect.innerHTML = allMembers.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
    createModal.show();
  });

  // 保存 Case
  document.getElementById('saveCaseBtn').addEventListener('click', async () => {
    const title = document.getElementById('caseTitle').value.trim();
    if (!title) { alert('件名を入力してください。'); return; }
    const reporter = document.getElementById('caseReporter').value;
    const urgency = document.getElementById('caseUrgency').value;
    const desc = document.getElementById('caseDesc').value.trim();

    const newCase = {
      title, reporter, urgency, desc,
      status: 'open',
      upgradedTo: null,
      createdAt: serverTimestamp()
    };
    const docRef = await addDoc(collection(db, 'cases'), newCase);
    newCase.id = docRef.id;
    allCases.unshift(newCase);
    createModal.hide();
    renderList();
  });

  // 过滤
  document.getElementById('filterStatus').addEventListener('change', renderList);

  // 编辑切换
  document.getElementById('editToggleBtn').addEventListener('click', () => {
    document.getElementById('viewMode').style.display = 'none';
    document.getElementById('editMode').style.display = 'block';
    document.getElementById('editToggleBtn').style.display = 'none';
    document.getElementById('saveEditBtn').style.display = 'inline-block';
    document.getElementById('upgradeSection').style.display = 'none';
  });

  // 保存编辑
  document.getElementById('saveEditBtn').addEventListener('click', async () => {
    if (!currentCase) return;
    const title = document.getElementById('editTitle').value.trim();
    const reporter = document.getElementById('editReporter').value;
    const urgency = document.getElementById('editUrgency').value;
    const status = document.getElementById('editStatus').value;
    const desc = document.getElementById('editDesc').value.trim();

    await updateDoc(doc(db, 'cases', currentCase.id), { title, reporter, urgency, status, desc });

    currentCase.title = title;
    currentCase.reporter = reporter;
    currentCase.urgency = urgency;
    currentCase.status = status;
    currentCase.desc = desc;

    openDetailModal(currentCase);
    renderList();
  });

  // 升级为 Project
  document.getElementById('upgradeToProjectBtn').addEventListener('click', async () => {
    if (!currentCase || !hasAdminPermission()) return;
    const projectName = (currentCase.title || '無題') + '（プロジェクト）';

    try {
      // 1. 创建 Project
      const projectRef = await addDoc(collection(db, 'projects'), {
        name: projectName,
        owner: currentCase.reporter || '未定',
        desc: currentCase.desc || '',
        status: 'active',
        createdAt: serverTimestamp()
      });

      // 2. 创建初始 Task
      await addDoc(collection(db, 'tasks'), {
        title: currentCase.title || '無題',
        assignee: currentCase.reporter || '未定',
        project: projectName,
        status: 'in_progress',
        dueDate: null,
        desc: currentCase.desc || '',
        createdAt: serverTimestamp()
      });

      // 3. 更新 Case 状态
      await updateDoc(doc(db, 'cases', currentCase.id), {
        status: 'upgraded',
        upgradedTo: projectName
      });

      // 4. 更新本地数据
      currentCase.status = 'upgraded';
      currentCase.upgradedTo = projectName;
      const idx = allCases.findIndex(c => c.id === currentCase.id);
      if (idx >= 0) {
        allCases[idx].status = 'upgraded';
        allCases[idx].upgradedTo = projectName;
      }

      // 5. 刷新显示
      document.getElementById('upgradeResult').innerHTML = `<span class="text-success">✅ プロジェクト「${projectName}」を作成しました。</span>`;
      document.getElementById('upgradeSection').style.display = 'none';
      document.getElementById('adminActions').style.display = 'none';
      document.getElementById('viewStatus').textContent = 'プロジェクト化 → ' + projectName;
      renderList();
    } catch (e) {
      console.error('プロジェクト化失敗:', e);
      document.getElementById('upgradeResult').innerHTML = '<span class="text-danger">プロジェクト化に失敗しました。</span>';
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}