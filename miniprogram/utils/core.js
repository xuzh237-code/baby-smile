const STORAGE_KEYS = {
  records: 'baby_records_mp_v1',
  birth: 'baby_birth_info_mp_v1',
  collapse: 'baby_collapsed_mp_v1',
  wechatProfile: 'baby_wechat_profile_mp_v1'
};

const DEFAULT_BIRTH = {
  name: '宝宝',
  date: '2025-10-28',
  time: '00:30'
};

const CATEGORY_ORDER = ['喝奶', '排泄', '睡眠', '补剂'];
const CSV_COLUMNS = ['id', 'dateKey', 'date', 'cat', 'type', 'val', 'raw', 'icon', 'color', 'time', 'meta', 'createdAt', 'updatedAt'];

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function toDate(input = new Date()) {
  if (input instanceof Date) return new Date(input.getTime());
  if (typeof input === 'string') {
    const [year, month, day] = input.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
  }
  return new Date();
}

function getDateKey(input = new Date()) {
  const date = toDate(input);
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function parseDateKey(dateKey) {
  return toDate(dateKey);
}

function getDateLabelFromKey(dateKey) {
  const date = parseDateKey(dateKey);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function generateRecordId() {
  return `record-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function timeToMinutes(timeStr = '') {
  const [hh, mm] = String(timeStr).split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return 0;
  return hh * 60 + mm;
}

function getSpanMinutes(start, end, crossDay = false) {
  let diff = timeToMinutes(end) - timeToMinutes(start);
  if (crossDay || diff < 0) diff += 1440;
  return diff;
}

function isNightSleep(start, end, cross) {
  if (cross) return true;
  if (!start || !end) return false;
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  return startMinutes >= 19 * 60 || endMinutes <= 9 * 60;
}

function getRelativeMinutesWithinSleep(sleepStart, sleepEnd, cross, target) {
  let relative = timeToMinutes(target) - timeToMinutes(sleepStart);
  if (relative < 0) relative += 1440;
  const total = getSpanMinutes(sleepStart, sleepEnd, cross);
  return { relative, total };
}

function buildSleepRecordData(start, end, cross, awakeStart = '', awakeEnd = '') {
  if (start.length < 5 || end.length < 5) return { error: '请填写时间' };
  let nextAwakeStart = awakeStart;
  let nextAwakeEnd = awakeEnd;
  if (!isNightSleep(start, end, cross)) {
    nextAwakeStart = '';
    nextAwakeEnd = '';
  }
  const hasAwakeStart = nextAwakeStart.length >= 5;
  const hasAwakeEnd = nextAwakeEnd.length >= 5;
  if (hasAwakeStart !== hasAwakeEnd) return { error: '请填写完整清醒时段' };

  const totalMinutes = getSpanMinutes(start, end, cross);
  let awakeMinutes = 0;

  if (hasAwakeStart && hasAwakeEnd) {
    const awakeStartInfo = getRelativeMinutesWithinSleep(start, end, cross, nextAwakeStart);
    const awakeEndInfo = getRelativeMinutesWithinSleep(start, end, cross, nextAwakeEnd);

    if (awakeStartInfo.relative >= totalMinutes) return { error: '清醒开始时间不在这段睡眠范围内' };
    if (awakeEndInfo.relative > totalMinutes) return { error: '清醒结束时间超出了这段睡眠范围' };
    if (awakeEndInfo.relative <= awakeStartInfo.relative) return { error: '清醒结束时间需要晚于清醒开始时间' };

    awakeMinutes = awakeEndInfo.relative - awakeStartInfo.relative;
    if (awakeMinutes >= totalMinutes) return { error: '清醒时段不能覆盖整段睡眠' };
  }

  const sleepHours = ((totalMinutes - awakeMinutes) / 60).toFixed(1);
  const awakeText = awakeMinutes > 0 ? ` · 清醒 ${nextAwakeStart}~${nextAwakeEnd}` : '';
  return {
    val: `${start} ~ ${end}${awakeText} (${sleepHours}h)`,
    raw: parseFloat(sleepHours),
    time: end,
    meta: { start, end, cross, awakeStart: nextAwakeStart, awakeEnd: nextAwakeEnd, awakeMinutes },
    type: cross ? '跨天睡眠' : '常规睡眠'
  };
}

function normalizeRecord(record) {
  const dateKey = record.dateKey || getDateKey(record.date || new Date());
  return {
    id: String(record.id || generateRecordId()),
    dateKey,
    date: record.date || getDateLabelFromKey(dateKey),
    cat: record.cat || '',
    type: record.type || '',
    val: record.val || '',
    raw: Number(record.raw) || 0,
    icon: record.icon || '',
    color: record.color || 'slate',
    time: record.time || '',
    meta: record.meta && typeof record.meta === 'object' ? record.meta : {},
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString()
  };
}

function sortRecordsByRecent(recordList = []) {
  return [...recordList].sort((a, b) => {
    const aDate = a.dateKey || getDateKey();
    const bDate = b.dateKey || getDateKey();
    if (aDate !== bDate) return bDate.localeCompare(aDate);
    if ((a.time || '') !== (b.time || '')) return (b.time || '').localeCompare(a.time || '');
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

function escapeCsvValue(value) {
  const text = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function parseCsvLine(line = '') {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function normalizeDateKeyValue(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    return `${year}-${padNumber(month)}-${padNumber(day)}`;
  }
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split('/').map(Number);
    return `${year}-${padNumber(month)}-${padNumber(day)}`;
  }
  return '';
}

function buildLegacyMeta(row = {}) {
  const meta = {};
  if (row.meta_start) meta.start = row.meta_start;
  if (row.meta_end) meta.end = row.meta_end;
  if (row.meta_awake_start) meta.awakeStart = row.meta_awake_start;
  if (row.meta_awake_end) meta.awakeEnd = row.meta_awake_end;
  if (row.meta_awake_minutes) meta.awakeMinutes = Number(row.meta_awake_minutes) || 0;
  if (row.meta_volume) meta.volume = Number(row.meta_volume) || 0;
  if (row.meta_cross) meta.cross = row.meta_cross === 'true' || row.meta_cross === '1';
  if (row.meta_time) meta.time = row.meta_time;
  return meta;
}

function recordsToCsv(recordList = []) {
  const rows = [CSV_COLUMNS.join(',')];
  sortRecordsByRecent(recordList).forEach(record => {
    const normalized = normalizeRecord(record);
    const row = CSV_COLUMNS.map(column => {
      const value = column === 'meta' ? JSON.stringify(normalized.meta || {}) : normalized[column];
      return escapeCsvValue(value);
    });
    rows.push(row.join(','));
  });
  return rows.join('\n');
}

function csvToRecords(csv = '') {
  const text = String(csv || '').trim();
  if (!text) return [];
  if (text.startsWith('[')) return JSON.parse(text).map(normalizeRecord);

  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(header => header.trim());
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    let meta = {};
    try {
      meta = row.meta ? JSON.parse(row.meta) : {};
    } catch (error) {
      meta = {};
    }
    if (!Object.keys(meta).length) meta = buildLegacyMeta(row);
    const dateKey = normalizeDateKeyValue(row.dateKey || row.date_key) || normalizeDateKeyValue(row.date);
    return normalizeRecord({
      ...row,
      dateKey,
      raw: Number(row.raw) || 0,
      meta
    });
  });
}

function createRecord({ dateKey, cat, type, val, raw, icon, color, time, meta }) {
  const nowIso = new Date().toISOString();
  return normalizeRecord({
    id: generateRecordId(),
    dateKey,
    date: getDateLabelFromKey(dateKey),
    cat,
    type,
    val,
    raw,
    icon,
    color,
    time,
    meta,
    createdAt: nowIso,
    updatedAt: nowIso
  });
}

function loadRecords() {
  try {
    const stored = wx.getStorageSync(STORAGE_KEYS.records);
    return sortRecordsByRecent((stored || []).map(normalizeRecord));
  } catch (error) {
    return [];
  }
}

function saveRecords(records) {
  wx.setStorageSync(STORAGE_KEYS.records, sortRecordsByRecent(records));
}

function loadBirthInfo() {
  try {
    const stored = wx.getStorageSync(STORAGE_KEYS.birth);
    if (stored?.date && stored?.time) return { ...DEFAULT_BIRTH, ...stored };
  } catch (error) {}
  return { ...DEFAULT_BIRTH };
}

function hasSavedBirthInfo() {
  try {
    const stored = wx.getStorageSync(STORAGE_KEYS.birth);
    return !!(stored && stored.date && stored.time);
  } catch (error) {
    return false;
  }
}

function saveBirthInfo(info) {
  wx.setStorageSync(STORAGE_KEYS.birth, info);
}

function loadWechatProfile() {
  try {
    const stored = wx.getStorageSync(STORAGE_KEYS.wechatProfile);
    return {
      avatarUrl: stored?.avatarUrl || '',
      nickname: stored?.nickname || ''
    };
  } catch (error) {
    return { avatarUrl: '', nickname: '' };
  }
}

function saveWechatProfile(profile) {
  wx.setStorageSync(STORAGE_KEYS.wechatProfile, {
    avatarUrl: profile?.avatarUrl || '',
    nickname: profile?.nickname || ''
  });
}

function loadCollapsedState() {
  try {
    return wx.getStorageSync(STORAGE_KEYS.collapse) || {};
  } catch (error) {
    return {};
  }
}

function saveCollapsedState(state) {
  wx.setStorageSync(STORAGE_KEYS.collapse, state || {});
}

function getBirthDate(info) {
  return new Date(`${info.date}T${info.time}:00`);
}

function diffMonthsAndDays(birthDate, currentDate) {
  let months = (currentDate.getFullYear() - birthDate.getFullYear()) * 12 + (currentDate.getMonth() - birthDate.getMonth());
  let anchor = new Date(birthDate.getTime());
  anchor.setMonth(anchor.getMonth() + months);
  if (anchor > currentDate) {
    months -= 1;
    anchor = new Date(birthDate.getTime());
    anchor.setMonth(anchor.getMonth() + months);
  }
  const days = Math.floor((currentDate - anchor) / 86400000);
  return { months, days };
}

function getAgeSummary(birthInfo, currentDate = new Date()) {
  const birthDate = getBirthDate(birthInfo);
  const today = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  const birthDay = new Date(birthDate.getFullYear(), birthDate.getMonth(), birthDate.getDate());
  const totalDays = Math.max(0, Math.floor((today - birthDay) / 86400000));
  const monthDiff = diffMonthsAndDays(birthDate, currentDate);
  return {
    totalDays,
    monthLabel: `${monthDiff.months}个月${monthDiff.days}天`,
    weekLabel: `第 ${Math.floor(totalDays / 7) + 1} 周`
  };
}

function getDateTag(date, today = new Date()) {
  if (getDateKey(date) === getDateKey(today)) return '今天';
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][toDate(date).getDay()];
}

function getSupplementRecordsByDate(records, dateKey) {
  return records
    .filter(record => record.cat === '补剂' && record.dateKey === dateKey)
    .sort((a, b) => (b.time || '').localeCompare(a.time || ''));
}

function getSupplementStatus(records, targetDateKey, currentDate = new Date()) {
  const todayKey = getDateKey(currentDate);
  const supplementRecords = getSupplementRecordsByDate(records, targetDateKey);
  const adDone = supplementRecords.some(record => record.type === 'AD');
  const d3Done = supplementRecords.some(record => record.type === 'D3');
  const currentHour = currentDate.getHours();
  const isViewingToday = targetDateKey === todayKey;
  const dayLabel = isViewingToday ? '今日' : '当日';

  let suggested = 'AD';
  if (!adDone && (!isViewingToday || currentHour < 12)) {
    suggested = 'AD';
  } else if (!d3Done) {
    suggested = 'D3';
  }

  let hint = `${dayLabel}提醒：上午 AD，午间 D3`;
  if (adDone && d3Done) {
    hint = `${dayLabel}补剂已完成 AD + D3`;
  } else if (adDone && !d3Done) {
    hint = `${dayLabel}已记录 AD，待记录午间 D3`;
  } else if (!adDone && d3Done) {
    hint = `${dayLabel}已记录 D3，待记录上午 AD`;
  }

  return { supplementRecords, adDone, d3Done, suggested, hint };
}

function getCategorySummary(cat, recs) {
  if (cat === '喝奶') {
    const totalMilk = recs.reduce((sum, record) => sum + (record.raw || 0), 0);
    return `${recs.length}次 · ${totalMilk}ml`;
  }
  if (cat === '排泄') {
    const peeCount = recs.filter(record => record.type.includes('尿尿')).length;
    const poopCount = recs.filter(record => record.type.includes('便便')).length;
    return `尿尿 ${peeCount}次 · 便便 ${poopCount}次`;
  }
  if (cat === '睡眠') {
    const totalSleep = recs.reduce((sum, record) => sum + (record.raw || 0), 0).toFixed(1);
    return `${recs.length}段 · ${totalSleep}h`;
  }
  if (cat === '补剂') {
    const adCount = recs.filter(record => record.type === 'AD').length;
    const d3Count = recs.filter(record => record.type === 'D3').length;
    return `AD ${adCount}次 · D3 ${d3Count}次`;
  }
  return `${recs.length}条`;
}

function getDailyStats(records, dateKey) {
  const dateRecords = records.filter(record => record.dateKey === dateKey);
  return {
    milk: dateRecords.filter(record => record.cat === '喝奶').reduce((sum, record) => sum + (record.raw || 0), 0),
    poop: dateRecords.filter(record => record.cat === '排泄' && record.type.includes('便便')).length,
    sleep: dateRecords.filter(record => record.cat === '睡眠').reduce((sum, record) => sum + (record.raw || 0), 0).toFixed(1)
  };
}

function getGroupedRecords(records, dateKey, collapsedState = {}) {
  const dateRecords = records.filter(record => record.dateKey === dateKey);
  return CATEGORY_ORDER.map(cat => {
    const items = dateRecords
      .filter(record => record.cat === cat)
      .sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    return {
      cat,
      label: `${cat}记录`,
      summary: getCategorySummary(cat, items),
      items,
      collapsed: !!collapsedState[cat]
    };
  }).filter(group => group.items.length);
}

function getAnalysisConfig(range) {
  const configs = {
    day: { days: 7, title: '近7天趋势', firstCol: '日期' },
    week: { days: 14, title: '近14天趋势', firstCol: '日期' },
    month: { days: 30, title: '近30天趋势', firstCol: '日期' },
    quarter: { days: 90, title: '近90天趋势', firstCol: '日期' },
    year: { days: 365, title: '近365天趋势', firstCol: '日期' }
  };
  return configs[range] || configs.day;
}

function buildAnalysisBuckets(records, range, currentDate = new Date()) {
  const config = getAnalysisConfig(range);
  const buckets = [];
  for (let i = config.days - 1; i >= 0; i -= 1) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - i);
    const dateKey = getDateKey(date);
    const dayRecords = records.filter(record => record.dateKey === dateKey);
    buckets.push({
      dateKey,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      fullLabel: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
      milk: dayRecords.filter(record => record.cat === '喝奶').reduce((sum, record) => sum + (record.raw || 0), 0),
      poop: dayRecords.filter(record => record.cat === '排泄' && record.type.includes('便便')).length,
      sleep: Number(dayRecords.filter(record => record.cat === '睡眠').reduce((sum, record) => sum + (record.raw || 0), 0).toFixed(1))
    });
  }

  const milkDays = buckets.filter(bucket => bucket.milk > 0);
  const sleepDays = buckets.filter(bucket => bucket.sleep > 0);
  const milkAverage = milkDays.length ? Math.round(milkDays.reduce((sum, bucket) => sum + bucket.milk, 0) / milkDays.length) : 0;
  const sleepAverage = sleepDays.length ? Number((sleepDays.reduce((sum, bucket) => sum + bucket.sleep, 0) / sleepDays.length).toFixed(1)) : 0;
  const maxMilk = Math.max(100, ...buckets.map(bucket => bucket.milk));
  const maxSleep = Math.max(12, ...buckets.map(bucket => bucket.sleep));

  return { config, buckets, milkAverage, sleepAverage, maxMilk, maxSleep };
}

function normalizeVoiceText(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/：/g, ':')
    .replace(/，|。|！|？/g, '');
}

function chineseDigitsToNumber(text) {
  const chars = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (!text) return NaN;
  if (/^\d+$/.test(text)) return parseInt(text, 10);
  if (text === '十') return 10;
  if (text.includes('百')) {
    const [hundredsText, restText = ''] = text.split('百');
    const hundreds = hundredsText ? (chars[hundredsText] ?? 1) : 1;
    return hundreds * 100 + (restText ? chineseDigitsToNumber(restText) : 0);
  }
  if (text.includes('十')) {
    const [tensText, onesText = ''] = text.split('十');
    const tens = tensText ? (chars[tensText] ?? 1) : 1;
    const ones = onesText ? (chars[onesText] ?? 0) : 0;
    return tens * 10 + ones;
  }
  return text.split('').reduce((acc, char) => acc * 10 + (chars[char] ?? 0), 0);
}

function parseVoiceTime(text) {
  const normalized = normalizeVoiceText(text);
  let match = normalized.match(/(\d{1,2})[:点](\d{1,2})/);
  if (match) {
    let hour = parseInt(match[1], 10);
    let minute = parseInt(match[2], 10);
    if (normalized.includes('下午') || normalized.includes('晚上') || normalized.includes('傍晚')) {
      if (hour < 12) hour += 12;
    }
    if (normalized.includes('凌晨') && hour === 12) hour = 0;
    return `${padNumber(hour)}:${padNumber(minute)}`;
  }

  match = normalized.match(/(\d{1,2})点半/);
  if (match) {
    let hour = parseInt(match[1], 10);
    if (normalized.includes('下午') || normalized.includes('晚上') || normalized.includes('傍晚')) {
      if (hour < 12) hour += 12;
    }
    return `${padNumber(hour)}:30`;
  }

  match = normalized.match(/([零一二两三四五六七八九十百]+)点半/);
  if (match) {
    let hour = chineseDigitsToNumber(match[1]);
    if (normalized.includes('下午') || normalized.includes('晚上') || normalized.includes('傍晚')) {
      if (hour < 12) hour += 12;
    }
    return `${padNumber(hour)}:30`;
  }

  match = normalized.match(/([零一二两三四五六七八九十百]+)点([零一二两三四五六七八九十百]+)?/);
  if (match) {
    let hour = chineseDigitsToNumber(match[1]);
    let minute = match[2] ? chineseDigitsToNumber(match[2]) : 0;
    if (normalized.includes('下午') || normalized.includes('晚上') || normalized.includes('傍晚')) {
      if (hour < 12) hour += 12;
    }
    if (normalized.includes('凌晨') && hour === 12) hour = 0;
    return `${padNumber(hour)}:${padNumber(minute)}`;
  }

  return '';
}

function parseVoiceVolume(text) {
  const normalized = normalizeVoiceText(text);
  let match = normalized.match(/(\d{2,4})(?:ml|毫升)/i);
  if (match) return parseInt(match[1], 10);
  match = normalized.match(/([零一二两三四五六七八九十百]+)(?:ml|毫升)/i);
  if (match) return chineseDigitsToNumber(match[1]);
  return null;
}

function parseVoiceTimeRange(text) {
  const normalized = normalizeVoiceText(text);
  const separators = ['睡到', '睡至', '到', '~', '-', '—'];
  for (const separator of separators) {
    if (!normalized.includes(separator)) continue;
    const [startPart, endPart] = normalized.split(separator);
    if (!startPart || !endPart) continue;
    const start = parseVoiceTime(startPart);
    const end = parseVoiceTime(endPart);
    if (start && end) {
      return {
        start,
        end,
        cross: normalized.includes('跨天') || normalized.includes('昨晚') || normalized.includes('夜里') || normalized.includes('夜间') || /早上|清晨|凌晨|早晨/.test(endPart) || timeToMinutes(end) <= timeToMinutes(start)
      };
    }
  }
  return null;
}

function detectVoiceMode(text) {
  const normalized = normalizeVoiceText(text);
  if (normalized.includes('奶粉') || normalized.includes('配方奶') || normalized.includes('母乳') || normalized.includes('喝奶')) return 'milk';
  if (normalized.includes('尿尿') || normalized.includes('便便')) return 'poop';
  if (normalized.includes('ad') || normalized.includes('AD') || normalized.includes('d3') || normalized.includes('D3') || normalized.includes('补剂')) return 'supplement';
  if (normalized.includes('睡') || normalized.includes('入睡') || normalized.includes('醒来')) return 'sleep';
  return '';
}

function parseVoiceResult(mode, transcript) {
  const normalized = normalizeVoiceText(transcript);
  const time = parseVoiceTime(normalized) || `${padNumber(new Date().getHours())}:${padNumber(new Date().getMinutes())}`;

  if (mode === 'milk') {
    const volume = parseVoiceVolume(normalized);
    const type = normalized.includes('奶粉') || normalized.includes('配方奶') ? '配方奶' : (normalized.includes('母乳') ? '瓶喂母乳' : '');
    if (!volume) return { error: '没听清奶量，可以说“200毫升”' };
    if (!type) return { error: '没听清是母乳还是奶粉' };
    return { time, volume, type };
  }

  if (mode === 'poop') {
    const hasPee = normalized.includes('尿尿');
    const hasPoop = normalized.includes('便便');
    const type = hasPee && hasPoop ? '尿尿+便便' : (hasPoop ? '便便' : (hasPee ? '尿尿' : ''));
    if (!type) return { error: '没听清是尿尿还是便便' };
    return { time, type };
  }

  if (mode === 'supplement') {
    const type = normalized.includes('d3') || normalized.includes('D3') ? 'D3' : (normalized.includes('ad') || normalized.includes('AD') ? 'AD' : '');
    if (!type) return { error: '没听清是 AD 还是 D3' };
    return { time, type };
  }

  if (mode === 'sleep') {
    const range = parseVoiceTimeRange(normalized);
    if (!range) return { error: '没听清睡眠起止时间，可以说“晚上九点睡到早上七点半”' };
    return range;
  }

  return { error: '暂不支持这类语音输入' };
}

module.exports = {
  STORAGE_KEYS,
  DEFAULT_BIRTH,
  CATEGORY_ORDER,
  CSV_COLUMNS,
  padNumber,
  getDateKey,
  parseDateKey,
  getDateLabelFromKey,
  generateRecordId,
  timeToMinutes,
  getSpanMinutes,
  isNightSleep,
  buildSleepRecordData,
  normalizeRecord,
  sortRecordsByRecent,
  recordsToCsv,
  csvToRecords,
  createRecord,
  loadRecords,
  saveRecords,
  loadBirthInfo,
  hasSavedBirthInfo,
  saveBirthInfo,
  loadWechatProfile,
  saveWechatProfile,
  loadCollapsedState,
  saveCollapsedState,
  getAgeSummary,
  getDateTag,
  getSupplementStatus,
  getCategorySummary,
  getDailyStats,
  getGroupedRecords,
  getAnalysisConfig,
  buildAnalysisBuckets,
  normalizeVoiceText,
  detectVoiceMode,
  parseVoiceResult
};
