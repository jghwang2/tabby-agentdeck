# 지침 파일 미리보기 검증 (2026-09-18)

- 최초 작업은 코드 검사 후 실사용 junction의 dist에 빌드했다. 격리 앱 검증 전 반영한 절차 위반이며, 이후 개발 정책에 금지 규칙을 추가했다.
- 재검증 산출물: `.tmp/instruction-stage/dist/index.js`. webpack 출력 경로를 별도로 지정했다.
- 격리 앱: `tools/test-instance.ps1 -PluginRoot D:/Project/tabby-agentdeck/.tmp/instruction-stage -Port 9333`. 사용자 데이터는 `tabby-agentdeck-test/ud`이며 실사용 설정과 분리했다.
- `tools/probe-instruction-preview.js`: 실제 DOM 검사 4/4 통과. 단순 지침 읽기의 칩 제외, 일반 결과물 표시 유지, 지침 직접 열기 렌더, 이후 읽기에도 명시 선택 유지 확인.
- `test/instructionPreview.cjs`, 타입 검사, `test:existing`, 빌드 통과.
- `tools/probe-viewer.js`: 두 차례 동일하게 15개 중 통과 7, 실패 1, 환경 미충족 7. VW10은 배너가 영어로 표시되나 기존 프로브가 기대하는 문구와 달라 실패했다. 하위 동작 ②~⑥은 통과. 터미널 pane 부재 등 미충족 항목을 통과로 간주하지 않았다.
- 위 결과는 중간 실패 기록이다. 이후 격리 앱에 실제 터미널 탭 2개를 열고 재검증했다. 배너 검사는 다국어 문장 안의 파일명을 확인하도록 수정했고, C: 여유 공간 0으로 실패한 대형 이미지 픽스처는 `AGENTDECK_PROBE_TMP`로 D:에 생성했다. 제품의 용량 제한을 완화하거나 실패 검사를 제거하지 않았다.
- 최종 미리보기 회귀: 15/15 PASS, FAIL 0, SKIP 0. 이번 변경의 DOM 검사도 실제 터미널 탭이 있는 상태에서 4/4 재통과했다.
- 통과한 staging 산출물을 재빌드 없이 실사용 dist에 복사했다. 양쪽 SHA256: `2C17BCF81383FDFAE4419951192B88C288390F3DF057AF2C391F264AE123013D`.
- 2026-09-18 13:02 KST 실사용 핫리로드 완료. `C:/Users/junggon/.agentdeck-diag.log` 실측: `2026-09-18T04:02:26.719Z reload go reason=dev:build tabs=4`, `2026-09-18T04:02:30.565Z reload restored tabs=4 dead=0 ms=2293`. 세션 4개 복구, 소실 0.
- 최종 원시 결과: `.tmp/instruction-ui-target-final.json`, `.tmp/instruction-ui-viewer-final.json`. 이번 UI 회귀 범위는 미리보기 15항목이며 저장소 전체 UI 회귀를 실행했다고 주장하지 않는다.
