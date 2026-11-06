# 独立的 RankLand / DOMjudge 入口

日期：2026-11-06。分支：`domjudge-scoreboard`。

## 入口与页面

在选赛页右侧参赛配置中，通过与“赛制”同一行的“榜单系统”下拉框选择 **RankLand** 或 **DOMjudge**，再开始比赛。立即开始、预约与随机选赛共用这一步选择。

- RankLand 进入 `/`，使用原 RankLand VP 页面。
- DOMjudge 整页导航到 `/domjudge.html`，直接运行原 DOMjudge 页面。
- 榜单内部没有界面切换器。
- DOMjudge 页面没有 Vue 应用外壳、iframe、RankLand 样式、VP 工具栏、手动提交表单、滚动提交侧栏或应用页脚。
- 传统 ICPC / CCPC 可选两套；CCPC26 仅可选 RankLand。跟随原比赛时也检查数据声明。CCPCOJ 暂不接入。

`StyledRanklistRenderer.vue` 与其偏好设置文件保持原样，没有加入 DOMjudge 展示代码。`setup.view.vue` 只负责外部入口选择；`board-entry.ts` 根据选择生成不同文档地址。

## DOMjudge 原版展示

源码固定在 `DOMjudge/domjudge@071e3bafce3828a5cd32b5f4e41598705cbb6c72`。直接运行该提交的 Twig 模板、完整 CSS 和完整 JavaScript，没有用 Vue 重画榜单。按用户要求，接入层在比赛标题旁增加原 RankLand 榜单链接，显示中国时区时间；vendor 原文件未改。原文件逐文件 SHA-256 保存在 `vendor/domjudge/manifest.json`，测试同时确认 RankLand 原展示文件保持不变。

`domjudge.html` 是 Vite 的第二个 HTML 入口，仅加载 DOMjudge 的样式和原始浏览器依赖。`src/client/modules/domjudge/main.ts` 只负责取比赛数据、重建 URL 时钟、生成回放快照和转接本地数据请求。它不挂载 RankLand 的 App 或 VP 视图。

`domjudge/native.ts` 用 Twing 执行原 Twig，将 SRK 快照适配成模板需要的 contest、team、scoreboard、matrix、summary 对象。排名、罚时、冻结和回放沿用已有 SRK 数据逻辑。

`public/scoreboards/domjudge/vp-bridge.js` 只做同文档的数据转接：使用原版 JavaScript 的 AJAX 更新、学校筛选、关注置顶、队伍弹窗、提交弹窗和 Problemset。它不生成榜单或详情界面。刷新采用原机制，保持已打开弹窗。

登录会话与服务器倒计时不适用于本地回放，因此仅在模板 loader 中省略这两个 include；原文件仍保持不变。回放起点、倍速和开始时间在外面的选赛页设置。

来源和完整许可证见 [第三方代码说明](../src/client/components/ranklist/vendor/README.md)。

## 验证

- 84 项单元 / 渲染测试通过，包括独立入口地址、赛制限制、原文件完整性和数据适配。
- 两个 HTML 入口的生产构建通过。
- Chromium 从选赛页分别点击开始，确认进入不同文档。
- DOMjudge 页确认无 iframe、RankLand 外壳、VP 控件、榜单切换器，且只加载原版样式。
- 原生关注置顶、队伍详情、题目列表、手机整页布局和刷新验证通过。
- RankLand 仍进入原页面；新赛制禁用 DOMjudge 入口。
- 全量类型检查仍有仓库原有错误；新增入口和 DOMjudge 数据代码无类型诊断。

## 开始时间与封榜

- 点击“立刻开始”时即记录时间，随后网络加载不会推迟起点；预约仍使用预约时间。链接中的 `at` 在刷新后继续作为同场 VP 的起点。
- DOMjudge 页头开始时间来自该起点，结束时间为起点加比赛时长；页头及 Last Update 统一显示 `UTC+8`。历史源比赛的开始时间保留给回放引擎，不覆盖原始数据。
- DOMjudge 固定最后 1 小时封榜，源数据缺省或配置其他时长也使用 1 小时；不足 1 小时的比赛从开始封榜。封榜后的提交显示 pending、隐藏详情结果，结束后恢复最终成绩。
- 91 项测试通过，生产构建通过，新增代码 ESLint 通过；实际榜单已确认标题链接、开始时间和 60 分钟封榜提示。
