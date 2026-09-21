import { AfterViewInit, Component, ElementRef, NgZone, Optional, OnDestroy } from '@angular/core'
import { Subscription } from 'rxjs'
import { ConfigService, HotkeysService, LocaleService, PlatformService } from 'tabby-core'

import { Lang, pickLang, translate } from './i18n'
import { LAYOUT_DEFAULTS, defaultHotkeys } from './config'
import {
    KEY_ITEMS, KeyItem, BindingPlan, Platform, applyBinding, displayStrokes, isDefaultBinding,
    keystrokeFromEvent, planBinding, resetBinding,
} from './keybind'
import { hooksInstalled, hooksSupported, installHooks, uninstallHooks } from './claudeHooks'
import { installStatusLine, statusLineInstalled, statusLineSupported, uninstallStatusLine } from './statusLine'
import { codexDisabledEvents, codexEventLabel, codexHooksInstalled, setCodexHooks } from './codexHooks'
import { AgentDeckRecoveryService } from './recovery.service'
import { AgentDeckUpdateService } from './update.service'
import { AgentDeckDevReloadService } from './devReload.service'
import { UpdateOutcome } from './update'
import { collectDiagBundle, configStamp, DIAG_PATH, pluginVersion } from './diag'

/** 확인 결과를 사람 말로 — 설정 창의 한 줄 안내 */
const UPDATE_OUTCOME_TEXT: Record<UpdateOutcome, string> = {
    'disabled': '자동 업데이트가 꺼져 있다',
    'too-soon': '방금 확인했다',
    'dev-install': '새 버전이 있지만 개발 설치라 건드리지 않는다',
    'unknown': 'npm 에 물어보지 못했다 (네트워크·프록시)',
    'up-to-date': '최신이다',
    'update-ready': '새 버전이 있다',
    'skipped': '이 버전은 건너뛰기로 했다',
    'postponed': '나중에 하기로 했다',
    'installing': '설치했다 — 창을 새로 고쳐 갈아탄다 (탭·세션 유지)',
    'installed': '설치했다 — Tabby 를 다시 켜면 적용된다 (창을 새로 고치지 못했다)',
    'failed': '업데이트를 시작하지 못했다',
}

const DOCK_KEYS: Record<string, string> = {
    left: 'dock.left',
    right: 'dock.right',
    top: 'dock.top',
    bottom: 'dock.bottom',
}

/**
 * 설정 > AgentDeck 탭.
 *
 * 사용자가 실제로 바꿀 일이 있는 것만 노출한다 — 레이아웃 on/off, 기동 시 탭 복원 끄기,
 * 지난 세션 이어받기, 에이전트 상태 연동, 작업 루트 프로필, 문제 신고, (개발 설치) 개발자 옵션.
 * 2026-09-14 유저 지시로 자동 업데이트·이어받기 개수·사이드바 목록·세션 그룹·미리보기 패널 절을
 * 템플릿에서 주석 처리했다 — "알아서 세팅해 두고, 고치고 싶으면 설정 파일을 직접 고칠 일".
 * 같은 날 `"지금 이 탭" 줄`(metaLine)과 `통보 채널`(notifyChannel) 스위치도 걷어냈다 —
 * 앞의 것은 statusLine 을 연결해 놓고 줄만 끄는 조합에 뜻이 없고, 뒤의 것은 훅 설치/제거가
 * 정답을 이미 알고 있다(`syncNotifyChannel`). 두 값 모두 config 에는 남아 있다.
 * 상태 훅과 statusLine 을 따로 걸던 줄 셋도 `Claude 연동` · `Codex 연동` 둘로 합쳤다
 * (`toggleClaude`) — 사용자가 정하는 것은 "이 에이전트를 사이드바에 붙일까" 하나뿐이다.
 * 값은 `config.ts` 기본값이 그대로 쓰인다. 아래 옛 설명은 그 절들이 있던 시절 기준이다.
 * 나머지(화면비, 사이드바 폭, 투명도, 상태 감지, 붙여넣기/줄바꿈 가로채기, 렌더 보정)는
 * 손댈 이유가 거의 없고 잘못 만지면 화면이 깨지는 값이라 `config.ts` 의 기본값으로 고정하고
 * 설정 창에서는 뺐다. 정말 필요하면 설정 파일의 `agentDeck.*` 를 직접 고친다.
 *
 * `enabled` 는 deck.service 가 `config.changed$` 를 구독해 즉시 반영한다(deck.service.ts:256).
 * 루트 프로필은 기동 시 한 번만 읽으므로 재시작이 필요하다고 적어 둔다.
 *
 * `사이드바 목록` 절을 `세션 그룹` **앞**에 둔 이유 — 그룹도 결국 이 목록의 세부 규칙이라
 * 목록 전체에 걸리는 것(키보드 조작 · 줄에 무엇을 보일지)을 먼저 읽는 편이 순서가 맞는다.
 * 0.14.0 의 `dragAutoScroll` 도 같은 절에 뒀다 — 정하는 것이 "목록을 다루는 방법" 이라
 * 키보드 조작과 성질이 같고, 따로 절을 만들면 항목 하나뿐인 절이 생긴다.
 * 0.13.0 에서 생긴 세 값(`keyboardNav` / `keyboardNavWrap` / `subagentCount`)은
 * 설정 창에 자리가 없어 `config.yaml` 을 손으로 고쳐야만 바꿀 수 있었다.
 *
 * `keyboardNavWrap` 과 `keyboardCloseTab`(0.19.0) 은 `keyboardNav` 를 끄면 아무 뜻이 없으므로 그때는 줄을 아예 감춘다 —
 * 꺼진 값을 회색으로 남겨 두는 것보다 "지금 만질 수 있는 것" 이 짧아진다.
 * 세션 그룹 절에 값이 하나도 없는 것(0.20.0)도 같은 기준이다 — 끌 이유가 없는 스위치와
 * 자동으로 알아낼 수 있는 경로는 설정이 아니라 동작이어야 한다.
 * 이 세 값은 deck.service/notify.service 가 쓸 때마다 store 를 다시 읽으므로
 * (deck.service.ts `navCanFocus`/`moveNav`, notify.service `subagentEnabled`)
 * 토글하면 바로 듣는다 — 그래서 재시작 안내를 붙이지 않았다.
 */
