import { StoragePaths, STORAGE_KEYS, validateStoragePaths } from './storagePaths'
import { syncStorageEnvironment } from './storageEnvironment'

interface StorageConfig {
    store: { agentDeck: Partial<StoragePaths> }
    save: () => void | Promise<void>
}

/** Shared for the lifetime of the settings service, including navigation away from the tab. */
export class StorageSettings {
    draft: StoragePaths
    message = ''
    error = false
    busy = false
    private revision = 0
    private queuedRevision = -1
    private pending = 0
    private queue: Promise<void> = Promise.resolve()

    constructor (private config: StorageConfig, private syncEnvironment = syncStorageEnvironment) {
        this.draft = this.savedPaths()
    }

    private savedPaths (): StoragePaths {
        return Object.fromEntries(STORAGE_KEYS.map(k => [k, this.config.store.agentDeck[k] || ''])) as unknown as StoragePaths
    }

    change (key: keyof StoragePaths, value: string): void {
        this.draft[key] = value
        this.revision++
        this.error = false
        this.message = 'pending'
    }

    save (): Promise<void> {
        if (this.queuedRevision === this.revision && this.pending) { return this.queue }
        const revision = this.revision
        const draft = { ...this.draft }
        this.queuedRevision = revision
        this.pending++
        this.busy = true
        this.queue = this.queue.then(async () => {
            const previous = this.savedPaths()
            let undoEnvironment: (() => Promise<void>) | undefined
            try {
                const next = validateStoragePaths(draft)
                undoEnvironment = await this.syncEnvironment(next)
                Object.assign(this.config.store.agentDeck, next)
                await this.config.save()
                if (this.revision === revision) {
                    this.draft = next
                    this.error = false
                    this.message = 'saved'
                }
            } catch (error: any) {
                Object.assign(this.config.store.agentDeck, previous)
                if (undoEnvironment) {
                    try { await undoEnvironment() } catch { error = new Error('storage.environmentRollback') }
                }
                if (this.revision === revision) {
                    this.error = true
                    this.message = String(error?.message || '').startsWith('storage.') ? error.message : 'failed'
                }
            } finally {
                this.pending--
                this.busy = this.pending > 0
            }
        })
        return this.queue
    }

    flush (): void {
        if (this.message === 'pending') { void this.save() }
    }
}

const models = new WeakMap<object, StorageSettings>()
export function storageSettingsFor (config: StorageConfig): StorageSettings {
    let model = models.get(config)
    if (!model) { model = new StorageSettings(config); models.set(config, model) }
    return model
}
