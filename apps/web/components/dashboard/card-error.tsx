"use client";

import { useRouter } from "next/navigation";
import { LoadError } from "@/components/feedback/load-error";

// A card whose read failed: the other cards of the page keep their numbers, and Try again renders the page afresh.
export function CardError({ title }: { title: string }) {
  const router = useRouter();
  return <LoadError title={title} retry={() => router.refresh()} />;
}
