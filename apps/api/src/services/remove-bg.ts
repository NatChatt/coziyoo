import { env } from "../config/env.js";

type RemoveBgSuccess = {
  contentType: "image/png";
  buffer: Buffer;
  width: number;
  height: number;
};

type RemoveBgFailure = {
  status: number;
  message: string;
  detail?: string;
};

function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  if (buffer.byteLength < 24) {
    throw new Error("PNG output is too small");
  }
  const signature = buffer.subarray(0, 8);
  const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!signature.equals(expected)) {
    throw new Error("Unexpected PNG signature from background removal service");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export async function removeImageBackground(input: {
  fileBuffer: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  fileName: string;
}): Promise<RemoveBgSuccess> {
  if (!env.REMOVE_BG_API_KEY) {
    const error = new Error("Background removal service is not configured");
    (error as Error & { status?: number }).status = 503;
    throw error;
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), env.REMOVE_BG_TIMEOUT_MS);

  try {
    const formData = new FormData();
    formData.append("size", "auto");
    formData.append("format", "png");
    const fileArrayBuffer = input.fileBuffer.buffer.slice(
      input.fileBuffer.byteOffset,
      input.fileBuffer.byteOffset + input.fileBuffer.byteLength,
    ) as ArrayBuffer;
    formData.append("image_file", new Blob([fileArrayBuffer], { type: input.mimeType }), input.fileName);

    const response = await fetch(env.REMOVE_BG_API_URL, {
      method: "POST",
      headers: {
        "X-Api-Key": env.REMOVE_BG_API_KEY,
      },
      body: formData,
      signal: abortController.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).trim();
      const error = new Error("Background removal failed") as Error & RemoveBgFailure;
      error.status = response.status;
      error.detail = detail || undefined;
      throw error;
    }

    const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("image/png")) {
      const error = new Error("Unexpected output from background removal service") as Error & RemoveBgFailure;
      error.status = 502;
      error.detail = `content-type=${contentType || "unknown"}`;
      throw error;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const { width, height } = readPngDimensions(buffer);
    return {
      contentType: "image/png",
      buffer,
      width,
      height,
    };
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "AbortError") {
      const timeoutError = new Error("Background removal service timed out") as Error & RemoveBgFailure;
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
