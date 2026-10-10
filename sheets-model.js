(function (root) {
  const HEADER = ['operation_id', 'record_id', 'action', 'changed_at', 'title_or_name', 'url', 'data_json'];
  function rowsToEvents(kind, rows = []) {
    if (!rows.length) return [];
    if (JSON.stringify(rows[0]) !== JSON.stringify(HEADER))
      throw new Error(`Tab ${kind} không đúng định dạng Bookmark Manager. Hãy dùng bảng tính riêng.`);
    return rows.slice(1).filter(row => row.some(cell => cell !== '')).map(row => {
      const [op, id, action, at, , , json] = row;
      if (!op || !id || !['put', 'delete'].includes(action)) throw new Error('Lịch sử Sheets có dòng không hợp lệ.');
      const value = action === 'delete' ? null : JSON.parse(json);
      if (action === 'put' && (!value || typeof value !== 'object' || Array.isArray(value) || value.id !== id || (kind === 'bookmarks'
        ? typeof value.url !== 'string' || !value.url || !Array.isArray(value.tags)
        : typeof value.name !== 'string'))) throw new Error('Dữ liệu Sheets không hợp lệ.');
      return { op, id, kind, at: Number(at), value };
    });
  }
  function toRow(event) {
    return [event.op, event.id, event.value ? 'put' : 'delete', String(event.at),
      event.value?.title || event.value?.name || '', event.value?.url || '',
      event.value ? JSON.stringify(event.value) : ''];
  }
  function materialize(events) {
    const seen = new Set();
    const maps = { bookmarks: new Map(), folders: new Map() };
    for (const event of events) {
      if (seen.has(event.op)) continue;
      seen.add(event.op);
      const map = maps[event.kind];
      map.delete(event.id);
      if (event.value) {
        if (event.kind === 'bookmarks') {
          for (const [id, value] of map) {
            if (value.url === event.value.url) map.delete(id);
          }
        }
        map.set(event.id, event.value);
      }
    }
    // Same URL created independently on two devices: last server event wins.
    return { bookmarks: [...maps.bookmarks.values()], folders: [...maps.folders.values()] };
  }
  root.SheetsModel = { HEADER, rowsToEvents, toRow, materialize };
  if (typeof module !== 'undefined') module.exports = root.SheetsModel;
})(globalThis);
