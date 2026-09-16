import { Injectable } from '@angular/core'
import { AppService, ConfigService } from 'tabby-core'

export const ROOT_PROFILE_ID = 'agentdeck:root'

/**
 * 새 탭이 항상 작업 루트에서 열리게 한다.
 *
 * Tabby 프로필을 하나 만들어 config 에 심고, 사용자가 아직 기본 프로필을
 * 직접 고른 적이 없으면 이것을 기본으로 지정한다.
 * 한 번 심은 뒤에는 사용자가 설정에서 바꾼 값을 존중한다 (매 기동 덮어쓰지 않음).
 */
@Injectable({ providedIn: 'root' })
export class AgentDeckProfileService {
    constructor (
        private app: AppService,
        private config: ConfigService,
    ) { }

    init (): void {
        this.app.ready$.subscribe(() => this.ensureProfile())
    }

    private ensureProfile (): void {
        const cfg = this.config.store.agentDeck
        // 경로를 안 정했으면 만들지 않는다 — 남의 홈 디렉토리에 엉뚱한 프로필을 심지 않기 위해
        if (!cfg.rootProfile || !cfg.rootProfileCwd) {
            return
        }

        const profiles = this.config.store.profiles || []
        const existing = profiles.find((p: any) => p.id === ROOT_PROFILE_ID)

        const profile = {
            id: ROOT_PROFILE_ID,
            type: 'local',
            name: cfg.rootProfileName || 'Agent Root',
            options: {
                command: cfg.rootProfileCommand || 'powershell.exe',
                args: [...(cfg.rootProfileArgs || [])],
                cwd: cfg.rootProfileCwd,
                env: { ...(cfg.rootProfileEnv || {}) },
                // 권한 승격은 이 플러그인이 다루지 않는다 — Tabby 를 어떤 권한으로 띄울지는 사용자의 몫이다.
            },
        }

        if (existing) {
            // 사용자가 설정 UI 에서 손댔을 수 있으므로 비어 있는 값만 보정한다
            if (!existing.options) {
                existing.options = profile.options
                this.config.save()
            } else {
                let dirty = false
                if (!existing.options.cwd) {
                    existing.options.cwd = profile.options.cwd
                    dirty = true
                }
                // npm 전역 .ps1 래퍼(claude 등)가 기본 실행 정책에 막히지 않도록 인자를 보정한다.
                // 사용자가 직접 인자를 넣어 뒀다면 건드리지 않는다.
                if (!existing.options.args || existing.options.args.length === 0) {
                    existing.options.args = [...profile.options.args]
                    dirty = true
                }
                // 색 지원 환경변수는 사용자가 지정한 값을 덮지 않고 빠진 것만 채운다
                existing.options.env = existing.options.env || {}
                for (const [k, v] of Object.entries(profile.options.env)) {
                    if (existing.options.env[k] === undefined) {
                        existing.options.env[k] = v
                        dirty = true
                    }
                }
                if (dirty) {
                    this.config.save()
                }
            }
        } else {
            profiles.push(profile)
            this.config.store.profiles = profiles
            // 최초 1회만 기본 프로필로 지정
            if (!cfg.rootProfileClaimed) {
                this.config.store.terminal.profile = ROOT_PROFILE_ID
                cfg.rootProfileClaimed = true
            }
            this.config.save()
        }
    }
}
