// T21、D14：Wikimedia Commons 照片的授權、作者、來源必填。
// 規則與 migration 20261124010000_t21_photos.sql 的 photos_commons_source、photos_author_not_blank 相同。

export const COMMONS_LICENSE = /^(CC0 1\.0|CC BY(-SA)? [1-4]\.0|Public domain)$/;
export const COMMONS_SOURCE = /^https:\/\/commons\.wikimedia\.org\/wiki\/File:\S+$/;

export interface CommonsAttribution {
  license: string;
  author: string;
  sourceUrl: string;
}

export function parseCommonsAttribution(
  input: CommonsAttribution,
): { ok: true; value: CommonsAttribution } | { ok: false; error: string } {
  const license = input.license.trim();
  const author = input.author.trim();
  const sourceUrl = input.sourceUrl.trim();
  if (!COMMONS_LICENSE.test(license)) return { ok: false, error: "授權必須是 CC0、CC BY、CC BY-SA 或公有領域" };
  if (author.length === 0 || [...author].length > 200) return { ok: false, error: "作者必填，最多 200 字" };
  if (sourceUrl.length > 2048 || !COMMONS_SOURCE.test(sourceUrl)) return { ok: false, error: "來源必須是 Wikimedia Commons 的檔案頁網址" };
  return { ok: true, value: { license, author, sourceUrl } };
}
