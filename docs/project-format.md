# 可移植工程格式 v2

工程由章节（Chapter）和可执行片段（Segment）组成。章节只负责分组；旁白、画面、评论、版本和任务都属于片段。画布坐标不决定播放顺序：按 `chapters[]`、各章 `segments[]` 的数组顺序构建和连播；`enabled:false` 的片段保留历史，但不参与连播、导出或创建新任务。

## 可直接导入的文件

- `examples/project-v2.json`：不含素材的完整示例，可直接导入工作台。
- TXT / Markdown：按章节标题与句子生成章节和片段，随后导入旁白和画面。
- JSON：只适合没有任何素材版本的工程模板。已有音视频引用的 JSON 会被拒绝，并提示从原工作台导出 ZIP。
- ZIP：完整工程的可移植备份，根目录为 `project.json`，素材位于 `media/`。应使用工作台的“导出工程包”。JSON 元数据本身不包含音视频字节。

导入默认追加到当前工程，不覆盖已有章节、版本、评论或任务。每个导入对象都会获得新 ID，所有相关引用会一起重映射；重复导入同一工程会生成另一份副本。

默认保留当前工程的名称、主音量、图谱布局和工程 ID。选择“采用文件的图谱布局”只应用文件中的 `graph`；其余工程级属性仍以当前工程为准。ZIP 中始终保留导出时完整的工程级配置，便于检查和再次使用。

## 结构与图谱配置

完整结构定义在 [`schemas/project-v2.schema.json`](../schemas/project-v2.schema.json)，运行时使用同一份 JSON Schema 经 Ajv 校验，另校验 ID 唯一性、版本/任务/评论引用与派生来源。未知字段、未来版本和不支持的布局会被拒绝。

```json
{
  "schemaVersion": 2,
  "id": "my_project",
  "title": "我的作品",
  "revision": 0,
  "masterGain": 1,
  "updatedAt": "2026-10-16T00:00:00.000Z",
  "graph": {
    "layout": "chapter-segments",
    "theme": "scifi",
    "columnWidth": 220,
    "rowGap": 180
  },
  "chapters": [],
  "jobs": []
}
```

`columnWidth` 范围为 160–640，`rowGap` 为 80–600；默认 220 和 180。目前只支持 `chapter-segments` 布局与 `scifi` 主题。章节是 `{id,title,segments:[]}`。片段保留文稿、表演要求、音量、段后停顿、所选旁白/画面版本、审听状态与评论；`derivedFromId` 可记录拆句来源，必须指向现存片段且不能形成循环。

单个片段可以同时选择 `activeAudioId` 与 `activeVideoId`。二者共用起点零；有独立旁白时，预览会关闭视频原声。轨道长度取两种素材的较长时长。该格式目前不包含素材偏移、裁剪或转场编辑。

所有 ID 为 1–100 位字母、数字、下划线或连字符。每个工程最多 200 章、每章最多 2000 个片段、全工程最多 5000 个片段和 5000 个任务。音量为 0–1，段后停顿为 0–30 秒。

## ZIP 规则

包内 `project.json` 的素材 URL 必须是相对路径，例如 `media/1-voice.wav`；本机保存后会由服务改写为新 `/media/<uuid>.<ext>` URL。禁止绝对路径、`..`、外部 URL、未知文件、未引用素材和缺失素材。导入不会联网抓取任何素材。服务还会检查素材实际文件头与声明的音频/视频类型，文件扩展名不作为真实性依据。

ZIP 输入及解压总量均限制为 256 MiB，最多 2000 个条目。解压前检查条目声明大小；任何校验或保存失败都由服务回滚此次已暂存的文件，已有工程保持原样。

## 旧版本迁移

旧版扁平章节被迁移为一个章节分组和一个启用片段：原执行章节 ID 成为片段 ID，分组 ID 默认是 `chapter_<原ID>`。超长或冲突的分组 ID 使用确定性的长度限制和后缀，不随机替换原片段 ID。音视频版本、评论、验收记录、任务快照和任务 ID 均保留；任务的 `chapterId` 改为 `segmentId`。

已完成或取消的历史孤立任务可保留，避免删除旧片段时丢失证据。待执行任务必须属于存在且启用的片段。旧工程在服务启动时迁移并备份；不支持未来 schemaVersion 的隐式降级。

## 开发接口

`shared/project-format.mjs` 提供：

- `validateProjectDocument(project)`：结构及关系校验；成功返回原对象。
- `migrateProject(v1OrV2)`：纯函数，返回 v2 副本。
- `parseImport(bytes, filename, {detectMedia}?)`：返回 `{project, media: Map<archivePath, Uint8Array>}`。
- `createProjectArchive(project, readMedia)`：异步读取本机素材并返回 ZIP 字节，`readMedia(url)` 不得获取外部 URL。
- `appendImportedProject(current, candidate, media, {saveMedia, detectMedia, applyGraph}?)`：追加并重映射，`saveMedia({filename,bytes,kind})` 由服务暂存并返回安全的本机素材 URL；服务负责整体事务提交与回滚。

文稿解析只有一个实现：`shared/script-parser.mjs` 的 `parseScriptDocument(text)` 与 `splitSentences(text)` 同时被浏览器和服务使用。支持 Markdown 标题、“第X章/节”和“【标题】”；无标题时以空段分章。拆句保留中文标点、引号和数字小数点，不在小数点中间拆分。
