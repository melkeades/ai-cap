import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeFittedImageRect,
  isPointInCrop,
  moveCropByDelta,
  normalizeRectFromDrag,
  normalizedToFittedPixels,
  pointToNormalizedInFittedRect,
  resizeCropByDelta,
  type ResizeHandle
} from './lib/crop';
import type { AppFlow, ConvertImagesResult, CropRectNormalized, ImageItem } from './types';

interface ImageConvertFlowProps {
  folder: string | null;
  onSwitchFlow: (flow: AppFlow) => void;
  onChangeFolder: () => Promise<void>;
}

interface CropDragState {
  itemId: string;
  pointerId: number;
  mode: 'draw' | 'move' | 'resize';
  handle?: ResizeHandle;
  startX: number;
  startY: number;
  initialCrop: CropRectNormalized | null;
}

interface ImageNaturalSize {
  width: number;
  height: number;
}

interface PointerInfo {
  localX: number;
  localY: number;
  normalizedX: number;
  normalizedY: number;
}

function ImageConvertFlow({ folder, onSwitchFlow, onChangeFolder }: ImageConvertFlowProps) {
  const [imageItems, setImageItems] = useState<ImageItem[]>([]);
  const [imagePreviewErrors, setImagePreviewErrors] = useState<Record<string, boolean>>({});
  const [imageNaturalSizes, setImageNaturalSizes] = useState<Record<string, ImageNaturalSize>>({});
  const [imageCrops, setImageCrops] = useState<Record<string, CropRectNormalized | null>>({});
  const [imageLoading, setImageLoading] = useState(false);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const [maxSizeInput, setMaxSizeInput] = useState('1440');
  const [isConverting, setIsConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<ConvertImagesResult | null>(null);

  const cropStageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cropDragRef = useRef<CropDragState | null>(null);

  const loadImageItems = useCallback(async () => {
    if (!folder) {
      setImageItems([]);
      return;
    }

    setImageLoading(true);
    setImageStatus(null);

    try {
      const scanned = await window.datasetApi.scanImages({ folder, mode: 'recursive' });
      setImageItems(scanned);
      setImagePreviewErrors({});
      setImageNaturalSizes({});
      setImageCrops({});
      setConvertResult(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read image folder.';
      setImageItems([]);
      setImageStatus(`Unable to scan images: ${message}`);
    } finally {
      setImageLoading(false);
    }
  }, [folder]);

  useEffect(() => {
    void loadImageItems();
  }, [loadImageItems]);

  const getPointerInfo = useCallback(
    (itemId: string, clientX: number, clientY: number): PointerInfo | null => {
      const stage = cropStageRefs.current[itemId];
      const natural = imageNaturalSizes[itemId];
      if (!stage || !natural || natural.width <= 0 || natural.height <= 0) {
        return null;
      }

      const stageRect = stage.getBoundingClientRect();
      const localX = clientX - stageRect.left;
      const localY = clientY - stageRect.top;
      const fitted = computeFittedImageRect(stageRect.width, stageRect.height, natural.width, natural.height);
      const normalized = pointToNormalizedInFittedRect(localX, localY, fitted);

      return {
        localX,
        localY,
        normalizedX: normalized.x,
        normalizedY: normalized.y
      };
    },
    [imageNaturalSizes]
  );

  const getRenderedCropRect = useCallback(
    (itemId: string, crop: CropRectNormalized) => {
      const stage = cropStageRefs.current[itemId];
      const natural = imageNaturalSizes[itemId];
      if (!stage || !natural) {
        return null;
      }

      const fitted = computeFittedImageRect(stage.clientWidth, stage.clientHeight, natural.width, natural.height);
      if (fitted.width <= 0 || fitted.height <= 0) {
        return null;
      }

      return normalizedToFittedPixels(crop, fitted);
    },
    [imageNaturalSizes]
  );

  const detectResizeHandle = useCallback(
    (itemId: string, crop: CropRectNormalized, localX: number, localY: number): ResizeHandle | null => {
      const rect = getRenderedCropRect(itemId, crop);
      if (!rect) {
        return null;
      }

      const threshold = 8;
      const nearLeft = Math.abs(localX - rect.x) <= threshold;
      const nearRight = Math.abs(localX - (rect.x + rect.width)) <= threshold;
      const nearTop = Math.abs(localY - rect.y) <= threshold;
      const nearBottom = Math.abs(localY - (rect.y + rect.height)) <= threshold;

      const withinX = localX >= rect.x - threshold && localX <= rect.x + rect.width + threshold;
      const withinY = localY >= rect.y - threshold && localY <= rect.y + rect.height + threshold;

      if (nearLeft && nearTop) return 'nw';
      if (nearRight && nearTop) return 'ne';
      if (nearLeft && nearBottom) return 'sw';
      if (nearRight && nearBottom) return 'se';
      if (nearTop && withinX) return 'n';
      if (nearBottom && withinX) return 's';
      if (nearLeft && withinY) return 'w';
      if (nearRight && withinY) return 'e';

      return null;
    },
    [getRenderedCropRect]
  );

  const handleCropPointerDown = useCallback(
    (itemId: string, event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      const pointer = getPointerInfo(itemId, event.clientX, event.clientY);
      if (!pointer) {
        return;
      }

      const existingCrop = imageCrops[itemId] ?? null;
      let mode: CropDragState['mode'] = 'draw';
      let handle: ResizeHandle | undefined;

      if (existingCrop) {
        const hitHandle = detectResizeHandle(itemId, existingCrop, pointer.localX, pointer.localY);
        if (hitHandle) {
          mode = 'resize';
          handle = hitHandle;
        } else if (isPointInCrop(pointer.normalizedX, pointer.normalizedY, existingCrop)) {
          mode = 'move';
        }
      }

      if (mode === 'draw') {
        setImageCrops((current) => ({
          ...current,
          [itemId]: normalizeRectFromDrag(pointer.normalizedX, pointer.normalizedY, pointer.normalizedX, pointer.normalizedY)
        }));
      }

      cropDragRef.current = {
        itemId,
        pointerId: event.pointerId,
        mode,
        handle,
        startX: pointer.normalizedX,
        startY: pointer.normalizedY,
        initialCrop: existingCrop
      };

      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [detectResizeHandle, getPointerInfo, imageCrops]
  );

  const handleCropPointerMove = useCallback(
    (itemId: string, event: React.PointerEvent<HTMLDivElement>) => {
      const drag = cropDragRef.current;
      if (!drag || drag.itemId !== itemId || drag.pointerId !== event.pointerId) {
        return;
      }

      const pointer = getPointerInfo(itemId, event.clientX, event.clientY);
      if (!pointer) {
        return;
      }

      let nextCrop: CropRectNormalized | null = null;
      if (drag.mode === 'draw') {
        nextCrop = normalizeRectFromDrag(drag.startX, drag.startY, pointer.normalizedX, pointer.normalizedY);
      } else if (drag.mode === 'move' && drag.initialCrop) {
        nextCrop = moveCropByDelta(
          drag.initialCrop,
          pointer.normalizedX - drag.startX,
          pointer.normalizedY - drag.startY
        );
      } else if (drag.mode === 'resize' && drag.initialCrop && drag.handle) {
        nextCrop = resizeCropByDelta(
          drag.initialCrop,
          drag.handle,
          pointer.normalizedX - drag.startX,
          pointer.normalizedY - drag.startY
        );
      }

      if (nextCrop) {
        setImageCrops((current) => ({
          ...current,
          [itemId]: nextCrop
        }));
      }

      event.preventDefault();
    },
    [getPointerInfo]
  );

  const clearCropDrag = useCallback(() => {
    cropDragRef.current = null;
  }, []);

  const handleConvert = useCallback(async () => {
    if (!folder || isConverting) {
      return;
    }

    const parsed = Number.parseInt(maxSizeInput, 10);
    const maxSize = Number.isFinite(parsed) && parsed > 0 ? parsed : 1440;
    setMaxSizeInput(String(maxSize));

    setIsConverting(true);
    setImageStatus(null);

    try {
      const result = await window.datasetApi.convertImages({
        folder,
        maxSize,
        crops: imageCrops
      });
      setConvertResult(result);

      if (result.failed === 0) {
        setImageStatus(`Converted ${result.succeeded}/${result.total} images to ${result.outputRoot}`);
      } else {
        setImageStatus(`Converted ${result.succeeded}/${result.total}. ${result.failed} failed.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image conversion failed.';
      setImageStatus(`Conversion failed: ${message}`);
    } finally {
      setIsConverting(false);
    }
  }, [folder, imageCrops, isConverting, maxSizeInput]);

  const hasImages = imageItems.length > 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="folder-label" title={folder ?? undefined}>
          {folder}
        </div>
        <div className="toolbar-controls">
          <div className="flow-tabs" role="tablist" aria-label="App flow mode">
            <button
              type="button"
              role="tab"
              aria-selected={false}
              className="flow-tab"
              onClick={() => onSwitchFlow('dataset-editor')}
            >
              Dataset Editor
            </button>
            <button type="button" role="tab" aria-selected className="flow-tab is-active">
              Image Convert
            </button>
          </div>

          <label htmlFor="max-size">Max size</label>
          <input
            id="max-size"
            className="max-size-input"
            value={maxSizeInput}
            onChange={(event) => setMaxSizeInput(event.target.value)}
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="Maximum output size"
          />
          <button type="button" className="primary-btn" onClick={() => void handleConvert()} disabled={isConverting || !hasImages}>
            {isConverting ? 'Converting...' : 'Convert'}
          </button>
          <button type="button" className="secondary-btn" onClick={() => void loadImageItems()}>
            Reload
          </button>
          <button type="button" className="secondary-btn" onClick={() => void onChangeFolder()}>
            Change Folder
          </button>
        </div>
      </header>

      <section className="image-flow-shell" aria-label="Image crop and convert">
        {imageStatus ? <p className="status-text">{imageStatus}</p> : null}

        {imageLoading ? (
          <section className="empty-state">
            <p>Loading images...</p>
          </section>
        ) : !hasImages ? (
          <section className="empty-state">
            <p>No supported images found (`png`, `jpg`, `jpeg`, `webp`, `gif`).</p>
          </section>
        ) : (
          <section className="image-grid">
            {imageItems.map((item) => {
              const crop = imageCrops[item.id];
              const renderedCrop = crop ? getRenderedCropRect(item.id, crop) : null;

              return (
                <article className="image-card" key={item.id}>
                  <div className="item-meta">
                    <div className="item-name">{item.baseName}</div>
                    <div className="item-dir">
                      {item.relDir ? `${item.relDir}${item.relDir.endsWith('/') ? '' : '/'}${item.baseName}${item.ext}` : `${item.baseName}${item.ext}`}
                    </div>
                  </div>

                  <div
                    className="image-crop-stage"
                    ref={(node) => {
                      cropStageRefs.current[item.id] = node;
                    }}
                    onPointerDown={(event) => handleCropPointerDown(item.id, event)}
                    onPointerMove={(event) => handleCropPointerMove(item.id, event)}
                    onPointerUp={(event) => {
                      if (cropDragRef.current?.itemId === item.id && cropDragRef.current.pointerId === event.pointerId) {
                        clearCropDrag();
                      }
                    }}
                    onPointerCancel={clearCropDrag}
                  >
                    {imagePreviewErrors[item.id] ? (
                      <div className="image-fallback">Image preview unavailable</div>
                    ) : (
                      <img
                        className="image-crop-preview"
                        src={item.sourceUrl}
                        alt={item.baseName}
                        loading="lazy"
                        onLoad={(event) => {
                          const target = event.currentTarget;
                          setImageNaturalSizes((current) => ({
                            ...current,
                            [item.id]: {
                              width: target.naturalWidth,
                              height: target.naturalHeight
                            }
                          }));
                        }}
                        onError={() => {
                          setImagePreviewErrors((current) => ({ ...current, [item.id]: true }));
                        }}
                      />
                    )}

                    {crop && renderedCrop ? (
                      <div
                        className="crop-rect"
                        style={{
                          left: `${renderedCrop.x}px`,
                          top: `${renderedCrop.y}px`,
                          width: `${renderedCrop.width}px`,
                          height: `${renderedCrop.height}px`
                        }}
                      >
                        <div className="crop-handle nw" />
                        <div className="crop-handle ne" />
                        <div className="crop-handle sw" />
                        <div className="crop-handle se" />
                        <div className="crop-handle n" />
                        <div className="crop-handle s" />
                        <div className="crop-handle e" />
                        <div className="crop-handle w" />
                      </div>
                    ) : null}
                  </div>

                  <div className="editor-actions">
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => {
                        setImageCrops((current) => ({ ...current, [item.id]: null }));
                      }}
                    >
                      Clear Crop
                    </button>
                    {crop ? <span className="muted-text">Crop active</span> : <span className="muted-text">No crop</span>}
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {convertResult ? (
          <section className="convert-summary card">
            <h3>Conversion Summary</h3>
            <p>
              {convertResult.succeeded}/{convertResult.total} converted, {convertResult.failed} failed.
            </p>
            <p>Output: {convertResult.outputRoot}</p>
            {convertResult.warnings.length > 0 ? (
              <div>
                <strong>Warnings:</strong>
                <ul className="result-list">
                  {convertResult.warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {convertResult.failures.length > 0 ? (
              <div>
                <strong>Failures:</strong>
                <ul className="result-list">
                  {convertResult.failures.map((failure) => (
                    <li key={`${failure.sourcePath}-${failure.message}`}>
                      {failure.sourcePath}: {failure.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}
      </section>
    </main>
  );
}

export default ImageConvertFlow;

