import type { CustomEffectRecord, Layer, Project, SavedElement } from '../types/project';

const DB_NAME = 'alight_motion_web_db';
const DB_VERSION = 2;
const STORE_PROJECTS = 'projects';
const STORE_ELEMENTS = 'elements';
const STORE_MEDIA = 'media';
const STORE_CUSTOM_EFFECTS = 'customEffects';

const sessionMediaUrlCache = new Map<string, string>();
const sessionMediaBlobCache = new Map<string, Blob>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ELEMENTS)) {
        db.createObjectStore(STORE_ELEMENTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CUSTOM_EFFECTS)) {
        db.createObjectStore(STORE_CUSTOM_EFFECTS, { keyPath: 'uid' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function rehydrateLayerMediaUrls(layers: Layer[]): Promise<void> {
  const tasks: Promise<void>[] = [];
  const walk = (list: Layer[]) => {
    for (const l of list) {
      if (l.mediaData?.mediaId) {
        const md = l.mediaData;
        tasks.push(
          loadMediaUrl(md.mediaId!).then((fresh) => {
            if (fresh) md.src = fresh;
          })
        );
      }
      if (l.audioData?.mediaId) {
        const ad = l.audioData;
        tasks.push(
          loadMediaUrl(ad.mediaId!).then((fresh) => {
            if (fresh) ad.src = fresh;
          })
        );
      }
      if (l.groupLayers?.length) walk(l.groupLayers);
    }
  };
  walk(layers);
  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

export async function loadAllProjects(): Promise<Project[]> {
  try {
    const db = await openDb();
    const list = await new Promise<Project[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).getAll();
      req.onsuccess = () => {
        const res = (req.result as Project[]) || [];
        res.sort((a, b) => (b.modifiedTime ?? 0) - (a.modifiedTime ?? 0));
        resolve(res);
      };
      req.onerror = () => reject(req.error);
    });
    // Rehydrate stored mediaId blobs immediately so reopened Home Screen PWA sessions never hold dead blob: URLs
    await Promise.all(list.map((p) => rehydrateLayerMediaUrls(p.layers)));
    return list;
  } catch {
    return [];
  }
}

export async function saveProjectToDb(project: Project): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).put(project);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteProjectFromDb(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAllElements(): Promise<SavedElement[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ELEMENTS, 'readonly');
      const req = tx.objectStore(STORE_ELEMENTS).getAll();
      req.onsuccess = () => resolve((req.result as SavedElement[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveElementToDb(el: SavedElement): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ELEMENTS, 'readwrite');
    tx.objectStore(STORE_ELEMENTS).put(el);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteElementFromDb(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ELEMENTS, 'readwrite');
    tx.objectStore(STORE_ELEMENTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveMediaBlob(id: string, blob: Blob, name: string, mime: string): Promise<string> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_MEDIA, 'readwrite');
    tx.objectStore(STORE_MEDIA).put({ id, blob, name, mime });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const url = URL.createObjectURL(blob);
  sessionMediaBlobCache.set(id, blob);
  sessionMediaUrlCache.set(id, url);
  return url;
}

export async function loadMediaBlob(id: string): Promise<Blob | null> {
  const cached = sessionMediaBlobCache.get(id);
  if (cached) return cached;
  try {
    const db = await openDb();
    const record = await new Promise<{ blob: Blob } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_MEDIA, 'readonly');
      const req = tx.objectStore(STORE_MEDIA).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (record?.blob) {
      sessionMediaBlobCache.set(id, record.blob);
      return record.blob;
    }
  } catch {
    // ignore IDB errors
  }
  return null;
}

export async function loadMediaArrayBuffer(id: string): Promise<ArrayBuffer | null> {
  const blob = await loadMediaBlob(id);
  if (!blob) return null;
  try {
    return await blob.arrayBuffer();
  } catch {
    return null;
  }
}

export async function loadMediaUrl(id: string): Promise<string | null> {
  const cachedUrl = sessionMediaUrlCache.get(id);
  if (cachedUrl) return cachedUrl;
  const blob = await loadMediaBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  sessionMediaUrlCache.set(id, url);
  return url;
}

export async function loadAllCustomEffects(): Promise<CustomEffectRecord[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CUSTOM_EFFECTS, 'readonly');
      const req = tx.objectStore(STORE_CUSTOM_EFFECTS).getAll();
      req.onsuccess = () => {
        const list = (req.result as CustomEffectRecord[]) || [];
        list.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveCustomEffectToDb(rec: CustomEffectRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_CUSTOM_EFFECTS, 'readwrite');
    tx.objectStore(STORE_CUSTOM_EFFECTS).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteCustomEffectFromDb(uid: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_CUSTOM_EFFECTS, 'readwrite');
    tx.objectStore(STORE_CUSTOM_EFFECTS).delete(uid);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllStorage(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_PROJECTS, STORE_ELEMENTS, STORE_MEDIA, STORE_CUSTOM_EFFECTS], 'readwrite');
    tx.objectStore(STORE_PROJECTS).clear();
    tx.objectStore(STORE_ELEMENTS).clear();
    tx.objectStore(STORE_MEDIA).clear();
    tx.objectStore(STORE_CUSTOM_EFFECTS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
