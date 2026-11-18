# 掌柜智库学习知识图谱

2026-11-18 界面升级：已接入本地固定版本的 AntV G6 5.1.1，增加悬停高亮、动画缩放、布局过渡、缩略图和专注模式；学习路径、术语及源码证据功能保留。调研依据、维护方式和验证边界见 [docs/UI_REFERENCES.md](docs/UI_REFERENCES.md)。

一个围绕 **掌柜智库真实源码** 的本地学习网站。帮助你回答“这个模块做什么、下一步到哪里、数据从哪里来、代码证据在哪里”。

## 立即启动

需要 Python 3.11 或更高版本、现代浏览器。无需 npm、pip 安装，不需要启动数据库或模型服务。

Windows：双击本目录的 **`启动网站.cmd`**（也可用 `start.cmd`），保持窗口开启，然后打开：

**http://127.0.0.1:8765**

也可以在本目录运行：

```powershell
python start.py
```

默认读取附带的 `reference-source/` 源码快照，启动时重新生成图谱。**不要直接双击 static/index.html**，源码证据依赖本地服务。

关闭启动窗口或在终端按 Ctrl+C 停止服务。若 8765 端口被占用：

```powershell
python start.py --port 8766
```

随后访问 http://127.0.0.1:8766 。如果系统找不到 `python`，可尝试 `py -3 start.py`；Windows 一键脚本会依次检测 `python` 和 `py -3`，要求版本不低于 3.11。

如果旧版本启动窗口出现“d 不是内部或外部命令”等报错，请使用新版启动文件替换旧文件，或重新解压更新后的完整包。旧脚本在 Windows CMD 中存在换行与编码兼容问题；新版使用 ASCII 命令与 CRLF 换行，并通过真实 CMD 启动验收。

## 已交付的 MVP

- 项目 → 模块 → 文件 → 类 / 函数逐层展开。类下可继续进入方法。
- 架构总览、问答查询流程、知识导入流程三个入口。
- 单击节点查看职责、接口路由、State 字段、上下游及代码锚点；双击或点击“展开子节点”深入。
- 点击“查看关联图”显示当前节点跨文件的一跳关系；选择节点高亮画布中的可达上下游。蓝色为上游、金色为下游；环中的节点可能同时属于两者。
- 点击连线查看关系类型、说明、可信度及代码证据。交叉密集时可从详情的上游/下游关系列表选择，或 Tab 定位连线后按 Enter。
- 全局搜索模块、文件、函数、描述和术语；支持类型、关系、可信度筛选。
- 拖动节点、拖动画布、滚轮缩放、适应画布、重置布局。
- 4 条学习路径、12 个项目术语；学习进度保存在本机浏览器。
- 代码证据弹窗显示实际源码、行号、符号及绝对路径；支持复制位置与 VS Code 跳转。
- 点击证据时重新校验 SHA-256；文件变化时明确提示证据过期。

默认“结构 / 流程”视图隐藏容易拥挤的 State 候选线。选择“State 数据流”或“全部关系”后展示它们。“待验证”筛选只保留有对应关系的节点；如果没有结果，点击“清除筛选”。

## 代码来源与仓库检查结果

