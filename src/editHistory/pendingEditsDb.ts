export interface PendingEdit {
	fileId: string;
	path: string;
	content: string;
	ts: number;
}

const STORE_NAME = "pending";
const VERSION = 1;

export class PendingEditsDb {
	private dbName: string;
	private db: IDBDatabase | null = null;

	constructor(dbName: string) {
		this.dbName = dbName;
	}

	open(): Promise<void> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, VERSION);

			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: "fileId" });
				}
			};

			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onerror = () => {
				reject(request.error);
			};
		});
	}

	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}

	async put(edit: PendingEdit): Promise<void> {
		const tx = this.requireDb().transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		store.put(edit);
		return this.txPromise(tx);
	}

	async get(fileId: string): Promise<PendingEdit | undefined> {
		const tx = this.requireDb().transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const request = store.get(fileId);
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result ?? undefined);
			request.onerror = () => reject(request.error);
		});
	}

	async getAll(): Promise<PendingEdit[]> {
		const tx = this.requireDb().transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const request = store.getAll();
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result ?? []);
			request.onerror = () => reject(request.error);
		});
	}

	async remove(fileId: string): Promise<void> {
		const tx = this.requireDb().transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		store.delete(fileId);
		return this.txPromise(tx);
	}

	async clear(): Promise<void> {
		const tx = this.requireDb().transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		store.clear();
		return this.txPromise(tx);
	}

	private requireDb(): IDBDatabase {
		if (!this.db) throw new Error("PendingEditsDb not opened");
		return this.db;
	}

	private txPromise(tx: IDBTransaction): Promise<void> {
		return new Promise((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}
}
