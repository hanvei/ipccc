(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const ui = {
    fileInput: $('#fileInput'), chooseFile: $('#chooseFile'), dropArea: $('#dropArea'),
    dropZone: $('#dropZone'), sampleButton: $('#sampleButton'), fileState: $('#fileState'),
    emptyState: $('#emptyState'), fieldList: $('#fieldList'), fieldCount: $('#fieldCount'),
    editorHint: $('#editorHint'), searchInput: $('#searchInput'), resetButton: $('#resetButton'),
    summaryEmpty: $('#summaryEmpty'), summaryBody: $('#summaryBody'), summaryName: $('#summaryName'),
    summarySize: $('#summarySize'), summaryFields: $('#summaryFields'), summaryChanges: $('#summaryChanges'),
    exportPreview: $('#exportPreview'), diffButton: $('#diffButton'), exportButton: $('#exportButton'),
    rawPreview: $('#rawPreview'), rawText: $('#rawText'), rawToggle: $('#rawToggle'), toast: $('#toast'),
    diffDialog: $('#diffDialog'), diffList: $('#diffList'), helpDialog: $('#helpDialog')
  };

  let original = null;
  let current = null;
  let fileName = '';
  let fileBytes = 0;
  let toastTimer = 0;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
  const encodePath = (path) => JSON.stringify(path);
  const prettySize = (size) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(2)} MB`;

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2600);
  }

  function elementChildren(node) { return [...node.children].filter((child) => child.nodeType === 1); }

  function parseNode(node, depth = 0) {
    if (depth > 64) throw new Error('plist 嵌套层级过深');
    const tag = node.tagName;
    if (tag === 'dict') {
      const children = elementChildren(node);
      if (children.length % 2 !== 0) throw new Error('dict 中有未配对的 key/value');
      const result = {};
      for (let i = 0; i < children.length; i += 2) {
        if (children[i].tagName !== 'key') throw new Error('dict 中缺少 key 标签');
        const key = children[i].textContent;
        Object.defineProperty(result, key, {
          value: parseNode(children[i + 1], depth + 1),
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
      return result;
    }
    if (tag === 'array') return elementChildren(node).map((child) => parseNode(child, depth + 1));
    if (tag === 'string' || tag === 'key') return node.textContent;
    if (tag === 'integer') {
      const parsed = Number.parseInt(node.textContent.trim(), 10);
      if (!Number.isFinite(parsed)) throw new Error(`整数格式无效：${node.textContent}`);
      return parsed;
    }
    if (tag === 'real') {
      const parsed = Number.parseFloat(node.textContent.trim());
      if (!Number.isFinite(parsed)) throw new Error(`数字格式无效：${node.textContent}`);
      return parsed;
    }
    if (tag === 'true') return true;
    if (tag === 'false') return false;
    if (tag === 'date' || tag === 'data') return { __plistType: tag, value: node.textContent.trim() };
    throw new Error(`暂不支持 plist 类型：<${tag}>`);
  }

  function parsePlist(xmlText) {
    const document = new DOMParser().parseFromString(xmlText, 'application/xml');
    const parseError = document.querySelector('parsererror');
    if (parseError) throw new Error('文件不是有效的 XML，请确认它是 XML 格式 plist（不是二进制 plist）。');
    const root = document.documentElement;
    if (!root || root.tagName !== 'plist') throw new Error('没有找到 plist 根标签。');
    const values = elementChildren(root);
    if (values.length !== 1) throw new Error('plist 中应当只有一个根数据对象。');
    const result = parseNode(values[0]);
    if (!result || Array.isArray(result) || typeof result !== 'object' || result.__plistType) throw new Error('目前只支持以 dict 字典为根的 plist。');
    return result;
  }

  function plistNode(value, depth = 0) {
    const pad = '  '.repeat(depth);
    if (value && typeof value === 'object' && value.__plistType) return `${pad}<${value.__plistType}>${esc(value.value)}</${value.__plistType}>`;
    if (typeof value === 'string') return `${pad}<string>${esc(value)}</string>`;
    if (typeof value === 'boolean') return `${pad}<${value ? 'true/>' : 'false/>'}`;
    if (typeof value === 'number') return `${pad}<${Number.isInteger(value) ? 'integer' : 'real'}>${value}</${Number.isInteger(value) ? 'integer' : 'real'}>`;
    if (Array.isArray(value)) {
      const inner = value.map((item) => plistNode(item, depth + 1)).join('\n');
      return `${pad}<array>${inner ? `\n${inner}\n${pad}` : ''}</array>`;
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value).flatMap(([key, item]) => [`${'  '.repeat(depth + 1)}<key>${esc(key)}</key>`, plistNode(item, depth + 1)]).join('\n');
      return `${pad}<dict>${entries ? `\n${entries}\n${pad}` : ''}</dict>`;
    }
    throw new Error('遇到无法导出的数据类型。');
  }

  function serializePlist(value) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plistNode(value, 1)}\n</plist>\n`;
  }

  function leaves(value, path = [], result = []) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => leaves(item, [...path, index], result));
    } else if (value && typeof value === 'object' && !value.__plistType) {
      Object.entries(value).forEach(([key, item]) => leaves(item, [...path, key], result));
    } else {
      result.push({ path, value });
    }
    return result;
  }

  function getAtPath(root, path) { return path.reduce((value, key) => value[key], root); }
  function setAtPath(root, path, value) {
    const parent = path.slice(0, -1).reduce((node, key) => node[key], root);
    parent[path[path.length - 1]] = value;
  }
  function displayValue(value) {
    if (value && typeof value === 'object' && value.__plistType) return value.value;
    if (typeof value === 'boolean') return value ? '是 / true' : '否 / false';
    return String(value);
  }
  function typeName(value) {
    if (value && typeof value === 'object' && value.__plistType) return value.__plistType;
    if (typeof value === 'boolean') return '布尔';
    if (typeof value === 'number') return Number.isInteger(value) ? '整数' : '数字';
    return '文本';
  }
  function isEditable(value) { return !(value && typeof value === 'object' && value.__plistType); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function changes() {
    if (!original || !current) return [];
    const oldMap = new Map(leaves(original).map((item) => [encodePath(item.path), item]));
    return leaves(current).flatMap((item) => {
      const before = oldMap.get(encodePath(item.path));
      return before && !same(before.value, item.value) ? [{ ...item, before: before.value }] : [];
    });
  }

  function fieldMatches(item, query) {
    if (!query) return true;
    const path = item.path.map(String).join(' › ');
    return `${path} ${displayValue(item.value)}`.toLowerCase().includes(query.toLowerCase());
  }

  function renderFields() {
    if (!current) return;
    const all = leaves(current);
    const query = ui.searchInput.value.trim();
    const visible = all.filter((item) => fieldMatches(item, query));
    const changedPaths = new Set(changes().map((item) => encodePath(item.path)));
    ui.fieldCount.textContent = `${all.filter((item) => isEditable(item.value)).length} 个字段`;
    ui.editorHint.textContent = `${changes().length ? `已修改 ${changes().length} 项。` : '修改只作用于待导出的副本。'} 点击任意可编辑值即可更改。`;
    ui.fieldList.hidden = false;
    ui.emptyState.hidden = true;
    ui.fieldList.innerHTML = visible.length ? visible.map((item) => {
      const pathKey = encodePath(item.path);
      const changed = changedPaths.has(pathKey);
      const label = String(item.path[item.path.length - 1] ?? '(根)');
      const fullPath = item.path.map(String).join(' › ');
      const value = displayValue(item.value);
      const control = typeof item.value === 'boolean'
        ? `<select data-path="${esc(pathKey)}" ${changed ? 'class="changed"' : ''}><option value="true" ${item.value ? 'selected' : ''}>是 / true</option><option value="false" ${!item.value ? 'selected' : ''}>否 / false</option></select>`
        : isEditable(item.value)
          ? `<input type="${typeof item.value === 'number' ? 'number' : 'text'}" data-path="${esc(pathKey)}" data-type="${typeof item.value === 'number' ? (Number.isInteger(item.value) ? 'integer' : 'real') : 'string'}" value="${esc(value)}" ${changed ? 'class="changed"' : ''} aria-label="编辑 ${esc(fullPath)}">`
          : `<input type="text" value="${esc(value)}" disabled title="日期和 data 保持原样">`;
      return `<div class="field-row"><div class="field-key"><b title="${esc(fullPath)}">${esc(label)}</b><small>${esc(fullPath)}</small></div><div class="field-control">${control}<span class="type-tag">${typeName(item.value)}</span>${changed ? '<span class="change-mark">已改</span>' : ''}</div></div>`;
    }).join('') : '<div class="no-results">没有匹配的字段</div>';
    ui.rawPreview.hidden = false;
    ui.rawText.textContent = JSON.stringify(current, null, 2);
    updateSummary();
  }

  function updateSummary() {
    const all = leaves(current);
    const editableCount = all.filter((item) => isEditable(item.value)).length;
    const changedCount = changes().length;
    ui.summaryEmpty.hidden = true;
    ui.summaryBody.hidden = false;
    ui.summaryName.textContent = fileName;
    ui.summarySize.textContent = prettySize(fileBytes);
    ui.summaryFields.textContent = String(editableCount);
    ui.summaryChanges.textContent = String(changedCount);
    ui.exportPreview.classList.toggle('ready', changedCount > 0);
    ui.exportPreview.innerHTML = changedCount
      ? `<div class="preview-icon">✓</div><div><b>有 ${changedCount} 项修改待导出</b><small>原文件未改变，导出会生成新副本。</small></div>`
      : '<div class="preview-icon">⇩</div><div><b>配置已就绪</b><small>目前没有修改；可先编辑字段再导出。</small></div>';
    ui.diffButton.disabled = false;
    ui.exportButton.disabled = false;
    ui.resetButton.disabled = false;
    ui.searchInput.disabled = false;
  }

  function renderLoaded(data, name, size) {
    original = clone(data);
    current = clone(data);
    fileName = name;
    fileBytes = size;
    ui.fileState.hidden = false;
    ui.fileState.innerHTML = `<span class="file-icon">PL</span><span><b>${esc(name)}</b><small>${prettySize(size)} · XML plist 已读取</small></span><button id="removeFile" aria-label="清除文件">×</button>`;
    $('#removeFile').addEventListener('click', clearFile);
    renderFields();
    showToast('配置已在本地打开');
  }

  async function loadFile(file) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return showToast('文件超过 15 MB，请选择较小的 plist。');
    try {
      const text = await file.text();
      const parsed = parsePlist(text);
      renderLoaded(parsed, file.name, file.size);
      ui.fileInput.value = '';
    } catch (error) {
      showToast(error instanceof Error ? error.message : '读取失败');
    }
  }

  function clearFile() {
    original = current = null;
    fileName = '';
    fileBytes = 0;
    ui.fileState.hidden = true;
    ui.fieldList.hidden = true;
    ui.fieldList.innerHTML = '';
    ui.rawPreview.hidden = true;
    ui.emptyState.hidden = false;
    ui.summaryEmpty.hidden = false;
    ui.summaryBody.hidden = true;
    ui.fieldCount.textContent = '等待导入';
    ui.editorHint.textContent = '导入文件后，这里会显示可以查看和编辑的字段。';
    ui.searchInput.value = '';
    ui.searchInput.disabled = true;
    ui.resetButton.disabled = true;
    ui.diffButton.disabled = true;
    ui.exportButton.disabled = true;
    ui.exportPreview.classList.remove('ready');
    ui.exportPreview.innerHTML = '<div class="preview-icon">⇩</div><div><b>尚无可导出的配置</b><small>导入后可以预览差异并保存副本。</small></div>';
  }

  function sampleData() {
    return {
      CarrierName: '示例运营商',
      MCC: '460',
      MNC: '00',
      SupportedSIMs: ['SIM1', 'SIM2'],
      APN: 'internet.example',
      IMSConfig: { VoLTEEnabled: true, VoNRAllowed: false, IMSDomain: 'ims.example' },
      ProfileVersion: 1,
      Notes: '这是一份演示数据，不对应真实运营商。'
    };
  }

  function formatValue(value) { return value === '' ? '(空)' : displayValue(value); }
  function showDiff() {
    const list = changes();
    ui.diffList.innerHTML = list.length ? list.map((item) => `<div class="diff-item"><b>${esc(item.path.map(String).join(' › '))}</b><div class="diff-values"><div><span>原值</span><code>${esc(formatValue(item.before))}</code></div><div class="after"><span>新值</span><code>${esc(formatValue(item.value))}</code></div></div></div>`).join('') : '<div class="no-changes">目前没有字段被修改。你仍可以导出一份新的 XML plist 副本。</div>';
    ui.diffDialog.showModal();
  }

  function exportPlist() {
    if (!current) return;
    try {
      const xml = serializePlist(current);
      const base = fileName.replace(/\.(plist|xml)$/i, '') || 'carrier-profile';
      const exportName = `${base}-edited.plist`;
      const nativeExporter = window.webkit?.messageHandlers?.exportPlist;
      if (nativeExporter) {
        nativeExporter.postMessage({ filename: exportName, content: xml });
        showToast('已准备好 plist，请在系统分享菜单中保存');
        return;
      }
      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = exportName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      showToast('已导出新的 plist 文件');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导出失败');
    }
  }

  ui.chooseFile.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (event) => loadFile(event.target.files?.[0]));
  ui.sampleButton.addEventListener('click', () => {
    const data = sampleData();
    const bytes = new Blob([serializePlist(data)]).size;
    renderLoaded(data, '示例运营商.plist', bytes);
  });
  ui.searchInput.addEventListener('input', renderFields);
  ui.resetButton.addEventListener('click', () => { if (!original) return; current = clone(original); renderFields(); showToast('已还原为导入时的内容'); });
  ui.fieldList.addEventListener('change', (event) => {
    const input = event.target;
    if (!input.dataset.path) return;
    const path = JSON.parse(input.dataset.path);
    const previous = getAtPath(current, path);
    if (input.tagName === 'SELECT') setAtPath(current, path, input.value === 'true');
    else if (input.dataset.type === 'integer') {
      const parsed = Number.parseInt(input.value, 10);
      if (!Number.isFinite(parsed)) return showToast('请输入有效整数');
      setAtPath(current, path, parsed);
    } else if (input.dataset.type === 'real') {
      const parsed = Number.parseFloat(input.value);
      if (!Number.isFinite(parsed)) return showToast('请输入有效数字');
      setAtPath(current, path, parsed);
    } else setAtPath(current, path, input.value);
    if (!same(previous, getAtPath(current, path))) renderFields();
  });
  ui.fieldList.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('input[data-path]')) event.target.blur();
  });
  ui.diffButton.addEventListener('click', showDiff);
  ui.exportButton.addEventListener('click', exportPlist);
  $('#exportFromDiff').addEventListener('click', exportPlist);
  $('#closeDiff').addEventListener('click', () => ui.diffDialog.close());
  $('#closeDiffBottom').addEventListener('click', () => ui.diffDialog.close());
  $('#helpButton').addEventListener('click', () => ui.helpDialog.showModal());
  $('#closeHelp').addEventListener('click', () => ui.helpDialog.close());
  $('#closeHelpBottom').addEventListener('click', () => ui.helpDialog.close());
  $('#noticeClose').addEventListener('click', () => $('.notice').remove());
  ui.rawToggle.addEventListener('click', () => { ui.rawToggle.classList.toggle('open'); ui.rawPreview.classList.toggle('expanded'); });
  for (const eventName of ['dragenter', 'dragover']) ui.dropArea.addEventListener(eventName, (event) => { event.preventDefault(); ui.dropArea.classList.add('dragging'); });
  for (const eventName of ['dragleave', 'drop']) ui.dropArea.addEventListener(eventName, (event) => { event.preventDefault(); ui.dropArea.classList.remove('dragging'); });
  ui.dropArea.addEventListener('drop', (event) => loadFile(event.dataTransfer?.files?.[0]));
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => event.preventDefault());
})();
