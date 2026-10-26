# xcpc-vp

基于 RankLand 榜单数据的纯前端 XCPC 虚拟参赛工具。

选择一场历史比赛后，在浏览器中按原始提交时间重放榜单。可以暂停、倍速、从指定时间开始，并加入自己的队伍手动记录 AC、WA、TLE、MLE、RTE、CE 等判题结果。

## 功能

- 使用 RankLand 官方榜单合集选赛
- Finder 风格的分栏选赛和顶部搜索
- ICPC、传统 CCPC、CCPC 2026 揭题逻辑
- 按原始提交时间重放榜单
- 暂停、倍速、指定起始时间
- 手动设置提交的小时和分钟，支持 AC、WA、TLE、MLE、RTE、CE、PE、OLE、IDLE、NOUT、RJ、UKE
- 使用官方 RankLand 榜单渲染器和评分算法
- 所有题目列同时显示，题目较多时自动压缩列宽
- 比赛信息、队伍数、学校数、人数、金银铜和题目链接预览
- 深色模式
- 进度保存在浏览器本地

## 页面

应用只使用根路径，通过 URL 参数区分选赛页和 VP 页：

```text
http://127.0.0.1:5174/
http://127.0.0.1:5174/?contest=icpc2020invitational-xiaomi
```

不注册 `/live/`、`/vp/`、`/collection/` 或 `/search/` 路由。

## 开发

需要 Node.js 22 和 pnpm 9：

```bash
pnpm install --frozen-lockfile
pnpm dev:vp
```

打开：

```text
http://127.0.0.1:5174/
```

生产构建：

```bash
pnpm build:vp
pnpm preview:vp
```

构建产物位于 `dist/`，是可直接部署的静态网站。

## URL 参数

```text
contest   比赛 ID
run       当前 VP 实例 ID
rule      auto、ICPC 或 CCPC26
speed     1、2、5、10、30、60
from      起始时间，单位为分钟
team      队伍名称
organization 学校 / 单位（可选）
feed      是否显示实时提交条，0 或 1
play      是否载入后自动开始，0 或 1
count     CCPC 2026 通过队伍数阈值
ratio     CCPC 2026 通过比例阈值，百分比
```

额外罚时固定为 20 分钟，提交时间必须早于当前虚拟时间和比赛结束时间。

## 测试

```bash
pnpm exec vitest run --config vite.config.js
pnpm build:vp
```

测试覆盖重放边界、官方 ICPC 计分、CCPC 2026 揭题、分栏选赛、参数校验、比赛摘要和手动提交时间。

## 数据与来源

- 榜单合集和 SRK 数据来自 [RankLand](https://rl.algoux.cn/collection/official)。
- 榜单渲染组件和评分工具来自 [algoux/standard-ranklist](https://github.com/algoux/standard-ranklist) 及其相关仓库。
- 页面结构和视觉基于 [algoux/rankland-web](https://github.com/algoux/rankland-web) 官方项目。
- 本项目是独立的虚拟参赛工具，不代表 RankLand 官方。

## 许可证说明

本仓库保留上游项目和第三方依赖的版权信息。

`@algoux/standard-ranklist`、渲染器和相关工具包包含 MIT 许可证文本；榜单数据来自 [algoux/srk-collection](https://github.com/algoux/srk-collection)，请按其许可证和数据说明使用。

`rankland-web` 上游源码的授权边界请以作者的明确许可为准。本仓库暂不为上游未明确授权的源码声明新的许可证。
