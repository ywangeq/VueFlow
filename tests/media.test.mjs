import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
const source = await fs.readFile(
  new URL("../src/services/media.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { volume, selectedVersion, exportAudio, claimPlayback, releasePlayback } =
  await import(
    `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
  );
const version = { id: "a", kind: "audio", textSnapshot: "hello", duration: 2 };
const chapter = {
  title: "Chapter",
  text: "hello",
  gain: 1,
  gap: 0,
  versions: [version],
  activeAudioId: "a",
  activeVideoId: null,
  approvedVersionIds: ["a"],
  comments: [],
};
const project = { masterGain: 1, chapters: [chapter] };
test("media selection cannot substitute a different media kind or absent version", () => {
  assert.equal(selectedVersion(chapter, "audio"), version);
  assert.equal(selectedVersion(chapter, "video"), null);
  assert.equal(
    selectedVersion({ ...chapter, activeVideoId: "a" }, "video"),
    null,
  );
  assert.equal(
    selectedVersion({ ...chapter, activeAudioId: "missing" }, "audio"),
    null,
  );
});
test("playback gain stays in native media range", () => {
  assert.equal(volume(2), 1);
  assert.equal(volume(-1), 0);
  assert.equal(volume(NaN), 0);
  assert.equal(volume(0.4), 0.4);
});
test("export refuses incomplete, stale and unapproved sequences before decoding", async () => {
  await assert.rejects(exportAudio({ ...project, chapters: [] }), /添加章节/);
  await assert.rejects(
    exportAudio({
      ...project,
      chapters: [{ ...chapter, activeAudioId: null }],
    }),
    /缺少/,
  );
  await assert.rejects(
    exportAudio({ ...project, chapters: [{ ...chapter, text: "new" }] }),
    /旧文稿/,
  );
  await assert.rejects(
    exportAudio({
      ...project,
      chapters: [{ ...chapter, approvedVersionIds: [] }],
    }),
    /审听/,
  );
  await assert.rejects(
    exportAudio({
      ...project,
      chapters: [{ ...chapter, versions: [{ ...version, duration: 901 }] }],
    }),
    /15 分钟/,
  );
});
test("audio export schedules gains and gaps and writes bounded stereo PCM WAV", async () => {
  const original = {
    AudioContext: globalThis.AudioContext,
    OfflineAudioContext: globalThis.OfflineAudioContext,
    fetch: globalThis.fetch,
  };
  const starts = [],
    gains = [];
  let closed = false;
  globalThis.AudioContext = class {
    async decodeAudioData() {
      return { duration: 2 };
    }
    async close() {
      closed = true;
    }
  };
  globalThis.OfflineAudioContext = class {
    constructor(channels, length, rate) {
      assert.equal(channels, 2);
      assert.equal(length, 5 * 44100);
      assert.equal(rate, 44100);
    }
    createBufferSource() {
      return {
        connect() {},
        start(time) {
          starts.push(time);
        },
      };
    }
    createGain() {
      const gain = { value: 0 };
      gains.push(gain);
      return { gain, connect() {} };
    }
    async startRendering() {
      return {
        numberOfChannels: 2,
        length: 2,
        sampleRate: 44100,
        getChannelData: () => new Float32Array([2, -2]),
      };
    }
  };
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(2),
  });
  try {
    const blob = await exportAudio({
      masterGain: 0.5,
      chapters: [
        { ...chapter, gain: 0.6, gap: 1 },
        { ...chapter, gain: 1 },
      ],
    });
    assert.deepEqual(starts, [0, 3]);
    assert.deepEqual(
      gains.map((g) => g.value),
      [0.3, 0.5],
    );
    const bytes = await blob.arrayBuffer(),
      view = new DataView(bytes);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
    assert.equal(view.getUint16(22, true), 2);
    assert.equal(view.getInt16(44, true), 32767);
    assert.equal(view.getInt16(48, true), -32768);
    assert.equal(closed, true);
  } finally {
    Object.assign(globalThis, original);
  }
});

test("playback ownership pauses previous transport and ignores old owner release", () => {
  const preview = Symbol(),
    sequence = Symbol(),
    other = Symbol();
  const paused = [];
  claimPlayback(preview, () => {
    paused.push("preview");
    releasePlayback(preview);
  });
  claimPlayback(sequence, () => {
    paused.push("sequence");
    releasePlayback(sequence);
  });
  claimPlayback(sequence, () =>
    assert.fail("duplicate claim replaces callback"),
  );
  claimPlayback(other, () => paused.push("other"));
  assert.deepEqual(paused, ["preview", "sequence"]);
  releasePlayback(other);
});
test("export blocks unresolved feedback on selected version only", async () => {
  await assert.rejects(
    exportAudio({
      ...project,
      chapters: [
        { ...chapter, comments: [{ versionId: "a", resolved: false }] },
      ],
    }),
    /未解决/,
  );
});

test("export refuses obsolete performance direction when captured", async () => {
  await assert.rejects(
    exportAudio({
      ...project,
      chapters: [
        {
          ...chapter,
          direction: "new",
          versions: [{ ...version, directionSnapshot: "old" }],
        },
      ],
    }),
    /表演要求/,
  );
});
