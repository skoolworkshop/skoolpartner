import Image from "next/image";

import { findWorkshopImage, type WorkshopImageMap } from "@/lib/workshop-images";
import { cn } from "@/lib/utils";

/**
 * De foto die bij een workshopsoort hoort. Is er geen passende foto, dan komt
 * er een rustig vlak in de huisstijl in plaats van een verkeerd beeld.
 */
export function WorkshopPhoto({
  workshopName,
  images,
  className,
  sizes = "(min-width: 1024px) 480px, 100vw",
  priority = false,
}: {
  workshopName: string | null | undefined;
  images: WorkshopImageMap;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const src = findWorkshopImage(workshopName, images);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-card bg-ink",
        className ?? "aspect-[16/7]"
      )}
    >
      {src ? (
        <Image
          src={src}
          alt=""
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="size-full"
          style={{
            background:
              "radial-gradient(120% 140% at 15% 0%, rgb(244 151 0 / 0.35) 0%, transparent 60%), #111111",
          }}
        />
      )}
    </div>
  );
}

/** Kleine variant voor lijsten. */
export function WorkshopThumb({
  workshopName,
  images,
}: {
  workshopName: string | null | undefined;
  images: WorkshopImageMap;
}) {
  return (
    <WorkshopPhoto
      workshopName={workshopName}
      images={images}
      sizes="88px"
      className="size-[72px] shrink-0 rounded-card sm:size-[88px]"
    />
  );
}
