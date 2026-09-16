# 웹사이트 (GitHub Pages)

<https://jghwang2.github.io/tabby-agentdeck/> — `docs/` 폴더를 그대로 서빙한다.

| 경로 | 파일 | 무엇 |
|---|---|---|
| `/` | `docs/index.html` | 랜딩 (영문) |
| `/ko.html` | `docs/ko.html` | 랜딩 (한국어) |
| `/guide/` | `docs/guide/index.html` | 사용 설명서 (영문) |
| `/guide/ko.html` | `docs/guide/ko.html` | 사용 설명서 (한국어) |

스타일은 두 장뿐이다 — 랜딩 2종이 `docs/site.css`, 설명서 2종이 `docs/guide/guide.css` 를 공유한다.
스크린샷은 `docs/guide/img/` 한 곳에 두고 네 페이지가 같이 쓴다.

## 배포 방식 — 브랜치 소스 (워크플로 없음)

**Settings → Pages → Source = `Deploy from a branch`, 브랜치 `main`, 폴더 `/docs`.**
`main` 에 push 하면 GitHub 이 알아서 다시 올린다. 빌드 단계가 없으므로 워크플로 파일도 없다.

> **왜 Actions 배포(`actions/deploy-pages`)를 안 쓰나.** 그러려면 `.github/workflows/` 에 파일을
> 추가해야 하는데, **그 경로의 파일을 만들거나 고치는 push 는 토큰에 `workflow` 스코프가 없으면 거부된다.**
> 이 저장소를 미는 자격은 `repo` 스코프뿐이라(2026-09-14 확인: `X-OAuth-Scopes: repo`) 워크플로를 못 올린다.
> 정적 파일 네 장에 빌드 단계가 필요하지도 않으므로 브랜치 소스가 맞다.
> 나중에 빌드가 필요해지면 그때 `workflow` 스코프를 받아 전환한다.

`docs/.nojekyll` 은 Jekyll 전처리를 끈다 — 지금은 밑줄로 시작하는 파일이 없어 증상이 없지만,
나중에 그런 파일이 생기면 **말없이 404** 가 되므로 미리 막아 둔다.

## 버전 표기

네 페이지 모두 `<span class="ad-version">` 마커로 버전을 적고, `tools/sync-version.js` 가
`package.json` 에서 찍어 넣는다. **손으로 적지 말 것** — 한쪽만 갱신되는 것을 막으려고
`test/version.test.js` 가 네 장을 전부 잰다.

## 손볼 때 주의

- 랜딩·설명서는 **언어마다 파일이 따로다.** 한쪽만 고치면 다른 언어가 조용히 뒤처진다.
  기능을 더하면 네 장 중 해당하는 것을 같이 고칠 것.
- `.why::before` 라벨처럼 **마크업에 못 적는 글자**만 CSS 변수(`--why-label`)로 뺐다.
  버튼·제목처럼 마크업에 적을 수 있는 글자는 변수로 빼지 않는다 — 번역 누락을 눈으로 잡기 쉬워야 한다.
- 로컬 확인은 `npx serve docs` 또는 `python -m http.server -d docs 8080`.
  `file://` 로 열면 `/guide/` 같은 디렉토리 링크가 안 먹는다.