@Component({
    selector: 'agentdeck-settings-tab',
    template: `
<h3 class="mb-3">AgentDeck</h3>

<div class="form-line">
    <div class="header">
        <div class="title">{{t('layout.title')}}</div>
        <div class="description">{{t('layout.desc')}}</div>
    </div>
    <toggle [(ngModel)]="config.store.agentDeck.enabled" (ngModelChange)="config.save()"></toggle>
</div>

<div class="form-line">
    <div class="header">
        <div class="title">{{t('reset.title')}}</div>
        <div class="description">
            {{t('reset.desc')}}
            <span *ngIf="layoutChanged()">{{t('reset.now', { dock: dockLabel(), size: sizeLabel() })}}</span>
            <span *ngIf="!layoutChanged()">{{t('reset.default')}}</span>
        </div>
    </div>
    <button class="btn btn-secondary" type="button" [disabled]="!layoutChanged()" (click)="resetLayout()">
        <i class="fas fa-undo me-2"></i>{{t('reset.btn')}}
    </button>
</div>

<div class="form-line">
    <div class="header">
        <div class="title">{{t('norecover.title')}}</div>
        <div class="description" [innerHTML]="t('norecover.desc')"></div>
    </div>
    <toggle [ngModel]="config.store.agentDeck.noTabRecovery" (ngModelChange)="recovery.setNoTabRecovery($event)"></toggle>
</div>

<!-- [설정 화면에서 숨김 자동 업데이트·지금 확인 — 기본값(config.ts)으로 고정, 바꿀 땐 config.yaml agentDeck.* 직접]
<div class="form-line">
    <div class="header">
        <div class="title">자동 업데이트</div>
        <div class="description">
            기동할 때 npm 을 보고 새 버전이 있으면 <b>물어본 뒤</b> 업데이트한다.
            승낙하면 Tabby 가 닫히고 → 설치하고 → <b>스스로 다시 켜진다</b> (사람이 할 일은 없다).
            돌고 있는 플러그인은 갈아끼울 수 없어서 이 방법뿐이다.
            끊긴 Claude Code·Codex 대화는 <code>⟲ 지난 세션</code> 에서 이어받으면 된다.
            <b>개발 설치(소스 링크)에는 설치하지 않는다</b> — 작업 중인 소스를 덮어쓰기 때문이다.
        </div>
    </div>
    <toggle [(ngModel)]="config.store.agentDeck.autoUpdate" (ngModelChange)="config.save()"></toggle>
</div>

<div class="form-line" *ngIf="config.store.agentDeck.autoUpdate">
    <div class="header">
        <div class="title">지금 확인</div>
        <div class="description">
            간격({{config.store.agentDeck.updateCheckIntervalHours}}시간)과 <code>다시 묻지 않기</code> 를 무시하고 한 번 확인한다.
            <span *ngIf="updateMsg">— {{updateMsg}}</span>
        </div>
    </div>
    <button class="btn btn-secondary" type="button" [disabled]="updateBusy" (click)="checkUpdate()">
        <i class="fas fa-rotate me-2"></i>{{updateBusy ? '확인 중…' : '확인'}}
    </button>
</div>

-->

<div class="form-line">
    <div class="header">
        <div class="title">{{t('resume.title')}}</div>
        <div class="description" [innerHTML]="t('resume.desc')"></div>
    </div>
    <toggle [(ngModel)]="config.store.agentDeck.resumeList" (ngModelChange)="config.save()"></toggle>
</div>

<!-- [설정 화면에서 숨김 몇 줄까지·며칠치 — 기본값(config.ts)으로 고정, 바꿀 땐 config.yaml agentDeck.* 직접]
<div class="form-line" *ngIf="config.store.agentDeck.resumeList">
    <div class="header">
        <div class="title">몇 줄까지 · 며칠치</div>
        <div class="description">
            그룹마다 최근 <b>{{config.store.agentDeck.resumeListLimit}}줄</b>까지,
            최근 <b>{{config.store.agentDeck.resumeListDays}}일</b> 안의 세션만 보여준다.
            길게 잡으면 살아 있는 탭이 아래로 밀린다. 숨긴 세션은 줄 우클릭으로 되돌릴 수 없고
            <code>config.yaml</code> 의 <code>resumeHidden</code> 을 비우면 다시 나온다.
        </div>
    </div>
    <div class="d-flex align-items-center">
        <input class="form-control text-end me-2" style="width: 5rem" type="number" min="0" max="50"
            [(ngModel)]="config.store.agentDeck.resumeListLimit" (ngModelChange)="config.save()">
        <input class="form-control text-end" style="width: 5rem" type="number" min="0" max="365"
            [(ngModel)]="config.store.agentDeck.resumeListDays" (ngModelChange)="config.save()">
    </div>
</div>

-->

<h3 class="mt-4 mb-3">{{t('keys.head')}}</h3>
<div class="text-muted mb-3" [innerHTML]="t('keys.intro')"></div>

<div class="form-line ad-keyrow" *ngFor="let it of keyItems">
    <div class="header">
        <div class="title">
            {{t(it.label)}}
            <span class="badge bg-secondary ms-1" *ngIf="it.stock">{{t('keys.stock')}}</span>
        </div>
        <div class="description">
            <ng-container *ngIf="capturing !== it.id && !isPending(it)">
                <kbd class="me-1" *ngFor="let k of keysOf(it)">{{k}}</kbd>
                <span class="text-muted" *ngIf="!keysOf(it).length">{{t('keys.unbound')}}</span>
            </ng-container>
            <span class="text-info" *ngIf="capturing === it.id">{{t('keys.press')}}</span>
            <div class="text-warning" *ngIf="isPending(it)">
                <kbd>{{pending!.plan.display}}</kbd> — {{t('keys.conflict', { names: pending!.names })}}
                <div class="mt-1">
                    <button class="btn btn-sm btn-warning me-1" type="button" (click)="confirmPending()">{{t('keys.force')}}</button>
                    <button class="btn btn-sm btn-secondary me-1" type="button" (click)="startCapture(it)">{{t('keys.change')}}</button>
                    <button class="btn btn-sm btn-link" type="button" (click)="pending = null">{{t('keys.cancel')}}</button>
                </div>
            </div>
            <span class="text-danger d-block mt-1" *ngIf="keyMsgFor === it.id && keyMsg">{{keyMsg}}</span>
        </div>
    </div>
    <div class="d-flex gap-1">
        <button class="btn btn-secondary" type="button"
                (click)="capturing === it.id ? stopCapture() : startCapture(it)">
            {{t(capturing === it.id ? 'keys.cancel' : 'keys.change')}}
        </button>
        <button class="btn btn-outline-secondary" type="button" [disabled]="isDefault(it)" (click)="resetKeys(it)">
            {{t('keys.default')}}
        </button>
    </div>
</div>
<div class="text-muted mb-3" [innerHTML]="t('keys.fixed')"></div>

<!-- [설정 화면에서 숨김 사이드바 목록·세션 그룹·미리보기 패널 — 기본값(config.ts)으로 고정, 바꿀 땐 config.yaml agentDeck.* 직접]
<h3 class="mt-4 mb-3">사이드바 목록</h3>
<div class="text-muted mb-3">
    세션 목록을 마우스 없이 다루는 방법과, 줄에 무엇까지 보일지를 정한다. 바꾸면 곧바로 적용된다.
</div>

<div class="form-line">
    <div class="header">
        <div class="title">키보드로 다루기</div>
        <div class="description">
            <code>Ctrl+L</code> 로 목록에 들어가 <code>↑↓</code> 로 훑고 Enter 로 그 탭으로 옮긴다
            (<code>Esc</code> 로 터미널로 돌아온다). <b>훑는 동안 활성 탭은 바뀌지 않는다</b> —
            줄마다 탭이 바뀌면 그 탭의 출력이 화면을 덮어 훑어보는 것 자체가 안 된다.
            포커스가 사이드바에 없는 동안은 키를 한 개도 가로채지 않으므로 켜 둬서 잃는 것이 없다.
            끄면 목록이 포커스를 받지 않는다.
            키 배정은 <b>단축키</b> 탭의 <code>agentdeck-focus-list</code> 에서 바꾼다.
        </div>
    </div>
    <toggle [(ngModel)]="config.store.agentDeck.keyboardNav" (ngModelChange)="config.save()"></toggle>
</div>

<div class="form-line" *ngIf="config.store.agentDeck.keyboardNav">
    <div class="header">
        <div class="title">끝에서 반대쪽으로 감싸기</div>
        <div class="description">
            맨 아래에서 <code>↓</code> 를 한 번 더 누르면 맨 위로 넘어간다.
            기본은 꺼짐 — 끝에서 멈춰야 "맨 아래에 왔다" 가 보이고 목록이 통째로 튀지 않는다.
            끝에서 끝으로 갈 일은 <code>Home</code> · <code>End</code> 가 받는다.
            켜도 <b>맨 위의 ↑ 는 검색창으로 나간다</b> — 그 경계까지 감싸기에 내주면
            목록에서 검색창으로 돌아갈 키가 없어진다.
        </div>
    </div>
    <toggle [(ngModel)]="config.store.agentDeck.keyboardNavWrap" (ngModelChange)="config.save()"></toggle>
</div>

<div class="form-line" *ngIf="config.store.agentDeck.keyboardNav">
    <div class="header">
        <div class="title"><code>Ctrl+W</code> 로 탭 닫기</div>
        <div class="description">
            터미널에서 누르면 <b>지금 보고 있는 탭</b>, 목록이 키보드를 갖고 있으면
            <b>포커스 줄의 탭</b>을 닫는다 (그룹 헤더에서는 아무 일도 하지 않는다).
            사이드바 <code>✕</code> 와 같은 경로라 돌아가는 프로세스가 있으면 평소처럼 한 번 물어본다.
            <b>끄면 <code>Ctrl+W</code> 가 터미널로 그대로 간다</b> — 셸·에이전트 CLI 에서
            그 키는 <b>앞 단어 지우기</b>이고, 우리는 닫을 탭이 정해졌을 때만 키를 가로챈다.
            <code>키보드로 다루기</code> 를 끄면 이 항목도 함께 꺼진다.
        </div>
    </div>
    <toggle [(ngModel)]="config.store.agentDeck.keyboardCloseTab" (ngModelChange)="config.save()"></toggle>
</div>

<div class="form-line">
    <div class="header">
        <div class="title">서브에이전트 개수 보이기</div>
        <div class="description">
            그 세션이 백그라운드로 돌리고 있는 에이전트 수를 줄에 <b>❖3</b> 으로 보인다
            (툴팁에 무엇을 시켜 놨는지와 가장 오래된 것의 경과 시간).
            0 개면 아무것도 그리지 않으므로 켜 둬서 잃는 것이 없다.
            끄면 표시도 멈추고 대화 기록을 <b>읽지도 않는다</b>.
        </div>
    </div>
    <toggle [(ngModel)]="config.store.agentDeck.subagentCount" (ngModelChange)="config.save()"></toggle>
</div>

<div class="form-line">
    <div class="header">
        <div class="title">끌 때 목록 끝에서 저절로 흐르기</div>
        <div class="description">
            줄을 끌어 순서를 바꿀 때 목록의 위·아래 끝에 커서를 대고 있으면
            <b>커서를 더 움직이지 않아도</b> 목록이 그 방향으로 흘러간다.
            그래서 탭이 많아 화면에 안 보이는 자리로도 한 손짓에 옮길 수 있다.
            끄면 손을 뗀 뒤 스크롤하고 다시 끌어야 하지만, 그 대신
            <b>맨 끝 줄 뒤에 놓는 조작이 미끄러지지 않는다</b>.
        </div>
    </div>
    <toggle [(ngModel)]="config.store.agentDeck.dragAutoScroll" (ngModelChange)="config.save()"></toggle>
</div>

<h3 class="mt-4 mb-3">세션 그룹</h3>
<div class="text-muted mb-3">
    사이드바의 세션을 <b>프로젝트 단위</b>로 묶고 헤더를 눌러 접는다. 끄고 켜는 값이 없다 —
    그룹이 하나뿐이면 헤더도 순서도 건드리지 않으므로, 한 프로젝트만 쓸 때는 묶지 않은 화면과 같다.
    <br>
    묶는 기준은 <b>탭이 태어난 작업 폴더</b>다 — 셸에서 <code>cd</code> 를 해도 따라오지 않으므로
    세션이 사는 동안 그룹이 흔들리지 않는다. 그룹 안의 순서는 상태 정렬을 그대로 따른다.
    경계는 <b>저장소 루트</b>(<code>.git</code> 등)를 위로 훑어 자동으로 잡으므로 하위 폴더에서 띄운
    세션도 같은 프로젝트로 들어오고, 저장소가 아닌 폴더는 그 폴더 자체가 그룹이다.
</div>

<div class="form-line">
    <div class="header">
        <div class="title">접어 둔 그룹 펼치기</div>
        <div class="description">
            헤더를 눌러 접은 그룹은 다음 기동에도 접힌 채로 뜬다.
            <span *ngIf="collapsedCount()">지금 {{collapsedCount()}}개가 접혀 있다.</span>
            <span *ngIf="!collapsedCount()">지금 접힌 그룹은 없다.</span>
        </div>
    </div>
    <button class="btn btn-secondary" type="button" [disabled]="!collapsedCount()" (click)="expandGroups()">
        <i class="fas fa-angles-down me-2"></i>모두 펼치기
    </button>
</div>

<h3 class="mt-4 mb-3">미리보기 패널</h3>
<div class="text-muted mb-3">
    터미널 옆에서 에이전트가 만든 md · 이미지 · 표 · 코드를 그대로 본다.
    글자 파일은 <b>✎</b> 로 고쳐 저장하고(<code>Ctrl+S</code>), <b>🔍</b> 나 <code>Ctrl+F</code> 로 찾는다.
    여닫기는 사이드바의 <b>▤</b> 버튼(또는 단축키 <code>agentdeck-view</code>)이다.
    특정 CLI 에 매이지 않는다 — 화면에 찍힌 경로를 주우므로 Claude Code · Codex · Gemini 모두 같이 동작한다.
</div>

<div class="form-line">
    <div class="header">
        <div class="title">패널 열기</div>
        <div class="description">
            지금 여닫는다. 이 상태는 다음 기동에도 그대로 복원된다.
            사이드바의 <b>▤</b> 버튼·단축키 <code>agentdeck-view</code> 와 같은 값이다 —
            아래 <b>새 파일을 주우면</b> 을 <b>사람이 열 때만</b> 으로 두면 이 값은
            <b>사람이 바꿀 때만</b> 바뀐다.
        </div>
    </div>
    <toggle [(ngModel)]="config.store.agentDeck.viewerOpen" (ngModelChange)="config.save()"></toggle>
</div>

<div class="form-line">
    <div class="header">
        <div class="title">경로 자동 수집</div>
        <div class="description">
            에이전트가 화면에 찍은 파일 경로를 주워 패널 위쪽 최근 목록에 쌓는다.
            끄면 파일을 끌어다 놓거나 <b>＋</b> 로 경로를 넣을 때만 열린다.
        </div>
    </div>
    <toggle [(ngModel)]="config.store.agentDeck.viewerScrape" (ngModelChange)="config.save()"></toggle>
</div>

<div class="form-line">
    <div class="header">
        <div class="title">문서 패널에 읽어두기</div>
        <div class="description">
            에이전트가 만진 파일을 <b>닫혀 있는 동안에도</b> 패널에 얹어 둔다 —
            나중에 <b>▤</b> 를 누르면 그때까지 건드린 파일이 칩으로 쌓여 있고 본문은 가장 최근 파일이다
            (<b>변경</b> 을 보고 있었으면 여는 김에 diff 를 다시 읽는다).
            끄면 아무것도 자동으로 하지 않는다 — 무엇을 볼지 칩·<b>＋</b>·드롭으로 직접 고른다.
        </div>
    </div>
    <toggle [(ngModel)]="config.store.agentDeck.viewerPreload" (ngModelChange)="config.save()"></toggle>
</div>

<div class="form-line">
    <div class="header">
        <div class="title">패널 자동으로 열기</div>
        <div class="description">
            새 파일을 주우면 닫힌 패널을 스스로 연다. <b>기본은 꺼짐</b> — 여닫기는 사람 몫이다
            (작업 중에 저절로 열리면 터미널이 좁아진다). 위 <b>읽어두기</b> 가 내용을 채워 두므로
            열고 싶을 때 열면 이미 최신이다. <b>읽어두기</b> 를 끄면 이 값은 의미가 없다.
        </div>
    </div>
    <toggle [(ngModel)]="config.store.agentDeck.viewerAutoOpen"
            [disabled]="!config.store.agentDeck.viewerPreload"
            (ngModelChange)="config.save()"></toggle>
</div>

<div class="form-line">
    <div class="header">
        <div class="title">터미널에 파일을 끌어다 놓으면</div>
        <div class="description">
            순정 Tabby 는 경로를 터미널에 붙여넣는다. 패널이 닫혀 있으면 그래서 아무것도 안 열린다 —
            기본은 <b>물어본다</b> — 패널에 띄우기 / 경로 붙여넣기 중에서 고른다. 배너에서 "다시 묻지 않기" 를
            체크하고 누르면 그 선택이 여기 저장된다.
        </div>
    </div>
    <select class="form-control w-auto"
            [(ngModel)]="config.store.agentDeck.viewerDropOpen"
            (ngModelChange)="config.save()">
        <option value="ask">물어본다 (기본)</option>
        <option value="always">패널에 띄운다</option>
        <option value="paste">경로를 붙여넣는다</option>
        <option value="never">개입하지 않는다 (순정)</option>
    </select>
</div>

-->

<h3 class="mt-4 mb-3">{{t('agents.head')}}</h3>
<div class="text-muted mb-3" [innerHTML]="t('agents.intro')"></div>

<div class="form-line" *ngIf="!hooksSupported">
    <div class="header">
        <div class="title">{{t('agents.unsupported.title')}}</div>
        <div class="description">{{t('agents.unsupported.desc')}}</div>
    </div>
</div>

<div class="form-line" *ngIf="hooksSupported">
    <div class="header">
        <div class="title">{{t('claude.title')}}</div>
        <div class="description">
            <b>{{t(claudeOn ? 'state.on' : 'state.off')}}</b> — <span [innerHTML]="t('claude.desc')"></span>
            <span *ngIf="claudeError" class="text-danger d-block mt-1">{{claudeError}}</span>
        </div>
    </div>
    <button class="btn" type="button"
            [class.btn-secondary]="!claudeOn" [class.btn-outline-danger]="claudeOn"
            (click)="toggleClaude()">
        <i class="fas me-2" [class.fa-plug]="!claudeOn" [class.fa-trash]="claudeOn"></i>
        {{t(claudeOn ? 'btn.remove' : 'btn.install')}}
    </button>
</div>

<div class="form-line" *ngIf="hooksSupported">
    <div class="header">
        <div class="title">{{t('codex.title')}}</div>
        <div class="description">
            <b>{{t(codexOff.length ? 'state.half' : (codexHooksOn ? 'state.on' : 'state.off'))}}</b> — <span [innerHTML]="t('codex.desc')"></span>
            <span *ngIf="codexOff.length" class="text-warning d-block mt-1">
                {{t('codex.disabled', { events: codexOffLabels })}}
            </span>
            <span *ngIf="codexHookError" class="text-danger d-block mt-1">{{codexHookError}}</span>
        </div>
    </div>
    <button class="btn" type="button"
            [class.btn-secondary]="!codexHooksOn" [class.btn-outline-danger]="codexHooksOn"
            (click)="toggleCodexHooks()">
        <i class="fas me-2" [class.fa-plug]="!codexHooksOn" [class.fa-trash]="codexHooksOn"></i>
        {{t(codexHooksOn ? 'btn.remove' : 'btn.install')}}
    </button>
</div>

<h3 class="mt-4 mb-3">{{t('root.head')}}</h3>
<div class="text-muted mb-3">{{t('root.intro')}}</div>

<div class="form-line">
    <div class="header">
        <div class="title">{{t('root.use.title')}}</div>
        <div class="description">{{t('root.use.desc')}}</div>
    </div>
    <toggle [(ngModel)]="config.store.agentDeck.rootProfile" (ngModelChange)="config.save()"></toggle>
</div>

<ng-container *ngIf="config.store.agentDeck.rootProfile">
    <div class="form-line">
        <div class="header">
            <div class="title">{{t('root.name.title')}}</div>
        </div>
        <input class="form-control w-50" type="text"
               [(ngModel)]="config.store.agentDeck.rootProfileName" (change)="config.save()">
    </div>

    <div class="form-line">
        <div class="header">
            <div class="title">{{t('root.cwd.title')}}</div>
            <div class="description">{{t('root.cwd.desc')}}</div>
        </div>
        <div class="input-group w-50">
            <input class="form-control" type="text" placeholder="D:/Project"
                   [(ngModel)]="config.store.agentDeck.rootProfileCwd" (change)="config.save()">
            <button class="btn btn-secondary" type="button" (click)="pickCwd()">
                <i class="fas fa-folder-open me-2"></i>{{t('root.browse')}}
            </button>
        </div>
    </div>

    <div class="form-line">
        <div class="header">
            <div class="title">{{t('root.command.title')}}</div>
        </div>
        <input class="form-control w-50" type="text"
               [(ngModel)]="config.store.agentDeck.rootProfileCommand" (change)="config.save()">
    </div>

</ng-container>

<h3 class="mt-4 mb-3">{{t('diag.head')}}</h3>
<div class="text-muted mb-3" [innerHTML]="t('diag.intro', { path: diagPath })"></div>

<div class="form-line">
    <div class="header">
        <div class="title">{{t('diag.screen.title')}}</div>
        <div class="description">{{t('diag.screen.desc')}}</div>
    </div>
    <toggle [(ngModel)]="diagIncludeScreen"></toggle>
</div>

<div class="form-line">
    <div class="header">
        <div class="title">{{t('diag.collect.title')}}</div>
        <div class="description">
            {{t('diag.collect.desc', { version: diagVersion })}}
            <span *ngIf="diagBundlePath" class="d-block mt-1">{{t('diag.made')}}<code>{{diagBundlePath}}</code></span>
            <span *ngIf="diagError" class="text-danger d-block mt-1">{{diagError}}</span>
        </div>
    </div>
    <button class="btn btn-secondary" type="button" (click)="collectDiag()">
        <i class="fas fa-folder-open me-2"></i>{{t('diag.btn')}}
    </button>
</div>

<ng-container *ngIf="devReload.available">
<h3 class="mt-4 mb-3">{{t('dev.head')}}</h3>
<div class="form-line">
    <div class="header">
        <div class="title">{{t('dev.use.title')}}</div>
        <div class="description" [innerHTML]="t('dev.use.desc')"></div>
    </div>
    <toggle [(ngModel)]="config.store.agentDeck.devMode" (ngModelChange)="config.save()"></toggle>
</div>
<div class="form-line" *ngIf="config.store.agentDeck.devMode">
    <div class="header">
        <div class="title">{{t('dev.now.title')}}</div>
        <div class="description">{{t('dev.now.desc')}}</div>
    </div>
    <button class="btn btn-secondary" type="button" (click)="devReload.reload('settings')">
        <i class="fas fa-rotate me-2"></i>{{t('dev.btn')}}
    </button>
</div>
</ng-container>

<div class="text-muted mt-4" [innerHTML]="t('footer')"></div>
`,
})
export class AgentDeckSettingsTabComponent implements AfterViewInit, OnDestroy {
    /** 이 환경에서 훅을 걸 수 있나 (통보 스크립트가 PowerShell 이라 Windows 전용) */
    hooksSupported = hooksSupported()
    /** 지금 걸려 있나 — 파일을 매번 읽지 않도록 화면용으로 들고 있는다 */
    hooksOn = false
    codexHooksOn = false
    codexHookError = ''
    /**
     * Codex 가 `/hooks` 에서 **꺼 둔** 우리 훅 (`config.toml` 의 `[hooks.state]`).
     *
     * 설치 여부와 따로 읽는다 — `hooks.json` 에 우리 항목이 있어도 Codex 가 꺼 두면
     * 한 건도 오지 않는데, 그때 화면이 `연동됨` 이라고 말하면 사용자는 원인을 볼 수 없다
     * (2026-09-14 실측: 상태 보고 폴더에 codex 파일 0건).
     */
    codexOff: string[] = []
    /** 훅을 쓰다 실패한 이유 — 조용히 삼키면 사용자는 버튼이 먹통인 줄 안다 */
    hookError = ''
    /** statusLine 래퍼를 걸 수 있나 (스크립트가 패키지에 들어 있나) */
    statusLineSupported = statusLineSupported()
    /** 지금 감싸져 있나 */
    statusLineOn = false
    statusLineError = ''
    /** 신고 안내에 그대로 보여줄 진단 로그 경로 */
    diagPath = DIAG_PATH
    /** 신고 본문에 적을 버전 — 사용자가 어느 버전을 쓰는지 스스로 알 방법이 없었다 */
    diagVersion = pluginVersion()
    /** 묶음에 화면 원문까지 넣나 (기본 제외 — 터미널에 찍힌 내용이 그대로 들어간다) */
    diagIncludeScreen = false
    /** 마지막으로 만든 묶음 경로 */
    diagBundlePath = ''
    /** 묶음을 만들다 실패한 이유 */
    diagError = ''

