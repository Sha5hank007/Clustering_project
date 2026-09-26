import { useEffect, useState } from 'react';

interface AuthenticatedImageProps {
  src: string | undefined;
  alt: string;
  style?: React.CSSProperties;
}

export default function AuthenticatedImage({ src, alt, style }: AuthenticatedImageProps) {
  const [imageSrc, setImageSrc] = useState<string>();

  useEffect(() => {
    let objectUrl: string | undefined;
    const controller = new AbortController();

    if (!src) {
      setImageSrc(undefined);
      return () => controller.abort();
    }

    fetch(src, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
      .then(response => {
        if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
        return response.blob();
      })
      .then(blob => {
        objectUrl = URL.createObjectURL(blob);
        setImageSrc(objectUrl);
      })
      .catch(error => {
        if (error.name !== 'AbortError') setImageSrc(undefined);
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return imageSrc ? <img src={imageSrc} alt={alt} style={style} /> : null;
}