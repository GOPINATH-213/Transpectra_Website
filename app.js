// public/app.js
const dropArea = document.getElementById('drop-area');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const preview = document.getElementById('preview');
const processBtn = document.getElementById('processBtn');
const status = document.getElementById('status');
const displayDate = document.getElementById('displayDate');
const datePicker = document.getElementById('datePicker');
const submitBtn = document.getElementById('submitBtn');
const routesTbody = document.querySelector('#routesTable tbody');

const modal = document.getElementById('modal');
const mNo = document.getElementById('mNo');
const mBus = document.getElementById('mBus');
const mRoute = document.getElementById('mRoute');
const mTime = document.getElementById('mTime');
const saveBtn = document.getElementById('saveBtn');
const deleteBtn = document.getElementById('deleteBtn');
const closeBtn = document.getElementById('closeBtn');
const toast = document.getElementById('toast');

let droppedFiles = [];    // actual File objects
let extractedDate = null;
let routes = [];          // array of {no,bus,route,time}
let editingRowIndex = null;

// Drag & drop
['dragenter','dragover'].forEach(ev => {
  dropArea.addEventListener(ev, (e) => { e.preventDefault(); dropArea.classList.add('dragover'); });
});
['dragleave','drop'].forEach(ev => {
  dropArea.addEventListener(ev, (e) => { e.preventDefault(); dropArea.classList.remove('dragover'); });
});

dropArea.addEventListener('drop', (e) => {
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (files.length) addFiles(files);
});
browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
  if (files.length) addFiles(files);
});

function addFiles(files) {
  for (const f of files) {
    droppedFiles.push(f);
    const url = URL.createObjectURL(f);
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.innerHTML = `<img src="${url}" alt="${escapeHtml(f.name)}" /><button class="remove-btn">Remove</button>`;
    item.querySelector('.remove-btn').addEventListener('click', () => {
      preview.removeChild(item);
      droppedFiles = droppedFiles.filter(x => x !== f);
      processBtn.disabled = droppedFiles.length === 0;
    });
    preview.appendChild(item);
  }
  processBtn.disabled = droppedFiles.length === 0;
  showStatus(`${droppedFiles.length} image(s) ready`);
}

processBtn.addEventListener('click', async () => {
  if (droppedFiles.length === 0) return showToast('No images selected');
  processBtn.disabled = true;
  showStatus('Uploading and extracting...');
  try {
    const fd = new FormData();
    for (const f of droppedFiles) fd.append('images', f, f.name);

    const res = await fetch('/Auth/upload', { method: 'POST', body: fd });
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(body.error || 'Extraction failed');

    // body.extracted is an array (we return single parsed JSON from server; keep unified handling)
    const parsed = body.extracted && body.extracted.length ? body.extracted[0] : null;
    if (parsed && parsed.date) {
      extractedDate = parsed.date;
      displayDate.textContent = extractedDate;
      datePicker.value = extractedDate;
    } else {
      displayDate.textContent = '-';
      datePicker.value = '';
      extractedDate = null;
    }

    // append parsed routes
    appendRoutes(parsed?.routes || []);
    showToast('Extraction finished');
    submitBtn.disabled = routes.length === 0 || !extractedDate;
  } catch (err) {
    console.error(err);
    showToast('Extraction failed: ' + (err.message || err));
  } finally {
    processBtn.disabled = false;
    showStatus('');
  }
});

function appendRoutes(newRoutes) {
  for (const r of newRoutes) {
    const no = r.no || String(routes.length + 1);
    routes.push({ no, bus: r.bus || '', route: r.route || '', time: convertTo24(r.time) || '' });
  }
  renderTable();
}

