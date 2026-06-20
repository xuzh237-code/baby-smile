const config = require('./cloudConfig');
const core = require('./core');

const DOC_KIND = 'baby_smile_user_data';
const RECORD_CHUNK_KIND = 'baby_smile_records_chunk';
const RECORDS_PER_CHUNK = 60;

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

async function fetchRecordChunks(parentId, expectedCount = 0) {
  if (!parentId) return [];
  const res = await getCollection()
    .where({ kind: RECORD_CHUNK_KIND, parentId })
    .limit(Math.min(Math.max(expectedCount + 5, 100), 100))
    .get();
  return (res.data || [])
    .filter(chunk => expectedCount <= 0 || Number(chunk.chunkIndex) < expectedCount)
    .sort((a, b) => Number(a.chunkIndex) - Number(b.chunkIndex));
}

function splitRecords(records = []) {
  const normalized = core.sortRecordsByRecent(records).map(core.normalizeRecord);
  const chunks = [];
  for (let i = 0; i < normalized.length; i += RECORDS_PER_CHUNK) {
    chunks.push(normalized.slice(i, i + RECORDS_PER_CHUNK));
  }
  return chunks;
}

async function saveRecordChunks(parentId, records) {
  const chunks = splitRecords(records);
  const collection = getCollection();
  const existing = await fetchRecordChunks(parentId);
  const existingByIndex = new Map(existing.map(chunk => [Number(chunk.chunkIndex), chunk]));
  const nowIso = new Date().toISOString();

  for (let index = 0; index < chunks.length; index += 1) {
    const data = {
      kind: RECORD_CHUNK_KIND,
      parentId,
      chunkIndex: index,
      records: chunks[index],
      updatedAt: nowIso
    };
    const current = existingByIndex.get(index);
    if (current?._id) {
      await collection.doc(current._id).update({ data });
    } else {
      await collection.add({ data });
    }
  }

  for (const chunk of existing) {
    if (Number(chunk.chunkIndex) >= chunks.length && chunk._id) {
      await collection.doc(chunk._id).update({
        data: {
          records: [],
          stale: true,
          updatedAt: nowIso
        }
      });
    }
  }

  return chunks.length;
}

async function saveSyncDoc(docId, records, birthInfo) {
  if (!isConfigured()) return { configured: false };
  const recordChunks = splitRecords(records);
  const data = {
    kind: DOC_KIND,
    schemaVersion: 2,
    records: [],
    recordChunkCount: recordChunks.length,
    birthInfo: normalizeBirthInfo(birthInfo),
    updatedAt: new Date().toISOString()
  };
  let nextDocId = docId;
  if (docId) {
    await getCollection().doc(docId).update({ data });
  } else {
    const res = await getCollection().add({ data });
    nextDocId = res._id;
  }
  await saveRecordChunks(nextDocId, records);
  return { configured: true, docId: nextDocId };
}

async function syncLocalWithCloud(localRecords, localBirthInfo) {
  const { configured, doc } = await fetchSyncDoc();
  if (!configured) return { configured: false };

  let cloudRecords = doc?.records || [];
  if (doc?._id && doc.recordChunkCount > 0) {
    const chunks = await fetchRecordChunks(doc._id, doc.recordChunkCount);
    cloudRecords = chunks.flatMap(chunk => chunk.records || []);
  }
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

function getReadableCloudError(error = {}) {
  const text = String(error.errMsg || error.message || error || '');
  if (!text) return '微信同步失败';
  if (text.includes('collection') || text.includes('DATABASE_COLLECTION_NOT_EXIST')) {
    return '云端集合不存在';
  }
  if (text.includes('permission') || text.includes('-502003') || text.includes('access')) {
    return '云端权限不足';
  }
  if (text.includes('env') || text.includes('init') || text.includes('cloud')) {
    return '云开发环境异常';
  }
  if (text.includes('data exceed max size')) {
    return '数据太多，需分片同步';
  }
  return `同步失败：${text.slice(0, 24)}`;
}

module.exports = {
  isConfigured,
  syncLocalWithCloud,
  saveSyncDoc,
  getReadableCloudError
};
