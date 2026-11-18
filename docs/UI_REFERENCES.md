# 前端改造：G6 知识探索空间

改造日期：2026-11-18。

## 开源调研与选择

| 项目 | 用途与判断 |
| --- | --- |
| [AntV G6](https://github.com/antvis/G6) | MIT，提供图绘制、行为、动画和插件。根据用户选择，实际接入 5.1.1 浏览器发行包。 |
| [G6VP](https://github.com/antvis/G6VP) | Apache-2.0，完整的图分析工作台。参考工具栏和缩略图组织方式；仓库已于 2026-05-19 归档，没有作为运行依赖。 |
| [Reagraph](https://github.com/reaviz/reagraph) | Apache-2.0，React / WebGL 图组件。查看了单选交互示例；没有引入 React 或复用其代码。 |
| [Cytoscape.js](https://github.com/cytoscape/cytoscape.js) | 图可视化与分析库，作为备选调研；本轮选择 G6。 |

核对过的参考代码：

- [G6VP MiniMap](https://github.com/antvis/G6VP/blob/master/packages/gi-assets-basic/src/components/MiniMap/Component.tsx)
- [G6VP Toolbar](https://github.com/antvis/G6VP/blob/master/packages/gi-assets-basic/src/components/Toolbar/Component.tsx)
- [Reagraph SingleSelection](https://github.com/reaviz/reagraph/blob/master/stories/demos/SingleSelection.story.tsx)
- [G6 自定义节点文档](https://g6.antv.antgroup.com/en/manual/element/node/custom-node)
- [G6 交互行为文档](https://g6.antv.antgroup.com/en/manual/behavior/overview)
- [G6 视口 API](https://g6.antv.antgroup.com/en/api/viewport)

上述工作台代码用于理解交互组织，界面与业务适配由本项目实现。G6 引擎使用其官方 npm 发行包，保留 MIT 许可证。

## 本轮实现

- 浅色侧栏、点阵画布、统一排版、配色及卡片；同步调整学习路径、术语和源码弹窗。
- 原生 SVG 画布替换为 G6 Canvas，保留现有图谱 JSON 与证据可信度规则。
- 自定义节点卡片、悬停一跳高亮、选择后的上下游高亮、节点与画布拖动。
- G6 缩略图、动画缩放、布局过渡、结构 / 环形布局切换。
- 专注模式、节点定位选择器、搜索结果键盘导航。
- 动效开关与系统 `prefers-reduced-motion` 适配；动画仅辅助阅读，不是实际业务运行记录。

## 文件与构建

- `static/workbench.js`：可维护的应用源码。
- `static/vendor/g6-5.1.1.min.js`：固定版本的 G6 官方发行包，离线保存在项目中。
- `static/vendor/G6-LICENSE.txt`：G6 MIT 许可证。
- `static/app.js`：由 `python build_ui.py` 合并生成，供本地 HTTP 服务使用，不直接编辑。
- `.local-backups/ui-before/`：本轮修改前的三份前端文件，仅保存在本机并被 Git 忽略。

采用合并文件，使已经运行的旧版 Python 服务也能直接提供新版前端，无需为新增资源路由重启服务。用户刷新页面即可加载；运行时不依赖 CDN 或 npm。

## 验证范围

- 原有 Python 测试 13/13 通过。
- Node VM 验证应用和 G6 发行包语法，实际加载发行包并核对 Graph / Rect 等 API。
- `tests/ui_smoke.mjs` 使用 G6 测试替身检查视角、State 筛选、上下游高亮、布局坐标、快速导航、搜索、学习页面、进度和动效开关；它不验证真实 Canvas 绘制。
- 已运行的 8765 服务成功返回更新后的页面、样式和 G6 合并脚本。
- 浏览器控制工具因无法可靠识别 Windows 浏览器当前网址而中止，因此本轮未完成真实浏览器视觉、鼠标拖动及 Canvas 动画验收。
