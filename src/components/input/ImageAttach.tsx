import { X } from 'lucide-react';

interface ImageAttachProps {
  images: string[];
  onRemove: (index: number) => void;
  showContextHint?: boolean;
}

export function ImageAttach({ images, onRemove, showContextHint = false }: ImageAttachProps) {
  if (images.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-text-secondary">
          {images.length} image{images.length === 1 ? '' : 's'} attached
        </p>
        {showContextHint && (
          <p className="text-[10px] text-text-tertiary">
            Saved to `.context/attachments.md` in workspace runs
          </p>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {images.map((src, index) => (
          <div key={index} className="relative flex-shrink-0 group">
            <img
              src={src}
              alt={`Attachment ${index + 1}`}
              className="h-12 w-12 rounded-lg border border-border object-cover"
            />
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-bg-elevated text-text-tertiary opacity-0 transition-colors group-hover:opacity-100 hover:bg-bg-hover hover:text-text-primary"
              aria-label={`Remove image ${index + 1}`}
              title="Remove image"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