    /**
     * Claude 연동이 **온전히** 걸려 있나 — 상태 훅 + statusLine 둘 다.
     *
     * 반쪽(훅만 걸림)은 `false` 다. 그래야 버튼이 `설치` 로 남아 한 번 더 누르면 모자란 쪽이
     * 채워진다 — `연동됨` 이라고 해 놓고 막대가 안 뜨면 사용자가 손댈 곳이 없어진다.
     * statusLine 스크립트가 없는 설치본에서는 훅만으로 판정한다.
     */
    get claudeOn (): boolean {
        return this.hooksOn && (this.statusLineOn || !this.statusLineSupported)
    }

    /** 꺼진 훅 이름을 사람이 `/hooks` 에서 찾을 수 있는 표기로 */
    get codexOffLabels (): string {
        return this.codexOff.map(codexEventLabel).join(' · ')
    }

    /** 두 갈래(훅·statusLine) 중 실패한 것만 모아 한 줄로 */
    get claudeError (): string {
        return [this.hookError, this.statusLineError].filter(Boolean).join(' / ')
    }

    /** `지금 확인` 이 도는 동안 버튼을 잠근다 (레지스트리 응답까지 몇 초) */
    updateBusy = false
    /** 마지막 확인 결과 한 줄 */
    updateMsg = ''

