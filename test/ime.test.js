// 조합(IME) 순서 판정 검증 — `npm test` (ime.ts 를 .tmp 로 컴파일한 뒤 실행)
const { readCompositionState, planSend, flushComposition } = require('../.tmp/ime.js')
let pass = 0, fail = 0
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  ok   ${name} -> ${g}`) }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`) }
}

// ---------- readCompositionState : 헬퍼의 살아있는 상태 ----------

check('조합 중', readCompositionState({ isComposing: true, _isSendingComposition: false }), 'composing')
// 조합은 끝났는데 확정 텍스트가 setTimeout 대기 중 = 이 틈이 버그의 정체다
check('확정 전송 대기 중', readCompositionState({ isComposing: false, _isSendingComposition: true }), 'pending')
check('유휴', readCompositionState({ isComposing: false, _isSendingComposition: false }), 'idle')
// 조합 중이면 전송 대기 여부와 무관하게 조합이 우선 (동기 확정을 시킬 수 있다)
check('조합 중 + 전송 대기', readCompositionState({ isComposing: true, _isSendingComposition: true }), 'composing')

check('헬퍼 없음(null)', readCompositionState(null), 'unknown')
check('헬퍼 없음(undefined)', readCompositionState(undefined), 'unknown')
check('헬퍼가 객체가 아니다', readCompositionState('nope'), 'unknown')
// xterm 내부가 바뀌어 필드가 둘 다 사라졌다 — 아무것도 단정하지 않는다
check('필드 둘 다 없음', readCompositionState({ keydown: () => true }), 'unknown')
// 한쪽만 살아 있으면 그 값으로 판정한다
check('isComposing 만 있음(false)', readCompositionState({ isComposing: false }), 'idle')
check('sending 만 있음(true)', readCompositionState({ _isSendingComposition: true }), 'pending')
check('sending 만 있음(false)', readCompositionState({ _isSendingComposition: false }), 'idle')
// boolean 아닌 값은 상태로 읽지 않는다 (true 로 강제 형변환하면 오판)
check('isComposing 이 boolean 이 아니다', readCompositionState({ isComposing: 1 }), 'unknown')
// getter 가 던지는 경우 — 예외를 밖으로 내보내지 않고 unknown 으로 떨어진다
check('getter 가 던진다', readCompositionState(Object.defineProperty({}, 'isComposing', {
  get () { throw new Error('gone') },
})), 'unknown')

// ---------- planSend : 상태 → 계획 ----------

// 조합 중에는 **확정을 재촉하지 않고 조합이 끝나기를 기다린다.**
// 0.5.0 은 여기서 동기 확정을 시켰는데, 그러면 IME 가 뒤이어 compositionend 를 쏘고
// xterm 이 음절을 한 번 더 보내 그 두 번째가 우리 개행 뒤에 나갔다 — 그게 사용자가 신고한
// "조합 중 Shift+Enter 로 문자가 내려간다" 다 (2026-09-08 하네스 실측: 한 -> ESC[H -> 한).
check('composing → 조합 끝난 뒤에', planSend('composing'), 'after-composition')
check('pending → 한 틱 뒤로', planSend('pending'), 'defer')
check('idle → 즉시', planSend('idle'), 'now')
// unknown 이 now 인 것이 중요하다 — 훅이 정상 입력을 막는 일은 없어야 한다
check('unknown → 즉시 (기존 동작 유지)', planSend('unknown'), 'now')

// ---------- flushComposition : 동기 확정 ----------

{
  // 방향키가 하는 일을 그대로 흉내낸다 — 공개 표면 keydown 으로 확정을 트리거
  const calls = []
  const helper = {
    isComposing: true,
    _compositionPosition: { start: 3, end: 7 },
    keydown (e) { calls.push(e); return true },
  }
  check('keydown({keyCode:0}) 을 부른다', flushComposition(helper, 9), true)
  check('넘긴 인자', calls, [{ keyCode: 0 }])
  // end 가 이미 start 보다 크다 = 보정 불필요. 원본을 건드리면 안 된다
  check('보정 불필요하면 end 를 안 건드린다', helper._compositionPosition, { start: 3, end: 7 })
}

{
  // 낡은 end 보정 — compositionupdate 의 setTimeout(…,0) 이 아직 안 돌아 end 가 0 이다.
  // 그대로 확정하면 substring(3, 0) = "" 이 나가 음절이 통째로 유실된다
  const helper = { isComposing: true, _compositionPosition: { start: 3, end: 0 }, keydown: () => true }
  check('낡은 end 를 textLength 로 메운다', flushComposition(helper, 5), true)
  check('메운 값', helper._compositionPosition, { start: 3, end: 5 })
}

{
  // end === start 도 빈 문자열이므로 보정 대상이다
  const helper = { isComposing: true, _compositionPosition: { start: 4, end: 4 }, keydown: () => true }
  flushComposition(helper, 6)
  check('end === start 도 보정한다', helper._compositionPosition, { start: 4, end: 6 })
}

{
  // textLength 가 start 보다 작으면 메워도 여전히 빈 문자열이다 — 원본을 그대로 둔다
  const helper = { isComposing: true, _compositionPosition: { start: 4, end: 0 }, keydown: () => true }
  flushComposition(helper, 2)
  check('textLength 가 start 이하면 안 건드린다', helper._compositionPosition, { start: 4, end: 0 })
}

{
  // _compositionPosition 이 없어도 확정 자체는 시도한다
  let called = false
  const helper = { isComposing: true, keydown: () => { called = true; return true } }
  check('position 없어도 확정한다', flushComposition(helper, 5), true)
  check('그래도 keydown 은 불렀다', called, true)
}

check('헬퍼 없으면 false', flushComposition(null, 5), false)
check('keydown 이 없으면 false', flushComposition({ isComposing: true }, 5), false)
check('keydown 이 함수가 아니면 false', flushComposition({ keydown: 1 }, 5), false)
check('keydown 이 던지면 false', flushComposition({ keydown () { throw new Error('gone') } }, 5), false)
// NaN 이 end 에 들어가면 substring 이 0 으로 취급해 오히려 유실된다
check('textLength 가 NaN 이면 보정하지 않는다', (() => {
  const helper = { _compositionPosition: { start: 3, end: 0 }, keydown: () => true }
  flushComposition(helper, NaN)
  return helper._compositionPosition
})(), { start: 3, end: 0 })

// planSend 가 내는 값은 deck.service 의 분기와 **문자열로** 맞물린다 — 오타가 나면
// 그 분기를 아무도 안 타고 조용히 즉시 쓰기로 떨어진다. 값 자체를 고정한다.
{
    const plans = ['now', 'after-composition', 'defer', 'flush-then-now']
    for (const st of ['idle', 'composing', 'pending', 'unknown']) {
        check(`${st} 의 계획은 알려진 값`, plans.indexOf(planSend(st)) >= 0, true)
    }
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { process.exit(1) }
