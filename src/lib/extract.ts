
export const ACCEPTED_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const MAX_CV_BYTES = 10 * 1024 * 1024;

/** Infer MIME from magic bytes; never trust the client-supplied type alone. */
export function sniffMime(buf: Buffer, fileName: string): string | null {
  if (buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf[0] === 0x50 && buf[1] === 0x4b && /\.docx$/i.test(fileName))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (/\.txt$/i.test(fileName) && !buf.subarray(0, 2048).includes(0)) return "text/plain";
  return null;
}

/**
 * Extract plain text. Returns null when the document has no usable text layer
 * (scanned PDF or image) so the caller can fall back to OCR.
 */
export async function extractText(buf: Buffer, mime: string): Promise<string | null> {
  let text = "";
  if (mime === "application/pdf") {
    const { getDocumentProxy, extractText: pdfText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const out = await pdfText(pdf, { mergePages: true });
    text = Array.isArray(out.text) ? out.text.join("\n") : out.text;
  } else if (mime.includes("wordprocessingml")) {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if (mime === "text/plain") {
    text = buf.toString("utf8");
  } else {
    return null;
  }
  text = text.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text.length >= 200 ? text : null;
}
