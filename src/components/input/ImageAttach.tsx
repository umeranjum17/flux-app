import { X } from 'lucide-react';

interface ImageAttachProps {
  images: string[];
  onRemove: (index: number) => void;
}

export function ImageAttach({ images, onRemove }: ImageAttachProps) {
  if (images.length === 0) return null;

  return (
    <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
      {images.map((src, index) => (
        <div key={index} className="relative flex-shrink-0 group">
          <img
            src={src}
            alt={`Attachment ${index + 1}`}
            className="w-12 h-12 rounded-lg object-cover border border-border"
          />
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-bg-elevated border border-border flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors opacity-0 group-hover:opacity-100"
            aria-label={`Remove image ${index + 1}`}
            title="Remove image"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
