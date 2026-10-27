import * as fs from 'fs'
import { agentHome } from './storagePaths'
import { readClaudeSettings } from './claudeSettings'
import { hasAgentDeckHooks, installHooks, uninstallHooks } from './claudeHooks'
import { isWrapped, installStatusLine, uninstallStatusLine, innerConfigPath, readInner } from './statusLine'

/** Match the selected installation toggles, preserving account-specific user settings. */
export function syncClaudeIntegration (home: string, source: string): void {
    const primary = readClaudeSettings(agentHome('claude'))
    const target = readClaudeSettings(home)
    if (isWrapped(target) && !fs.existsSync(innerConfigPath(home))) {
        fs.writeFileSync(innerConfigPath(home), JSON.stringify(readInner(source)), 'utf8')
    }
    if (hasAgentDeckHooks(primary)) { installHooks([home]) } else { uninstallHooks([home]) }
    if (isWrapped(primary)) { installStatusLine([home]) } else { uninstallStatusLine([home]) }
}
