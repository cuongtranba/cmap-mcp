/**
 * Fold text for diacritic-insensitive matching: NFD, strip combining marks, đ/Đ -> d, lowercase,
 * collapse whitespace. "Hà Nội  mưa rơi" -> "ha noi mua roi".
 */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
