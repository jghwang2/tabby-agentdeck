const path = require('path')
const webpack = require('webpack')
const fs = require('fs')

// `--env release` = npm 배포 빌드. 개발용 라이브 리로드(devReload.service)를 스텁으로 바꿔 끼워
// 번들에서 코드째로 뺀다. 검증은 tools/check-release.js (package.json `prepack`).
// **배포 빌드에는 소스맵을 싣지 않는다.** `source-map` 이 만드는 `.map` 은 줄 대응표만
// 담는 것이 아니라 `sourcesContent` 에 **압축 전 원본 전문**(주석 포함)을 넣는다. 번들
// 자체는 주석이 제거돼 깨끗한데 그 옆 파일로 소스가 통째로 따라 나가는 셈이라, 번들을
// 줄이려고 한 일이 무의미해진다(1.1.3 실측: `index.js.map` 1.4MB, `sourcesContent` 78개).
// 개발 빌드에서는 그대로 켜 둔다 — 디버깅에 필요하고 그 산출물은 배포되지 않는다.
module.exports = (env = {}) => ({
    entry: './src/index.ts', target: 'electron-renderer',
    devtool: env.release ? false : 'source-map',
    output: { path: path.resolve(__dirname, 'dist'), filename: 'index.js', libraryTarget: 'umd' },
    resolve: { extensions: ['.ts', '.js'] },
    externals: [/^@angular\//, /^tabby-/, 'rxjs', /^rxjs\//],
    module: { rules: [
        { test: /\.ts$/, loader: 'ts-loader' },
        { test: /\.scss$/, use: ['style-loader', 'css-loader', 'sass-loader'] },
    ] },
    plugins: env.release
        ? [
            new webpack.NormalModuleReplacementPlugin(/[\\/]devReload\.service$/, './devReload.stub'),
            // **옛 맵은 릴리스 빌드가 직접 치운다.** `devtool: false` 는 새로 만들지 않을 뿐
            // 이미 있는 파일을 지우지 않아서, 직전에 개발 빌드를 돌렸으면 그 산출물이 `dist/` 에
            // 남고 `npm pack` 은 디스크에 있는 것을 담는다. `check-release.js` 도 같은 일을
            // 하지만 그쪽은 `prepack` 체인에만 걸려 있어, 스크립트를 건너뛰고 내보내면 방어가
            // 통째로 빠진다. 빌드 쪽에도 두어 **둘 중 하나만 돌아도** 막히게 한다
            {
                apply: compiler => compiler.hooks.done.tap('DropStaleSourceMap', () => {
                    const map = path.resolve(__dirname, 'dist', 'index.js.map')
                    if (fs.existsSync(map)) { fs.rmSync(map) }
                }),
            },
        ]
        : [],
})
