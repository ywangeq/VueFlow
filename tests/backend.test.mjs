import test from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "../server/index.mjs";

function wave() {
  const b = Buffer.alloc(46);
  b.write("RIFF");
  b.writeUInt32LE(38, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(2, 40);
  return b;
}
async function start(dataDir) {
  const server = await createStudioServer({
    dataDir,
    distDir: join(dataDir, "missing-dist"),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (
    path = "/api/project",
    method = "GET",
    body,
    headers = {},
  ) => {
    const binary = Buffer.isBuffer(body);
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(body && !binary ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined
        ? { body: binary ? body : JSON.stringify(body) }
        : {}),
    });
    const data = await response.json();
    return { status: response.status, data };
  };
  return {
    server,
    base,
    request,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "vueflow-backend-"));
  const ctx = await start(dir);
  t.after(async () => {
    await ctx.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { ...ctx, dir };
}
const uploadPath = (chapter, extra = "") =>
  `/api/segments/${chapter}/assets?kind=audio&duration=0.001&name=voice.wav${extra}`;

test("persists edits, rejects stale writers, and ignores forged jobs and assets", async (t) => {
  const { request, dir } = await fixture(t);
  const first = (await request()).data;
  assert.equal(first.chapters.length, 3);
  assert.deepEqual(first.jobs, []);
  assert.deepEqual(first.chapters[0].segments[0].versions, []);
  const changed = structuredClone(first);
  changed.title = "Saved title";
  changed.jobs = [{ id: "forged" }];
  changed.chapters[0].segments[0].versions = [{ id: "forged" }];
  const saved = await request("/api/project", "PUT", changed);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.revision, 1);
  assert.deepEqual(saved.data.jobs, []);
  assert.deepEqual(saved.data.chapters[0].segments[0].versions, []);
  assert.equal((await request("/api/project", "PUT", first)).status, 409);
  const restarted = await start(dir);
  t.after(restarted.close);
  assert.equal((await restarted.request()).data.title, "Saved title");
});

test("concurrent saves serialize and one conflicting writer loses", async (t) => {
  const { request } = await fixture(t);
  const initial = (await request()).data;
  const responses = await Promise.all([
    request("/api/project", "PUT", initial),
    request("/api/project", "PUT", initial),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
});

test("queues immutable comment snapshots, deduplicates pending tasks, and cancels", async (t) => {
  const { request } = await fixture(t);
  let p = (await request()).data;
  p = (await request(uploadPath(p.chapters[0].segments[0].id), "POST", wave()))
    .data;
  const chapter = p.chapters[0].segments[0];
  chapter.comments.push({
    id: "comment-1",
    text: "更轻松",
    time: 0,
    versionId: chapter.activeAudioId,
    resolved: false,
  });
  p = (await request("/api/project", "PUT", p)).data;
  const path = `/api/segments/${chapter.id}/jobs`;
  p = (
    await request(path, "POST", { kind: "audio", commentIds: ["comment-1"] })
  ).data;
  assert.equal(p.jobs[0].status, "awaiting_external");
  assert.equal(p.jobs[0].commentSnapshots[0].text, "更轻松");
  const duplicate = await request(path, "POST", {
    kind: "audio",
    commentIds: ["comment-1"],
  });
  assert.equal(duplicate.data.jobs.length, 1);
  assert.equal(duplicate.data.revision, p.revision);
  p.chapters[0].segments[0].comments[0].text = "再自然一些";
  p = (await request("/api/project", "PUT", p)).data;
  p = (
    await request(path, "POST", { kind: "audio", commentIds: ["comment-1"] })
  ).data;
  assert.equal(p.jobs.length, 2);
  assert.equal(p.jobs[0].commentSnapshots[0].text, "更轻松");
  assert.equal(
    (await request(`/api/jobs/${p.jobs[0].id}/cancel`, "POST")).data.jobs[0]
      .status,
    "cancelled",
  );
  assert.equal(
    (
      await request(
        uploadPath(chapter.id, `&jobId=${p.jobs[0].id}`),
        "POST",
        wave(),
      )
    ).status,
    409,
  );
});

test("validates upload bytes, preserves stale result as a version, and streams range", async (t) => {
  const { request, base } = await fixture(t);
  let p = (await request()).data;
  const chapterId = p.chapters[0].segments[0].id;
  assert.equal(
    (await request(uploadPath(chapterId), "POST", Buffer.from("not a wave")))
      .status,
    415,
  );
  assert.equal(
    (
      await request(
        uploadPath(chapterId).replace("audio", "video"),
        "POST",
        wave(),
      )
    ).status,
    415,
  );
  p = (await request(uploadPath(chapterId), "POST", wave())).data;
  const baseline = p.chapters[0].segments[0].activeAudioId;
  assert.ok(baseline);
  p = (
    await request(`/api/segments/${chapterId}/jobs`, "POST", { kind: "audio" })
  ).data;
  const jobId = p.jobs[0].id;
  p.chapters[0].segments[0].text = "New text";
  p = (await request("/api/project", "PUT", p)).data;
  p = (await request(uploadPath(chapterId, `&jobId=${jobId}`), "POST", wave()))
    .data;
  assert.equal(p.jobs[0].status, "completed");
  assert.equal(p.chapters[0].segments[0].versions.length, 2);
  assert.equal(p.chapters[0].segments[0].activeAudioId, baseline);
  const oldResult = p.chapters[0].segments[0].versions[1];
  assert.notEqual(oldResult.textSnapshot, "New text");
  const range = await fetch(base + oldResult.url, {
    headers: { Range: "bytes=0-3" },
  });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 0-3/46");
  assert.equal(await range.text(), "RIFF");
  assert.equal(
    (await fetch(base + oldResult.url, { headers: { Range: "bytes=100-" } }))
      .status,
    416,
  );
});

test("fresh task result activates and a later baseline makes results stale", async (t) => {
  const { request } = await fixture(t);
  let p = (await request()).data;
  const chapterId = p.chapters[0].segments[0].id;
  p = (
    await request(`/api/segments/${chapterId}/jobs`, "POST", { kind: "audio" })
  ).data;
  p = (
    await request(
      uploadPath(chapterId, `&jobId=${p.jobs[0].id}`),
      "POST",
      wave(),
    )
  ).data;
  assert.equal(
    p.chapters[0].segments[0].activeAudioId,
    p.jobs[0].completedVersionId,
  );
  p = (
    await request(`/api/segments/${chapterId}/jobs`, "POST", { kind: "audio" })
  ).data;
  const jobId = p.jobs[1].id;
  p = (await request(uploadPath(chapterId), "POST", wave())).data;
  const active = p.chapters[0].segments[0].activeAudioId;
  p = (await request(uploadPath(chapterId, `&jobId=${jobId}`), "POST", wave()))
    .data;
  assert.equal(p.chapters[0].segments[0].activeAudioId, active);
});

test("rejects foreign host/origin and malformed project input", async (t) => {
  const { request, base } = await fixture(t);
  assert.equal(
    (
      await request("/api/project", "GET", undefined, {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  const badHostStatus = await new Promise((resolve, reject) => {
    http
      .get(
        base + "/api/project",
        { headers: { Host: "evil.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      )
      .on("error", reject);
  });
  assert.equal(badHostStatus, 403);
  const p = (await request()).data;
  p.chapters.push(p.chapters[0].segments[0]);
  assert.equal((await request("/api/project", "PUT", p)).status, 400);
  assert.equal((await fetch(base + "/media/%2e%2e/project.json")).status, 404);
  assert.equal(
    (
      await request(
        `/api/segments/${p.chapters[0].segments[0].id}/jobs`,
        "POST",
        null,
      )
    ).status,
    400,
  );
});

test("edited feedback prevents silent activation and pending chapters cannot disappear", async (t) => {
  const { request } = await fixture(t);
  let p = (await request()).data;
  const chapterId = p.chapters[0].segments[0].id;
  p = (await request(uploadPath(chapterId), "POST", wave())).data;
  const baseline = p.chapters[0].segments[0].activeAudioId;
  p.chapters[0].segments[0].comments = [
    {
      id: "feedback",
      text: "慢一点",
      versionId: baseline,
      time: 1,
      resolved: false,
    },
  ];
  p = (await request("/api/project", "PUT", p)).data;
  p = (
    await request(`/api/segments/${chapterId}/jobs`, "POST", {
      kind: "audio",
      commentIds: ["feedback"],
    })
  ).data;
  const removed = structuredClone(p);
  removed.chapters.shift();
  assert.equal((await request("/api/project", "PUT", removed)).status, 409);
  p.chapters[0].segments[0].comments[0].text = "快一点";
  p = (await request("/api/project", "PUT", p)).data;
  p = (
    await request(
      uploadPath(chapterId, `&jobId=${p.jobs[0].id}`),
      "POST",
      wave(),
    )
  ).data;
  assert.equal(p.chapters[0].segments[0].activeAudioId, baseline);
  assert.equal(p.chapters[0].segments[0].versions.length, 2);
  assert.equal(p.jobs[0].commentSnapshots[0].text, "慢一点");
});

test("validates playback gains and refuses blank-text generation", async (t) => {
  const { request } = await fixture(t);
  let p = (await request()).data;
  p.masterGain = 1.01;
  assert.equal((await request("/api/project", "PUT", p)).status, 400);
  p.masterGain = 1;
  p.chapters[0].segments[0].gain = 1.01;
  assert.equal((await request("/api/project", "PUT", p)).status, 400);
  p.chapters[0].segments[0].gain = 0;
  p.chapters[0].segments[0].text = " \n\t";
  p = (await request("/api/project", "PUT", p)).data;
  assert.equal(
    (
      await request(
        `/api/segments/${p.chapters[0].segments[0].id}/jobs`,
        "POST",
        {
          kind: "audio",
        },
      )
    ).status,
    400,
  );
});

test("approval uses immutable text/direction snapshots while allowing later draft edits", async (t) => {
  const { request } = await fixture(t);
  let p = (await request()).data;
  const chapterId = p.chapters[0].segments[0].id;
  p.chapters[0].segments[0].direction = "轻松";
  p = (await request("/api/project", "PUT", p)).data;
  p = (await request(uploadPath(chapterId), "POST", wave())).data;
  const version = structuredClone(p.chapters[0].segments[0].versions[0]);
  assert.equal(version.directionSnapshot, "轻松");
  p.chapters[0].segments[0].direction = "严肃";
  p.chapters[0].segments[0].approvedVersionIds = [version.id];
  // Forged input may not alter server-owned version snapshots to bypass review.
  p.chapters[0].segments[0].versions[0].directionSnapshot = "严肃";
  assert.equal((await request("/api/project", "PUT", p)).status, 409);
  p = (await request()).data;
  p.chapters[0].segments[0].text = "改后的文稿";
  p.chapters[0].segments[0].approvedVersionIds = [version.id];
  assert.equal((await request("/api/project", "PUT", p)).status, 409);
  p = (await request()).data;
  p.chapters[0].segments[0].approvedVersionIds = [version.id];
  p.chapters[0].segments[0].versions[0].createdAt = "forged";
  p.chapters[0].segments[0].versions[0].name = "forged";
  p = (await request("/api/project", "PUT", p)).data;
  assert.equal(
    p.chapters[0].segments[0].versions[0].createdAt,
    version.createdAt,
  );
  assert.equal(p.chapters[0].segments[0].versions[0].name, version.name);
  p.chapters[0].segments[0].direction = "新要求";
  p = (await request("/api/project", "PUT", p)).data;
  assert.equal(p.chapters[0].segments[0].direction, "新要求");
  assert.deepEqual(p.chapters[0].segments[0].approvedVersionIds, [version.id]);
});

test("job imports retain original direction after the chapter direction changes", async (t) => {
  const { request } = await fixture(t);
  let p = (await request()).data;
  const chapterId = p.chapters[0].segments[0].id;
  p.chapters[0].segments[0].direction = "原要求";
  p = (await request("/api/project", "PUT", p)).data;
  p = (
    await request(`/api/segments/${chapterId}/jobs`, "POST", { kind: "audio" })
  ).data;
  const jobId = p.jobs[0].id;
  p.chapters[0].segments[0].direction = "新要求";
  p = (await request("/api/project", "PUT", p)).data;
  p = (await request(uploadPath(chapterId, `&jobId=${jobId}`), "POST", wave()))
    .data;
  assert.equal(
    p.chapters[0].segments[0].versions[0].directionSnapshot,
    "原要求",
  );
  assert.equal(p.chapters[0].segments[0].activeAudioId, null);
});

test("feedback generation requires comments on the active baseline of the requested kind", async (t) => {
  const { request } = await fixture(t);
  let p = (await request()).data;
  const chapterId = p.chapters[0].segments[0].id;
  const queue = (ids) =>
    request(`/api/segments/${chapterId}/jobs`, "POST", {
      kind: "audio",
      commentIds: ids,
    });
  p.chapters[0].segments[0].comments = [
    { id: "unbound", text: "反馈", time: 0, versionId: null, resolved: false },
  ];
  p = (await request("/api/project", "PUT", p)).data;
  assert.equal((await queue(["unbound"])).status, 409);
  p = (await request(uploadPath(chapterId), "POST", wave())).data;
  const first = p.chapters[0].segments[0].activeAudioId;
  p.chapters[0].segments[0].comments.push({
    id: "first",
    text: "旧版反馈",
    time: 0,
    versionId: first,
    resolved: false,
  });
  p = (await request("/api/project", "PUT", p)).data;
  p = (await request(uploadPath(chapterId), "POST", wave())).data;
  assert.equal((await queue(["first"])).status, 409);
  const video = Buffer.alloc(80);
  video.writeUInt32BE(24, 0);
  video.write("ftypisom", 4);
  video.write("vide", 40);
  p = (
    await request(
      `/api/segments/${chapterId}/assets?kind=video&duration=1&name=clip.mp4`,
      "POST",
      video,
    )
  ).data;
  p.chapters[0].segments[0].comments.push({
    id: "video-feedback",
    text: "视频反馈",
    time: 0,
    versionId: p.chapters[0].segments[0].activeVideoId,
    resolved: false,
  });
  p = (await request("/api/project", "PUT", p)).data;
  assert.equal((await queue(["video-feedback"])).status, 409);
  p.chapters[0].segments[0].comments.push({
    id: "current",
    text: "当前音频反馈",
    time: 0,
    versionId: p.chapters[0].segments[0].activeAudioId,
    resolved: false,
  });
  p = (await request("/api/project", "PUT", p)).data;
  assert.equal((await queue(["current"])).status, 200);
});

test("resolved feedback cannot be queued and late feedback results preserve the reviewed baseline", async (t) => {
  const { request } = await fixture(t);
  let p = (await request()).data;
  const chapterId = p.chapters[0].segments[0].id;
  p = (await request(uploadPath(chapterId), "POST", wave())).data;
  const baseline = p.chapters[0].segments[0].activeAudioId;
  p.chapters[0].segments[0].comments.push({
    id: "review-note",
    text: "慢一点",
    time: 0,
    versionId: baseline,
    resolved: false,
  });
  p = (await request("/api/project", "PUT", p)).data;
  p = (
    await request(`/api/segments/${chapterId}/jobs`, "POST", {
      kind: "audio",
      commentIds: ["review-note"],
    })
  ).data;
  const jobId = p.jobs[0].id;
  assert.equal(p.jobs[0].commentSnapshots[0].resolved, false);
  p.chapters[0].segments[0].comments[0].resolved = true;
  p = (await request("/api/project", "PUT", p)).data;
  assert.equal(
    (
      await request(`/api/segments/${chapterId}/jobs`, "POST", {
        kind: "audio",
        commentIds: ["review-note"],
      })
    ).status,
    409,
  );
  p = (await request(uploadPath(chapterId, `&jobId=${jobId}`), "POST", wave()))
    .data;
  assert.equal(p.jobs[0].status, "completed");
  assert.equal(p.chapters[0].segments[0].activeAudioId, baseline);
  assert.equal(p.chapters[0].segments[0].versions.length, 2);
});

test("new baseline approval prevents pending result from replacing reviewed media", async (t) => {
  const { request } = await fixture(t);
  let p = (await request()).data;
  const chapterId = p.chapters[0].segments[0].id;
  p = (await request(uploadPath(chapterId), "POST", wave())).data;
  const baseline = p.chapters[0].segments[0].activeAudioId;
  p = (
    await request(`/api/segments/${chapterId}/jobs`, "POST", { kind: "audio" })
  ).data;
  const jobId = p.jobs[0].id;
  assert.equal(p.jobs[0].baseApprovedSnapshot, false);
  p.chapters[0].segments[0].approvedVersionIds.push(baseline);
  p = (await request("/api/project", "PUT", p)).data;
  p = (await request(uploadPath(chapterId, `&jobId=${jobId}`), "POST", wave()))
    .data;
  assert.equal(p.chapters[0].segments[0].activeAudioId, baseline);
  assert.equal(p.jobs[0].status, "completed");
});
