interface MediaAssetProps {
  src: string;
  alt: string;
  className?: string;
}

function isVideo(src: string) {
  const ext = src.split('.').pop()?.toLowerCase();
  return ext === 'mp4' || ext === 'webm' || ext === 'ogg';
}

export function MediaAsset({ src, alt, className }: MediaAssetProps) {
  if (isVideo(src)) {
    return (
      <video
        src={src}
        autoPlay
        muted
        loop
        playsInline
        className={className}
        aria-label={alt}
      />
    );
  }
  return <img src={src} alt={alt} className={className} />;
}
