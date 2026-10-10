// supabase-js is 220 KB: it loads when the first read or upload needs it, not with the first load of the page.
export async function createLazyClient() {
  const { createClient } = await import("@/lib/supabase/browser");
  return createClient();
}
