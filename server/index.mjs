import http from "node:http";
import { promises as fs, createReadStream } from "node:fs";
import { resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_GRAPH,
  migrateProject,
  validateProjectDocument,
  parseImport,
  appendImportedProject,
  createProjectArchive,
} from "../shared/project-format.mjs";
export { migrateProject } from "../shared/project-format.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAX_JSON = 2 * 1024 * 1024;
const MAX_MEDIA = 256 * 1024 * 1024;
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const str = (value, max, label) =>
  typeof value === "string" && value.length <= max
    ? value
    : fail(400, `${label}格式或长度不正确`);
const number = (value, min, max, label) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max
    ? value
    : fail(400, `${label}超出范围`);
const id = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
    ? value
    : fail(400, "无效 ID");
const kind = (value) =>
  ["audio", "video"].includes(value) ? value : fail(400, "无效素材类型");
const copy = (value) => structuredClone(value);
const now = () => new Date().toISOString();
const isLocal = (hostname) =>
  ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);

const allSegments = (project) =>
  project.chapters.flatMap((chapter) => chapter.segments);
function initialProject() {
  return migrateProject({
    id: randomUUID(),
    title: "我的音视频工作台",
    revision: 0,
    masterGain: 1,
    updatedAt: now(),
    jobs: [],
    chapters: [
      ["开场", "在这里填写开场文稿。"],
      ["正文", "在这里填写主要内容，可继续添加章节。"],
      ["结尾", "在这里填写结尾文稿。"],
    ].map(([title, text]) => ({
      id: randomUUID(),
      title,
      text,
      direction: "",
      gain: 1,
      gap: 0.5,
      approvedVersionIds: [],
      activeAudioId: null,
      activeVideoId: null,
      versions: [],
      comments: [],
    })),
  });
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, "上传内容过大");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function json(req) {
  try {
    return JSON.parse((await readBody(req, MAX_JSON)).toString("utf8"));
  } catch (error) {
    if (error.status) throw error;
    fail(400, "无效 JSON");
  }
}
export function mediaFormat(bytes, requestedKind) {
  const starts = (text) =>
    bytes.subarray(0, text.length).toString("latin1") === text;
  if (requestedKind === "audio") {
    if (
      starts("RIFF") &&
      bytes.subarray(8, 12).toString() === "WAVE" &&
      bytes.length >= 44 &&
      bytes.readUInt32LE(4) + 8 <= bytes.length &&
      bytes.includes(Buffer.from("fmt ")) &&
      bytes.includes(Buffer.from("data"))
    )
      return ["wav", "audio/wav"];
    if (starts("fLaC") && bytes.length > 42) return ["flac", "audio/flac"];
    if (
      starts("OggS") &&
      (bytes.includes(Buffer.from("OpusHead")) ||
        bytes.includes(Buffer.from("vorbis")))
    )
      return ["ogg", "audio/ogg"];
    let audioOffset = 0;
    if (starts("ID3") && bytes.length >= 10) {
      const size = [...bytes.subarray(6, 10)].reduce(
        (size, byte) => (size << 7) | (byte & 0x7f),
        0,
      );
      audioOffset = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
    }
    const frame = bytes.subarray(audioOffset, audioOffset + 4);
    if (
      frame.length === 4 &&
      frame[0] === 0xff &&
      (frame[1] & 0xe0) === 0xe0 &&
      (frame[1] & 0x06) !== 0 &&
      (frame[1] & 0x18) !== 0x08 &&
      (frame[2] & 0xf0) !== 0xf0 &&
      (frame[2] & 0x0c) !== 0x0c &&
      bytes.length > audioOffset + 32
    )
      return ["mp3", "audio/mpeg"];
  }
  if (bytes.subarray(4, 8).toString() === "ftyp" && bytes.length > 32) {
    if (requestedKind === "video" && bytes.includes(Buffer.from("vide")))
      return ["mp4", "video/mp4"];
    if (
      requestedKind === "audio" &&
      bytes.includes(Buffer.from("soun")) &&
      !bytes.includes(Buffer.from("vide"))
    )
      return ["m4a", "audio/mp4"];
  }
  if (
    bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
    bytes.includes(Buffer.from("webm"))
  ) {
    const hasVideo = ["V_VP8", "V_VP9", "V_AV1"].some((codec) =>
      bytes.includes(Buffer.from(codec)),
    );
    if (requestedKind === "video" && hasVideo) return ["webm", "video/webm"];
    if (
      requestedKind === "audio" &&
      !hasVideo &&
      bytes.includes(Buffer.from("A_OPUS"))
    )
      return ["webm", "audio/webm"];
  }
  fail(415, "文件内容不是受支持的音视频格式，或与所选类型不符");
}

