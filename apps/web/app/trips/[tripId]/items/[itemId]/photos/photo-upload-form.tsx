"use client";

import { startTransition, useActionState, useState } from "react";
import { submitPhoto } from "./actions";

// 大於 1.5 MB 或長邊超過 2048 的照片先在瀏覽器縮小並重新壓縮為 JPEG；
// EXIF 一律由伺服器移除，這裡只負責縮小檔案
const COMPRESS_OVER_BYTES = 1.5 * 1024 * 1024;
const MAX_EDGE = 2048;

async function compress(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (file.size <= COMPRESS_OVER_BYTES && scale === 1) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.85));
}

export function PhotoUploadForm({ tripId, itemId }: { tripId: string; itemId: string }) {
  const [state, dispatch, pending] = useActionState(submitPhoto, null);
  const [source, setSource] = useState<"user_upload" | "wikimedia_commons">("user_upload");
  const [busy, setBusy] = useState(false);

  async function onSubmit(form: FormData) {
    setBusy(true);
    try {
      const file = form.get("file");
      if (file instanceof File && file.size > 0) {
        const blob = await compress(file).catch(() => file);
        form.set("file", blob, file.name);
      }
    } finally {
      setBusy(false);
    }
    startTransition(() => dispatch(form));
  }

  return (
    <form action={onSubmit} className="key-row">
      <p role="status" aria-live="polite" className={state && !state.ok ? "status error" : "status"}>
        {state?.message ?? ""}
      </p>
      <fieldset disabled={pending || busy}>
        <legend>新增照片</legend>
        <input type="hidden" name="tripId" value={tripId} />
        <input type="hidden" name="itemId" value={itemId} />
        <label htmlFor="photo-file">照片（JPEG、PNG、WebP，5 MB 以內）</label>
        <input id="photo-file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
        <div className="toggles" role="radiogroup" aria-label="照片來源">
          <label className="toggle">
            <input type="radio" name="source" value="user_upload" checked={source === "user_upload"} onChange={() => setSource("user_upload")} />
            自己拍攝
          </label>
          <label className="toggle">
            <input
              type="radio"
              name="source"
              value="wikimedia_commons"
              checked={source === "wikimedia_commons"}
              onChange={() => setSource("wikimedia_commons")}
            />
            Wikimedia Commons
          </label>
        </div>
        <label htmlFor="photo-author">{source === "wikimedia_commons" ? "作者" : "拍攝者（選填）"}</label>
        <input id="photo-author" name="author" type="text" maxLength={200} required={source === "wikimedia_commons"} />
        {source === "wikimedia_commons" ? (
          <>
            <label htmlFor="photo-license">授權（例如 CC BY-SA 4.0）</label>
            <input id="photo-license" name="license" type="text" maxLength={100} required />
            <label htmlFor="photo-source">Commons 檔案頁網址</label>
            <input id="photo-source" name="sourceUrl" type="url" maxLength={2048} required placeholder="https://commons.wikimedia.org/wiki/File:…" />
          </>
        ) : null}
        <div className="key-actions">
          <button type="submit" name="intent" value="save">
            上傳
          </button>
        </div>
      </fieldset>
    </form>
  );
}
