import { photos, photoSrcSet, type PhotoName } from "@/lib/public/photos";
import { cn } from "@/lib/utils";

type PhotoProps = { name: PhotoName; sizes: string; className?: string; priority?: boolean };

// A plain picture, because next/image writes a style attribute, which the CSP blocks (style-src-attr). It fills the
// positioned box around it, behind the box's content. Only the hero is a priority (eager, high fetch priority and the
// preload of preloadHeroPhoto); every other picture is lazy and loads as it nears the screen.
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
