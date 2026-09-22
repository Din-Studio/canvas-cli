import { promises as fs, constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { CliError, MEDIA_LIMIT, UPLOAD_LIMIT } from "./common.mjs";
import { readWorkspaceFile, workspacePath } from "./session.mjs";
import { call, requireSuccess } from "./client.mjs";

const MIMES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".txt": "text/plain",
  ".md": "text/markdown",
};
/** Container by leading bytes — the only evidence of an audio's real format. */
export function sniffMediaType(bytes) {
  const head = Buffer.from(bytes).subarray(0, 16);
  const n = head.length;
  const ascii = (offset, value) =>
    n >= offset + value.length && head.toString("latin1", offset, offset + value.length) === value;
  if (n >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (n >= 8 && head[0] === 0x89 && ascii(1, "PNG")) return "image/png";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "audio/wav";
  if (ascii(0, "OggS")) return "audio/ogg";
  if (ascii(0, "fLaC")) return "audio/flac";
  if (ascii(0, "ID3") || (n >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0))
    return "audio/mpeg";
  if (n >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
    return "video/webm";
  if (ascii(4, "ftyp")) {
    const brand = n >= 12 ? head.toString("latin1", 8, 12).toLowerCase().trimEnd() : "";
    if (brand === "m4a" || brand === "m4b") return "audio/mp4";
    if (brand === "qt") return "video/quicktime";
    return "video/mp4";
  }
  return null;
}
/** Audio containers the video providers accept as reference audio (by bytes). */
export const VIDEO_REFERENCE_AUDIO_TYPES = ["audio/mpeg", "audio/wav"];
/**
 * What an audio's real bytes mean for video generation. The provider sniffs
 * and rejects anything but mp3 / wav, so a `.mp3` name proves nothing.
 */
export function audioCompatibility(detectedMimeType) {
  if (!detectedMimeType || !detectedMimeType.startsWith("audio/")) return undefined;
  const ok = VIDEO_REFERENCE_AUDIO_TYPES.includes(detectedMimeType);
  return {
    detectedMimeType,
    videoReferenceCompatible: ok,
    ...(ok ? {} : { note: `视频模型不支持该音频格式（${detectedMimeType}）；允许格式：mp3、wav` }),
  };
}
export function mimeFor(file) {
  return MIMES[path.extname(file).toLowerCase()] || "application/octet-stream";
}
export async function upload(session, input, options, rpcOptions) {
  const { file, bytes } = await readWorkspaceFile(session.workspace, input, UPLOAD_LIMIT);
  const command = {
    type: "upload_asset",
    path: path.relative(session.workspace, file).split(path.sep).join("/"),
    fileName: path.basename(file),
    mimeType: options.mime || mimeFor(file),
    bytesBase64: bytes.toString("base64"),
    ...(options.title ? { title: options.title } : {}),
  };
  if (options.x !== undefined || options.y !== undefined) {
    const x = Number(options.x ?? 0),
      y = Number(options.y ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new CliError("invalid_argument", "--x and --y must be finite numbers");
    command.position = { x, y };
  }
  return call(
    session,
    "apply",
    { commands: [command], label: options.label || `Upload ${path.basename(file)}` },
    rpcOptions,
  );
}
export async function mediaInfo(session, nodeId, { resource, metadataOnly = false } = {}) {
  if (!nodeId) throw new CliError("invalid_argument", "--node is required");
  if (resource !== undefined && (typeof resource !== "string" || !resource.trim()))
    throw new CliError("invalid_argument", "--resource must be an ID returned by resources");
  const info = requireSuccess(
    await call(session, "media_info", {
      nodeId,
      ...(resource ? { resourceId: resource } : {}),
      ...(metadataOnly ? { metadataOnly: true } : {}),
    }),
  );
  if (
    !info ||
    typeof info !== "object" ||
    (!(metadataOnly && info.size === null) &&
      (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > MEDIA_LIMIT)) ||
    typeof info.mimeType !== "string" ||
    typeof info.fileName !== "string"
  )
    throw new CliError("invalid_media", "Page returned invalid or oversized media metadata");
  return info;
}
export async function download(
  session,
  nodeId,
  output,
  { overwrite = false, info: suppliedInfo, resource } = {},
) {
  if (!output) throw new CliError("invalid_argument", "--out is required");
  const target = await workspacePath(session.workspace, output, { output: true });
  if (!overwrite) {
    try {
      await fs.lstat(target);
      throw new CliError(
        "file_exists",
        "Output already exists; choose another path or explicitly use --overwrite",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const info = suppliedInfo || (await mediaInfo(session, nodeId, { resource }));
  const temp = path.join(path.dirname(target), `.scenemint-${randomUUID()}.part`);
  const handle = await fs.open(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0),
    0o600,
  );
  let written = 0;
  let head = Buffer.alloc(0);
  try {
    if (typeof info.content === "string") {
      const content = Buffer.from(info.content, "utf8");
      if (content.length !== info.size || content.length > MEDIA_LIMIT)
        throw new CliError("invalid_media", "Text media size does not match metadata");
      await handle.writeFile(content);
      written = content.length;
      head = content.subarray(0, 16);
    } else {
      if (typeof info.mediaId !== "string" || !info.mediaId)
        throw new CliError("invalid_media", "Page returned no scoped media handle");
      while (written < info.size) {
        const length = Math.min(262144, info.size - written);
        const chunk = requireSuccess(
          await call(session, "media_chunk", { mediaId: info.mediaId, offset: written, length }),
        );
        if (
          chunk.offset !== written ||
          typeof chunk.base64 !== "string" ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk.base64)
        )
          throw new CliError("invalid_media", "Page returned an invalid media chunk");
        const bytes = Buffer.from(chunk.base64, "base64");
        if (head.length < 16) head = Buffer.concat([head, bytes]).subarray(0, 16);
        if (
          bytes.length < 1 ||
          bytes.length > length ||
          written + bytes.length > info.size ||
          (chunk.eof === true && written + bytes.length !== info.size)
        )
          throw new CliError("invalid_media", "Media chunk length does not match metadata");
        await handle.writeFile(bytes);
        written += bytes.length;
      }
    }
    await handle.sync();
    await handle.close();
    await workspacePath(session.workspace, output, { output: true });
    if (overwrite) await fs.rename(temp, target);
    else {
      // Atomic no-clobber publication. rename() would silently overwrite a file
      // created by the human between the initial check and download completion.
      try {
        await fs.link(temp, target);
      } catch (error) {
        if (error.code === "EEXIST")
          throw new CliError("file_exists", "Output appeared during download and was preserved");
        throw error;
      }
      await fs.unlink(temp);
    }
    return {
      ok: true,
      path: target,
      nodeId,
      ...(info.resourceId ? { resourceId: info.resourceId } : {}),
      size: written,
      mimeType: info.mimeType,
      fileName: info.fileName,
      detectedMimeType: sniffMediaType(head),
    };
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}
function runTool(command, args, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stdout = "",
      stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 1024 * 1024) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16384) stderr += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(
        new CliError(
          error.code === "ENOENT" ? "tool_missing" : "media_tool_failed",
          error.code === "ENOENT" ? `${command} is not installed or not on PATH` : error.message,
        ),
      );
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else
        reject(
          new CliError(
            "media_tool_failed",
            signal
              ? `${command} was interrupted or timed out`
              : `${command} failed: ${stderr.trim()}`,
          ),
        );
    });
  });
}
export async function inspectMedia(session, nodeId, options) {
  const info = await mediaInfo(session, nodeId, {
    resource: options.resource,
    metadataOnly: !options.out,
  });
  const metadata = {
    nodeId,
    size: info.size,
    mimeType: info.mimeType,
    fileName: info.fileName,
    ...(info.resourceId ? { resourceId: info.resourceId } : {}),
  };
  if (!options.out)
    return {
      ok: true,
      ...metadata,
      downloaded: false,
      hint: "Use download --out to obtain a local file for your host image/audio/video reader; mimeType/fileName are declared, not sniffed — pass --out to read the real container (video reference audio must be mp3/wav by bytes)",
    };
  const saved = {
    ...(await download(session, nodeId, options.out, { overwrite: options.overwrite, info })),
  };
  const audio = audioCompatibility(saved.detectedMimeType);
  if (audio) Object.assign(saved, audio);
  if (options.probe) {
    const raw = await runTool("ffprobe", [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      saved.path,
    ]);
    return { ...saved, probe: JSON.parse(raw) };
  }
  return saved;
}
export async function frames(session, nodeId, options) {
  if (!options["out-dir"])
    throw new CliError(
      "invalid_argument",
      "--out-dir must name a new directory inside the workspace",
    );
  const count = Number(options.count ?? 12),
    every = Number(options.every ?? 5);
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100 ||
    !Number.isFinite(every) ||
    every < 0.1 ||
    every > 3600
  )
    throw new CliError(
      "invalid_argument",
      "--count must be 1–100 and --every must be 0.1–3600 seconds",
    );
  // Check availability before downloading potentially large media.
  await runTool("ffmpeg", ["-version"], { timeout: 10000 });
  const targetDir = await workspacePath(session.workspace, options["out-dir"], { output: true });
  await fs.mkdir(targetDir, { mode: 0o700 });
  let source;
  try {
    const info = await mediaInfo(session, nodeId, { resource: options.resource });
    if (!info.mimeType.startsWith("video/"))
      throw new CliError("invalid_media", "frames requires a video node");
    source = path.join(targetDir, ".source-video");
    await download(session, nodeId, source, { info });
    await runTool("ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      source,
      "-vf",
      `fps=1/${every}`,
      "-frames:v",
      String(count),
      "-q:v",
      "2",
      path.join(targetDir, "frame-%03d.jpg"),
    ]);
    const files = (await fs.readdir(targetDir))
      .filter((name) => /^frame-\d+\.jpg$/.test(name))
      .sort()
      .map((name) => path.join(targetDir, name));
    return {
      ok: true,
      nodeId,
      ...(info.resourceId ? { resourceId: info.resourceId } : {}),
      everySeconds: every,
      paths: files,
      count: files.length,
    };
  } finally {
    if (source) await fs.unlink(source).catch(() => {});
  }
}
