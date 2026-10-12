// The licensed photographs of the home page (Unsplash License, docs/assets/photo-credits.md). The files are in
// public/images/home as <name>-<width>.webp and .jpg; width and height are those of the largest file, so that the page
// keeps the space of a picture before it loads. The people shown illustrate industries: they are never named or presented
// as customers or workers of the platform, which is why every picture is decoration with an empty alt.
export const photos = {
  "hero-welder": { width: 2400, height: 1600, widths: [640, 1280, 1920, 2400], subject: "Welding", photographer: "Rob Lambert", page: "https://unsplash.com/photos/9Q_pLLP_jmA" },
  "healthcare-nurse": { width: 1920, height: 1080, widths: [640, 1280, 1920], subject: "Healthcare", photographer: "CDC", page: "https://unsplash.com/photos/fpPf0lxu0-4" },
  "construction-team": { width: 1920, height: 1280, widths: [640, 1280, 1920], subject: "Construction", photographer: "Scott Blake", page: "https://unsplash.com/photos/x-ghf9LjrVg" },
  "logistics-warehouse": { width: 1920, height: 1278, widths: [640, 1280, 1920], subject: "Warehouse", photographer: "Centre for Ageing Better", page: "https://unsplash.com/photos/j3ay5s6Irlk" },
  "hospitality-chef": { width: 1920, height: 1280, widths: [640, 1280, 1920], subject: "Hospitality", photographer: "Johnathan Macedo", page: "https://unsplash.com/photos/4NQEvxW2_4w" },
  "transport-truck": { width: 1920, height: 997, widths: [640, 1280, 1920], subject: "Transport", photographer: "Sander Yigin", page: "https://unsplash.com/photos/ki19VJAGh6w" },
  "employers-handshake": { width: 1920, height: 1282, widths: [640, 1280, 1920], subject: "Handshake", photographer: "Cytonn Photography", page: "https://unsplash.com/photos/n95VMLxqM2I" },
} as const;

export type PhotoName = keyof typeof photos;

export function photoSrcSet(name: PhotoName, format: "webp" | "jpg"): string {
  return photos[name].widths.map((width) => `/images/home/${name}-${width}.${format} ${width}w`).join(", ");
}
