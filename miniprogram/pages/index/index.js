const core = require('../../utils/core');
const cloudSync = require('../../utils/cloudSync');

let recordManager = null;
const ENABLE_WECHAT_SI = false;
const SHARE_TITLE = '宝宝吃睡拉记录';
const SHARE_PATH = '/pages/index/index';

function getNowTime() {
  const now = new Date();
  return `${core.padNumber(now.getHours())}:${core.padNumber(now.getMinutes())}`;
}

function formatTimeValue(value = '') {
  const raw = String(value).replace(/\D/g, '');
  if (!raw) return '';
  let next = raw;
  if (next.length === 3) next = `0${next}`;
  if (next.length >= 4) {
    const hh = next.slice(0, 2);
    const mm = next.slice(2, 4);
    if (Number(hh) > 23 || Number(mm) > 59) return '';
    return `${hh}:${mm}`;
  }
  return value;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const EMPTY_AGE_SUMMARY = {
  totalDays: 0,
  totalDaysLabel: '0',
  monthLabel: '0',
  weekLabel: '0'
};

function getDefaultBirthDraft() {
  return {
    name: '宝贝',
    date: core.getDateKey(new Date()),
    time: '00:00'
  };
}

function decorateAgeSummary(ageSummary) {
  return {
    ...ageSummary,
    totalDaysLabel: `${ageSummary.totalDays} 天`
  };
}

Page({
  data: {
    version: '1.1.8-mini',
    releaseDate: '2026-06-20',
    viewDateKey: core.getDateKey(new Date()),
    viewDateLabel: '',
    viewDateTag: '',
    ageSummary: EMPTY_AGE_SUMMARY,
    hasBirthInfo: false,
    babyNameLabel: '宝宝',
    birthInfo: core.DEFAULT_BIRTH,
    stats: {
      milk: 0,
      poop: 0,
      sleep: '0.0'
    },
    syncLoggedIn: false,
    syncBusy: false,
    syncActionText: '微信登录',
    syncStatusText: '本地可用',
    wechatProfileVisible: false,
    wechatProfileDraft: {
      avatarUrl: '',
      nickname: ''
    },
    groupedRecords: [],
    milkType: '瓶喂母乳',
    milkVolume: '',
    milkStartTime: '00:00',
    milkEndTime: '00:00',
    poopType: '尿尿',
    poopTime: '00:00',
    supplementType: 'AD',
    supplementTime: '00:00',
    supplementHint: '今日提醒：上午 AD，午间 D3',
    sleepStartTime: '00:00',
    sleepEndTime: '00:00',
    sleepCrossDay: false,
    sleepAwakeStartTime: '',
    sleepAwakeEndTime: '',
    showSleepAwakePanel: false,
    sleepSaveLabel: '保存睡眠数据',
    analysisVisible: false,
    analysisRange: 'day',
    analysisTitle: '近7天趋势',
    analysisBuckets: [],
    analysisMilkAverage: 0,
    analysisSleepAverage: '0.0',
    analysisSelected: null,
    analysisManualSelection: false,
    editVisible: false,
    editRecordId: '',
    editForm: null,
    birthVisible: false,
    birthDraft: getDefaultBirthDraft(),
    voiceSupported: false,
    voiceVisible: false,
    voiceStatus: '准备开始',
    voiceHint: '请说，比如：八点半喝奶粉200毫升',
    voiceTranscript: '等待语音输入…',
    voiceBarHeights: [18, 34, 48, 28, 42, 22, 38],
    voiceListening: false,
    voiceProcessing: false,
    voiceConfirmVisible: false,
    voiceConfirmSummary: '',
    voiceConfirmMode: '',
    voiceConfirmForm: null,
    topActionsVisible: false,
    voiceExamples: [
      '喝奶：八点半喝奶粉200毫升',
      '排泄：下午两点二十便便',
      '补剂：上午九点吃AD',
      '睡眠：晚上九点睡到早上七点半'
    ]
  },

  onLoad() {
    this.records = core.loadRecords();
    this.collapsedState = core.loadCollapsedState();
    this.birthInfo = core.loadBirthInfo();
    this.voiceAnimationTimer = null;
    this.voiceCancelled = false;
    this.pendingVoiceRecord = null;
    this.syncDocId = '';
    this.wechatProfile = core.loadWechatProfile();
    this.birthInfoConfiguredInSession = false;
    this.initVoiceManager();
    this.resetDefaultTimes();
    this.refreshPageState();
    this.enableShareMenu();
  },

  onUnload() {
    this.stopVoiceAnimation();
    if (recordManager) {
      try { recordManager.stop(); } catch (error) {}
    }
  },

  enableShareMenu() {
    if (typeof wx.showShareMenu !== 'function') return;
    wx.showShareMenu({
      withShareTicket: false,
      menus: ['shareAppMessage', 'shareTimeline']
    });
  },

  onShareAppMessage() {
    return {
      title: SHARE_TITLE,
      path: SHARE_PATH
    };
  },

  onShareTimeline() {
    return {
      title: SHARE_TITLE,
      query: ''
    };
  },

  initVoiceManager() {
    if (!ENABLE_WECHAT_SI) {
      this.setData({ voiceSupported: false });
      return;
    }
    try {
      const plugin = requirePlugin('WechatSI');
      recordManager = plugin.getRecordRecognitionManager();
      if (!recordManager) throw new Error('manager missing');
      this.bindVoiceEvents();
      this.setData({ voiceSupported: true });
    } catch (error) {
      recordManager = null;
      this.setData({ voiceSupported: false });
    }
  },

  bindVoiceEvents() {
    if (!recordManager) return;
    recordManager.onRecognize = (res) => {
      this.setData({ voiceTranscript: res.result || '正在听你说话…' });
    };
    recordManager.onStop = (res) => {
      this.stopVoiceAnimation();
      if (this.voiceCancelled) {
        this.voiceCancelled = false;
        return;
      }
      const transcript = (res.result || '').trim();
      if (!transcript) {
        this.setVoiceState('error', '这次没听清', '可以点重试再说一次', '请再说一次');
        this.showToast('没有听清，请再说一次');
        return;
      }
      this.setVoiceState('processing', '正在识别…', '我在整理你刚才说的话', transcript);
      const mode = core.detectVoiceMode(transcript);
      if (!mode) {
        this.setVoiceState('error', '这次没听清', '可以点重试再说一次', transcript);
        this.showToast('没听清是哪类记录');
        return;
      }
      const parsed = core.parseVoiceResult(mode, transcript);
      if (parsed.error) {
        this.setVoiceState('error', '这次没听清', '可以点重试再说一次', transcript);
        this.showToast(parsed.error);
        return;
      }
      this.setVoiceState('done', '识别完成', '可以先手动修改，再确认保存', transcript);
      this.applyVoiceResult(mode, parsed, transcript);
    };
    recordManager.onError = (error) => {
      this.stopVoiceAnimation();
      this.setVoiceState('error', '识别失败', '请检查权限后重试', error?.msg || '语音识别失败');
      this.showToast(error?.msg || '语音识别失败');
    };
  },

  refreshPageState() {
    const viewDate = core.parseDateKey(this.data.viewDateKey);
    const hasBirthInfo = (this.data.syncLoggedIn || this.birthInfoConfiguredInSession) && core.hasSavedBirthInfo();
    const ageSummary = hasBirthInfo ? decorateAgeSummary(core.getAgeSummary(this.birthInfo, new Date())) : EMPTY_AGE_SUMMARY;
    const stats = core.getDailyStats(this.records, this.data.viewDateKey);
    const supplementStatus = core.getSupplementStatus(this.records, this.data.viewDateKey, new Date());
    const groupedRecords = core.getGroupedRecords(this.records, this.data.viewDateKey, this.collapsedState[this.data.viewDateKey] || {}).map(group => ({
      ...group,
      colorClass: this.getCategoryColor(group.cat),
      iconText: this.getCategoryIcon(group.cat),
      items: group.items.map(item => ({
        ...item,
        badgeClass: this.getBadgeClass(item.color),
        recordTagClass: this.getTagClass(item.color),
        hasAwakeTag: item.cat === '睡眠' && !!item.meta?.awakeMinutes
      }))
    }));
    const analysis = core.buildAnalysisBuckets(this.records, this.data.analysisRange, new Date());
    const selectedIndex = this.data.analysisManualSelection && this.data.analysisSelected ? this.data.analysisSelected.index : analysis.buckets.length - 1;
    const selected = analysis.buckets[selectedIndex] ? this.decorateAnalysisSelected(analysis.buckets[selectedIndex], selectedIndex) : null;

    this.setData({
      birthInfo: this.birthInfo,
      ageSummary,
      hasBirthInfo,
      babyNameLabel: hasBirthInfo ? (this.birthInfo.name || '宝宝') : '宝宝',
      viewDateLabel: `${viewDate.getFullYear()}年${viewDate.getMonth() + 1}月${viewDate.getDate()}日`,
      viewDateTag: core.getDateTag(viewDate),
      stats,
      groupedRecords,
      supplementHint: supplementStatus.hint,
      supplementType: supplementStatus.suggested,
      showSleepAwakePanel: core.isNightSleep(this.data.sleepStartTime, this.data.sleepEndTime, this.data.sleepCrossDay),
      sleepSaveLabel: core.isNightSleep(this.data.sleepStartTime, this.data.sleepEndTime, this.data.sleepCrossDay) ? '保存夜间睡眠' : '保存睡眠数据',
      analysisTitle: analysis.config.title,
      analysisBuckets: analysis.buckets.map((bucket, index) => this.decorateAnalysisBucket(bucket, analysis, index)),
      analysisMilkAverage: analysis.milkAverage,
      analysisSleepAverage: analysis.sleepAverage.toFixed(1),
      analysisSelected: selected
    });
  },

  refreshSyncState(text) {
    const loggedIn = !!this.syncDocId;
    this.setData({
      syncLoggedIn: loggedIn,
      syncActionText: loggedIn ? '已登录' : '微信登录',
      syncStatusText: text || (loggedIn ? '云端同步中' : '本地可用')
    });
  },

  decorateAnalysisBucket(bucket, analysis, index) {
    const inactive = this.data.analysisManualSelection && this.data.analysisSelected && this.data.analysisSelected.index !== index;
    return {
      ...bucket,
      index,
      milkHeight: Math.max(6, Math.round((bucket.milk / analysis.maxMilk) * 140)),
      sleepHeight: Math.max(6, Math.round((bucket.sleep / analysis.maxSleep) * 140)),
      muted: inactive
    };
  },

  decorateAnalysisSelected(bucket, index) {
    return {
      ...bucket,
      index
    };
  },

  resetDefaultTimes() {
    const time = this.data.viewDateKey === core.getDateKey(new Date()) ? getNowTime() : '00:00';
    this.setData({
      milkStartTime: time,
      milkEndTime: time,
      poopTime: time,
      supplementTime: time,
      sleepStartTime: time,
      sleepEndTime: time,
      sleepAwakeStartTime: '',
      sleepAwakeEndTime: ''
    });
  },

  getCategoryColor(cat) {
    if (cat === '喝奶') return 'amber';
    if (cat === '排泄') return 'emerald';
    if (cat === '睡眠') return 'sky';
    return 'indigo';
  },

  getCategoryIcon(cat) {
    if (cat === '喝奶') return '🍼';
    if (cat === '排泄') return '💧';
    if (cat === '睡眠') return '🌙';
    return '💊';
  },

  getBadgeClass(color) {
    return `badge-${color || 'slate'}`;
  },

  getTagClass(color) {
    return `tag-${color || 'slate'}`;
  },

  showToast(title) {
    wx.showToast({ title, icon: 'none' });
  },

  shiftDate(event) {
    const offset = Number(event.currentTarget.dataset.offset || 0);
    const date = core.parseDateKey(this.data.viewDateKey);
    date.setDate(date.getDate() + offset);
    this.setData({
      viewDateKey: core.getDateKey(date),
      analysisManualSelection: false
    });
    this.resetDefaultTimes();
    this.refreshPageState();
  },

  jumpToToday() {
    this.setData({
      viewDateKey: core.getDateKey(new Date()),
      analysisManualSelection: false
    });
    this.resetDefaultTimes();
    this.refreshPageState();
  },

  onMilkVolumeInput(event) { this.setData({ milkVolume: event.detail.value }); },
  onMilkStartInput(event) { this.setData({ milkStartTime: event.detail.value }); },
  onMilkEndInput(event) { this.setData({ milkEndTime: event.detail.value }); },
  onPoopTimeInput(event) { this.setData({ poopTime: event.detail.value }); },
  onSupplementTimeInput(event) { this.setData({ supplementTime: event.detail.value }); },
  onSleepStartInput(event) { this.setData({ sleepStartTime: event.detail.value }, () => this.refreshPageState()); },
  onSleepEndInput(event) { this.setData({ sleepEndTime: event.detail.value }, () => this.refreshPageState()); },
  onSleepAwakeStartInput(event) { this.setData({ sleepAwakeStartTime: event.detail.value }); },
  onSleepAwakeEndInput(event) { this.setData({ sleepAwakeEndTime: event.detail.value }); },
  onSleepCrossChange(event) { this.setData({ sleepCrossDay: event.detail.value }, () => this.refreshPageState()); },

  onTimeBlur(event) {
    const key = event.currentTarget.dataset.key;
    const next = formatTimeValue(event.detail.value);
    if (!next && event.detail.value) {
      this.showToast('时间不合法');
      this.setData({ [key]: '' });
      return;
    }
    this.setData({ [key]: next }, () => {
      if (key.startsWith('sleep')) this.refreshPageState();
    });
  },

  setMilkType(event) {
    this.setData({ milkType: event.currentTarget.dataset.type });
  },

  setPoopType(event) {
    this.setData({ poopType: event.currentTarget.dataset.type });
  },

  setSupplementType(event) {
    this.setData({ supplementType: event.currentTarget.dataset.type });
  },

  persistRecords() {
    core.saveRecords(this.records);
    this.refreshPageState();
    this.pushCloudSync();
  },

  async pushCloudSync() {
    if (!this.syncDocId || !cloudSync.isConfigured()) return;
    try {
      await cloudSync.saveSyncDoc(this.syncDocId, this.records, this.birthInfo);
      this.refreshSyncState('已同步');
    } catch (error) {
      console.error('push cloud sync failed', error);
      this.refreshSyncState('同步失败');
    }
  },

  async loginWithWechat() {
    if (this.data.syncBusy) return;
    if (!this.data.syncLoggedIn) {
      this.openWechatProfileModal();
      return;
    }
    await this.syncWithWechatCloud();
  },

  openWechatProfileModal() {
    const profile = this.wechatProfile || core.loadWechatProfile();
    this.setData({
      wechatProfileVisible: true,
      wechatProfileDraft: {
        avatarUrl: profile.avatarUrl || '',
        nickname: profile.nickname || ''
      }
    });
  },

  closeWechatProfileModal() {
    if (this.data.syncBusy) return;
    this.setData({ wechatProfileVisible: false });
  },

  onChooseWechatAvatar(event) {
    this.setData({ 'wechatProfileDraft.avatarUrl': event.detail.avatarUrl || '' });
  },

  onWechatNicknameInput(event) {
    this.setData({ 'wechatProfileDraft.nickname': event.detail.value });
  },

  onWechatNicknameChange(event) {
    const nickname = String(event.detail.value || '').trim();
    this.setData({ 'wechatProfileDraft.nickname': nickname });
  },

  async confirmWechatLogin() {
    if (this.data.syncBusy) return;
    const draft = this.data.wechatProfileDraft || {};
    const profile = {
      avatarUrl: draft.avatarUrl || '',
      nickname: String(draft.nickname || '').trim()
    };
    this.wechatProfile = profile;
    core.saveWechatProfile(profile);
    this.setData({ wechatProfileVisible: false });
    await this.syncWithWechatCloud();
  },

  async syncWithWechatCloud() {
    if (this.data.syncBusy) return;
    if (!cloudSync.isConfigured()) {
      this.showToast('请先配置云开发环境');
      return;
    }
    this.setData({ syncBusy: true, syncStatusText: '同步中…' });
    try {
      const result = await cloudSync.syncLocalWithCloud(this.records, this.birthInfo);
      if (!result.configured) {
        this.showToast('请先配置云开发环境');
        return;
      }
      this.syncDocId = result.docId || '';
      this.records = core.sortRecordsByRecent(result.records || []);
      this.birthInfo = { ...core.DEFAULT_BIRTH, ...(result.birthInfo || {}) };
      this.birthInfoConfiguredInSession = true;
      core.saveRecords(this.records);
      core.saveBirthInfo(this.birthInfo);
      this.refreshSyncState('已同步');
      this.refreshPageState();
      this.showToast('已用微信身份同步');
    } catch (error) {
      console.error('wechat cloud sync failed', error);
      this.refreshSyncState('同步失败');
      this.showToast(cloudSync.getReadableCloudError(error));
    } finally {
      this.setData({ syncBusy: false });
    }
  },

  addRecord(record) {
    this.records = core.sortRecordsByRecent([record, ...this.records]);
    this.persistRecords();
    this.showToast('记录成功');
  },

  saveMilk() {
    const volume = parseInt(this.data.milkVolume, 10);
    const start = formatTimeValue(this.data.milkStartTime);
    const end = formatTimeValue(this.data.milkEndTime);
    if (!volume || start.length < 5 || end.length < 5) return this.showToast('请填写奶量和时间');
    const record = core.createRecord({
      dateKey: this.data.viewDateKey,
      cat: '喝奶',
      type: this.data.milkType,
      val: `${volume}ml (${start}~${end})`,
      raw: volume,
      icon: 'milk',
      color: 'amber',
      time: end,
      meta: { start, end, volume }
    });
    this.addRecord(record);
  },

  savePoop() {
    const time = formatTimeValue(this.data.poopTime);
    if (time.length < 5) return this.showToast('请填写时间');
    const type = this.data.poopType;
    const record = core.createRecord({
      dateKey: this.data.viewDateKey,
      cat: '排泄',
      type,
      val: `${type} (${time})`,
      raw: 1,
      icon: 'droplets',
      color: 'emerald',
      time,
      meta: { time, type }
    });
    this.addRecord(record);
  },

  saveSupplement() {
    const time = formatTimeValue(this.data.supplementTime);
    if (time.length < 5) return this.showToast('请填写时间');
    const status = core.getSupplementStatus(this.records, this.data.viewDateKey, new Date());
    const duplicated = (this.data.supplementType === 'AD' && status.adDone) || (this.data.supplementType === 'D3' && status.d3Done);
    const proceed = () => {
      const record = core.createRecord({
        dateKey: this.data.viewDateKey,
        cat: '补剂',
        type: this.data.supplementType,
        val: `${this.data.supplementType} (${time})`,
        raw: 1,
        icon: 'pill',
        color: 'indigo',
        time,
        meta: { time, type: this.data.supplementType }
      });
      this.addRecord(record);
      this.setData({ supplementTime: getNowTime() });
    };
    if (duplicated) {
      wx.showModal({
        title: '重复记录提醒',
        content: `今天已经记录过 ${this.data.supplementType}，还要继续记录吗？`,
        success: ({ confirm }) => { if (confirm) proceed(); }
      });
      return;
    }
    proceed();
  },

  saveSleep() {
    const start = formatTimeValue(this.data.sleepStartTime);
    const end = formatTimeValue(this.data.sleepEndTime);
    const awakeStart = formatTimeValue(this.data.sleepAwakeStartTime);
    const awakeEnd = formatTimeValue(this.data.sleepAwakeEndTime);
    const sleepRecord = core.buildSleepRecordData(start, end, this.data.sleepCrossDay, awakeStart, awakeEnd);
    if (sleepRecord.error) return this.showToast(sleepRecord.error);
    const record = core.createRecord({
      dateKey: this.data.viewDateKey,
      cat: '睡眠',
      type: sleepRecord.type,
      val: sleepRecord.val,
      raw: sleepRecord.raw,
      icon: 'moon',
      color: 'sky',
      time: sleepRecord.time,
      meta: sleepRecord.meta
    });
    this.addRecord(record);
  },

  toggleCategory(event) {
    const cat = event.currentTarget.dataset.cat;
    if (!this.collapsedState[this.data.viewDateKey]) this.collapsedState[this.data.viewDateKey] = {};
    this.collapsedState[this.data.viewDateKey][cat] = !this.collapsedState[this.data.viewDateKey][cat];
    core.saveCollapsedState(this.collapsedState);
    this.refreshPageState();
  },

  openAnalysis() {
    this.setData({ analysisVisible: true, analysisManualSelection: false }, () => this.refreshPageState());
  },

  closeAnalysis() {
    this.setData({ analysisVisible: false });
  },

  exportData() {
    const csv = core.recordsToCsv(this.records);
    wx.setClipboardData({
      data: csv,
      success: () => this.showToast('CSV 已复制'),
      fail: () => this.showToast('导出失败')
    });
  },

  importData() {
    wx.showModal({
      title: '导入CSV',
      content: '请先复制导出的 CSV 内容，确认后会从剪贴板导入并合并数据。',
      confirmText: '导入',
      success: (result) => {
        if (!result.confirm) return;
        wx.getClipboardData({
          success: ({ data }) => {
            try {
              const incomingRecords = core.csvToRecords(data);
              if (!incomingRecords.length) {
                this.showToast('剪贴板没有可导入数据');
                return;
              }
              const merged = new Map(this.records.map(record => [record.id, record]));
              incomingRecords.forEach(record => merged.set(record.id, record));
              this.records = core.sortRecordsByRecent([...merged.values()]);
              this.persistRecords();
              this.showToast(`已导入 ${incomingRecords.length} 条`);
            } catch (error) {
              this.showToast('导入失败，请检查CSV');
            }
          },
          fail: () => this.showToast('读取剪贴板失败')
        });
      }
    });
  },

  setAnalysisRange(event) {
    this.setData({
      analysisRange: event.currentTarget.dataset.range,
      analysisManualSelection: false
    }, () => this.refreshPageState());
  },

  selectAnalysisBucket(event) {
    const index = Number(event.currentTarget.dataset.index);
    const bucket = this.data.analysisBuckets[index];
    if (!bucket) return;
    this.setData({
      analysisManualSelection: true,
      analysisSelected: this.decorateAnalysisSelected(bucket, index)
    }, () => this.refreshPageState());
  },

  openBirthModal() {
    const draft = this.data.hasBirthInfo ? clone(this.birthInfo) : getDefaultBirthDraft();
    this.setData({
      birthVisible: true,
      birthDraft: draft
    });
  },

  closeBirthModal() {
    this.setData({ birthVisible: false });
  },

  onBirthNameInput(event) {
    this.setData({ 'birthDraft.name': event.detail.value });
  },

  onBirthNicknameChange(event) {
    const value = (event.detail.value || '').trim();
    if (value) this.setData({ 'birthDraft.name': value });
  },

  onBirthDateChange(event) {
    this.setData({ 'birthDraft.date': event.detail.value });
  },

  onBirthTimeChange(event) {
    this.setData({ 'birthDraft.time': event.detail.value });
  },

  saveBirthInfo() {
    const draft = this.data.birthDraft;
    const name = String(draft.name || '').trim() || '宝贝';
    const birthDate = new Date(`${draft.date}T${draft.time}:00`);
    if (Number.isNaN(birthDate.getTime())) return this.showToast('出生时间格式不正确');
    if (birthDate > new Date()) return this.showToast('出生时间不能晚于现在');
    this.birthInfo = { ...clone(draft), name };
    this.birthInfoConfiguredInSession = true;
    core.saveBirthInfo(this.birthInfo);
    this.setData({ birthVisible: false });
    this.refreshPageState();
    this.pushCloudSync();
    this.showToast('出生信息已更新');
  },

  openEditModal(event) {
    const recordId = event.currentTarget.dataset.id;
    const record = this.records.find(item => item.id === recordId);
    if (!record) return;
    const editForm = {
      cat: record.cat,
      type: record.type,
      time: record.meta?.time || record.time,
      start: record.meta?.start || '',
      end: record.meta?.end || '',
      volume: record.meta?.volume || '',
      cross: !!record.meta?.cross,
      awakeStart: record.meta?.awakeStart || '',
      awakeEnd: record.meta?.awakeEnd || ''
    };
    this.setData({
      editVisible: true,
      editRecordId: recordId,
      editForm
    });
  },

  closeEditModal() {
    this.setData({ editVisible: false, editRecordId: '', editForm: null });
  },

  onEditInput(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`editForm.${key}`]: event.detail.value });
  },

  onEditTimeBlur(event) {
    const key = event.currentTarget.dataset.key;
    const next = formatTimeValue(event.detail.value);
    if (!next && event.detail.value) return this.showToast('时间不合法');
    this.setData({ [`editForm.${key}`]: next });
  },

  onEditSwitchChange(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`editForm.${key}`]: event.detail.value });
  },

  setEditType(event) {
    const { type } = event.currentTarget.dataset;
    this.setData({ 'editForm.type': type });
  },

  saveEditRecord() {
    const recordId = this.data.editRecordId;
    const recordIndex = this.records.findIndex(item => item.id === recordId);
    if (recordIndex === -1) return;
    const target = clone(this.records[recordIndex]);
    const form = this.data.editForm;

    if (target.cat === '喝奶') {
      const volume = parseInt(form.volume, 10);
      if (!volume || form.start.length < 5 || form.end.length < 5) return this.showToast('请补全奶量和时间');
      target.type = form.type;
      target.time = form.end;
      target.raw = volume;
      target.val = `${volume}ml (${form.start}~${form.end})`;
      target.meta = { start: form.start, end: form.end, volume };
    } else if (target.cat === '排泄') {
      if (form.time.length < 5) return this.showToast('请填写时间');
      target.type = form.type;
      target.time = form.time;
      target.val = `${form.type} (${form.time})`;
      target.meta = { time: form.time, type: form.type };
    } else if (target.cat === '补剂') {
      if (form.time.length < 5) return this.showToast('请填写时间');
      target.type = form.type;
      target.time = form.time;
      target.val = `${form.type} (${form.time})`;
      target.meta = { time: form.time, type: form.type };
    } else if (target.cat === '睡眠') {
      const result = core.buildSleepRecordData(form.start, form.end, form.cross, form.awakeStart, form.awakeEnd);
      if (result.error) return this.showToast(result.error);
      target.type = result.type;
      target.time = result.time;
      target.raw = result.raw;
      target.val = result.val;
      target.meta = result.meta;
    }

    target.updatedAt = new Date().toISOString();
    this.records.splice(recordIndex, 1, target);
    this.records = core.sortRecordsByRecent(this.records);
    this.closeEditModal();
    this.persistRecords();
    this.showToast('已更新');
  },

  deleteEditRecord() {
    wx.showModal({
      title: '删除记录',
      content: '确认删除这条记录吗？',
      success: ({ confirm }) => {
        if (!confirm) return;
        this.records = this.records.filter(item => item.id !== this.data.editRecordId);
        this.closeEditModal();
        this.persistRecords();
        this.showToast('已删除');
      }
    });
  },

  setVoiceState(kind, title, hint, transcript) {
    this.setData({
      voiceStatus: title,
      voiceHint: hint,
      voiceTranscript: transcript,
      voiceListening: kind === 'listening',
      voiceProcessing: kind === 'processing'
    });
  },

  startVoiceAnimation() {
    this.stopVoiceAnimation();
    this.voiceAnimationTimer = setInterval(() => {
      const heights = Array.from({ length: 7 }).map((_, index) => {
        const presets = [18, 34, 48, 28, 42, 22, 38];
        return Math.max(12, presets[index] + Math.round(Math.random() * 18 - 9));
      });
      this.setData({ voiceBarHeights: heights });
    }, 220);
  },

  stopVoiceAnimation() {
    if (this.voiceAnimationTimer) {
      clearInterval(this.voiceAnimationTimer);
      this.voiceAnimationTimer = null;
    }
  },

  openVoiceModal() {
    if (!this.data.voiceSupported) {
      return this.showToast('当前环境暂不支持语音输入');
    }
    this.voiceCancelled = false;
    this.setData({
      voiceVisible: true,
      voiceStatus: '正在听…',
      voiceHint: '说完后稍等一下，我会帮你识别',
      voiceTranscript: '正在听你说话…',
      voiceListening: true,
      voiceProcessing: false
    });
    this.startVoiceAnimation();
    if (recordManager) {
      recordManager.start({ lang: 'zh_CN', duration: 30000 });
    }
  },

  closeVoiceModal() {
    this.voiceCancelled = true;
    this.stopVoiceAnimation();
    this.setData({ voiceVisible: false, voiceListening: false, voiceProcessing: false });
    if (recordManager) {
      try { recordManager.stop(); } catch (error) {}
    }
  },

  retryVoice() {
    this.closeVoiceModal();
    setTimeout(() => this.openVoiceModal(), 150);
  },

  applyVoiceResult(mode, parsed, transcript) {
    const labels = {
      milk: '识别到这条喝奶记录，可以先手动修改，再确认保存。',
      poop: '识别到这条排泄记录，可以先手动修改，再确认保存。',
      supplement: '识别到这条补剂记录，可以先手动修改，再确认保存。',
      sleep: '识别到这条睡眠记录，可以先手动修改，再确认保存。'
    };
    this.pendingVoiceRecord = { mode, transcript };
    this.setData({
      voiceVisible: false,
      voiceConfirmVisible: true,
      voiceConfirmMode: mode,
      voiceConfirmSummary: labels[mode],
      voiceConfirmForm: clone(parsed)
    });
  },

  closeVoiceConfirm() {
    this.pendingVoiceRecord = null;
    this.setData({
      voiceConfirmVisible: false,
      voiceConfirmMode: '',
      voiceConfirmForm: null
    });
  },

  retryVoiceFromConfirm() {
    this.closeVoiceConfirm();
    setTimeout(() => this.openVoiceModal(), 150);
  },

  onVoiceConfirmInput(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`voiceConfirmForm.${key}`]: event.detail.value });
  },

  onVoiceConfirmTimeBlur(event) {
    const key = event.currentTarget.dataset.key;
    const next = formatTimeValue(event.detail.value);
    if (!next && event.detail.value) return this.showToast('时间不合法');
    this.setData({ [`voiceConfirmForm.${key}`]: next });
  },

  onVoiceConfirmSwitchChange(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`voiceConfirmForm.${key}`]: event.detail.value });
  },

  setVoiceConfirmType(event) {
    const type = event.currentTarget.dataset.type;
    this.setData({ 'voiceConfirmForm.type': type });
  },

  confirmVoiceRecord() {
    const mode = this.data.voiceConfirmMode;
    const form = this.data.voiceConfirmForm || {};
    if (mode === 'milk') {
      if (!form.volume || !form.type || String(form.time || '').length < 5) return this.showToast('请补全奶量、时间和类型');
      this.setData({
        milkType: form.type,
        milkVolume: String(form.volume),
        milkStartTime: form.time,
        milkEndTime: form.time
      });
      this.closeVoiceConfirm();
      this.saveMilk();
      return;
    }
    if (mode === 'poop') {
      if (!form.type || String(form.time || '').length < 5) return this.showToast('请补全排泄时间和类型');
      this.setData({ poopType: form.type, poopTime: form.time });
      this.closeVoiceConfirm();
      this.savePoop();
      return;
    }
    if (mode === 'supplement') {
      if (!form.type || String(form.time || '').length < 5) return this.showToast('请补全补剂时间和类型');
      this.setData({ supplementType: form.type, supplementTime: form.time });
      this.closeVoiceConfirm();
      this.saveSupplement();
      return;
    }
    if (mode === 'sleep') {
      if (String(form.start || '').length < 5 || String(form.end || '').length < 5) return this.showToast('请补全睡眠起止时间');
      this.setData({
        sleepStartTime: form.start,
        sleepEndTime: form.end,
        sleepCrossDay: !!form.cross,
        sleepAwakeStartTime: '',
        sleepAwakeEndTime: ''
      }, () => {
        this.closeVoiceConfirm();
        this.refreshPageState();
        this.saveSleep();
      });
    }
  }
});
