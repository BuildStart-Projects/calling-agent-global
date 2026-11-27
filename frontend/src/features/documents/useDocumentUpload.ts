import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, callFunction } from "@/lib/supabase";
import { extractText, isAcceptedDoc } from "./extract";

export type UploadItem = {
  key: string;
  filename: string;
  status: "uploading" | "reading" | "ready" | "failed";
  label: string;
  pct?: number;
  documentId?: string;
  headline?: string;
};

const MAX_MB = 10;

export function useDocumentUpload(agentId: string | undefined, workspaceId: string | undefined) {
  const qc = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);

  const patch = (key: string, p: Partial<UploadItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const add = useCallback(async (files: File[]) => {
    if (!agentId || !workspaceId) return;
    const accepted = files.slice(0, 5);
    for (const file of accepted) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      if (!isAcceptedDoc(file)) {
        setItems((l) => [...l, { key, filename: file.name, status: "failed", label: "Use a PDF, photo, Word or text file" }]);
        continue;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        setItems((l) => [...l, { key, filename: file.name, status: "failed", label: `Too large (max ${MAX_MB} MB)` }]);
        continue;
      }
      setItems((l) => [...l, { key, filename: file.name, status: "uploading", label: "Uploading…" }]);
      try {
        const path = `${workspaceId}/${agentId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
        const up = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined });
        if (up.error) throw new Error(up.error.message);
        const { data: doc, error } = await supabase.from("documents")
          .insert({ agent_id: agentId, storage_path: path, filename: file.name, mime: file.type || "application/octet-stream", size_bytes: file.size })
          .select("id").single();
        if (error) throw new Error(error.message);

        patch(key, { status: "reading", label: "Reading…", documentId: doc.id });
        const extracted = await extractText(file, (label, pct) => patch(key, { label, pct }));
        const res = await callFunction<{ status: string; headline?: string; message?: string }>("documents-ingest", {
          agent_id: agentId, document_id: doc.id, text: extracted.text, pages: extracted.pages, ocr_confidence: extracted.ocrConfidence,
        });
        if (res.status !== "ready") patch(key, { status: "failed", label: res.message ?? "Couldn't read this file" });
        else patch(key, { status: "ready", label: res.headline ?? "Ready", headline: res.headline });
        qc.invalidateQueries({ queryKey: ["knowledge", agentId] });
      } catch (e) {
        patch(key, { status: "failed", label: (e as Error).message || "Upload failed" });
      }
    }
  }, [agentId, workspaceId, qc]);

  const remove = (key: string) => setItems((l) => l.filter((i) => i.key !== key));
  const clearReady = () => setItems((l) => l.filter((i) => i.status !== "ready"));
  const ready = items.filter((i) => i.status === "ready" && i.documentId).map((i) => ({ id: i.documentId!, filename: i.filename }));
  const busy = items.some((i) => i.status === "uploading" || i.status === "reading");

  return { items, add, remove, clearReady, ready, busy };
}