function convertTo24(timeStr) {
  if (!timeStr) return "";
  let s = timeStr.trim();

  // If input already has AM/PM, just normalize it
  const ampmMatch = s.match(/\b([AaPp][Mm])\b/);
  if (ampmMatch) {
    let [h, m] = s.replace(/\s*[AaPp][Mm]\b/, "").split(":").map(x => parseInt(x, 10));
    if (isNaN(h) || isNaN(m)) return timeStr;
    let period = ampmMatch[1]
    h = h % 12; // keep within 1–12 range
    if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2,"0")} ${period}`;
  }

  // If input is 24h (HH:mm), convert to 12h
  const [hRaw, mRaw] = s.split(":").map(x => parseInt(x, 10));
  if (isNaN(hRaw) || isNaN(mRaw)) return timeStr;

  let period = hRaw >= 12 ? "pm" : "am";
  let h = hRaw % 12;
  if (h === 0) h = 12;

  return `${h}:${String(mRaw).padStart(2,"0")} ${period}`;
}

function renderTable() {
  routesTbody.innerHTML = '';
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.no}</td>
      <td>${escapeHtml(r.bus)}</td>
      <td>${escapeHtml(r.route)}</td>
      <td>${escapeHtml(convertTo24(r.time))}</td>
      <td><button class="editBtn" data-index="${i}">Edit</button></td>
    `;
    routesTbody.appendChild(tr);
  }
  routesTbody.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', onEdit));
  routesTbody.querySelectorAll('.delBtn').forEach(b => b.addEventListener('click', onDelete));
}

function onEdit(e) {
  const idx = Number(e.currentTarget.dataset.index);
  editingRowIndex = idx;
  const r = routes[idx];
  mNo.value = r.no; mBus.value = r.bus; mRoute.value = r.route; mTime.value = r.time || '';
  modal.classList.remove('hidden');
}
function onDelete(e) {
  const idx = Number(e.currentTarget.dataset.index);
  if (!confirm('Delete this row?')) return;
  routes.splice(idx, 1);
  for (let i = 0; i < routes.length; i++) routes[i].no = String(i+1);
  renderTable();
  showToast('Row deleted');
  submitBtn.disabled = routes.length === 0 || !extractedDate;
}

// modal actions
saveBtn.addEventListener('click', () => {
  if (editingRowIndex == null) return;
  routes[editingRowIndex] = { no: mNo.value || String(editingRowIndex+1), bus: mBus.value.trim(), route: mRoute.value.trim(), time: mTime.value };
  routes.sort((a,b)=> Number(a.no) - Number(b.no));
  for (let i=0;i<routes.length;i++) routes[i].no = String(i+1);
  renderTable();
  modal.classList.add('hidden');
  showToast('Saved');
  submitBtn.disabled = routes.length === 0 || !extractedDate;
});
deleteBtn.addEventListener('click', () => {
  if (editingRowIndex == null) return;
  if (!confirm('Delete this row?')) return;
  routes.splice(editingRowIndex,1);
  for (let i=0;i<routes.length;i++) routes[i].no = String(i+1);
  renderTable();
  modal.classList.add('hidden');
  showToast('Deleted');
  submitBtn.disabled = routes.length === 0 || !extractedDate;
});
closeBtn.addEventListener('click', ()=> modal.classList.add('hidden'));

// date editing
displayDate.addEventListener('click', () => {
  datePicker.style.display = datePicker.style.display === 'inline-block' ? 'none' : 'inline-block';
  datePicker.focus();
});
datePicker.addEventListener('change', ()=> {
  extractedDate = datePicker.value;
  displayDate.textContent = extractedDate || '-';
  submitBtn.disabled = routes.length === 0 || !extractedDate;
});

// submit to Firestore
submitBtn.addEventListener('click', async () => {
  if (!extractedDate) return showToast('Set the date before submitting');
  if (routes.length === 0) return showToast('No routes to submit');
  submitBtn.disabled = true;
  showStatus('Submitting...');
  try {
    const res = await fetch('/Auth/submitRoutes', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ date: extractedDate, routes })
    });
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(body.error || 'Submit failed');
    showToast(body.message || 'Submitted successfully');
    // clear
    routes = []; renderTable();
    preview.innerHTML = ''; droppedFiles = []; displayDate.textContent = '-'; datePicker.value = ''; extractedDate = null;
    submitBtn.disabled = true;
  } catch (err) {
    console.error(err);
    showToast('Submit error: ' + (err.message || err));
  } finally {
    submitBtn.disabled = false; showStatus('');
  }
});

// helpers
function showStatus(t){ status.textContent = t || ''; }
function showToast(t){ toast.textContent = t; toast.classList.remove('hidden'); setTimeout(()=>toast.classList.add('hidden'),3000); }
function escapeHtml(s){return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