export function sanitizeProject(input, current) {
  if (!input || input.schemaVersion !== 2)
    fail(400, "需要 schemaVersion 2 工程");
  if (input.revision !== current.revision)
    fail(409, "工程已更新，请重新载入后再保存");
  if (!Array.isArray(input.chapters) || input.chapters.length > 200)
    fail(400, "章节数量超出限制");
  if (
    !input.graph ||
    input.graph.layout !== "chapter-segments" ||
    input.graph.theme !== "scifi"
  )
    fail(400, "图配置不受支持");
  const graph = {
    layout: "chapter-segments",
    theme: "scifi",
    columnWidth: number(input.graph.columnWidth, 160, 640, "图列宽"),
    rowGap: number(input.graph.rowGap, 80, 600, "图行距"),
  };
  const seen = new Set();
  const commentIds = new Set();
  let segmentCount = 0;
  const chapters = input.chapters.map((group) => {
    if (!group || typeof group !== "object") fail(400, "无效章节");
    const groupId = id(group.id);
    if (seen.has(groupId)) fail(400, "章节或片段 ID 重复");
    seen.add(groupId);
    if (!Array.isArray(group.segments) || group.segments.length > 2000)
      fail(400, "片段数量超出限制");
    segmentCount += group.segments.length;
    if (segmentCount > 5000) fail(400, "工程片段数量超出限制");
    const segments = group.segments.map((ch) => {
      if (!ch || typeof ch !== "object") fail(400, "无效章节");
      const chapterId = id(ch.id);
      if (seen.has(chapterId)) fail(400, "章节 ID 重复");
      seen.add(chapterId);
      const existing = allSegments(current).find((c) => c.id === chapterId);
      const versions = existing?.versions || [];
      const active = (value, type) =>
        value === null
          ? null
          : versions.some((v) => v.id === value && v.kind === type)
            ? value
            : fail(400, "素材版本不存在");
      if (!Array.isArray(ch.comments) || ch.comments.length > 1000)
        fail(400, "评论数量超出限制");
      if (
        !Array.isArray(ch.approvedVersionIds) ||
        ch.approvedVersionIds.some((v) => !versions.some((x) => x.id === v))
      )
        fail(400, "验收版本不存在");
      for (const versionId of ch.approvedVersionIds) {
        if (existing?.approvedVersionIds.includes(versionId)) continue;
        const version = versions.find((v) => v.id === versionId);
        if (
          version.textSnapshot !== ch.text ||
          version.directionSnapshot !== ch.direction
        )
          fail(409, "素材对应旧文稿或旧表演要求，不能验收");
      }
      return {
        id: chapterId,
        enabled:
          typeof ch.enabled === "boolean"
            ? ch.enabled
            : fail(400, "片段启用状态无效"),
        ...(ch.derivedFromId ? { derivedFromId: id(ch.derivedFromId) } : {}),
        title: str(ch.title, 200, "章节标题"),
        text: str(ch.text, 100000, "文稿"),
        direction: str(ch.direction, 10000, "表演要求"),
        gain: number(ch.gain, 0, 1, "音量"),
        gap: number(ch.gap, 0, 30, "停顿"),
        activeAudioId: active(ch.activeAudioId, "audio"),
        activeVideoId: active(ch.activeVideoId, "video"),
        approvedVersionIds: [...new Set(ch.approvedVersionIds)],
        versions,
        comments: ch.comments.map((c) => {
          if (!c || typeof c !== "object") fail(400, "无效评论");
          const commentId = id(c.id);
          if (commentIds.has(commentId)) fail(400, "评论 ID 重复");
          commentIds.add(commentId);
          if (
            c.versionId !== null &&
            !versions.some((v) => v.id === c.versionId)
          )
            fail(400, "评论素材不存在");
          const previous = existing?.comments.find(
            (old) => old.id === commentId,
          );
          return {
            id: commentId,
            text: str(c.text, 10000, "评论"),
            time: number(c.time, 0, 86400, "评论时间"),
            versionId: c.versionId,
            resolved: c.resolved === true,
            createdAt: previous?.createdAt || now(),
          };
        }),
      };
    });
    return { id: groupId, title: str(group.title, 200, "章节标题"), segments };
  });
  const segments = chapters.flatMap((c) => c.segments);
  for (const segment of segments) {
    if (
      segment.derivedFromId &&
      (segment.derivedFromId === segment.id ||
        !segments.some((s) => s.id === segment.derivedFromId))
    )
      fail(400, "片段来源必须引用工程中的其他片段");
  }
  if (
    current.jobs.some(
      (j) =>
        j.status === "awaiting_external" &&
        !segments.some((s) => s.id === j.segmentId && s.enabled),
    )
  )
    fail(409, "请先取消片段的待执行任务，才能停用或删除");
  return {
    ...current,
    schemaVersion: 2,
    graph,
    title: str(input.title, 200, "工程标题"),
    masterGain: number(input.masterGain, 0, 1, "总音量"),
    chapters,
  };
}

