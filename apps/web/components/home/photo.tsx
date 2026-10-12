import { preload } from "react-dom";
import { photos, photoSrcSet, type PhotoName } from "@/lib/public/photos";
import { cn } from "@/lib/utils";

type PhotoProps = { name: PhotoName; sizes: string; className?: string; priority?: boolean };

// A plain picture, because next/image writes a style attribute, which the CSP blocks (style-src-attr). It fills the
// positioned box around it, behind the box's content. Only the hero is a priority (eager, high fetch priority and the
// preload of preloadPhoto); every other picture is lazy and loads as it nears the screen.
export function Photo({ name, sizes, className, priority = false }: PhotoProps) {
  const { width, height } = photos[name];
  const webp = photoSrcSet(name, "webp");
  return (
    <picture className="absolute inset-0 -z-20">
      <source type="image/webp" srcSet={webp} sizes={sizes} />
      <img
        src={`/images/home/${name}-1280.jpg`}
        srcSet={photoSrcSet(name, "jpg")}
        sizes={sizes}
        width={width}
        height={height}
        alt=""
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        className={cn("size-full object-cover", className)}
      />
    </picture>
  );
}

// The preload of a priority picture, with the same sources and sizes, so that the browser fetches the one file it will
// show. It must be called before the page waits for its data: a hint given later reaches the browser only after the head
// has been sent, as data for the client runtime instead of a link in the head.
export function preloadPhoto(name: PhotoName, sizes: string) {
  preload(`/images/home/${name}-1920.webp`, { as: "image", type: "image/webp", imageSrcSet: photoSrcSet(name, "webp"), imageSizes: sizes, fetchPriority: "high" });
}
