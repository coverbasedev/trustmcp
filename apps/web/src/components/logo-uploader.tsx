"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

type Kind = "square" | "wide";

const SPEC: Record<Kind, { label: string; box: [number, number]; hint: string; field: string }> = {
  square: {
    label: "Square logo (mark)",
    box: [512, 512],
    hint: "Recommended 512×512px. Used as the switcher icon and favicon. PNG/SVG with a transparent background works best.",
    field: "logo",
  },
  wide: {
    label: "Wide logo (lockup)",
    box: [800, 200],
    hint: "Recommended 800×200px (4:1). Shown in your trust center header. PNG/SVG with a transparent background works best.",
    field: "wide_logo",
  },
};

const ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"];
const MAX_BYTES = 2 * 1024 * 1024;

function isRedirect(e: unknown): boolean {
  return typeof (e as { digest?: string })?.digest === "string" &&
    (e as { digest: string }).digest.startsWith("NEXT_REDIRECT");
}

/**
 * Drag-and-drop logo uploader. Validates type/size, resizes raster images to the
 * recommended box on a transparent canvas (preserving alpha — SVGs are uploaded
 * as-is since they scale losslessly), previews the result, and submits it to the
 * given server action. Keeping the resize client-side means the network just
 * stores bytes — no server image pipeline needed.
 */
export default function LogoUploader({
  kind,
  currentUrl,
  action,
}: {
  kind: Kind;
  currentUrl?: string | null;
  // Bound server action: (FormData) => Promise<{ url } | void>. The FormData
  // carries the processed file under the spec's field name; on success the action
  // returns the new (cache-busted) public URL.
  action: (formData: FormData) => Promise<{ url: string } | undefined | void>;
}) {
  const spec = SPEC[kind];
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (f: File) => {
      setError(null);
      setSaved(false);
      if (!ACCEPT.includes(f.type)) {
        setError("Use a PNG, JPEG, WebP, SVG, or GIF.");
        return;
      }
      if (f.size > MAX_BYTES) {
        setError("File must be 2 MB or smaller.");
        return;
      }
      // SVG: keep the vector as-is (scales losslessly, transparency preserved).
      if (f.type === "image/svg+xml") {
        setFile(f);
        setPreview(URL.createObjectURL(f));
        return;
      }
      try {
        const processed = await resizeToBox(f, spec.box, kind);
        setFile(processed);
        setPreview(URL.createObjectURL(processed));
      } catch {
        setError("Couldn't process that image. Try a different file.");
      }
    },
    [spec.box, kind],
  );

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const fd = new FormData();
      fd.append(spec.field, file, file.name);
      const res = await action(fd);
      // The action returns the new cache-busted URL (it no longer redirects).
      // Show it as the preview, clear the pending file, and refresh the rest of
      // the page (live preview / logo URL field) with fresh server data.
      setFile(null);
      if (res?.url) setPreview(res.url);
      setSaved(true);
      router.refresh();
    } catch (e) {
      if (isRedirect(e)) throw e;
      setError("Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{spec.label}</div>
          <p className="mt-0.5 text-xs text-slate-500">{spec.hint}</p>
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
          dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50 hover:border-slate-400"
        }`}
      >
        {preview ? (
          <div
            className={`flex items-center justify-center rounded-md border border-slate-200 bg-[linear-gradient(45deg,#f1f5f9_25%,transparent_25%),linear-gradient(-45deg,#f1f5f9_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f1f5f9_75%),linear-gradient(-45deg,transparent_75%,#f1f5f9_75%)] bg-[length:12px_12px] bg-white p-2 ${
              kind === "square" ? "h-20 w-20" : "h-16 w-48"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" className="max-h-full max-w-full object-contain" />
          </div>
        ) : (
          <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-200 text-slate-500" aria-hidden>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </span>
        )}
        <div className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">Drag &amp; drop</span> or click to choose
        </div>
        <div className="text-xs text-slate-400">PNG, SVG, JPEG, WebP · up to 2 MB</div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT.join(",")}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </div>

      {error && <div className="banner-error">{error}</div>}

      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary" disabled={!file || busy} onClick={submit} aria-busy={busy}>
          {busy ? "Uploading…" : "Save logo"}
        </button>
        {file && !busy && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setFile(null);
              setPreview(currentUrl ?? null);
              setError(null);
            }}
          >
            Cancel
          </button>
        )}
        {saved && !file && !busy && (
          <span className="text-sm text-emerald-600">Logo updated.</span>
        )}
      </div>
    </div>
  );
}

/**
 * Draw a raster image onto a transparent canvas sized to fit the target box
 * (contain), then export PNG so transparency is preserved. For square logos we
 * center the image in a fixed square; for wide logos we keep the scaled bounds
 * (capped to the box) so the lockup isn't letterboxed.
 */
async function resizeToBox(file: File, box: [number, number], kind: Kind): Promise<File> {
  const img = await loadImage(URL.createObjectURL(file));
  const [boxW, boxH] = box;
  const scale = Math.min(boxW / img.width, boxH / img.height, 1);
  const drawW = Math.round(img.width * scale);
  const drawH = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  if (kind === "square") {
    canvas.width = boxW;
    canvas.height = boxH;
  } else {
    canvas.width = drawW;
    canvas.height = drawH;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas context");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const dx = Math.round((canvas.width - drawW) / 2);
  const dy = Math.round((canvas.height - drawH) / 2);
  ctx.drawImage(img, dx, dy, drawW, drawH);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("export failed");
  const name = file.name.replace(/\.[^.]+$/, "") + ".png";
  return new File([blob], name, { type: "image/png" });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
