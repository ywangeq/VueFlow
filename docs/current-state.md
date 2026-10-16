# 当前实现

2026-10-16：本地音视频工作台首版。

## 入口与归属

| 文件 | 负责内容 |
|---|---|
| src/App.vue | 工程装配、选择、保存、任务提交与导出 |
| src/domain/types.ts | 工程、章节、素材版本、评论、生成任务的共享合同 |
| src/domain/project.ts | 选用版本与章节验收状态 |
| src/domain/script.ts | 章节标题解析，不修改朗读内容 |
| src/components/ChapterGraph.vue | 原版 scaffold 图谱适配与可访问列表 |
| src/components/ChapterInspector.vue | 正文／表现、评论、版本、任务导入 |
| src/components/SequencePlayer.vue | 连播与单一播放所有权 |
| src/services/media.ts | 浏览器解码、增益与 WAV 混音导出 |
| src/services/api.ts | 本机 HTTP 适配 |
| server/index.mjs | 单实例工程持久化、并发修订、文件与任务权威 |
| src/vendor/scaffold | 第三方可视化组件及最小依赖，保留原许可 |

## 权威与状态

- `project.chapters` 数组决定播放顺序；坐标仅展示布局。
- 服务端不可变素材版本和生成快照为权威。前端不能通过保存伪造素材 URL、版本快照、任务完成状态。
- 当前选择、验收版本和未解决评论决定章节显示状态。正文或表现要求改变会使已生成版本显示过期。
- 生成任务状态为 awaiting_external / completed / cancelled，均反映本地交接状态，不代表远端服务正在生成。
- 导入任务结果时比较原稿、表现要求、评论快照与基线版本；晚到结果保存但不自动激活。
- 原子重命名和实例内串行变更避免半写。修订冲突需保留草稿后刷新。只允许单个服务实例拥有一个 data 目录；不支持跨进程写同一目录。

## 已知范围

- 无账号、公共托管、多人协作、多工程列表和在线 MiniMax worker。
- 无视频合成导出、字幕和多轨时间线。
- JSON 工程备份不包含媒体、不提供界面恢复；完整备份整个 data/。
- 试听效果仍需人判断。测试用合成音只验证播放与混音，不证明真实人声表演质量。
- 媒体时长由浏览器提供；后端只做范围与签名检查，服务不执行 ffprobe 全量媒体检查。

## 债务与后续

避免了 React/Vue 双运行时、重复状态和 MiniMax 专用逻辑散落 UI；保留上游图谱适配层。暂保留单工程本地文件存储、手动外部生成连接和浏览器混音；后续 worker/视频渲染接入独立适配器，不能把本地排队伪装成真实调用。