    // ── 단축키 절 (계산은 keybind.ts) ──
    /** 늘어놓는 항목 — README 첫 화면의 표와 같은 순서 */
    keyItems: KeyItem[] = KEY_ITEMS
    /** 지금 키를 받고 있는 항목 id */
    capturing: string | null = null
    /** 겹침이 나와 확인을 기다리는 계획 */
    pending: { plan: BindingPlan, names: string } | null = null
    /** 한 줄 안내(숫자로 끝나야 한다 등) 와 그 대상 */
    keyMsg = ''
    keyMsgFor = ''
    /** id → 사람이 읽는 이름. Tabby 순정·다른 플러그인 것까지 HotkeysService 가 모아 준다 */
    private hotkeyNames = new Map<string, string>()
    private captureHandler: ((e: KeyboardEvent) => void) | null = null
    private readonly keyPlatform: Platform = (process.platform === 'darwin' || process.platform === 'linux')
        ? process.platform : 'win32'

    /** 600px 제한을 풀어 둔 Tabby 의 본문 엘리먼트 (나갈 때 되돌린다) */
    private widened: HTMLElement | null = null
    /** 풀기 전의 값 — 인라인으로 없던 상태면 빈 문자열이라 그대로 되돌려진다 */
    private prevMaxWidth = ''
    /** 지금 그릴 언어 — Tabby 의 `설정 > 응용 프로그램 > 언어` 를 따라간다 */
    private lang: Lang = 'en'
    private localeSub: Subscription | null = null
    private hooksRefreshTimer: ReturnType<typeof setInterval> | null = null