来源：[2935492622-cmyk/zhanggui-zhiku](https://github.com/2935492622-cmyk/zhanggui-zhiku)。2026-11-18 只读下载，远端 main 当时指向：

`428f5255184733963b352d982c098cad534b5e72`（2026-11-10，“更改地址”）

实际检查到的技术栈：Python；uv 管理依赖；FastAPI 提供 HTTP 接口；LangGraph 组织两条工作流；原生 HTML 页面；LangChain / OpenAI 客户端、BGE 向量模型、Reranker；Milvus、MongoDB、MinIO、Neo4j 客户端。README 指定 Python 3.12，pyproject 声明 >=3.11。本网站验证环境为 Python 3.14.3、Node 24.22.3（Node 仅用于开发时的语法检查，运行网站不需要）。

快照包含原仓库 `app/` 与 `pyproject.toml` 的原样副本，不包含 `.env`、虚拟环境、模型、数据库、Git 元数据或真实业务数据。`.learning-source.json` 记录原始提交和文件哈希。网站不导入或执行业务代码。

本次索引范围：`app/**/*.py` 与 `app/**/*.html`，57 个文件、241 个节点、599 条关系，其中 373 条为显式源码事实，226 条待验证。未扫描测试、提示词正文及第三方库内部实现；HTML 只作为文件节点，不静态推断其 JavaScript 调用。

## 范围与实现选择

这个产品围绕掌柜智库学习，不建设通用图谱平台。当前使用 **Python 标准库 AST / HTTP 服务 + 原生 JavaScript / G6 Canvas + JSON**：G6 发行包随项目保存，运行不需要 npm、CDN 或业务依赖。

网站、索引和学习内容独立保存；现有业务仓库没有被修改，没有 GitHub 写入、提交或推送。图谱 JSON 数据契约独立于 G6 视图。

本版不包含 AI 问答、真实请求回放、运行时调用追踪或业务服务调试。图上的“知识图谱检索”是掌柜智库中的业务节点；学习网站本身不需要图数据库。

## 可信度规则

| 标签 | 允许表达的事实 | 不代表什么 |
| --- | --- | --- |
| 源码已确认 | 文件存在、符号声明、显式 import、add_node 绑定、字面量 add_edge / set_entry_point 配置 | 不代表这段代码在某次请求中确实执行，或业务已运行成功 |
| 待验证 | AST 名称匹配的调用候选、按 import 汇总的模块依赖、根据 return 推断的条件分支、同名 State 字段候选 | 不可当成真实调用栈或数据传输记录 |

“已确认”是显式语法事实的确认，并非人工审计所有业务行为。注释与 docstring 是学习入口，可能过时，实际逻辑需要结合源码判断。

每条关系都有 `evidence[]`，包含相对路径、1-based 行号、符号（适用时）与扫描时文件哈希。本版刻意不解析通配符导入、动态方法调用、装饰器派发、运行时重绑定；可能漏掉真实调用。同名匹配也可能误匹配，调用候选始终待验证。

State 字段按实现文件静态汇总，可能包含辅助函数、未执行分支及非 State 返回字典；缺失字段与隐式写入也可能漏检。它只用于提出“应该读哪里”的学习线索。

## 更新到你的日常开发仓库

第一次指定完整路径：

```powershell
python start.py --repo "D:\你的项目目录\zhanggui-zhiku"
```

之后启动会记住这个目录，保存在本站 `repo.local.json`。若换了电脑或目录，请重新使用 `--repo`。业务仓库只读；扫描只更新本站 `data/graph.json`。不要求在业务仓库中创建任何文件。

代码修改后重启网站即可重新扫描；也可保持服务运行，在本站目录执行：

```powershell
python graph_builder.py --repo "D:\你的项目目录\zhanggui-zhiku"
```

然后刷新页面。远端版本更新不会自动拉取或覆盖你的工作区；请先按自己的开发流程同步仓库，再扫描。

## 数据维护

| 文件 | 维护方式 |
| --- | --- |
| `data/graph.json` | 自动生成，不手工维护；重新扫描会整体替换 |
| `graph_builder.py` | 提取规则与模块中文说明；扩展规则时保留可信度约束 |
| `content/learning.json` | 人工维护学习路径、思考问题与术语；以 path + symbol 关联源码 |
| `reference-source/` | 交付时的只读学习快照；建议通过 `--repo` 切换真实开发仓库 |
| `repo.local.json` | 本机源码路径，首次启动生成，不应提交到公共仓库 |

节点 ID 示例：`file:app/utils/sse_utils.py`、`symbol:app/utils/sse_utils.py:sse_generator`。关系类型包含 contains / imports / calls / flow / conditional / data / implements / dependency。自动推断规则必须输出 `pending`；不得把候选关系仅凭同名或 AI 解释改成 confirmed。

学习进度按本地源码目录隔离，保存在浏览器 localStorage；重启服务不丢失，清除浏览器网站数据会重置。更改源码目录后是一份新进度。没有账号和云端同步。

## 验收与继续开发

运行检查：

```powershell
python -m unittest discover -s tests -v
```

如果有 Node，可额外执行 `node --check static/app.js` 与 `node tests/ui_smoke.mjs`。前端应用源码为 `static/workbench.js`，修改后运行 `python build_ui.py` 重新生成浏览器加载的 `static/app.js`。

详细操作验收见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)，产品边界和演进见 [docs/MVP.md](docs/MVP.md)，日常迭代方法见 [docs/ITERATION_GUIDE.md](docs/ITERATION_GUIDE.md)，交给 Codex 的持续开发提示词见 [docs/CODEX_PROMPT.md](docs/CODEX_PROMPT.md)。

网站仅监听 `127.0.0.1`，没有写入业务、远程执行或任意文件读取接口。源码接口只接受扫描清单中的文件，并检查解析后路径仍在仓库内。
