"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const coreBaseUrl = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

type OutputFile = {
  label: string;
  url: string;
};

export default function Home() {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [status, setStatus] = useState("待機中");
  const [splitSource, setSplitSource] = useState<File | null>(null);
  const [splitOutputs, setSplitOutputs] = useState<OutputFile[]>([]);
  const [mergeSources, setMergeSources] = useState<[File | null, File | null]>([
    null,
    null,
  ]);
  const [mergeOutput, setMergeOutput] = useState<OutputFile | null>(null);

  const loadFfmpeg = useCallback(async () => {
    if (isReady) return;
    setStatus("FFmpeg を読み込み中...");
    if (!ffmpegRef.current) {
      ffmpegRef.current = new FFmpeg();
    }
    const ffmpeg = ffmpegRef.current;
    await ffmpeg.load({
      coreURL: await toBlobURL(`${coreBaseUrl}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(
        `${coreBaseUrl}/ffmpeg-core.wasm`,
        "application/wasm",
      ),
    });
    setIsReady(true);
    setStatus("準備完了");
  }, [isReady]);

  const resetSplit = () => {
    splitOutputs.forEach((output) => URL.revokeObjectURL(output.url));
    setSplitOutputs([]);
  };

  const resetMerge = () => {
    if (mergeOutput) {
      URL.revokeObjectURL(mergeOutput.url);
    }
    setMergeOutput(null);
  };

  const handleSplitFile = async (file: File | null) => {
    resetSplit();
    setSplitSource(file);
    if (!file) return;
    await loadFfmpeg();
  };

  const handleMergeFile = async (index: 0 | 1, file: File | null) => {
    resetMerge();
    setMergeSources((prev) => {
      const next: [File | null, File | null] = [...prev];
      next[index] = file;
      return next;
    });
    if (file) {
      await loadFfmpeg();
    }
  };

  const splitVideo = async () => {
    if (!splitSource || !ffmpegRef.current) return;
    setIsWorking(true);
    setStatus("動画を解析中...");
    resetSplit();

    const duration = await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve(video.duration || 0);
      video.onerror = () => reject(new Error("動画の読み込みに失敗しました"));
      video.src = URL.createObjectURL(splitSource);
    });

    if (!duration || Number.isNaN(duration)) {
      setStatus("動画の長さを取得できませんでした");
      setIsWorking(false);
      return;
    }

    const half = duration / 2;
    const ffmpeg = ffmpegRef.current;
    const inputName = `split-input-${splitSource.name}`;
    const outputA = "split-part-a.mp4";
    const outputB = "split-part-b.mp4";

    setStatus("動画を半分に分割中...");
    await ffmpeg.writeFile(inputName, await fetchFile(splitSource));

    await ffmpeg.exec([
      "-i",
      inputName,
      "-t",
      half.toString(),
      "-c",
      "copy",
      outputA,
    ]);

    await ffmpeg.exec([
      "-i",
      inputName,
      "-ss",
      half.toString(),
      "-c",
      "copy",
      outputB,
    ]);

    const dataA = await ffmpeg.readFile(outputA);
    const dataB = await ffmpeg.readFile(outputB);

    const outputFiles: OutputFile[] = [
      {
        label: "前半",
        url: URL.createObjectURL(new Blob([dataA], { type: "video/mp4" })),
      },
      {
        label: "後半",
        url: URL.createObjectURL(new Blob([dataB], { type: "video/mp4" })),
      },
    ];

    setSplitOutputs(outputFiles);
    setStatus("分割完了");
    setIsWorking(false);
  };

  const mergeVideo = async () => {
    const [first, second] = mergeSources;
    if (!first || !second || !ffmpegRef.current) return;
    setIsWorking(true);
    setStatus("動画を結合中...");
    resetMerge();

    const ffmpeg = ffmpegRef.current;
    const firstName = `merge-first-${first.name}`;
    const secondName = `merge-second-${second.name}`;
    const concatList = "concat.txt";
    const outputName = "merged-output.mp4";

    await ffmpeg.writeFile(firstName, await fetchFile(first));
    await ffmpeg.writeFile(secondName, await fetchFile(second));
    await ffmpeg.writeFile(
      concatList,
      `file '${firstName.replaceAll("'", "'\\''")}'\nfile '${secondName.replaceAll("'", "'\\''")}'\n`,
    );

    await ffmpeg.exec([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatList,
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputName,
    ]);

    const merged = await ffmpeg.readFile(outputName);
    setMergeOutput({
      label: "結合済み動画",
      url: URL.createObjectURL(new Blob([merged], { type: "video/mp4" })),
    });
    setStatus("結合完了");
    setIsWorking(false);
  };

  const splitDisabled = !splitSource || isWorking;
  const mergeDisabled = !mergeSources[0] || !mergeSources[1] || isWorking;

  const splitFileName = useMemo(
    () => splitSource?.name ?? "ファイルが選択されていません",
    [splitSource],
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-12">
        <span className="text-sm font-semibold uppercase tracking-[0.4em] text-zinc-400">
          Video Cutter & Joiner
        </span>
        <h1 className="text-3xl font-semibold leading-tight text-white sm:text-4xl">
          動画を半分にカット、または2本をつなげる。
          <br />
          ブラウザだけで完結する動画ツール。
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-zinc-300">
          アップロードした動画はブラウザ内で処理されます。データは外部へ送信されません。
          初回操作時に FFmpeg を読み込みます。
        </p>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-200">
          ステータス: <span className="font-semibold text-white">{status}</span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 pb-16 pt-10">
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-lg shadow-black/20">
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-semibold text-white">動画を半分にカット</h2>
              <p className="mt-2 text-sm text-zinc-300">
                1本の動画をアップロードすると、ぴったり半分にカットして2本の動画を出力します。
              </p>
            </div>
            <label className="flex flex-col gap-2 text-sm font-medium text-zinc-200">
              ファイルを選択
              <input
                type="file"
                accept="video/*"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-zinc-700"
                onChange={(event) =>
                  handleSplitFile(event.currentTarget.files?.[0] ?? null)
                }
              />
            </label>
            <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-400">
              選択中: {splitFileName}
            </div>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full bg-white px-6 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              onClick={splitVideo}
              disabled={splitDisabled}
            >
              半分にカットする
            </button>
          </div>

          {splitOutputs.length > 0 && (
            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              {splitOutputs.map((output) => (
                <div
                  key={output.label}
                  className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4"
                >
                  <p className="text-sm font-semibold text-white">{output.label}</p>
                  <video
                    className="mt-3 w-full rounded-xl"
                    src={output.url}
                    controls
                  />
                  <a
                    className="mt-3 inline-flex items-center justify-center rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-200 hover:border-zinc-500"
                    href={output.url}
                    download={`split-${output.label}.mp4`}
                  >
                    ダウンロード
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-lg shadow-black/20">
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-semibold text-white">2本の動画を結合</h2>
              <p className="mt-2 text-sm text-zinc-300">
                1本目と2本目の順番でつなげます。長さや解像度が違う場合は自動で再エンコードします。
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1].map((index) => (
                <label
                  key={index}
                  className="flex flex-col gap-2 text-sm font-medium text-zinc-200"
                >
                  {index === 0 ? "1本目" : "2本目"}
                  <input
                    type="file"
                    accept="video/*"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-zinc-700"
                    onChange={(event) =>
                      handleMergeFile(
                        index as 0 | 1,
                        event.currentTarget.files?.[0] ?? null,
                      )
                    }
                  />
                  <span className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-400">
                    {mergeSources[index]?.name ?? "未選択"}
                  </span>
                </label>
              ))}
            </div>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full bg-white px-6 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              onClick={mergeVideo}
              disabled={mergeDisabled}
            >
              つなげる
            </button>
          </div>

          {mergeOutput && (
            <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
              <p className="text-sm font-semibold text-white">{mergeOutput.label}</p>
              <video className="mt-3 w-full rounded-xl" src={mergeOutput.url} controls />
              <a
                className="mt-3 inline-flex items-center justify-center rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-200 hover:border-zinc-500"
                href={mergeOutput.url}
                download="merged-video.mp4"
              >
                ダウンロード
              </a>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
