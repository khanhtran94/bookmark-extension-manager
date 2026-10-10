(function () {
  const panel = document.getElementById('sheetsPanel');
  const label = document.getElementById('sheetsStatus');
  const input = document.getElementById('sheetsUrl');
  const link = document.getElementById('sheetsLink');
  let busy = false;
  async function refresh() {
    const { sheetsConfig: config, sheetsStatus: status } = await chrome.storage.local.get(['sheetsConfig', 'sheetsStatus']);
    const { pending } = await BookmarkDB.snapshot();
    if (input && config?.id && !input.value) input.value = `https://docs.google.com/spreadsheets/d/${config.id}/edit`;
    if (link) {
      link.hidden = !config?.id;
      if (config?.id) link.href = `https://docs.google.com/spreadsheets/d/${config.id}/edit`;
    }
    let text = 'Chưa kết nối Google Sheets — dữ liệu chỉ lưu trên máy.';
    if (config?.enabled) {
      if (status?.state === 'syncing') text = 'Đang đồng bộ Google Sheets…';
      else if (status?.state === 'error') text = `Chưa đồng bộ: ${status.message}`;
      else if (pending.length) text = `Chờ đồng bộ ${pending.length} thay đổi.`;
      else if (status?.lastSync) text = `Đã đồng bộ: ${new Date(status.lastSync).toLocaleString('vi-VN')}`;
      else text = 'Chờ đồng bộ Google Sheets.';
    } else if (config?.id) text = 'Đã tạm dừng đồng bộ. Thay đổi mới chỉ lưu trên máy.';
    if (label) label.textContent = text;
  }
  async function command(type) {
    if (busy) return;
    busy = true;
    const buttons = panel?.querySelectorAll('button') || [];
    buttons.forEach(button => { button.disabled = true; });
    try {
      label.textContent = 'Đang xử lý…';
      const result = await chrome.runtime.sendMessage({ type, sheet: input?.value, manual: true });
      if (!result?.ok) throw new Error(result?.error || 'Không thể kết nối service worker.');
      await refresh();
    } catch (error) { label.textContent = error.message; }
    finally {
      busy = false;
      buttons.forEach(button => { button.disabled = false; });
    }
  }
  document.getElementById('sheetsConnect')?.addEventListener('click', () => command('sheets-connect'));
  document.getElementById('sheetsNow')?.addEventListener('click', () => command('sheets-sync'));
  document.getElementById('sheetsPause')?.addEventListener('click', () => command('sheets-pause'));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.sheetsStatus || changes.sheetsConfig)) refresh().catch(() => {});
  });
  window.addEventListener('bookmark-local-change', () => refresh().catch(() => {}));
  window.addEventListener('online', () => chrome.runtime.sendMessage({ type: 'sheets-sync' }).catch(() => {}));
  refresh().catch(error => { if (label) label.textContent = `Không đọc được cache: ${error.message}`; });
  chrome.runtime.sendMessage({ type: 'sheets-sync' }).catch(() => {});
})();