export async function createStudioServer({
  dataDir = join(root, "data"),
  distDir = join(root, "dist"),
} = {}) {
  await fs.mkdir(join(dataDir, "media"), { recursive: true });
  const projectPath = join(dataDir, "project.json");
  let project;
  try {
    const original = await fs.readFile(projectPath, "utf8");
    const stored = JSON.parse(original);
    project = migrateProject(stored);
    if (stored.schemaVersion !== 2) {
      try {
        await fs.writeFile(`${projectPath}.v1.bak`, original, { flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if ((await fs.readFile(`${projectPath}.v1.bak`, "utf8")) !== original)
          await fs.writeFile(
            `${projectPath}.v1.${randomUUID()}.bak`,
            original,
            { flag: "wx" },
          );
      }
      const temporary = `${projectPath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(project, null, 2));
        await fs.rename(temporary, projectPath);
      } catch (error) {
        await fs.rm(temporary, { force: true });
        throw error;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    project = initialProject();
    await fs.writeFile(projectPath, JSON.stringify(project, null, 2));
  }
  let tail = Promise.resolve();
  const serial = (operation) => {
    const next = tail.then(operation);
    tail = next.catch(() => {});
    return next;
  };
  async function persist(next) {
    try {
      validateProjectDocument(next);
    } catch (error) {
      if (!error.status) error.status = 400;
      throw error;
    }
    next.revision = project.revision + 1;
    next.updatedAt = now();
    const temporary = `${projectPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(next, null, 2));
      await fs.rename(temporary, projectPath);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    project = next;
    return project;
  }
  const server = http.createServer(async (req, res) => {
    const respond = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(body));
    };
    try {
      const host = new URL(`http://${req.headers.host || ""}`);
      if (!isLocal(host.hostname)) fail(403, "仅允许本机访问");
      if (req.headers.origin) {
        let origin;
        try {
          origin = new URL(req.headers.origin);
        } catch {
          fail(403, "无效来源");
        }
        if (
          !isLocal(origin.hostname) ||
          !["http:", "https:"].includes(origin.protocol)
        )
          fail(403, "禁止跨站请求");
      }
      if (req.headers["sec-fetch-site"] === "cross-site")
        fail(403, "禁止跨站请求");
      const url = new URL(req.url, host);
      const path = url.pathname;
      if (path.startsWith("/api/chapters/")) {
        res.setHeader("Deprecation", "true");
        res.setHeader(
          "Warning",
          '299 - "Use /api/segments/:id; chapter leaf adapter expires after v1 migration release"',
        );
      }
      if (path === "/api/project" && req.method === "GET") {
        await tail;
        respond(200, project);
        return;
      }
      if (path === "/api/project/export" && req.method === "GET") {
        await tail;

        let archive;
        try {
          archive = await createProjectArchive(
            copy(project),
            async (mediaUrl) => {
              if (
                !/^\/media\/[a-f0-9-]{36}\.(wav|mp3|flac|ogg|mp4|m4a|webm)$/.test(
                  mediaUrl,
                )
              )
                fail(400, "工程包含不安全的素材引用");
              try {
                return await fs.readFile(join(dataDir, mediaUrl));
              } catch (error) {
                if (error.code === "ENOENT")
                  fail(404, "工程素材文件缺失，无法导出完整备份");
                throw error;
              }
            },
          );
        } catch (error) {
          if (!error.status) error.status = 400;
          throw error;
        }
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="vueflow-project.zip"',
          "Content-Length": archive.byteLength,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(Buffer.from(archive));
        return;
      }
      if (path === "/api/project/import" && req.method === "POST") {
        const bytes = await readBody(req, MAX_MEDIA);
        const name = str(
          url.searchParams.get("name") || "project.json",
          250,
          "文件名",
        );
        const result = await serial(async () => {
          const written = [];
          try {
            const imported = await parseImport(bytes, name, {
              detectMedia: (bytes, kind) =>
                mediaFormat(Buffer.from(bytes), kind),
            });
            let total = 0;
            const next = await appendImportedProject(
              copy(project),
              imported.project,
              imported.media,
              {
                applyGraph: url.searchParams.get("applyGraph") === "true",
                detectMedia: (bytes, kind) =>
                  mediaFormat(Buffer.from(bytes), kind),
                saveMedia: async ({ bytes: mediaBytes, kind: mediaKind }) => {
                  total += mediaBytes.byteLength;
                  if (total > MAX_MEDIA)
                    fail(413, "导入素材总量超出 256 MiB 限制");
                  const [extension] = mediaFormat(
                    Buffer.from(mediaBytes),
                    kind(mediaKind),
                  );
                  const filename = `${randomUUID()}.${extension}`;
                  const mediaPath = join(dataDir, "media", filename);
                  await fs.writeFile(mediaPath, mediaBytes, { flag: "wx" });
                  written.push(mediaPath);
                  return `/media/${filename}`;
                },
              },
            );
            validateProjectDocument(next);
            const sanitized = sanitizeProject(next, next);
            return await persist(sanitized);
          } catch (error) {
            await Promise.all(
              written.map((file) => fs.rm(file, { force: true })),
            );
            if (!error.status) error.status = 400;
            throw error;
          }
        });
        respond(200, result);
        return;
      }
      if (path.startsWith("/api/")) {
        const body =
          req.method === "PUT" || /\/jobs$/.test(path) ? await json(req) : null;
        const uploadMatch = path.match(
          /^\/api\/(?:segments|chapters)\/([\w-]+)\/assets$/,
        );
        const bytes = uploadMatch ? await readBody(req, MAX_MEDIA) : null;
        const result = await serial(async () => {
          if (path === "/api/project" && req.method === "PUT")
            return persist(sanitizeProject(body, project));
          const next = copy(project);
          const jobMatch = path.match(
            /^\/api\/(?:segments|chapters)\/([\w-]+)\/jobs$/,
          );
          if ((jobMatch || uploadMatch) && req.method === "POST") {
            const chapter = allSegments(next).find(
              (c) => c.id === (jobMatch || uploadMatch)[1],
            );
            if (!chapter) fail(404, "片段不存在");
            if (jobMatch) {
              if (!chapter.enabled) fail(409, "停用片段不能创建生成任务");
              if (!body || typeof body !== "object") fail(400, "无效任务");
              if (!chapter.text.trim()) fail(400, "请先填写文稿再创建生成任务");
              const mediaKind = kind(body.kind);
              const selected = body.commentIds || [];
              if (
                !Array.isArray(selected) ||
                selected.length > 1000 ||
                selected.some((c) => !chapter.comments.some((x) => x.id === c))
              )
                fail(400, "评论不存在");
              const baseVersionId =
                mediaKind === "audio"
                  ? chapter.activeAudioId
                  : chapter.activeVideoId;
              if (
                selected.some((commentId) => {
                  const c = chapter.comments.find((c) => c.id === commentId);
                  return (
                    c.resolved ||
                    !baseVersionId ||
                    c.versionId !== baseVersionId ||
                    !chapter.versions.some(
                      (v) => v.id === c.versionId && v.kind === mediaKind,
                    )
                  );
                })
              )
                fail(409, "返修评论必须未解决，并对应当前同类型素材版本");
              const commentIds = [...new Set(selected)].sort();
              const commentSnapshots = commentIds.map((commentId) => {
                const c = chapter.comments.find((c) => c.id === commentId);
                return {
                  id: c.id,
                  text: c.text,
                  time: c.time,
                  versionId: c.versionId,
                  resolved: c.resolved,
                };
              });
              const snapshot = {
                segmentId: chapter.id,
                kind: mediaKind,
                textSnapshot: chapter.text,
                directionSnapshot: chapter.direction,
                baseVersionId,
                baseApprovedSnapshot: baseVersionId
                  ? chapter.approvedVersionIds.includes(baseVersionId)
                  : false,
                commentIds,
                commentSnapshots,
              };
              const duplicate = next.jobs.find(
                (j) =>
                  j.status === "awaiting_external" &&
                  Object.entries(snapshot).every(
                    ([key, value]) =>
                      JSON.stringify(j[key]) === JSON.stringify(value),
                  ),
              );
              if (duplicate) return project;
              if (next.jobs.length >= 5000) fail(400, "任务数量已达上限");
              next.jobs.push({
                id: randomUUID(),
                ...snapshot,
                status: "awaiting_external",
                createdAt: now(),
              });
              return persist(next);
            }
            const mediaKind = kind(url.searchParams.get("kind"));
            const duration = number(
              Number(url.searchParams.get("duration")),
              0,
              86400,
              "素材时长",
            );
            if (!url.searchParams.has("duration")) fail(400, "缺少素材时长");
            const name = str(
              url.searchParams.get("name") || "导入素材",
              250,
              "文件名",
            ).replace(/[\x00-\x1f]/g, "");
            const jobId = url.searchParams.get("jobId");
            const job = jobId
              ? next.jobs.find(
                  (j) =>
                    j.id === jobId &&
                    j.segmentId === chapter.id &&
                    j.kind === mediaKind,
                )
              : null;
            if (jobId && !job) fail(400, "任务与章节或素材类型不匹配");
            if (job && job.status !== "awaiting_external")
              fail(409, "任务已完成或取消");
            if (chapter.versions.length >= 1000)
              fail(400, "素材版本数量已达上限");
            const [extension] = mediaFormat(bytes, mediaKind);
            const versionId = randomUUID();
            const filename = `${versionId}.${extension}`;
            const activeKey =
              mediaKind === "audio" ? "activeAudioId" : "activeVideoId";
            const commentsUnchanged =
              !job ||
              ((job.commentIds.length === 0 ||
                job.commentSnapshots?.length === job.commentIds.length) &&
                (job.commentSnapshots || []).every((snapshot) => {
                  const c = chapter.comments.find((c) => c.id === snapshot.id);
                  return (
                    c &&
                    c.text === snapshot.text &&
                    c.time === snapshot.time &&
                    c.versionId === snapshot.versionId &&
                    c.resolved === (snapshot.resolved ?? false)
                  );
                }));
            const baselineApprovalUnchanged =
              !job ||
              (job.baseVersionId
                ? chapter.approvedVersionIds.includes(job.baseVersionId)
                : false) === (job.baseApprovedSnapshot ?? false);
            const shouldActivate =
              !job ||
              (job.textSnapshot === chapter.text &&
                job.directionSnapshot === chapter.direction &&
                job.baseVersionId === chapter[activeKey] &&
                commentsUnchanged &&
                baselineApprovalUnchanged);
            chapter.versions.push({
              id: versionId,
              kind: mediaKind,
              name,
              duration,
              url: `/media/${filename}`,
              createdAt: now(),
              ...(job ? { jobId } : {}),
              textSnapshot: job?.textSnapshot ?? chapter.text,
              directionSnapshot: job?.directionSnapshot ?? chapter.direction,
            });
            if (shouldActivate) chapter[activeKey] = versionId;
            if (job) {
              job.status = "completed";
              job.completedVersionId = versionId;
            }
            const mediaPath = join(dataDir, "media", filename);
            await fs.writeFile(mediaPath, bytes, { flag: "wx" });
            try {
              return await persist(next);
            } catch (error) {
              await fs.rm(mediaPath, { force: true });
              throw error;
            }
          }
          const cancelMatch = path.match(/^\/api\/jobs\/([\w-]+)\/cancel$/);
          if (cancelMatch && req.method === "POST") {
            const job = next.jobs.find((j) => j.id === cancelMatch[1]);
            if (!job) fail(404, "任务不存在");
            if (job.status !== "awaiting_external")
              fail(409, "任务已完成或取消");
            job.status = "cancelled";
            return persist(next);
          }
          fail(404, "接口不存在");
        });
        respond(200, result);
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) fail(405, "不支持此方法");
      let file;
      let mime;
      if (path.startsWith("/media/")) {
        if (
          !/^\/media\/[a-f0-9-]{36}\.(wav|mp3|flac|ogg|mp4|m4a|webm)$/.test(
            path,
          )
        )
          fail(404, "素材不存在");
        file = join(dataDir, path);
        mime = {
          ".wav": "audio/wav",
          ".mp3": "audio/mpeg",
          ".flac": "audio/flac",
          ".ogg": "audio/ogg",
          ".mp4": "video/mp4",
          ".m4a": "audio/mp4",
          ".webm": "video/webm",
        }[extname(file)];
      } else {
        let decoded;
        try {
          decoded = decodeURIComponent(path);
        } catch {
          fail(400, "无效路径");
        }
        file = resolve(distDir, `.${decoded}`);
        if (!file.startsWith(resolve(distDir) + "/"))
          file = join(distDir, "index.html");
        try {
          if (!(await fs.stat(file)).isFile())
            file = join(distDir, "index.html");
        } catch {
          file = join(distDir, "index.html");
        }
        mime =
          {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".json": "application/json",
          }[extname(file)] || "application/octet-stream";
      }
      let stat;
      try {
        stat = await fs.stat(file);
      } catch {
        fail(404, "文件不存在，请先运行构建或开发服务器");
      }
      let start = 0;
      let end = stat.size - 1;
      let status = 200;
      const headers = {
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
      };
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) fail(416, "无效范围");
        start = match[1]
          ? Number(match[1])
          : Math.max(0, stat.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        if (start > end || start >= stat.size) {
          res.setHeader("Content-Range", `bytes */${stat.size}`);
          fail(416, "范围超出文件");
        }
        status = 206;
        headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
      }
      headers["Content-Length"] = Math.max(0, end - start + 1);
      res.writeHead(status, headers);
      if (req.method === "HEAD" || stat.size === 0) res.end();
      else {
        const stream = createReadStream(file, { start, end });
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      }
    } catch (error) {
      if (!res.headersSent)
        respond(error.status || 500, {
          error: error.status ? error.message : "本地服务发生错误",
        });
      else res.destroy();
    }
  });
  return server;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 4319);
  const server = await createStudioServer();
  server.listen(port, "127.0.0.1", () =>
    console.log(`音视频工作台 http://127.0.0.1:${port}`),
  );
}
