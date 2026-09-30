# 메일박스 Wake

`agentdeck_send`가 큐 저장에 성공하면 수신 세션의 현재 pane에 고정 안내문을 한 줄 입력한다. 메시지 본문은 터미널에 입력하거나 wake 진단 로그에 기록하지 않는다.

## 동작

- 현재 세션 ID와 pane ID가 정확히 연결되고, 메일박스 등록과 PTY가 모두 열려 있어야 한다. 닫힌 세션·미등록 세션에도 큐 저장은 가능하지만 wake는 `no-tab`으로 생략한다.
- `idle` 또는 `done`에서 입력한다. **2026-09-30 사용자 결정: 완료도 입력 가능한 대기로 인정한다.** Claude와 Codex 모두 정상 종료 훅이 `done`을 보고한다.
- 진행 중·승인 대기·한도·오류에서는 입력하지 않는다. 상태 변경과 `tickIdle`의 유휴 전환 알림에서 대기를 다시 판정한다.
- 마지막 키·붙여넣기·입력·IME 이벤트 이후 기본 3초를 기다린다. 타이핑 지연은 일회성 타이머이며, 새 입력이 오면 마감 시각을 갱신한다. IME 조합 중에는 종료 이벤트를 기다린다.
- 세션별로 대기 메시지 ID를 모아 한 번에 건수를 안내한다. 동일 `requestKey`는 동일 메시지이며, 같은 앱 실행 중 이미 주입한 메시지는 다시 주입하지 않는다. 재시도 응답은 acknowledge 이후에도 기존 주입 성공을 유지한다.
- 실제 입력 직전에 수신 pane의 동일성·열림·상태·타이핑·설정을 다시 확인한다. `sendToPane(..., 'mailbox-wake', ...)`를 경유하고 Enter는 `\r` 한 번이다.
- 주입 직후 상태를 진행 중으로 바꿔, 다음 메시지가 UserPromptSubmit 훅보다 먼저 와도 연속 주입하지 않는다.
- 새 수신 폴링 프로세스나 반복 타이머를 만들지 않는다. 타이핑 지연을 제외한 대기에는 wake 타이머가 없다. 기존 AgentDeck 상태 감시의 CPU 사용까지 0이 된다는 의미는 아니다.

## 설정

```yaml
agentDeck:
  mailboxWake:
    enabled: true
    typingGuardMs: 3000
    text: '[agentdeck] 새 메시지 {N}건 도착  receive 로 확인하고 acknowledge 할 것'
```

탭 우클릭 메뉴의 **메일 wake 끄기 / 켜기**로 해당 탭만 제외한다. 탭별 선택은 현재 앱 실행 동안 유지하며, 전역 설정을 켜도 탭별 제외는 유지한다. 꺼진 동안 쌓인 wake는 다시 켤 때 조건을 재확인한다. 전역 설정은 Tabby 설정 저장소를 사용한다.

`text`의 `{N}`을 합산 건수로 치환한다. 제어 문자와 줄바꿈은 공백으로 바꿔 한 줄 입력을 유지한다. 비어 있으면 기본 문구를 사용한다.

## 전송 응답

기존 메시지 필드에 `wake: { attempted, delivered, reason }`을 추가한다. `sent`인 경우 두 플래그가 true이며, 나머지는 false다.

| reason | 뜻 |
|---|---|
| `sent` | 터미널 입력 호출 성공. 메시지를 읽었다는 뜻은 아님 |
| `no-tab` | 현재 주입 가능한 수신 pane 없음. 큐는 보존 |
| `busy-deferred` | 입력 가능한 상태가 될 때까지 대기 |
| `typing-deferred` | 타이핑·IME 입력이 끝날 때까지 대기 |
| `disabled` | 전역 또는 탭별 설정이 꺼져 대기 |

지연 응답은 전송 당시의 결과다. 이후 주입 여부를 원래 응답에 소급해서 보내지는 않는다. 앱 재시작 전의 wake 이력은 메모리에서 사라지며, 이미 완료한 메시지의 재시도는 다시 깨우지 않는다. **수신 확정은 여전히 acknowledge 또는 답장으로 판정한다.**

진단: `.agentdeck-diag.log`의 `mailbox-wake to="<sessionId>" n=<N> reason=<reason>`.

## 검증

- `npm run typecheck`, `npm test`, `npm run test:sessions`.
- `test/mailboxWake.cjs`: 저장 실패 시 주입 없음, idle, busy 합산, 타이핑 마감/갱신, IME, 설정, 미등록 수신자, 재시도, pane 교체, PTY 예외, 한 번의 Enter, 본문 비기록. 대기 중 반복 타이머가 없음을 내부 상태로 확인.
- `tools/probe-mailbox-wake.js`: 격리 앱에서 실제 PTY 입력 → 기존 UserPromptSubmit 메일박스 훅 → receive → completed acknowledge까지 실행. `tools/mailbox-wake-recipient.cjs`는 이벤트 기반 합성 수신기이며 모델/API를 호출하지 않는다. 실제 Claude/Codex 모델이 안내를 해석해 도구를 선택하는 행동 자체는 이 테스트의 검증 범위가 아니다.
- 최종 격리 앱 wake 프로브: **16개 통과, 실패 0개**. 수신 큐 저장·acknowledge 상태와 진단 로그도 확인.
- 최종 전수 회귀: **176개 중 169 통과, 실패 0, 제외 7**. 빌드·유닛 검사는 별도 실행하여 러너에서 제외했다. 나머지는 이미지 클립보드 2개, 실제 Claude 세션 필요 항목 1개, 수치 관측만 하는 성능 항목 2개다.

## 2026-09-30 반영 기록

- 최종 산출물: `.tmp/mailbox-wake-final/dist/index.js`.
- SHA-256: `67242E598CE88863BD215FCD68E617CEAA8481D77B2D779E506DE043B72E45EA`. 검증 산출물과 실사용 `dist/index.js` 해시가 일치한다.
- UI 결과: `.tmp/mailbox-wake-ui-final.json` (16/16).
- 전수 결과: `.tmp/mailbox-wake-regression-final/report/regression.json` (169/176, 실패 0).
- 유닛 결과: `.tmp/mailbox-wake-unit.log` (`npm test` 성공), `.tmp/mailbox-wake-sessions.log` (최종 재시도 응답 수정 후 관련 테스트 재실행 성공).
- 실사용 진단 원문: `2026-09-30T08:29:29.426Z reload go reason=dev:build tabs=4` → `2026-09-30T08:29:32.487Z reload restored tabs=4 dead=0 ms=1827`.
- 실사용 Tabby 프로세스 5796은 그대로 유지되었고, 기존 네 세션의 메일박스 등록이 훅 재보고 후 모두 복구되었다. 리로드 직후 등록이 재생성되는 동안은 일시적으로 `no-tab`일 수 있으며 큐는 보존된다.
- 커밋·푸시는 하지 않았다. 기존 다른 작업의 변경은 보존했다.
