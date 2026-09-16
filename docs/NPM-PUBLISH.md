# npm 배포

배포 경로는 두 가지다.

| 경로 | 상태 | 쓰는 때 |
|---|---|---|
| **로컬 `npm publish`** | **지금 쓰는 것.** 0.1.0~1.1.3 전부 이 경로로 나갔다 | 지금 |
| GitHub Actions + Trusted Publishing(OIDC) | 워크플로는 준비됨. **npm 쪽 등록만 남았다** — 계정 hold 로 보류 중, [재시도 절차](#재시도-절차-2026-09-17-이후) | 등록되면 |

## 지금: 로컬에서 배포

```powershell
npm run build      # dist 를 최신으로 (prebuild 가 sync-version 을 먼저 돌린다)
npm publish        # package.json 의 version 그대로 나간다
```

- 계정은 패키지 소유자여야 한다 — 현재 소유자는 `junggon` (레지스트리 `maintainers` 확인).
  로그인 상태는 `npm whoami`, 로그인은 `npm login`.
- `npm publish` 도 `prepack` 을 돌린다(npm 7+). 이 저장소의 `prepack` 은
  `build:release && check-release` 라 배포 직전에 다시 빌드되고 검사까지 걸린다.
  **`--ignore-scripts` 로 내보내지 말 것** — 그 한 줄이 재빌드와 검사를 통째로 건너뛰어
  디스크에 남아 있던 개발 빌드 산출물(소스맵 포함)이 그대로 나간다.
- 나가는 파일은 `package.json` 의 `files` 가 정한다. 미리 보려면 `npm pack --dry-run`.
- **이미 배포한 버전은 다시 올릴 수 없다.** 버전을 올리려면 `npm run release -- 1.1.4`.

## 나중: Actions + Trusted Publishing

npm 액세스 토큰 없이 OIDC 로 발행한다. GitHub 에 push 하는 것만으로 실행되지는 않고,
Actions → Publish to npm → Run workflow 에서 `main` 을 골라 수동 실행한다.

### npm 쪽 등록 (아직 안 돼 있다 — 2026-09-14 계정 hold 로 보류)

#### 왜 보류됐나 (2026-09-14 실측)

리커버리 코드로 npm 에 로그인했더니 **72시간 security hold** 가 걸렸다
([npm changelog 2026-09-09](https://github.blog/changelog/2026-09-09-npm-extends-recovery-code-security-holds-to-all-accounts/)).
hold 중에는 publish·토큰 생성·trust 등록 같은 쓰기가 전부 막히고, 풀리는 건 자동이다(지원 요청 불필요).

증상이 원인을 말해주지 않아서 헤맸다 — 같은 상황이면 아래를 hold 로 의심할 것:

| 시도 | 결과 |
|---|---|
| 웹 폼 `Set up connection` + 보안키 인증 | 에러 없이 끝나지만 **저장 안 됨** (trust 목록 `[]`) |
| CLI `npm trust github ...` + 브라우저 2FA | 인증은 통과(`done 200`), 그다음 `403 Forbidden - POST /-/package/tabby-agentdeck/trust` |
| `npm login` 으로 토큰 교체 후 재시도 | 똑같이 403 → 토큰 종류 문제가 아니다 |
| 판정 run 34814459808 · 34815246110 · 34816988813 | 전부 `ENEEDAUTH` |

npm CLI 는 403 응답 본문을 버려서 사유가 안 찍힌다. 사유는 **npmjs.com 상단 빨간 배너**
"Your account has been temporarily suspended due to a recent security-sensitive action" 에만 있었다.

#### 재시도 절차 (2026-09-17 이후)

hold 해제 추정 = **2026-09-17(목) 14:15 KST 무렵** (`npm profile get` 의 `updated: 2026-09-14T05:15:17Z` 기준, 추정).

1. **npmjs.com 에 로그인해 빨간 배너가 사라졌는지 먼저 본다.** 남아 있으면 더 기다린다 — 재시도로 안 풀린다.
2. **일반 터미널**(Tabby/PowerShell 창)에서 등록한다. 브라우저 2FA 인증을 두 번(필요 시) 거친다.

   ```powershell
   npx -y npm@11 trust github tabby-agentdeck --file npm-publish.yml --repo jghwang2/tabby-agentdeck --allow-publish -y
   ```

   - Claude Code 의 `!` 로 돌리면 안 된다 — TTY 가 아니라 인증을 기다리지 않고 `EOTP` 로 바로 끝난다.
   - `--repo` 는 CLI 에서만 `owner/repo` 형식이다(웹 폼은 칸이 나뉘어 있다).
   - `--allow-publish` 필수. 기본값 false 라 빼면 에러, `--allow-stage-publish` 만 주면 워크플로의 `npm publish` 가 거부된다.
   - 웹 폼으로 해도 되지만, 결과가 눈에 보이는 CLI 쪽이 판정이 쉽다. **패키지당 설정은 1개**라 둘 다 하면 두 번째가 409.
3. 등록 확인 — 로그인 토큰으로 조회만 하면 된다(OTP 불필요):

   ```bash
   TOK=$(sed -n 's#^//registry.npmjs.org/:_authToken=##p' ~/.npmrc)
   curl -s -H "Authorization: Bearer $TOK" https://registry.npmjs.org/-/package/tabby-agentdeck/trust
   ```

   `[]` 면 미등록, `jghwang2/tabby-agentdeck` + `npm-publish.yml` 이 들어 있으면 등록됨.
4. 연결 판정 — Actions → Publish to npm → Run workflow(`main`).
   main 버전이 **이미 배포된 버전**이면 실제 발행은 일어나지 않으므로 안전한 프로브가 된다:
   - `E403 ... cannot publish over the previously published versions` → **연결 성공** (OIDC 교환 통과)
   - `ENEEDAUTH` → 미연결 (등록 값 불일치 또는 미등록)
5. 등록이 여전히 403 이면 그때 계정 설정 `Require two-factor authentication for write actions` 를 켜 본다
   (2026-09-14 기준 `two-factor auth: auth-only`). hold 가 원인이었다면 필요 없을 가능성이 크다.
6. 연결되면: `npm run release -- 1.1.4`(작업트리가 clean 해야 한다) → push → Run workflow →
   `npm view tabby-agentdeck@1.1.4 dist.attestations` 에 값이 있는지로 OIDC 발행을 확인한다.
   확인 뒤 패키지 Settings → Publishing access 를 **"Require two-factor authentication and disallow tokens"** 로 잠그면
   로컬 publish 경로가 닫히고 배포는 Actions 로만 나간다.

재발 방지: 보안키를 2개 이상(PC + 폰 패스키 또는 YubiKey) 등록해 두면 리커버리 코드를 쓸 일이 없다.
폰 패스키는 PC 에서 QR 로 등록하면 `Device registration failed` 가 잘 나므로 **폰 브라우저에서 직접** 로그인해 `Add Security Key`.

#### 등록 값

<https://www.npmjs.com/package/tabby-agentdeck/access> → Trusted Publisher → GitHub Actions

| 항목 | 값 |
|---|---|
| Organization or user | `jghwang2` ← **GitHub 계정.** npm 계정(`junggon`)이 아니다 |
| Repository | `tabby-agentdeck` (슬래시 없이 저장소 이름만) |
| Workflow filename | `npm-publish.yml` (`.github/workflows/` 경로를 붙이면 매칭 실패) |
| Environment name | 비워 둔다 |

등록이 안 됐거나 값이 어긋나면 이렇게 죽는다 (2026-09-14 run 34801138465 실측):

```
npm http fetch POST 404 https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/tabby-agentdeck
npm verbose oidc Failed token exchange request with body message:
                 OIDC token exchange error - package not found
npm error code ENEEDAUTH
```

`package not found` 는 "패키지가 없다" 가 아니라 **"이 저장소/워크플로로 발행을 허용하는 설정이 없다"** 는 뜻이다.
패키지명 자체는 교환 URL 에 정상으로 들어가 있다.

### 함정 두 개 (둘 다 실측으로 잡았다)

**① tgz 경로는 `./` 로 시작해야 한다.**

```
npm publish package/tabby-agentdeck-1.1.3.tgz     # ✗
npm publish ./package/tabby-agentdeck-1.1.3.tgz   # ✓
```

앞엣것은 npm 이 파일이 아니라 **GitHub shorthand(`<org>/<repo>`)** 로 읽어
`git ls-remote ssh://git@github.com/package/tabby-agentdeck-1.1.3.tgz.git` 를 때리고
`Permission denied (publickey)` / exit 128 로 죽는다 (run 34798914763).

**② publish 잡의 `setup-node` 에 `registry-url` 을 주면 안 된다.**

주면 임시 `.npmrc` 에 `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` 이 써지고
`NODE_AUTH_TOKEN` 이 더미값(`XXXXX-XXXXX-XXXXX-XXXXX`)으로 나간다.
**토큰이 있으면 npm 은 OIDC 교환을 아예 시도하지 않는다** — 그 더미로 인증하려다
`404 Not Found - PUT https://registry.npmjs.org/tabby-agentdeck` 로 죽는다 (run 34800310910).

빼고 나서야 교환 요청(`POST /-/npm/v1/oidc/token/exchange/...`)이 실제로 나갔다 (run 34801138465).
기본 레지스트리가 이미 `registry.npmjs.org` 라 이 줄은 없어도 된다.

> **npm 공식 문서 예제에는 `registry-url` 이 들어 있다.** 문서와 실측이 어긋나는 자리이므로
> 워크플로를 손댈 때 "문서에 있으니 되돌리자" 로 다시 넣지 말 것. 넣으면 ②로 되돌아간다.

### 요구 사항

- npm CLI 11.5.1 이상, Node 22.14.0 이상 (현재 러너: npm 11.19.1 / Node 24)
- publish 잡에 `permissions: { contents: read, id-token: write }`
  - 러너 로그의 `GITHUB_TOKEN Permissions` 그룹에는 `id-token` 이 **안 보인다.** 그것만으로 권한이 없다고
    판단하면 오진이다 — 실제 확인은 `ACTIONS_ID_TOKEN_REQUEST_URL` 존재 여부로 한다 (run 34800637666 에서
    둘 다 PRESENT 였다).

공식 문서: <https://docs.npmjs.com/trusted-publishers/>
