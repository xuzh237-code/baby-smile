const config = require('./cloudConfig');
const core = require('./core');

const DOC_KIND = 'baby_smile_user_data';

function isConfigured() {
  return !!(config.CLOUD_ENV_ID && wx.cloud);
}

function getCollection() {
  return wx.cloud.database({ env: config.CLOUD_ENV_ID }).collection(config.SYNC_COLLECTION);
}

function normalizeBirthInfo(info) {
  return { ...core.DEFAULT_BIRTH, ...(info || {}) };
}

function mergeRecords(localRecords = [], cloudRecords = []) {
  const merged = new Map();
  [...cloudRecords, ...localRecords].forEach(record => {
    const normalized = core.normalizeRecord(record);
    const current = merged.get(normalized.id);
    if (!current || String(normalized.updatedAt || '') >= String(current.updatedAt || '')) {
      merged.set(normalized.id, normalized);
    }
  });
  return core.sortRecordsByRecent([...merged.values()]);
}

async function fetchSyncDoc() {
  if (!isConfigured()) return { configured: false, doc: null };
  const res = await getCollection().where({ kind: DOC_KIND }).limit(1).get();
  return { configured: true, doc: res.data && res.data[0] ? res.data[0] : null };
}

async function saveSyncDoc(docId, records, birthInfo) {
  if (!isConfigured()) return { configured: false };
  const data = {
    kind: DOC_KIND,
    schemaVersion: 1,
    records: core.sortRecordsByRecent(records).map(core.normalizeRecord),
    birthInfo: normalizeBirthInfo(birthInfo),
    updatedAt: new Date().toISOString()
  };
  if (docId) {
    await getCollection().doc(docId).update({ data });
    return { configured: true, docId };
  }
  const res = await getCollection().add({ data });
  return { configured: true, docId: res._id };
}

async function syncLocalWithCloud(localRecords, localBirthInfo) {
  const { configured, doc } = await fetchSyncDoc();
  if (!configured) return { configured: false };

  const cloudRecords = doc?.records || [];
  const mergedRecords = mergeRecords(localRecords, cloudRecords);
  const cloudBirthInfo = doc?.birthInfo ? normalizeBirthInfo(doc.birthInfo) : null;
  const localBirth = normalizeBirthInfo(localBirthInfo);
  const localIsDefault = JSON.stringify(localBirth) === JSON.stringify(core.DEFAULT_BIRTH);
  const mergedBirthInfo = localIsDefault && cloudBirthInfo ? cloudBirthInfo : localBirth;

  const saved = await saveSyncDoc(doc?._id, mergedRecords, mergedBirthInfo);
  return {
    configured: true,
    docId: saved.docId || doc?._id,
    records: mergedRecords,
    birthInfo: mergedBirthInfo
  };
}

module.exports = {
  isConfigured,
  syncLocalWithCloud,
  saveSyncDoc
};
