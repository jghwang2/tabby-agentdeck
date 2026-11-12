import { execFileSync } from 'child_process'

/** Installation-only preflight. Never run this in per-event or polling paths. */
export function requirePython (): void {
    try {
        const ready = execFileSync(process.platform === 'win32' ? 'python' : 'python3',
            ['-c', 'import sys; sys.exit(1) if sys.version_info < (3, 8) else print("agentdeck-python-ready")'],
            {windowsHide: true, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})
        if (ready.trim() !== 'agentdeck-python-ready') throw Error('Interpreter unavailable')
    } catch { throw Error('Python 3.8 이상을 설치하고 PATH에 추가한 뒤 다시 적용하세요. 기존 훅 설정은 유지했습니다.') }
}
