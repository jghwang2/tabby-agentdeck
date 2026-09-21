import { LoginBrowser } from './accounts'

export function loginOriginAllowed (provider: string, raw: string): boolean {
    try {
        const url = new URL(raw)
        const hosts = provider === 'codex' ? ['auth.openai.com', 'auth0.openai.com']
            : ['claude.ai', 'console.anthropic.com', 'platform.claude.com']
        return url.protocol === 'https:' && !url.port && hosts.includes(url.hostname)
    } catch { return false }
}

/** Use the real browser so SSO, passkeys and additional verification remain available. */
export const openAccountBrowser: LoginBrowser = async (raw, account) => {
    if (!loginOriginAllowed(account.provider, raw)) { throw new Error('지원하지 않는 로그인 주소입니다.') }
    const url = new URL(raw)
    if (!url.searchParams.has('login_hint')) { url.searchParams.set('login_hint', account.id) }
    try { await require('electron').shell.openExternal(url.toString()) } catch {
        throw new Error('로그인 브라우저를 열지 못했습니다.')
    }
    return () => {}
}
