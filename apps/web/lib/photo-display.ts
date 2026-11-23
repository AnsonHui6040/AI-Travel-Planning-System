// T21、D14：離線照片的顯示資料。有照片時附來源標示；沒有照片時顯示當地名稱與地址

export interface PhotoInput {
  url: string | null;
  source: "user_upload" | "wikimedia_commons";
  license: string;
  author: string;
  source_url: string | null;
}

export type PhotoView =
  | { kind: "photos"; photos: { url: string; alt: string; credit: string; sourceUrl: string | null }[] }
  | { kind: "fallback"; title: string; lines: string[] };

export function photoDisplay(
  item: { name_zh: string; name_local: string | null; address: string | null },
  photos: readonly PhotoInput[],
): PhotoView {
  const shown = photos.flatMap((p) =>
    p.url === null
      ? []
      : [
          {
            url: p.url,
            alt: item.name_zh,
            credit: p.source === "wikimedia_commons" ? `照片：${p.author}（${p.license}，Wikimedia Commons）` : `照片：${p.author}`,
            sourceUrl: p.source === "wikimedia_commons" ? p.source_url : null,
          },
        ],
  );
  if (shown.length > 0) return { kind: "photos", photos: shown };
  return { kind: "fallback", title: item.name_local ?? item.name_zh, lines: item.address ? [item.address] : [] };
}