    constructor (
        public config: ConfigService,
        public recovery: AgentDeckRecoveryService,
        private update: AgentDeckUpdateService,
        private platform: PlatformService,
        public devReload: AgentDeckDevReloadService,
        private host: ElementRef<HTMLElement>,
        // `@Optional` 인 이유 — 이 서비스가 없는 Tabby 에서도 설정 탭은 떠야 한다.
        // 주입에 실패하면 Angular 가 컴포넌트 생성 자체를 막아 **탭이 통째로 빈 화면**이 되는데,
        // 얻는 것이 "문구 언어" 하나뿐인 것과 견주면 그 대가가 너무 크다.
        @Optional() private locale: LocaleService | null,
        // 겹침 안내에 쓸 **이름**만 얻는다 — 매칭·처리는 여전히 Tabby 와 deck.service 의 일이다.
        // 없어도 설정 탭은 떠야 하므로 @Optional (그때는 id 를 그대로 보여 준다)
        @Optional() private hotkeys: HotkeysService | null,
        private zone: NgZone,
    ) {
        this.refreshHooks()
        void this.loadHotkeyNames()
        // 첫 값은 물어봐서 잡는다 — `localeChanged$` 는 **바뀔 때만** 흘리므로
        // 구독만 해 두면 사용자가 언어를 건드릴 때까지 영어로 떠 있는다.
        // 서비스가 없으면 설정 파일의 값, 그것도 비어 있으면(자동) 브라우저 로케일을 본다
        this.lang = pickLang(this.locale?.getLocale()
            || this.config.store.language
            || navigator.language)
        // 설정 창을 띄워 둔 채로 언어를 바꿀 수 있다 (둘 다 같은 창의 탭이다)
        this.localeSub = this.locale?.localeChanged$.subscribe(l => {
            this.lang = pickLang(l)
        }) ?? null
    }

