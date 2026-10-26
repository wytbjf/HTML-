import { formatSource, decodeFile, encodeFile } from './core.js';
import { zipSync } from 'fflate';

const $ = id => document.getElementById(id);
const files = [];
let selected = null, running = false;
const bytesLabel = n => n < 1024 ? n + ' B' : n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';
const announce = message => { $('notice').textContent = message; };
const make = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function downloadable() { return files.filter(f => f.result && f.outputBytes); }

function choose(index) {
  selected = index;
  const file = files[index];
  if (!file) { $('preview').hidden = true; return; }
  $('preview').hidden = false;
  $('preview-title').textContent = file.name;
  $('original').value = file.original || '';
  $('formatted').value = file.result?.source || file.original || '';
  $('original-lines').textContent = (file.original ? file.original.split(/\r?\n/).length : 0) + ' 行';
  $('formatted-lines').textContent = (file.result?.formattedLines || (file.original ? file.original.split(/\r?\n/).length : 0)) + ' 行';
  $('file-checks').replaceChildren();
  for (const check of file.result?.checks || []) $('file-checks').append(make('span', '✓ ' + check, 'check-chip'));
  const notes = file.result?.notes || (file.error ? [file.error] : ['格式化后可在这里查看检查结果。']);
  $('file-notes').replaceChildren(...notes.map(note => make('p', note)));
  for (const tr of $('rows').children) tr.classList.toggle('selected', Number(tr.dataset.index) === index);
}

function render() {
  $('rows').replaceChildren();
  files.forEach((f, index) => {
    const tr = make('tr'); tr.dataset.index = String(index);
    const nameCell = make('td');
    const name = make('button', f.name, 'file-name'); name.type = 'button'; name.onclick = () => choose(index);
    nameCell.append(name, make('small', f.relativePath !== f.name ? f.relativePath : bytesLabel(f.size)));
    const status = f.error ? ['读取失败', 'error'] : !f.result ? ['待处理', 'pending'] : !f.result.safe ? ['保留原样', 'warning'] : f.result.changed ? ['已格式化', 'success'] : ['无需调整', 'neutral'];
    const statusCell = make('td'); statusCell.append(make('span', status[0], 'badge ' + status[1]));
    const lineCell = make('td', f.result ? `${f.result.originalLines} → ${f.result.formattedLines}` : '—', 'line-count');
    const checkCell = make('td', f.result?.safe ? '0 个非空白字符变化' : f.result ? '已回退至原内容' : '等待检查', 'validation');
    const actionCell = make('td');
    const view = make('button', '查看', 'text-button'); view.type = 'button'; view.onclick = () => choose(index);
    const save = make('button', '下载副本', 'text-button'); save.type = 'button'; save.disabled = !f.outputBytes; save.onclick = () => download(new Blob([f.outputBytes], { type: 'text/html' }), f.name);
    const remove = make('button', '移除', 'text-button muted'); remove.type = 'button'; remove.disabled = running; remove.onclick = () => { files.splice(index, 1); selected = null; $('preview').hidden = true; render(); };
    actionCell.append(view, save, remove); tr.append(nameCell, statusCell, lineCell, checkCell, actionCell); $('rows').append(tr);
  });
  $('file-count').textContent = String(files.length);
  $('done-count').textContent = String(files.filter(f => f.result?.safe).length);
  $('keep-count').textContent = String(files.filter(f => f.result && !f.result.safe).length);
  $('empty').hidden = files.length > 0;
  $('table-wrap').hidden = files.length === 0;
  $('format').disabled = running || !files.some(f => !f.error);
  $('download-all').disabled = running || !downloadable().length;
  $('clear').disabled = running || !files.length;
  $('pick').disabled = running;
  $('pick-folder').disabled = running;
  $('vue-option').disabled = running;
  $('format').textContent = running ? '正在格式化…' : '开始格式化';
  if (selected != null && files[selected]) choose(selected);
}

