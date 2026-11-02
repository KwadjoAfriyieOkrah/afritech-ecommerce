'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { ApiError } from '@/services/api';
import { deleteProductImage, uploadProductImage } from '@/services/adminApi';

interface ProductImagesProps {
  productId: string;
  initialImages: string[];
}

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TYPE_ERROR = 'Choose a JPEG, PNG or WebP image.';
const SIZE_ERROR = 'Image must be under 5MB.';

export function ProductImages({
  productId,
  initialImages
}: ProductImagesProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState(initialImages);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const atLimit = images.length >= MAX_IMAGES;

  const handleAddClick = (): void => {
    if (isUploading || atLimit) return;
    setError(null);
    inputRef.current?.click();
  };

  const handleFileChange = async (
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    if (!ACCEPTED_TYPES.has(file.type)) {
      setError(TYPE_ERROR);
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setError(SIZE_ERROR);
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const updatedImages = await uploadProductImage(productId, file);
      setImages(updatedImages);
    } catch (caught) {
      setError(ApiError.from(caught).message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = async (index: number): Promise<void> => {
    if (isUploading) return;
    if (!window.confirm('Remove this image?')) return;

    setError(null);
    setIsUploading(true);

    try {
      const updatedImages = await deleteProductImage(productId, index);
      setImages(updatedImages);
    } catch (caught) {
      setError(ApiError.from(caught).message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleReplace = async (index: number): Promise<void> => {
    if (isUploading) return;
    if (
      !window.confirm('Replace this image? The current image will be removed first.')
    ) {
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const updatedImages = await deleteProductImage(productId, index);
      setImages(updatedImages);
    } catch (caught) {
      setError(ApiError.from(caught).message);
      setIsUploading(false);
      return;
    }

    setIsUploading(false);
    inputRef.current?.click();
  };

  return (
    <section className="card flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">Images</h2>
          <p className="text-sm text-stone-500">
            {images.length} of {MAX_IMAGES}
          </p>
        </div>
        <button
          type="button"
          onClick={handleAddClick}
          disabled={isUploading || atLimit}
          className="btn btn-outline text-xs"
        >
          {isUploading ? 'Uploading...' : 'Add image'}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => void handleFileChange(event)}
        className="hidden"
      />

      {error && (
        <div role="alert" className="alert-error">
          {error}
        </div>
      )}

      {images.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image, index) => (
            <li
              key={`${image}-${index}`}
              className="overflow-hidden rounded-lg border border-stone-200 bg-stone-50"
            >
              <div className="relative aspect-square">
                <img
                  src={image}
                  alt={`Product image ${index + 1}`}
                  className="h-full w-full object-contain p-2"
                />
                <span className="absolute left-2 top-2 rounded-full bg-stone-900/80 px-2 py-0.5 text-xs font-semibold text-white">
                  {index + 1}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-stone-200 bg-white px-2 py-2">
                <button
                  type="button"
                  onClick={() => void handleRemove(index)}
                  disabled={isUploading}
                  className="text-xs font-semibold text-red-700 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => void handleReplace(index)}
                  disabled={isUploading}
                  className="text-xs font-semibold text-dark-gold hover:underline disabled:opacity-50"
                >
                  Replace
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-stone-500">No images yet.</p>
      )}
    </section>
  );
}
