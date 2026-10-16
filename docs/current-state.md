# 当前实现

2026-10-16：工程升级为 schemaVersion 2，层级为工程 → 章节 → 句段。章内每个句段独立生成、预览、返修和验收；音视频继续共用句段节点。

## 入口与归属

| 文件                                   | 负责内容                                                 |
| -------------------------------------- | -------------------------------------------------------- |
| src/App.vue                            | 工程装配、选择、保存、任务提交与导出                     |
| src/domain/types.ts                    | 工程、章节组、句段、素材版本、评论、生成任务的共享合同   |
| src/domain/project.ts                  | 选用版本与章节验收状态                                   |
| shared/script-parser.mjs               | 章节标题与句段拆分，保留文稿内容                         |
| schemas/project-v2.schema.json         | 工程 v2 结构合同与字段边界                               |
| shared/project-format.mjs              | 跨引用校验、v1 迁移、TXT／MD／JSON／ZIP 导入和可携带 ZIP |
| src/components/ChapterGraph.vue        | 原版 scaffold 图谱适配与可访问列表                       |
| src/components/SegmentInspector.vue    | 句段正文／表现、评论、版本、任务导入                     |
| src/components/SequencePlayer.vue      | 按章节与启用句段连播、单一播放所有权                     |
| src/components/SegmentMediaPreview.vue | 共同起点、进度、双素材轨道，独立旁白覆盖视频原声         |
| src/services/media.ts                  | 浏览器解码、增益与 WAV 混音导出                          |
| src/services/api.ts                    | 本机 HTTP 适配                                           |
| server/index.mjs                       | 单实例工程持久化、并发修订、文件与任务权威               |
| src/vendor/scaffold                    | 第三方可视化组件及最小依赖，保留原许可                   |

## 权威与状态

- `project.chapters` 决定章节顺序，各章节的 `segments` 决定句段顺序。只执行 `enabled` 句段；坐标仅展示布局。图配置 `graph` 保存在工程中，当前支持 chapter-segments 布局与 scifi 主题。
- 服务端不可变素材版本和生成快照为权威。前端不能通过保存伪造素材 URL、版本快照、任务完成状态。
- 句段是执行叶子：同一节点同时包含选中旁白和画面，时长取两者较长值；可只有一种素材。章节是组织容器，汇总启用句段，不拥有另一份音视频状态。
- 当前选择、验收版本和未解决评论决定句段显示状态。正文或表现要求改变会使已生成版本显示过期。
- 生成任务状态为 awaiting_external / completed / cancelled，均反映本地交接状态，不代表远端服务正在生成。
- 任务按 `segmentId` 绑定；结果导入时比较原稿、表现要求、评论解决状态、基线版本与验收快照，晚到结果保留但不自动激活。完成或取消的历史任务可以引用已删除片段；待执行任务必须引用存在且启用的片段。
- v1 首次加载前保存原始 `.v1.bak`，旧章节只转换成一个句段，所有素材与证据保留。共享模块是唯一迁移入口。
- 文件导入采用实例内串行追加，所有导入 ID 与引用重映射，不覆盖当前工程。ZIP 的包内媒体经过签名检查，项目落盘失败会清除该次新写素材；拒绝远程 URL 和路径穿越。
- 原子重命名和实例内串行变更避免半写。修订冲突需保留草稿后刷新。只允许单个服务实例拥有一个 data 目录；不支持跨进程写同一目录。

## 已知范围

- 无账号、公共托管、多人协作、多工程列表和在线 MiniMax worker。
- 无视频合成导出、字幕和多轨时间线。
- 工程 ZIP 包含引用媒体且可直接导入。单次 ZIP／文件导入和解压总量上限 256 MiB；元数据 JSON 只能导入无媒体工程。未知 schemaVersion 拒绝。
- 试听效果仍需人判断。测试用合成音只验证播放与混音，不证明真实人声表演质量。
- 媒体时长由浏览器提供；后端只做范围与签名检查，服务不执行 ffprobe 全量媒体检查。

## 债务与后续

避免了 React/Vue 双运行时、重复状态和 MiniMax 专用逻辑散落 UI；保留上游图谱适配层。暂保留单工程本地文件存储、手动外部生成连接和浏览器混音；后续 worker/视频渲染接入独立适配器，不能把本地排队伪装成真实调用。

## 图谱视觉

图谱局部使用深海蓝画布、冷白文字、电蓝连线、紫色选中态和切角仪表。视觉参考 [React Flow Turbo Flow](https://reactflow.dev/examples/styling/turbo-flow) 的深色节点编辑器处理，不引入 React 或替换 Vue 底座。颜色通过图谱局部 CSS token 同时传给 DOM 与 Canvas，浅色原绘制路径保留。

## 兼容层

新 UI 调用 `/api/segments/:id/jobs` 与 `/api/segments/:id/assets`。`/api/chapters/:id/...` 暂时按旧执行 ID 转发到相同句段并返回弃用标记，归服务端路由拥有；仅保留一个迁移发布周期。确认旧调用方迁移、旧工程回归完成后，在下一轮格式迁移中删除。此别名不赋予章节容器执行能力。
