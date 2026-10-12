// The product name in running text, titles, emails and accessible names (owner decision 2026-10-12, OPEN_QUESTIONS.md
// D86). The logo keeps its own uppercase CHARA / PINNACLE lock-up; feature names such as CHARA Passport and the
// technical identifiers (CHARA_* error codes, chara_* cookies) are not this name.
export const BRAND_NAME = "Chara Pinnacle";

export function copyrightLine(): string {
  return `© ${new Date().getFullYear()} ${BRAND_NAME}`;
}