async function addFiles(chosen) {
  if (running) return;
  let count = 0, invalid = 0;
  for (const file of chosen) {
    if (!/\.html?$/i.test(file.name)) { invalid++; continue; }
    const relativePath = (file.webkitRelativePath || file.name).split('/').filter(p => p && p !== '.' && p !== '..').join('/');
    const f = { name: file.name, relativePath, size: file.size, lastModified: file.lastModified };
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('此文件超过 10 MB。请拆分后再处理，以避免浏览器内存占用过高。');
      f.originalBytes = new Uint8Array(await file.arrayBuffer());
      f.decoded = decodeFile(f.originalBytes);
      f.original = f.decoded.source;
    } catch (e) { f.error = e instanceof TypeError ? '文件无法按 UTF-8 读取。请先另存为 UTF-8 后再导入。' : e.message; }
    if (f.originalBytes && files.some(other => other.relativePath === relativePath && other.originalBytes?.length === f.originalBytes.length && other.originalBytes.every((byte, i) => byte === f.originalBytes[i]))) continue;
    files.push(f); count++;
  }
  announce(`已添加 ${count} 个 HTML 文件。` + (invalid ? ` 已忽略 ${invalid} 个其他类型的文件。` : ''));
  render();
}

async function run() {
  if (running) return;
  running = true; render();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.error) continue;
    announce(`正在处理 ${i + 1}/${files.length}：${f.name}`);
    await new Promise(resolve => setTimeout(resolve, 15));
    f.result = formatSource(f.original, { formatVue: $('vue-option').checked });
    f.outputBytes = f.result.changed ? encodeFile(f.result.source, f.decoded) : f.originalBytes;
    render();
  }
  running = false; render();
  const kept = files.filter(f => f.result && !f.result.safe).length;
  announce(`处理完成：${files.filter(f => f.result?.safe).length} 个文件通过检查` + (kept ? `，${kept} 个文件保留原样` : '') + '。原文件未被修改。');
  if (files.some(f => f.result)) choose(files.findIndex(f => f.result));
}

function exportZip() {
  const entries = Object.create(null), used = new Set();
  for (const f of downloadable()) {
    let name = f.relativePath;
    let index = 2;
    while (used.has(name.toLowerCase())) name = f.relativePath.replace(/(\.html?)$/i, ` (${index++})$1`);
    used.add(name.toLowerCase()); entries[name] = f.outputBytes;
  }
  if (!used.size) return;
  const zip = zipSync(entries, { level: 6 });
  download(new Blob([zip], { type: 'application/zip' }), 'HTML_格式化副本.zip');
  announce(`已生成包含 ${used.size} 个 HTML 副本的压缩包。下载后请解压到单独文件夹。`);
}

$('pick').onclick = () => $('files').click();
$('pick-folder').onclick = () => $('folder').click();
$('files').onchange = async e => { await addFiles(e.target.files); e.target.value = ''; };
$('folder').onchange = async e => { await addFiles(e.target.files); e.target.value = ''; };
$('format').onclick = run;
$('download-all').onclick = exportZip;
$('clear').onclick = () => { files.length = 0; selected = null; $('preview').hidden = true; announce('文件列表已清空。'); render(); };
for (const event of ['dragenter', 'dragover']) $('dropzone').addEventListener(event, e => { e.preventDefault(); $('dropzone').classList.add('dragging'); });
for (const event of ['dragleave', 'drop']) $('dropzone').addEventListener(event, e => { e.preventDefault(); $('dropzone').classList.remove('dragging'); });
$('dropzone').addEventListener('drop', e => addFiles(e.dataTransfer.files));
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => e.preventDefault());
$('copy').onclick = async () => {
  if (selected == null || !files[selected]?.result) return;
  try {
    await navigator.clipboard.writeText(files[selected].result.source);
    announce('已复制当前副本代码。');
  } catch {
    $('formatted').focus(); $('formatted').select();
    announce('代码已选中，请按 Ctrl+C 复制。');
  }
};
let syncingScroll = false;
for (const [a, b] of [[$('original'), $('formatted')], [$('formatted'), $('original')]]) {
  a.addEventListener('scroll', () => {
    if (!$('sync-scroll').checked || syncingScroll) return;
    syncingScroll = true;
    const ratio = a.scrollTop / Math.max(1, a.scrollHeight - a.clientHeight);
    b.scrollTop = ratio * (b.scrollHeight - b.clientHeight);
    requestAnimationFrame(() => { syncingScroll = false; });
  });
}
// Pure data API for local automated checks. It never executes imported HTML.
globalThis.HTMLFormatter = Object.freeze({ formatSource, decodeFile, encodeFile });
render();
