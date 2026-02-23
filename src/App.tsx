import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { insertCompletionAtCursor } from './lib/autocomplete';
import { createDebouncedPerKeySaver } from './lib/debounce';
import { suggestLocalCompletion } from './lib/localAutocomplete';
import { clampIndex, parseOneBasedJump } from './lib/pagination';
import type {
  AutocompleteHealth,
  AutocompleteResponse,
  AutocompleteSettings,
  DatasetItem,
  ScanMode
} from './types';

type View = 'loading' | 'splash' | 'editor';

interface SuggestionState {
  itemId: string;
  completion: string;
  cursorIndex: number;
  baseText: string;
  model: string;
  latencyMs: number;
  source: AutocompleteResponse['source'];
}

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
  const [autocompleteHealth, setAutocompleteHealth] = useState<AutocompleteHealth | null>(null);
  const [autocompleteSettings, setAutocompleteSettings] = useState<AutocompleteSettings | null>(null);
  const [autocompleteModels, setAutocompleteModels] = useState<string[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<AutocompleteSettings | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);

  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const textareaRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const itemsRef = useRef<DatasetItem[]>([]);
  const autocompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocompleteRequestVersionRef = useRef(0);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const clearSuggestion = useCallback(() => {
    autocompleteRequestVersionRef.current += 1;

    if (autocompleteTimerRef.current) {
      clearTimeout(autocompleteTimerRef.current);
      autocompleteTimerRef.current = null;
    }

    setSuggestion(null);
  }, []);

  useEffect(() => {
    return () => {
      if (autocompleteTimerRef.current) {
        clearTimeout(autocompleteTimerRef.current);
        autocompleteTimerRef.current = null;
      }
    };
  }, []);

  const refreshAutocompleteHealth = useCallback(async () => {
    const health = await window.datasetApi.autocompleteHealth();
    setAutocompleteHealth(health);
  }, []);

  const refreshAutocompleteModels = useCallback(async () => {
    try {
      const models = await window.datasetApi.autocompleteListModels();
      setAutocompleteModels(models);
    } catch {
      setAutocompleteModels([]);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const initializeAutocomplete = async () => {
      try {
        const [settings, health, models] = await Promise.all([
          window.datasetApi.autocompleteGetSettings(),
          window.datasetApi.autocompleteHealth(),
          window.datasetApi.autocompleteListModels()
        ]);

        if (!mounted) {
          return;
        }

        setAutocompleteSettings(settings);
        setAutocompleteHealth(health);
        setAutocompleteModels(models);
      } catch {
        if (!mounted) {
          return;
        }

        setAutocompleteHealth({ ok: false, reason: 'Unable to query Ollama autocomplete status' });
      }
    };

    void initializeAutocomplete();
    const interval = setInterval(() => {
      void refreshAutocompleteHealth();
    }, 15000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [refreshAutocompleteHealth]);

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

  const requestOllamaSuggestion = useCallback(
    async (index: number, text: string, cursorIndex: number, version: number) => {
      if (!autocompleteSettings?.enabled || !autocompleteHealth?.ok) {
        return;
      }

      const response = await window.datasetApi.autocompleteSuggest({
        text,
        cursorIndex,
        language: 'en'
      });

      if (version !== autocompleteRequestVersionRef.current) {
        return;
      }

      const currentItem = itemsRef.current[index];
      if (!currentItem || currentItem.currentText !== text) {
        return;
      }

      if (response.timedOut || !response.completion.trim()) {
        return;
      }

      setSuggestion({
        itemId: currentItem.id,
        completion: response.completion,
        cursorIndex,
        baseText: text,
        model: response.model,
        latencyMs: response.latencyMs,
        source: response.source
      });
    },
    [autocompleteHealth?.ok, autocompleteSettings?.enabled]
  );

  const queueSuggestion = useCallback(
    (index: number, text: string, cursorIndex: number, selectionStart: number, selectionEnd: number) => {
      if (!autocompleteSettings?.enabled) {
        setSuggestion(null);
        return;
      }

      if (selectionStart !== selectionEnd) {
        setSuggestion(null);
        return;
      }

      const localCompletion = suggestLocalCompletion({
        texts: itemsRef.current.map((item) => item.currentText),
        text,
        cursorIndex,
        mode: autocompleteSettings.mode
      });

      const currentItem = itemsRef.current[index];
      if (currentItem && localCompletion) {
        setSuggestion({
          itemId: currentItem.id,
          completion: localCompletion,
          cursorIndex,
          baseText: text,
          model: 'local-lexicon',
          latencyMs: 0,
          source: 'local'
        });
      } else {
        setSuggestion(null);
      }

      autocompleteRequestVersionRef.current += 1;
      const version = autocompleteRequestVersionRef.current;

      if (autocompleteTimerRef.current) {
        clearTimeout(autocompleteTimerRef.current);
        autocompleteTimerRef.current = null;
      }

      if (!autocompleteHealth?.ok) {
        return;
      }

      autocompleteTimerRef.current = setTimeout(() => {
        void requestOllamaSuggestion(index, text, cursorIndex, version);
      }, autocompleteSettings.debounceMs);
    },
    [autocompleteHealth?.ok, autocompleteSettings, requestOllamaSuggestion]
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
        clearSuggestion();
        setView('editor');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read folder.';
        setStatusMessage(`Unable to scan folder: ${message}`);
        setFolder(null);
        setItems([]);
        clearSuggestion();
        setView('splash');
      }
    },
    [clearSuggestion]
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
      clearSuggestion();

      const card = itemRefs.current[clamped];
      card?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });

      requestAnimationFrame(() => {
        const textarea = textareaRefs.current[clamped];
        textarea?.focus();
        textarea?.select();
      });
    },
    [clearSuggestion, items.length]
  );

  const refreshDataset = useCallback(async () => {
    if (!folder) {
      return;
    }

    await selectAndLoadFolder(folder, mode);
  }, [folder, mode, selectAndLoadFolder]);

  const handleTextChange = useCallback(
    (index: number, nextText: string, cursorIndex: number, selectionStart: number, selectionEnd: number) => {
      setItems((current) => {
        const next = [...current];
        const item = next[index];
        if (!item) {
          return current;
        }

        next[index] = { ...item, currentText: nextText };
        return next;
      });

      const item = itemsRef.current[index];
      if (!item) {
        return;
      }

      setCurrentIndex(index);
      saveController.scheduleSave(item.txtPath, nextText);
      queueSuggestion(index, nextText, cursorIndex, selectionStart, selectionEnd);
    },
    [queueSuggestion, saveController]
  );

  const handleRestore = useCallback(
    async (index: number) => {
      const item = itemsRef.current[index];
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

      clearSuggestion();

      try {
        await saveController.flushSave(item.txtPath, item.originalText);
      } catch {
        // Error state is set by saver callback.
      }
    },
    [clearSuggestion, saveController]
  );

  const acceptSuggestion = useCallback(
    (index: number, cursorIndex: number) => {
      const item = itemsRef.current[index];
      if (!item || !suggestion || suggestion.itemId !== item.id) {
        return;
      }

      if (item.currentText !== suggestion.baseText || suggestion.cursorIndex !== cursorIndex) {
        clearSuggestion();
        return;
      }

      const insertion = insertCompletionAtCursor(item.currentText, cursorIndex, suggestion.completion);

      setItems((current) => {
        const next = [...current];
        const existing = next[index];
        if (!existing) {
          return current;
        }

        next[index] = { ...existing, currentText: insertion.nextText };
        return next;
      });

      saveController.scheduleSave(item.txtPath, insertion.nextText);
      clearSuggestion();

      requestAnimationFrame(() => {
        const textarea = textareaRefs.current[index];
        if (!textarea) {
          return;
        }

        textarea.focus();
        textarea.setSelectionRange(insertion.nextCursorIndex, insertion.nextCursorIndex);
      });

      queueSuggestion(index, insertion.nextText, insertion.nextCursorIndex, insertion.nextCursorIndex, insertion.nextCursorIndex);
    },
    [clearSuggestion, queueSuggestion, saveController, suggestion]
  );

  const openSettings = useCallback(() => {
    if (!autocompleteSettings) {
      return;
    }

    setSettingsDraft(autocompleteSettings);
    setSettingsStatus(null);
    setIsSettingsOpen(true);

    void refreshAutocompleteModels();
  }, [autocompleteSettings, refreshAutocompleteModels]);

  const closeSettings = useCallback(() => {
    setSettingsStatus(null);
    setIsSettingsOpen(false);
  }, []);

  const saveSettings = useCallback(async () => {
    if (!settingsDraft) {
      return;
    }

    const updated = await window.datasetApi.autocompleteUpdateSettings(settingsDraft);
    setAutocompleteSettings(updated);
    setSettingsDraft(updated);
    setSettingsStatus('Saved');
    await refreshAutocompleteHealth();
  }, [refreshAutocompleteHealth, settingsDraft]);

  const resetSettings = useCallback(async () => {
    const reset = await window.datasetApi.autocompleteResetSettings();
    setAutocompleteSettings(reset);
    setSettingsDraft(reset);
    setSettingsStatus('Defaults restored');
    await refreshAutocompleteHealth();
  }, [refreshAutocompleteHealth]);

  const testConnection = useCallback(async () => {
    await refreshAutocompleteHealth();
    setSettingsStatus('Connection checked');
  }, [refreshAutocompleteHealth]);

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
  const autocompleteAvailable = Boolean(autocompleteSettings?.enabled && autocompleteHealth?.ok);
  const autocompleteStatus = autocompleteAvailable
    ? `Autocomplete: ${autocompleteSettings?.model}`
    : 'Autocomplete unavailable';
  const autocompleteReason = autocompleteHealth?.reason ?? 'Ollama not reachable';
  const modelOptions = useMemo(() => {
    const options = new Set(autocompleteModels);
    if (settingsDraft?.model) {
      options.add(settingsDraft.model);
    }

    return Array.from(options).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [autocompleteModels, settingsDraft?.model]);

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
          <button
            type="button"
            className={`autocomplete-btn ${autocompleteAvailable ? 'is-on' : 'is-off'}`}
            title={autocompleteAvailable ? autocompleteStatus : autocompleteReason}
            onClick={openSettings}
          >
            {autocompleteStatus}
          </button>
        </div>
      </header>

      {totalItems === 0 ? (
        <section className="empty-state">
          <p>No `.webp` + `.txt` pairs found for this folder and scan mode.</p>
        </section>
      ) : (
        <section className="items-list" aria-label="Dataset items">
          {items.map((item, index) => {
            const itemSuggestion =
              suggestion && suggestion.itemId === item.id && suggestion.baseText === item.currentText
                ? suggestion
                : null;
            const ghostPrefix = itemSuggestion ? item.currentText.slice(0, itemSuggestion.cursorIndex) : '';

            return (
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
                    <div className="editor-input-wrap">
                      {itemSuggestion ? (
                        <div className="editor-ghost" aria-hidden="true">
                          <span className="editor-ghost-prefix">{ghostPrefix}</span>
                          <span className="editor-ghost-completion">{itemSuggestion.completion}</span>
                        </div>
                      ) : null}

                      <textarea
                        ref={(node) => {
                          textareaRefs.current[index] = node;
                        }}
                        value={item.currentText}
                        onChange={(event) =>
                          handleTextChange(
                            index,
                            event.target.value,
                            event.target.selectionStart ?? event.target.value.length,
                            event.target.selectionStart ?? event.target.value.length,
                            event.target.selectionEnd ?? event.target.value.length
                          )
                        }
                        onFocus={(event) => {
                          setCurrentIndex(index);
                          const start = event.currentTarget.selectionStart ?? item.currentText.length;
                          const end = event.currentTarget.selectionEnd ?? item.currentText.length;
                          queueSuggestion(index, item.currentText, start, start, end);
                        }}
                        onSelect={(event) => {
                          const start = event.currentTarget.selectionStart ?? item.currentText.length;
                          const end = event.currentTarget.selectionEnd ?? item.currentText.length;
                          if (start !== end) {
                            clearSuggestion();
                            return;
                          }

                          queueSuggestion(index, item.currentText, start, start, end);
                        }}
                        onBlur={() => {
                          clearSuggestion();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape' && itemSuggestion) {
                            event.preventDefault();
                            clearSuggestion();
                            return;
                          }

                          if (event.key === 'Tab' && itemSuggestion) {
                            event.preventDefault();
                            acceptSuggestion(index, event.currentTarget.selectionStart ?? itemSuggestion.cursorIndex);
                          }
                        }}
                        className="editor-textarea"
                        spellCheck
                      />
                    </div>
                    <div className="editor-actions">
                      <button type="button" className="secondary-btn" onClick={() => void handleRestore(index)}>
                        Restore
                      </button>
                      {saveErrors[item.txtPath] ? (
                        <span className="error-text" role="status">
                          Save failed: {saveErrors[item.txtPath]}
                        </span>
                      ) : itemSuggestion ? (
                        <span className="muted-text">
                          Suggestion ({itemSuggestion.source}, {itemSuggestion.model}, {itemSuggestion.latencyMs}ms)
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
            );
          })}
        </section>
      )}

      {isSettingsOpen && settingsDraft ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Autocomplete settings">
          <div className="modal-card">
            <header className="modal-header">
              <h2>Autocomplete Settings</h2>
            </header>

            <section className="modal-grid">
              <label>
                Enabled
                <input
                  type="checkbox"
                  checked={settingsDraft.enabled}
                  onChange={(event) =>
                    setSettingsDraft((current) => (current ? { ...current, enabled: event.target.checked } : current))
                  }
                />
              </label>

              <label>
                Model
                <select
                  value={settingsDraft.model}
                  onChange={(event) =>
                    setSettingsDraft((current) => (current ? { ...current, model: event.target.value } : current))
                  }
                >
                  {modelOptions.length === 0 ? (
                    <option value={settingsDraft.model}>{settingsDraft.model}</option>
                  ) : (
                    modelOptions.map((modelName) => (
                      <option value={modelName} key={modelName}>
                        {modelName}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label>
                Mode
                <select
                  value={settingsDraft.mode}
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, mode: event.target.value as AutocompleteSettings['mode'] } : current
                    )
                  }
                >
                  <option value="word">Word</option>
                  <option value="phrase">Phrase</option>
                </select>
              </label>

              <label>
                Temperature
                <input
                  type="number"
                  step="0.01"
                  value={settingsDraft.temperature}
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, temperature: Number(event.target.value) || 0 } : current
                    )
                  }
                />
              </label>

              <label>
                Top P
                <input
                  type="number"
                  step="0.01"
                  value={settingsDraft.topP}
                  onChange={(event) =>
                    setSettingsDraft((current) => (current ? { ...current, topP: Number(event.target.value) || 0 } : current))
                  }
                />
              </label>

              <label>
                Top K
                <input
                  type="number"
                  value={settingsDraft.topK}
                  onChange={(event) =>
                    setSettingsDraft((current) => (current ? { ...current, topK: Number(event.target.value) || 0 } : current))
                  }
                />
              </label>

              <label>
                Repeat Penalty
                <input
                  type="number"
                  step="0.01"
                  value={settingsDraft.repeatPenalty}
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, repeatPenalty: Number(event.target.value) || 0 } : current
                    )
                  }
                />
              </label>

              <label>
                Repeat Last N
                <input
                  type="number"
                  value={settingsDraft.repeatLastN}
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, repeatLastN: Number(event.target.value) || 0 } : current
                    )
                  }
                />
              </label>

              <label>
                Presence Penalty
                <input
                  type="number"
                  step="0.01"
                  value={settingsDraft.presencePenalty}
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, presencePenalty: Number(event.target.value) || 0 } : current
                    )
                  }
                />
              </label>

              <label>
                Frequency Penalty
                <input
                  type="number"
                  step="0.01"
                  value={settingsDraft.frequencyPenalty}
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, frequencyPenalty: Number(event.target.value) || 0 } : current
                    )
                  }
                />
              </label>

              <label>
                Num Predict
                <input
                  type="number"
                  value={settingsDraft.numPredict}
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, numPredict: Number(event.target.value) || 0 } : current
                    )
                  }
                />
              </label>

              <label>
                Num Ctx
                <input
                  type="number"
                  value={settingsDraft.numCtx}
                  onChange={(event) =>
                    setSettingsDraft((current) => (current ? { ...current, numCtx: Number(event.target.value) || 0 } : current))
                  }
                />
              </label>

              <label>
                Debounce (ms)
                <input
                  type="number"
                  value={settingsDraft.debounceMs}
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, debounceMs: Number(event.target.value) || 0 } : current
                    )
                  }
                />
              </label>

              <label>
                First Token Timeout (ms)
                <input
                  type="number"
                  value={settingsDraft.firstTokenTimeoutMs}
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, firstTokenTimeoutMs: Number(event.target.value) || 0 } : current
                    )
                  }
                />
              </label>

              <label>
                Keep Alive
                <input
                  value={settingsDraft.keepAlive}
                  onChange={(event) =>
                    setSettingsDraft((current) => (current ? { ...current, keepAlive: event.target.value } : current))
                  }
                />
              </label>

              <label className="modal-checkbox">
                <input
                  type="checkbox"
                  checked={settingsDraft.useSuffixContext}
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, useSuffixContext: event.target.checked } : current
                    )
                  }
                />
                Use suffix context
              </label>

              <label className="modal-textarea-label">
                Prompt Template
                <textarea
                  value={settingsDraft.promptTemplate}
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, promptTemplate: event.target.value } : current
                    )
                  }
                />
              </label>
            </section>

            <section className="modal-diagnostics">
              <div>Health: {autocompleteHealth?.ok ? 'OK' : 'Unavailable'}</div>
              <div>Reason: {autocompleteHealth?.reason ?? 'n/a'}</div>
              <div>GPU likely: {autocompleteHealth?.gpuLikely ? 'yes' : 'unknown/no'}</div>
              <div>Requests: {autocompleteHealth?.requestCount ?? 0}</div>
              <div>Timeouts: {autocompleteHealth?.timeoutCount ?? 0}</div>
              <div>Median latency: {autocompleteHealth?.medianLatencyMs ?? 0} ms</div>
              <div>Last latency: {autocompleteHealth?.lastLatencyMs ?? 0} ms</div>
              {settingsStatus ? <div className="muted-text">{settingsStatus}</div> : null}
            </section>

            <footer className="modal-actions">
              <button type="button" className="secondary-btn" onClick={() => void testConnection()}>
                Test Connection
              </button>
              <button type="button" className="secondary-btn" onClick={() => void resetSettings()}>
                Reset Defaults
              </button>
              <button type="button" className="secondary-btn" onClick={closeSettings}>
                Close
              </button>
              <button type="button" className="primary-btn" onClick={() => void saveSettings()}>
                Save
              </button>
            </footer>
          </div>
        </div>
      ) : null}

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
