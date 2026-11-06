# DOMjudge 原版展示代码

来源：`DOMjudge/domjudge`，固定提交 `071e3bafce3828a5cd32b5f4e41598705cbb6c72`。
Copyright (c) 2004–2026 DOMjudge developers and contributors，GPL-2.0-or-later。
完整许可证保存在 `public/licenses/domjudge-COPYING.txt`。

## 原样保留的文件

- `domjudge/templates/`：从上游 `webapp/templates/` 按原目录复制的 Twig 文件，包括导航、榜单、队伍行、题目单元格、汇总、颜色图例、提交详情和队伍详情模板。
- `public/scoreboards/domjudge/style_domjudge.css`：上游完整 CSS。
- `public/scoreboards/domjudge/js/domjudge.js`：上游完整 JavaScript，负责关注队伍、置顶、提交详情、AJAX 弹窗及原生交互。
- `public/scoreboards/domjudge/images/DOMjudgelogo.svg`：上游资源。

以上文件没有改写。`domjudge/manifest.json` 记录逐文件 SHA-256，测试校验这些文件未发生修改。

DOMjudge 使用的前端依赖也在本地提供：Bootstrap 5.3.8、jQuery 3.7.1、Font Awesome Free 7.1.0、jquery-debounce-throttle 1.0.6-rc.0。版本来自该 DOMjudge 提交的 package.json。许可证保存在 `public/scoreboards/domjudge/licenses/`；debounce 的双许可证声明保留在原脚本头部。运行时不依赖外部 CDN。

## 仅用于接入的代码

- `../domjudge/native.ts`：把 SRK 数据适配成 DOMjudge 模板所需的 contest、scoreboard、team、matrix 与 summary 对象；使用 Twing 运行原始 Twig。模板组合与路由映射属于接入层，没有另写 Vue 榜单或覆盖上游 CSS。按用户要求，loader 在原比赛标题旁加上 RankLand 原榜单链接，其他原生布局保留；这项定制不改 vendor 文件。
- `domjudge.html`：独立的原版 HTML 页面入口，直接加载 DOMjudge 样式和脚本，没有 iframe，也不加载 RankLand 的 App 或 VP 界面。
- `src/client/modules/domjudge/main.ts`：读取选赛入口生成的链接，使用已有时钟和回放数据，只向原版页面提供快照。
- `public/scoreboards/domjudge/vp-bridge.js`：本地数据传输适配器，接上原 JavaScript 的 AJAX、fetch、筛选表单和队伍详情请求；不生成榜单或弹窗 HTML。

Twing 与 PHP Twig 的显式 `escape('html_attr')` 对安全 HTML 的处理存在差异。接入层在显式转义前取出 Markup 内容，保留原模板的属性转义语义，避免题目标识破坏 HTML 属性。

VP 没有 DOMjudge 登录会话，也不使用 DOMjudge 服务器的墙上时钟倒计时，因此 loader 将登录、倒计时两个 include 的返回值设为空；源文件仍按原样保存。导航、比赛卡片、进度条、筛选、榜单、图例和详情均来自原模板。开始时间、回放起点和倍速在进入前的选赛页设置；DOMjudge 页面内没有外层 VP 控件。

## 赛制范围

- 传统 ICPC：在选赛入口选择原 RankLand 页面或 DOMjudge 原版独立页面。
- CCPC26：原 RankLand 页面。即使进入封榜或最终结果，也不开放 DOMjudge。
- CCPCOJ：本轮暂不接入。

排名和计分仍来自 SRK 的现有比赛快照，适配层不运行另一套排名算法。DOMjudge 展示中的尝试数优先使用 SRK 的有效 `tries`，不使用 `solutions.length` 代替。

DOMjudge 时间数据使用实际 VP 开始时间，统一按中国时区 UTC+8 显示；本地回放固定最后 1 小时封榜。相关规则位于 `src/client/modules/domjudge/replay.ts`，不改原版 DOMjudge 的展示样式。
