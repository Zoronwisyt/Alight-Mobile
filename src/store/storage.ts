import type { Project, SavedElement } from '../types/project';

const DB_NAME = 'alight_motion_web_db';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_ELEMENTS = 'elements';
const STORE_MEDIA = 'media';

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadAllProjects(): Promise<Project[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).getAll();
      req.onsuccess = () => {
        const list = (req.result as Project[]) || [];
        list.sort((a, b) => (b.modifiedTime ?? 0) - (a.modifiedTime ?? 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
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
  return URL.createObjectURL(blob);
}

export async function loadMediaUrl(id: string): Promise<string | null> {
  const db = await openDb();
  const record = await new Promise<{ blob: Blob } | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_MEDIA, 'readonly');
    const req = tx.objectStore(STORE_MEDIA).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return record?.blob ? URL.createObjectURL(record.blob) : null;
}

export async function clearAllStorage(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_PROJECTS, STORE_ELEMENTS, STORE_MEDIA], 'readwrite');
    tx.objectStore(STORE_PROJECTS).clear();
    tx.objectStore(STORE_ELEMENTS).clear();
    tx.objectStore(STORE_MEDIA).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
