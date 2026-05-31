/**
 * Pixabay API client for royalty-free video/image search.
 * No watermarks on downloaded content.
 */

export interface PixabayVideo {
  id: number;
  pageURL: string;
  picture_id: string;
  videos: {
    large: { url: string; width: number; height: number; size: number };
    medium: { url: string; width: number; height: number; size: number };
    small: { url: string; width: number; height: number; size: number };
    tiny: { url: string; width: number; height: number; size: number };
  };
  duration: number;
  views: number;
  downloads: number;
  likes: number;
  tags: string;
}

export interface PixabayImage {
  id: number;
  pageURL: string;
  largeImageURL: string;
  webformatURL: string;
  imageWidth: number;
  imageHeight: number;
  views: number;
  downloads: number;
  likes: number;
  tags: string;
}

export async function searchPixabayVideos(
  query: string,
  perPage: number = 10
): Promise<PixabayVideo[]> {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) throw new Error("PIXABAY_API_KEY not configured");

  const res = await fetch(
    `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=${perPage}&min_width=1280&video_type=film`,
    { signal: AbortSignal.timeout(10000) }
  );

  if (!res.ok) throw new Error(`Pixabay API error: ${res.status}`);

  const data = await res.json();
  return data.hits || [];
}

export async function searchPixabayImages(
  query: string,
  perPage: number = 10
): Promise<PixabayImage[]> {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) throw new Error("PIXABAY_API_KEY not configured");

  const res = await fetch(
    `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=${perPage}&min_width=1280&image_type=photo`,
    { signal: AbortSignal.timeout(10000) }
  );

  if (!res.ok) throw new Error(`Pixabay API error: ${res.status}`);

  const data = await res.json();
  return data.hits || [];
}