    /**
     * 문구 하나. 표는 `i18n.ts` 에 있고 여기서는 언어만 얹는다.
     *
     * 템플릿에서 매 변경감지마다 불리는 함수다 — 표 조회 + 정규식 치환뿐이라 값이 싸고,
     * 캐시를 두면 언어가 바뀌었을 때 무효화할 자리가 하나 더 생긴다.
     */
    t (key: string, params?: Record<string, string | number>): string {
        return translate(key, this.lang, params)
    }

    /**
     * 설정 본문의 600px 제한을 **이 탭에서만** 푼다.
     *
     * Tabby 는 모든 설정 탭 본문에 `settings-tab-body { max-width: 600px }` 를 건다
     * (tabby-settings 컴포넌트 styles). 넓은 창에서는 오른쪽이 통째로 놀게 되는데,
     * 그 규칙은 컴포넌트 스타일이라 우리 스타일시트로는 못 이긴다(우선순위가 아니라 `:host`
     * 범위 문제다 — 우리 CSS 는 그 엘리먼트를 선택할 수는 있어도 어느 탭의 것인지 모른다).
     * 그래서 **우리 엘리먼트에서 위로 찾아** 인라인으로 푼다. 화면을 어떻게 채울지는
     * `styles.scss` 의 `agentdeck-settings-tab` 격자가 정한다.
     *
     * 되돌리기가 필요한 이유 — 이 엘리먼트는 다른 설정 탭과 **돌려 쓰일 수 있다**.
     * 풀어 둔 채 나가면 남의 탭이 우리 때문에 넓어진다.
     */
    ngAfterViewInit (): void {
        // 설정 파일은 다른 창이나 설치 도구에서도 바뀐다. 생성 시점의 판정을 고정하지 않는다.
        this.hooksRefreshTimer = setInterval(() => this.refreshHooks(), 2000)
        const body = this.host.nativeElement.closest('settings-tab-body') as HTMLElement | null
        if (!body) {
            return // Tabby 가 구조를 바꿨다 — 600px 그대로 쓰면 될 뿐 깨지지는 않는다
        }
        this.widened = body
        this.prevMaxWidth = body.style.maxWidth
        body.style.maxWidth = 'none'
    }

    ngOnDestroy (): void {
        if (this.hooksRefreshTimer) {
            clearInterval(this.hooksRefreshTimer)
            this.hooksRefreshTimer = null
        }
        if (this.widened) {
            this.widened.style.maxWidth = this.prevMaxWidth
            this.widened = null
        }
        this.localeSub?.unsubscribe()
        this.localeSub = null
        this.stopCapture()
    }

