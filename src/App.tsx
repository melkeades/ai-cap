import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDebouncedPerKeySaver } from './lib/debounce';
import { clampIndex, parseOneBasedJump } from './lib/pagination';
import type { DatasetItem, ScanMode } from './types';

type View = 'loading' | 'splash' | 'editor';

function App() {
  const [view, setView] = useState<View>('loading');
  const [folder, setFolder] = useState<string | null>(null);
  const [mode, setMode] = useState<ScanMode>('recursive');
  const [items, setItems] = useState<DatasetItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [jumpInput, setJumpInput] = useState('1');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const textareaRefs = useRef<Array<HTMLTextAreaElement | null>>([]);

  const saveController = useMemo(
    () =>
      createDebouncedPerKeySaver(250, async (txtPath, text) => {
        try {
          await window.datasetApi.saveText({ txtPath, text });
          setSaveErrors((current) => {
            if (!current[txtPath]) {
              return current;
            }

            const next = { ...current };
            delete next[txtPath];
            return next;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to save file.';
          setSaveErrors((current) => ({ ...current, [txtPath]: message }));
        }
      }),
    []
  );

  const selectAndLoadFolder = useCallback(
    async (selectedFolder: string, selectedMode: ScanMode) => {
      setView('loading');
      setStatusMessage(null);

      try {
        const scannedItems = await window.datasetApi.scanDataset({
          folder: selectedFolder,
          mode: selectedMode
        });

        setFolder(selectedFolder);
        setItems(scannedItems);
        setCurrentIndex(0);
        setJumpInput(scannedItems.length > 0 ? '1' : '0');
        setSaveErrors({});
        setImageErrors({});
        setView('editor');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read folder.';
        setStatusMessage(`Unable to scan folder: ${message}`);
        setFolder(null);
        setItems([]);
        setView('splash');
      }
    },
    []
  );

  const handleFolderPick = useCallback(async () => {
    const selected = await window.datasetApi.selectFolder();
    if (!selected) {
      return;
    }

    await selectAndLoadFolder(selected, mode);
  }, [mode, selectAndLoadFolder]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const initialFolder = await window.datasetApi.getInitialFolder();
      if (!mounted) {
        return;
      }

      if (!initialFolder) {
        setView('splash');
        return;
      }

      await selectAndLoadFolder(initialFolder, 'recursive');
    })();

    return () => {
      mounted = false;
    };
  }, [selectAndLoadFolder]);

  const goToIndex = useCallback(
    (targetIndex: number) => {
      const clamped = clampIndex(targetIndex, items.length);
      setCurrentIndex(clamped);
      setJumpInput(String(clamped + 1));

      const card = itemRefs.current[clamped];
      card?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });

      requestAnimationFrame(() => {
        const textarea = textareaRefs.current[clamped];
        textarea?.focus();
        textarea?.select();
      });
    },
    [items.length]
  );

  const refreshDataset = useCallback(async () => {
    if (!folder) {
      return;
    }

    await selectAndLoadFolder(folder, mode);
  }, [folder, mode, selectAndLoadFolder]);

  const handleTextChange = useCallback(
    (index: number, nextText: string) => {
      setItems((current) => {
        const next = [...current];
        const item = next[index];
        if (!item) {
          return current;
        }

        next[index] = { ...item, currentText: nextText };
        return next;
      });

      const item = items[index];
      if (item) {
        saveController.scheduleSave(item.txtPath, nextText);
      }
    },
    [items, saveController]
  );

  const handleRestore = useCallback(
    async (index: number) => {
      const item = items[index];
      if (!item) {
        return;
      }

      setItems((current) => {
        const next = [...current];
        const existing = next[index];
        if (!existing) {
          return current;
        }

        next[index] = { ...existing, currentText: existing.originalText };
        return next;
      });

      try {
        await saveController.flushSave(item.txtPath, item.originalText);
      } catch {
        // Error state is set by saver callback.
      }
    },
    [items, saveController]
  );

  useEffect(() => {
    const keydownHandler = (event: KeyboardEvent) => {
      if (event.key !== 'PageDown' || items.length === 0) {
        return;
      }

      event.preventDefault();
      goToIndex(currentIndex + 1);
    };

    window.addEventListener('keydown', keydownHandler, { passive: false });
    return () => window.removeEventListener('keydown', keydownHandler);
  }, [currentIndex, goToIndex, items.length]);

  useEffect(() => {
    if (items.length === 0) {
      return;
    }

    const updateNearest = () => {
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      itemRefs.current.forEach((element, index) => {
        if (!element) {
          return;
        }

        const top = element.getBoundingClientRect().top;
        const distance = Math.abs(top);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      setCurrentIndex(nearestIndex);
      setJumpInput(String(nearestIndex + 1));
    };

    const observer = new IntersectionObserver(updateNearest, {
      threshold: [0, 0.25, 0.5, 0.75, 1]
    });

    for (const element of itemRefs.current) {
      if (element) {
        observer.observe(element);
      }
    }

    window.addEventListener('scroll', updateNearest, { passive: true });
    updateNearest();

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', updateNearest);
    };
  }, [items.length]);

  const totalItems = items.length;

  if (view === 'loading') {
    return (
      <main className="centered-shell">
        <section className="card splash-card">
          <h1>Dataset Pair Editor</h1>
          <p>Loading...</p>
        </section>
      </main>
    );
  }

  if (view === 'splash') {
    return (
      <main className="centered-shell">
        <section className="card splash-card">
          <h1>Dataset Pair Editor</h1>
          <p>Select a folder with `.webp` and `.txt` pairs to begin.</p>
          {statusMessage ? <p className="error-text">{statusMessage}</p> : null}
          <button type="button" className="primary-btn" onClick={handleFolderPick}>
            Select Folder
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="folder-label" title={folder ?? undefined}>
          {folder}
        </div>
        <div className="toolbar-controls">
          <label htmlFor="scan-mode">Scan mode</label>
          <select
            id="scan-mode"
            value={mode}
            onChange={async (event) => {
              const nextMode = event.target.value as ScanMode;
              setMode(nextMode);
              if (folder) {
                await selectAndLoadFolder(folder, nextMode);
              }
            }}
          >
            <option value="recursive">Recursive</option>
            <option value="top-level">Top-level</option>
          </select>
          <button type="button" className="secondary-btn" onClick={refreshDataset}>
            Reload
          </button>
          <button type="button" className="secondary-btn" onClick={handleFolderPick}>
            Change Folder
          </button>
        </div>
      </header>

      {totalItems === 0 ? (
        <section className="empty-state">
          <p>No `.webp` + `.txt` pairs found for this folder and scan mode.</p>
        </section>
      ) : (
        <section className="items-list" aria-label="Dataset items">
          {items.map((item, index) => (
            <article
              className="item-card"
              key={item.id}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
            >
              <div className="item-meta">
                <div className="item-name">{item.baseName}</div>
                <div className="item-dir">{item.dir}</div>
              </div>

              <div className="item-grid">
                <div className="editor-column">
                  <textarea
                    ref={(node) => {
                      textareaRefs.current[index] = node;
                    }}
                    value={item.currentText}
                    onChange={(event) => handleTextChange(index, event.target.value)}
                    className="editor-textarea"
                    spellCheck
                  />
                  <div className="editor-actions">
                    <button type="button" className="secondary-btn" onClick={() => void handleRestore(index)}>
                      Restore
                    </button>
                    {saveErrors[item.txtPath] ? (
                      <span className="error-text" role="status">
                        Save failed: {saveErrors[item.txtPath]}
                      </span>
                    ) : (
                      <span className="muted-text">Saved automatically</span>
                    )}
                  </div>
                </div>

                <div className="preview-column">
                  {imageErrors[item.id] ? (
                    <div className="image-fallback">Image preview unavailable</div>
                  ) : (
                    <img
                      src={item.webpUrl}
                      alt={item.baseName}
                      loading="lazy"
                      onError={() => {
                        setImageErrors((current) => ({ ...current, [item.id]: true }));
                      }}
                    />
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      <footer className="pager" aria-label="Pagination controls">
        <span>
          {totalItems > 0 ? currentIndex + 1 : 0}/{totalItems}
        </span>
        <input
          value={jumpInput}
          onChange={(event) => setJumpInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') {
              return;
            }

            event.preventDefault();
            if (totalItems === 0) {
              setJumpInput('0');
              return;
            }

            const next = parseOneBasedJump(jumpInput, totalItems);
            goToIndex(next);
          }}
          aria-label="Jump to item"
          inputMode="numeric"
          pattern="[0-9]*"
        />
      </footer>
    </main>
  );
}

export default App;
