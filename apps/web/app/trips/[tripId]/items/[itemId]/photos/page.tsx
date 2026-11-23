import type { Metadata } from "next";
import { photoDisplay } from "../../../../../../lib/photo-display";
import { loadItemPhotos } from "../../../../../../lib/server/photos";
import { PhotoUploadForm } from "./photo-upload-form";
import "../../../../../settings/settings.css";

export const metadata: Metadata = { title: "照片" };
export const dynamic = "force-dynamic";

export default async function ItemPhotosPage({ params }: { params: Promise<{ tripId: string; itemId: string }> }) {
  const { tripId, itemId } = await params;
  const view = await loadItemPhotos(tripId, itemId);
  return (
    <main className="settings">
      <h1>照片</h1>
      {view.state === "signed_out" ? <p>請先登入。</p> : null}
      {view.state === "not_found" ? <p>找不到這個項目，或你不是此行程的成員。</p> : null}
      {view.state === "ok" ? <PhotoSection view={view} /> : null}
    </main>
  );
}

function PhotoSection({ view }: { view: Extract<Awaited<ReturnType<typeof loadItemPhotos>>, { state: "ok" }> }) {
  const display = photoDisplay(view.item, view.photos);
  return (
    <>
      <h2 className="item-name">{view.item.name_zh}</h2>
      {display.kind === "photos" ? (
        <ul className="photo-list" aria-label="照片">
          {display.photos.map((p) => (
            <li key={p.url}>
              <figure>
                {/* 同源 route handler 提供，已移除 EXIF */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.alt} loading="lazy" />
                <figcaption>
                  {p.sourceUrl ? (
                    <a href={p.sourceUrl} rel="noopener noreferrer" target="_blank">
                      {p.credit}
                    </a>
                  ) : (
                    p.credit
                  )}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      ) : (
        <div className="no-photo" aria-label="沒有照片">
          <p className="no-photo-title" lang="ja">
            {display.title}
          </p>
          {display.lines.map((line) => (
            <p key={line} lang="ja">
              {line}
            </p>
          ))}
        </div>
      )}
      {view.canUpload ? <PhotoUploadForm tripId={view.tripId} itemId={view.itemId} /> : null}
    </>
  );
}
