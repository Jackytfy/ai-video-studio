export interface PexelsVideo {
  id: number;
  url: string;
  duration: number;
  width: number;
  height: number;
  image: string;
  video_files: Array<{
    id: number;
    quality: string;
    file_type: string;
    width: number;
    height: number;
    link: string;
  }>;
}

export interface PexelsImage {
  id: number;
  url: string;
  width: number;
  height: number;
  src: {
    original: string;
    large: string;
    medium: string;
    small: string;
  };
}

export async function searchVideos(
  query: string,
  perPage: number = 10
): Promise<PexelsVideo[]> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY not configured");

  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`,
    { headers: { Authorization: apiKey } }
  );

  if (!res.ok) throw new Error("Pexels API error");

  const data = await res.json();
  return data.videos || [];
}

export async function searchImages(
  query: string,
  perPage: number = 10
): Promise<PexelsImage[]> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY not configured");

  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}`,
    { headers: { Authorization: apiKey } }
  );

  if (!res.ok) throw new Error("Pexels API error");

  const data = await res.json();
  return data.photos || [];
}
