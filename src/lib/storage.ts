/**
 * CV file storage.
 *
 * Files go to a private Supabase Storage bucket when SUPABASE_SERVICE_ROLE_KEY
 * is set (the default for a real deployment), and otherwise stay inline in
 * Postgres (`file_data`), which is what local development, tests and CI use
 * (or force it with CV_STORAGE=database). Keeping files out of the database
 * keeps it small, backups fast, and every `select *` on candidates cheap.
 *
 * The bucket is private: files are only ever read here, server-side, with the
 * service role key, and streamed to signed-in recruiters through
 * /api/candidates/[id]/cv after the usual tenant check.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { log } from "./log";

const BUCKET = process.env.CV_BUCKET || "cvs";

export const storageEnabled = () =>
  process.env.CV_STORAGE !== "database" && !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL;

let client: SupabaseClient | null = null;
function admin(): SupabaseClient {
  client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

let bucketReady: Promise<void> | null = null;
function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    const { data } = await admin().storage.getBucket(BUCKET);
    if (data) return;
    const { error } = await admin().storage.createBucket(BUCKET, { public: false, fileSizeLimit: "10MB" });
    if (error && !/already exists/i.test(error.message)) throw new Error(`Could not create storage bucket "${BUCKET}": ${error.message}`);
  })().catch((err) => {
    bucketReady = null; // retry on the next call
    throw err;
  });
  return bucketReady;
}

export type FileRef = { filePath: string | null; fileData: Buffer | null };

/** Path layout: <org>/<candidates|library>/<row id>. One object per row, so deleting a row deletes exactly its file. */
export const cvPath = (orgId: string, kind: "candidates" | "library", id: string) => `${orgId}/${kind}/${id}`;

/** Saves a CV file for a row and returns the columns to store on it. */
export async function storeCv(orgId: string, kind: "candidates" | "library", id: string, buf: Buffer, mime: string): Promise<FileRef> {
  if (!storageEnabled()) return { filePath: null, fileData: buf };
  await ensureBucket();
  const path = cvPath(orgId, kind, id);
  const { error } = await admin().storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: true });
  if (error) throw new Error(`CV upload to storage failed: ${error.message}`);
  return { filePath: path, fileData: null };
}

/** The CV file's bytes, from storage or the inline column; null when the row has no file. */
export async function loadCv(ref: FileRef): Promise<Buffer | null> {
  if (ref.filePath) {
    const { data, error } = await admin().storage.from(BUCKET).download(ref.filePath);
    if (error || !data) throw new Error(`CV download from storage failed: ${error?.message ?? "no data"}`);
    return Buffer.from(await data.arrayBuffer());
  }
  return ref.fileData ?? null;
}

/** Deletes stored files (rows with inline files need nothing extra). Never throws: an orphaned file is better than a failed deletion request. */
export async function removeCvFiles(paths: (string | null | undefined)[]): Promise<void> {
  const list = [...new Set(paths.filter((p): p is string => !!p))];
  if (!list.length || !storageEnabled()) return;
  for (let i = 0; i < list.length; i += 100) {
    const { error } = await admin().storage.from(BUCKET).remove(list.slice(i, i + 100));
    if (error) log.warn("could not delete CV files from storage", { count: list.length, err: error.message });
  }
}
