import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { runtimeRoot } from './storagePaths'

/** Copy once, never overwrite newer data or follow links. Keep the originals for rollback. */
export function copyRuntimeData (source: string, target: string): void {
    if (!fs.existsSync(source) || path.resolve(source) === path.resolve(target)) { return }
    const stat = fs.lstatSync(source)
    if (stat.isSymbolicLink()) { return }
    if (stat.isDirectory()) {
        fs.mkdirSync(target, { recursive: true })
        for (const entry of fs.readdirSync(source)) { copyRuntimeData(path.join(source, entry), path.join(target, entry)) }
    } else if (stat.isFile() && !fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
    }
}

export function migrateRuntimeData (): void {
    const root = runtimeRoot()
    const marker = path.join(root, '.legacy-imported')
    if (fs.existsSync(marker)) { return }
    const config = process.env.TABBY_CONFIG_DIRECTORY
    const defaultConfig = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'tabby')
    // Other profiles and isolated test apps must not import the user's live sessions.
    if (config && path.resolve(config).toLowerCase() !== path.resolve(defaultConfig).toLowerCase()) { return }
    const old = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'tabby-agentdeck')
    for (const entry of ['sessions.json', 'statusline-inner.json', 'scoped-limit.json', 'status', 'meta', 'history-search']) {
        copyRuntimeData(path.join(old, entry), path.join(root, entry))
    }
    const oldMailbox = config ? path.join(config, 'agentdeck-mailbox') : old
    for (const entry of ['mailbox.json', 'mailbox-connections', 'navigation-context.txt']) {
        copyRuntimeData(path.join(oldMailbox, entry), path.join(root, 'mailbox', entry))
    }
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(marker, new Date().toISOString(), 'utf8')
}