    // ───────────────────────── 단축키 절 ─────────────────────────

    /** 이 항목이 지금 쓰는 키들 (사람 표기) */
    keysOf (it: KeyItem): string[] {
        return displayStrokes(this.config.store.hotkeys ?? {}, it, this.keyPlatform)
    }

    isPending (it: KeyItem): boolean {
        return !!this.pending && this.pending.plan.item.id === it.id
    }

    isDefault (it: KeyItem): boolean {
        return isDefaultBinding(this.config.store.hotkeys ?? {}, it, this.keyDefaults(), this.keyPlatform)
    }

    /**
     * 키 받기 시작. **window 캡처 단계**에 건다 — 그래야 document 에 걸린 Tabby 의 HotkeysService
     * 리스너와 우리 deck.service 의 캡처 리스너(Ctrl+V · Shift+Enter)보다 먼저 받고, 전파를 끊어
     * 그 키가 진짜로 실행되는 일(검색창이 열리거나 터미널에 붙여지는 일)을 막는다.
     * 수식키만 눌린 이벤트는 그냥 흘린다 — 아직 조합 중이고, 막으면 Shift 추적이 어긋난다.
     */
    startCapture (it: KeyItem): void {
        this.stopCapture()
        this.pending = null
        this.keyMsg = ''
        this.capturing = it.id
        this.captureHandler = (e: KeyboardEvent) => {
            if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
                return
            }
            e.preventDefault()
            e.stopImmediatePropagation()
            this.zone.run(() => {
                if (e.key === 'Escape') {
                    this.stopCapture()
                    return
                }
                const stroke = keystrokeFromEvent(e, this.keyPlatform)
                if (!stroke) {
                    return
                }
                this.stopCapture()
                const table = this.config.store.hotkeys ?? {}
                const plan = planBinding(table, it, stroke, this.keyPlatform)
                if (plan.error === 'digit') {
                    this.keyMsg = this.t('keys.digit')
                    this.keyMsgFor = it.id
                    return
                }
                if (plan.conflicts.length) {
                    this.pending = { plan, names: plan.conflicts.map(id => this.nameOf(id)).join(', ') }
                    return
                }
                this.commit(plan, false)
            })
        }
        window.addEventListener('keydown', this.captureHandler, true)
    }

    stopCapture (): void {
        if (this.captureHandler) {
            window.removeEventListener('keydown', this.captureHandler, true)
            this.captureHandler = null
        }
        this.capturing = null
    }

    /** 겹침을 알고도 쓰기 — 겹치는 쪽에서 그 키를 뗀다 (한 번 눌러 둘이 도는 상태를 남기지 않는다) */
    confirmPending (): void {
        if (!this.pending) {
            return
        }
        this.commit(this.pending.plan, true)
        this.pending = null
    }

    resetKeys (it: KeyItem): void {
        this.pending = null
        this.keyMsg = ''
        resetBinding(this.config.store.hotkeys, it, this.keyDefaults())
        this.config.save()
    }

    private commit (plan: BindingPlan, force: boolean): void {
        applyBinding(this.config.store.hotkeys, plan, force, this.keyPlatform)
        // HotkeysService 는 매칭할 때마다 config.store 를 다시 읽으므로 저장만 하면 바로 산다
        this.config.save()
    }

    /**
     * 기본값 표 — 순정 항목(split-right · split-bottom …)은 Tabby 의 플랫폼 기본표에서,
     * 우리 항목과 close-pane 은 `defaultHotkeys()` 에서. 순정 기본표는 ConfigService 가 들고 있다
     * (`getDefaults()`), 없으면 우리 표만으로 간다(그때 순정 항목의 `기본값` 은 비운다).
     */
    private keyDefaults (): Record<string, unknown> {
        let stock: Record<string, unknown> = {}
        try {
            stock = (this.config.getDefaults?.()?.hotkeys ?? {}) as Record<string, unknown>
        } catch (e) { /* 순정 표를 못 읽으면 우리 표만 */ }
        return { ...stock, ...defaultHotkeys() }
    }

    private nameOf (id: string): string {
        return this.hotkeyNames.get(id) ?? id
    }

    private async loadHotkeyNames (): Promise<void> {
        try {
            const list = await this.hotkeys?.getHotkeyDescriptions()
            for (const d of list ?? []) {
                if (d?.id && d.name) {
                    this.hotkeyNames.set(d.id, d.name)
                }
            }
        } catch (e) {
            // 이름을 못 얻으면 id 로 보여 준다 — 겹침 판정 자체는 표만 보므로 영향이 없다
        }
    }

    /**
     * 사람이 직접 누른 확인. `force` 라 간격과 `다시 묻지 않기` 를 건너뛴다 —
     * 눌렀다는 것 자체가 "지금 알고 싶다" 는 뜻이다.
     */
    async checkUpdate (): Promise<void> {
        this.updateBusy = true
        this.updateMsg = ''
        try {
            this.updateMsg = UPDATE_OUTCOME_TEXT[await this.update.run('settings', true)] ?? ''
        } catch (e: any) {
            this.updateMsg = `확인하지 못했다: ${e?.message ?? e}`
        } finally {
            this.updateBusy = false
        }
    }

    private refreshHooks (): void {
        try {
            this.codexHooksOn = this.hooksSupported && codexHooksInstalled()
            this.codexOff = this.codexHooksOn ? codexDisabledEvents() : []
        } catch (e: any) {
            this.codexHooksOn = false
            this.codexOff = []
            this.codexHookError = `설정을 읽지 못했다: ${e?.message ?? e}`
        }
        try {
            this.hooksOn = this.hooksSupported && hooksInstalled()
        } catch (e: any) {
            this.hooksOn = false
            this.hookError = `설정을 읽지 못했다: ${e?.message ?? e}`
        }
        try {
            this.statusLineOn = this.statusLineSupported && statusLineInstalled()
        } catch (e: any) {
            this.statusLineOn = false
            this.statusLineError = `설정을 읽지 못했다: ${e?.message ?? e}`
        }
    }

    /**
     * Claude 연동을 걸거나 뗀다 — **상태 훅과 statusLine 을 한 덩이로** 다룬다.
     *
     * 따로 두었더니 "훅만 걸고 statusLine 은 안 건 상태" 가 흔하게 나왔고, 그 화면은
     * 상태는 뜨는데 모델·한도 막대만 없어서 사용자가 원인을 못 짚는다 (2026-09-14 유저 지시:
     * "status line 은 같은 취급 해"). 사용자가 정하는 것은 **이 에이전트를 사이드바에 붙일까**
     * 하나뿐이고, 그걸 이루는 파일이 둘인 것은 우리 사정이다.
     *
     * 해제는 **원래 statusLine 을 제자리에 돌려놓는다** — 우리 것이 아니면 아무것도 건드리지
     * 않는다(`unwrapStatusLine`). 되돌릴 것이 없던 사용자는 statusLine 키 자체가 지워진다.
     *
     * 한쪽만 실패해도 나머지는 계속 간다 — 둘 다 시도한 뒤 모아서 한 줄로 알린다.
     * 그래야 "훅은 걸렸는데 statusLine 이 안 걸린" 반쪽 상태를 사용자가 볼 수 있다.
     */
    toggleClaude (): void {
        this.hookError = ''
        this.statusLineError = ''
        const remove = this.claudeOn
        try {
            if (remove) {
                uninstallHooks()
            } else {
                installHooks()
            }
        } catch (e: any) {
            this.hookError = `상태 훅: ${e?.message ?? e}`
        }
        if (this.statusLineSupported) {
            try {
                if (remove) {
                    uninstallStatusLine()
                } else if (!this.statusLineOn) {
                    installStatusLine()
                }
            } catch (e: any) {
                this.statusLineError = `statusLine: ${e?.message ?? e}`
            }
        }
        this.refreshHooks()
        this.syncNotifyChannel()
    }

    toggleCodexHooks (): void {
        this.codexHookError = ''
        try {
            setCodexHooks(!this.codexHooksOn)
        } catch (e: any) {
            this.codexHookError = `${e?.message ?? e}`
        }
        this.refreshHooks()
        this.syncNotifyChannel()
    }

    /**
     * 통보 채널을 훅 설치 상태에 맞춘다 — 하나라도 걸려 있으면 열고, 하나도 없으면 닫는다.
     *
     * `refreshHooks()` **뒤에** 부른다. 실패해서 설치가 안 됐을 수도 있으므로 버튼을 누른
     * 의도가 아니라 **파일을 다시 읽은 결과**를 기준으로 삼는다.
     */
    private syncNotifyChannel (): void {
        const want = this.hooksOn || this.codexHooksOn
        if (this.config.store.agentDeck.notifyChannel === want) {
            return
        }
        this.config.store.agentDeck.notifyChannel = want
        this.config.save()
    }

    /**
     * OS 폴더 선택 창을 띄워 작업 폴더를 고른다.
     *
     * `pickDirectory` 는 취소하면 null/undefined 를 주므로 그때는 기존 값을 건드리지 않는다.
     * 다이얼로그 제목은 Tabby 버전에 따라 인자를 받기도 하고 안 받기도 해서 any 로 넘긴다 —
     * 안 받는 쪽은 그냥 무시하므로 어느 쪽에서도 깨지지 않는다.
     * 돌려받은 경로는 백슬래시를 슬래시로 바꿔 저장한다. 설정 파일에 그대로 적히는 값이라
     * 손으로 고칠 때 이스케이프 사고가 나지 않게 하려는 것이고, Windows 도 슬래시 경로를 받는다.
     */
    /**
     * 진단 묶음을 만들고 그 파일이 있는 폴더를 연다.
     *
     * 폴더를 여는 것까지가 한 동작인 이유 — 경로만 알려 주면 "그 폴더가 어디냐" 가 다시 질문으로
     * 돌아온다. 압축이 안 되는 환경에서는 폴더 경로가 나오므로 그대로 열어 주면 된다.
     */
    collectDiag (): void {
        this.diagError = ''
        this.diagBundlePath = ''
        try {
            const bundle = collectDiagBundle({
                includeScreen: this.diagIncludeScreen,
                stamp: {
                    tabby: this.platform.getAppVersion?.(),
                    osRelease: this.platform.getOSRelease?.(),
                    config: configStamp(this.config.store),
                },
            })
            this.diagBundlePath = bundle.path
            this.platform.showItemInFolder(bundle.path)
        } catch (e: any) {
            this.diagError = `모으지 못했다: ${e?.message ?? e}`
        }
    }

    /** 배치가 기본값에서 벗어나 있나 — 벗어나 있을 때만 초기화 버튼이 살아 있다 */
    layoutChanged (): boolean {
        const cfg = this.config.store.agentDeck
        return Object.keys(LAYOUT_DEFAULTS).some(k => cfg[k] !== LAYOUT_DEFAULTS[k])
    }

    dockLabel (): string {
        return this.t(DOCK_KEYS[this.config.store.agentDeck.sidebarDock] ?? 'dock.right')
    }

    sizeLabel (): string {
        const cfg = this.config.store.agentDeck
        if (cfg.sidebarDock === 'top' || cfg.sidebarDock === 'bottom') {
            return this.t('size.height', { px: cfg.sidebarHeight })
        }
        return cfg.sidebarWidth ? this.t('size.width', { px: cfg.sidebarWidth }) : this.t('size.auto')
    }

    /**
     * 도킹 방향과 크기만 기본값으로 되돌린다.
     *
     * 되돌리기 쉬운 조작이라 확인 창은 두지 않는다. `config.save()` 가 `changed$` 를 발화시키고
     * deck.service 가 그걸 받아 곧바로 다시 배치하므로(deck.service.ts:256) 재시작도 필요 없다.
     */
    resetLayout (): void {
        Object.assign(this.config.store.agentDeck, LAYOUT_DEFAULTS)
        this.config.save()
    }

    /** 접혀 있는 그룹 수 — 버튼을 살릴지와 안내 문장에 쓴다 */
    collapsedCount (): number {
        const list = this.config.store.agentDeck.collapsedGroups
        return Array.isArray(list) ? list.length : 0
    }

    /**
     * 접어 둔 그룹을 모두 펼친다.
     *
     * 왜 버튼이 필요한가 — 접힌 그룹의 탭을 다 닫아도 키는 남는다(그 프로젝트를 다시 열었을 때
     * 접힘이 유지되는 것이 의도다). 그래서 "예전에 접었는데 지금은 그 그룹이 안 보이는" 상태가
     * 쌓일 수 있고, 그때 되돌릴 방법이 config 파일 편집뿐이었다.
     */
    expandGroups (): void {
        this.config.store.agentDeck.collapsedGroups = []
        this.config.save()
    }

    async pickCwd (): Promise<void> {
        const picked = await (this.platform as any).pickDirectory('작업 폴더 선택')
        if (!picked) {
            return
        }
        this.config.store.agentDeck.rootProfileCwd = String(picked).replace(/\\/g, '/')
        this.config.save()
    }
}
