/** 极简 className 合并（避免引 clsx/tailwind-merge，简化版够用）。 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
