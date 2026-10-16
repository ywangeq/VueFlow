import test from "node:test";
import { promises as fs } from "node:fs";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStudioServer } from "../server/index.mjs";
async function setup(t, stored) {
  const dir = await mkdtemp(join(tmpdir(), "vueflow-v2-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  if (stored)
    await writeFile(
      join(dir, "project.json"),
      typeof stored === "string" ? stored : JSON.stringify(stored),
    );
  const server = await createStudioServer({
    dataDir: dir,
    distDir: join(dir, "dist"),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (path = "/api/project", method = "GET", body) => {
    const response = await fetch(base + path, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    return {
      status: response.status,
      data: await response.json(),
      headers: response.headers,
    };
  };
  return { dir, base, req };
}
function v1Project() {
  const version = {
    id: "asset-1",
    name: "old.wav",
    kind: "audio",
    duration: 3,
    url: "/media/00000000-0000-4000-8000-000000000001.wav",
    createdAt: "2026-01-01T00:00:00Z",
    textSnapshot: "旧文稿",
    directionSnapshot: "自然",
    jobId: "job-completed",
  };
  const comment = {
    id: "note-1",
    text: "停顿",
    versionId: version.id,
    time: 1,
    resolved: false,
    createdAt: "2026-01-01T00:00:00Z",
  };
  return {
    id: "legacy-project",
    title: "旧工程",
    revision: 7,
    masterGain: 0.7,
    updatedAt: "2026-01-01T00:00:00Z",
    chapters: [
      {
        id: "old-chapter",
        title: "第一章",
        text: "旧文稿",
        direction: "自然",
        gain: 0.8,
        gap: 0.5,
        approvedVersionIds: [version.id],
        activeAudioId: version.id,
        activeVideoId: null,
        versions: [version],
        comments: [comment],
      },
    ],
    jobs: [
      {
        id: "job-completed",
        chapterId: "old-chapter",
        kind: "audio",
        status: "completed",
        textSnapshot: "旧文稿",
        directionSnapshot: "自然",
        baseVersionId: null,
        commentIds: [],
        completedVersionId: version.id,
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "retired-job",
        chapterId: "deleted-old-chapter",
        kind: "video",
        status: "cancelled",
        textSnapshot: "保留快照",
        directionSnapshot: "",
        baseVersionId: null,
        commentIds: [],
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
  };
}
test("v1 migration backs up exact original and preserves one unsplit segment, assets and historical jobs", async (t) => {
  const old = v1Project(),
    original = JSON.stringify(old, null, 4);
  const { req, dir } = await setup(t, original);
  const result = await req();
  const p = result.data;
  assert.equal(p.schemaVersion, 2);
  assert.equal(p.revision, 7);
  assert.equal(p.chapters[0].id, "chapter_old-chapter");
  assert.equal(p.chapters[0].segments.length, 1);
  assert.deepEqual(p.chapters[0].segments[0], {
    ...old.chapters[0],
    enabled: true,
  });
  assert.equal(p.jobs[0].segmentId, "old-chapter");
  assert.ok(!("chapterId" in p.jobs[0]));
  assert.equal(p.jobs[1].segmentId, "deleted-old-chapter");
  assert.equal(p.jobs[1].textSnapshot, "保留快照");
  assert.equal(
    await readFile(join(dir, "project.json.v1.bak"), "utf8"),
    original,
  );
  assert.equal(
    JSON.parse(await readFile(join(dir, "project.json"), "utf8")).schemaVersion,
    2,
  );
  assert.equal((await req("/api/project", "PUT", p)).status, 200);
});
test("segments in one chapter queue independently and pending work prevents disabling or deletion", async (t) => {
  const { req } = await setup(t);
  let p = (await req()).data;
  const first = p.chapters[0].segments[0];
  const second = structuredClone(first);
  second.id = "second-segment";
  second.text = "第二句";
  second.derivedFromId = first.id;
  p.chapters[0].segments.push(second);
  p = (await req("/api/project", "PUT", p)).data;
  p = (await req(`/api/segments/${first.id}/jobs`, "POST", { kind: "audio" }))
    .data;
  p = (await req(`/api/segments/${second.id}/jobs`, "POST", { kind: "audio" }))
    .data;
  assert.equal(p.jobs.length, 2);
  assert.notEqual(p.jobs[0].segmentId, p.jobs[1].segmentId);
  assert.equal(p.jobs[1].textSnapshot, "第二句");
  const disabled = structuredClone(p);
  disabled.chapters[0].segments[1].enabled = false;
  assert.equal((await req("/api/project", "PUT", disabled)).status, 409);
  const removed = structuredClone(p);
  removed.chapters[0].segments.pop();
  assert.equal((await req("/api/project", "PUT", removed)).status, 409);
  p = (await req(`/api/jobs/${p.jobs[1].id}/cancel`, "POST")).data;
  p.chapters[0].segments[1].enabled = false;
  p = (await req("/api/project", "PUT", p)).data;
  assert.equal(
    (await req(`/api/segments/${second.id}/jobs`, "POST", { kind: "audio" }))
      .status,
    409,
  );
  p.chapters[0].segments.pop();
  p = (await req("/api/project", "PUT", p)).data;
  assert.equal(p.jobs[1].segmentId, second.id);
  assert.equal(p.jobs[1].status, "cancelled");
});
test("global group/segment IDs, lineage and graph bounds are validated", async (t) => {
  const { req } = await setup(t);
  const original = (await req()).data;
  const duplicate = structuredClone(original);
  duplicate.chapters[0].segments[0].id = duplicate.chapters[0].id;
  assert.equal((await req("/api/project", "PUT", duplicate)).status, 400);
  const lineage = structuredClone(original);
  lineage.chapters[0].segments[0].derivedFromId = "nonexistent";
  assert.equal((await req("/api/project", "PUT", lineage)).status, 400);
  const graph = structuredClone(original);
  graph.graph.columnWidth = 1;
  assert.equal((await req("/api/project", "PUT", graph)).status, 400);
  const future = structuredClone(original);
  future.schemaVersion = 99;
  assert.equal((await req("/api/project", "PUT", future)).status, 400);
});
test("deprecated v1 chapter routes only address stable leaf IDs", async (t) => {
  const { req } = await setup(t, v1Project());
  const response = await req("/api/chapters/old-chapter/jobs", "POST", {
    kind: "audio",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("deprecation"), "true");
  assert.equal(response.data.jobs.at(-1).segmentId, "old-chapter");
  assert.equal(
    (
      await req("/api/segments/chapter_old-chapter/jobs", "POST", {
        kind: "audio",
      })
    ).status,
    404,
  );
});
test("unknown stored schema fails without rewriting source or creating migration backup", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "vueflow-future-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const raw = JSON.stringify({ schemaVersion: 99, private: "untouched" });
  await writeFile(join(dir, "project.json"), raw);
  await assert.rejects(createStudioServer({ dataDir: dir }), /不支持/);
  assert.equal(await readFile(join(dir, "project.json"), "utf8"), raw);
  assert.ok(!(await readdir(dir)).includes("project.json.v1.bak"));
});

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
test("project ZIP export/import roundtrip remaps duplicate IDs and keeps actual local media playable", async (t) => {
  const { req, base } = await setup(t);
  let p = (await req()).data;
  const segmentId = p.chapters[0].segments[0].id;
  let response = await fetch(
    `${base}/api/segments/${segmentId}/assets?kind=audio&duration=0.001&name=test.wav`,
    { method: "POST", body: wave() },
  );
  assert.equal(response.status, 200);
  p = await response.json();
  const originalVersion = p.chapters[0].segments[0].versions[0];
  const originalGroups = p.chapters.length;
  response = await fetch(base + "/api/project/export");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  const archive = await response.arrayBuffer();
  assert.ok(archive.byteLength > 0);
  response = await fetch(base + "/api/project/import?name=project.zip", {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: archive,
  });
  const imported = await response.json();
  assert.equal(response.status, 200, JSON.stringify(imported));
  assert.equal(imported.chapters.length, originalGroups * 2);
  const newSegment = imported.chapters[originalGroups].segments[0];
  const newVersion = newSegment.versions[0];
  assert.notEqual(newSegment.id, segmentId);
  assert.notEqual(newVersion.id, originalVersion.id);
  assert.notEqual(newVersion.url, originalVersion.url);
  assert.equal(newSegment.activeAudioId, newVersion.id);
  assert.equal(newVersion.textSnapshot, originalVersion.textSnapshot);
  response = await fetch(base + newVersion.url);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), wave());
});
test("invalid project imports leave both persisted project and media directory unchanged", async (t) => {
  const { req, base, dir } = await setup(t);
  const p = (await req()).data;
  const malicious = structuredClone(p);
  malicious.schemaVersion = 999;
  let response = await fetch(base + "/api/project/import?name=broken.json", {
    method: "POST",
    body: JSON.stringify(malicious),
  });
  assert.equal(response.status, 400);
  assert.equal((await req()).data.revision, p.revision);
  const external = structuredClone(p);
  const segment = external.chapters[0].segments[0];
  segment.versions = [
    {
      id: "external",
      kind: "audio",
      url: "https://example.com/private.wav",
      name: "external",
      duration: 1,
      textSnapshot: segment.text,
      directionSnapshot: segment.direction,
      createdAt: new Date().toISOString(),
    },
  ];
  segment.activeAudioId = "external";
  response = await fetch(base + "/api/project/import?name=external.json", {
    method: "POST",
    body: JSON.stringify(external),
  });
  assert.equal(response.status, 400);
  assert.equal((await req()).data.revision, p.revision);
  assert.deepEqual(await readdir(join(dir, "media")), []);
  response = await fetch(base + "/api/project/import?name=broken.zip", {
    method: "POST",
    body: Buffer.from("not a ZIP"),
  });
  assert.equal(response.status, 400);
  assert.equal((await req()).data.revision, p.revision);
});
test("concurrent plain text imports append atomically without replacing existing work", async (t) => {
  const { req, base } = await setup(t);
  const original = (await req()).data;
  const responses = await Promise.all(
    ["第一段。第二句。", "另一段内容。"].map((text) =>
      fetch(base + "/api/project/import?name=notes.txt", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: text,
      }),
    ),
  );
  for (const response of responses) {
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
  }
  const p = (await req()).data;
  assert.equal(p.revision, original.revision + 2);
  assert.ok(p.chapters.length > original.chapters.length);
  assert.deepEqual(
    p.chapters.slice(0, original.chapters.length),
    original.chapters,
  );
  assert.ok(
    p.chapters
      .slice(original.chapters.length)
      .flatMap((c) => c.segments)
      .some((s) => s.text.includes("第一段")),
  );
  assert.ok(
    p.chapters
      .slice(original.chapters.length)
      .flatMap((c) => c.segments)
      .some((s) => s.text.includes("另一段")),
  );
});

test("failed atomic import persistence removes staged media and keeps prior project", async (t) => {
  const { req, base, dir } = await setup(t);
  let p = (await req()).data;
  const segmentId = p.chapters[0].segments[0].id;
  let response = await fetch(
    `${base}/api/segments/${segmentId}/assets?kind=audio&duration=0.001&name=test.wav`,
    { method: "POST", body: wave() },
  );
  p = await response.json();
  const beforeMedia = await readdir(join(dir, "media"));
  const beforeFile = await readFile(join(dir, "project.json"), "utf8");
  response = await fetch(base + "/api/project/export");
  const archive = await response.arrayBuffer();
  const rename = fs.rename;
  fs.rename = async () => {
    throw Object.assign(new Error("simulated disk failure"), { code: "EIO" });
  };
  try {
    response = await fetch(base + "/api/project/import?name=backup.zip", {
      method: "POST",
      body: archive,
    });
    assert.equal(response.ok, false);
    await response.arrayBuffer();
  } finally {
    fs.rename = rename;
  }
  assert.equal((await req()).data.revision, p.revision);
  assert.deepEqual(await readdir(join(dir, "media")), beforeMedia);
  assert.equal(await readFile(join(dir, "project.json"), "utf8"), beforeFile);
});
test("import graph adoption is explicit while ordinary append preserves current configuration", async (t) => {
  const { req, base } = await setup(t);
  let p = (await req()).data;
  const candidate = structuredClone(p);
  candidate.graph.columnWidth = 380;
  candidate.graph.rowGap = 300;
  let response = await fetch(base + "/api/project/import?name=config.json", {
    method: "POST",
    body: JSON.stringify(candidate),
  });
  let imported = await response.json();
  assert.equal(response.status, 200, JSON.stringify(imported));
  assert.equal(imported.graph.columnWidth, p.graph.columnWidth);
  response = await fetch(
    base + "/api/project/import?name=config.json&applyGraph=true",
    { method: "POST", body: JSON.stringify(candidate) },
  );
  imported = await response.json();
  assert.equal(response.status, 200, JSON.stringify(imported));
  assert.equal(imported.graph.columnWidth, 380);
  assert.equal(imported.graph.rowGap, 300);
});
