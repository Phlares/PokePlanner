import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Playthrough } from '../../domain/playthrough';
import { createPlaythroughDownloadHref } from '../../persistence/export-import';
import type { RunImportPreview } from '../../persistence/import-source';
import { encodePlanCode } from '../../persistence/plan-code';
import type { Theme } from '../../theme';

/** What the header says about the durable record behind the run currently on screen. */
export type RunSaveStatus = 'none' | 'saved' | 'unsaved' | 'temporary' | 'failed';

const SAVE_LABEL: Record<RunSaveStatus, string> = {
  none: 'No run yet',
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  temporary: 'Temporary session',
  failed: 'Save failed',
};

export interface RunMenuProps {
  /** The run being worked on, or `null` before one exists — import and theme still apply then. */
  playthrough: Playthrough | null;
  saveStatus: RunSaveStatus;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  /**
   * Turn one piece of user text into a validated preview, without writing. Injected so the pack
   * index stays at the application boundary and this menu never learns canonical data.
   */
  prepareImport: (input: string) => RunImportPreview;
  onImport: (playthrough: Playthrough) => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

type RunDialogKind = 'import' | 'rename' | 'delete';

interface RunDialogProps {
  label: string;
  role?: 'dialog' | 'alertdialog';
  /** Changing this re-runs the initial focus move, so a stage change never strands focus. */
  focusKey?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * One dialog shape for every run-data confirmation: named by its question, focus moved inside on
 * open and on each stage change, and dismissible from the keyboard. Focus is restored by the
 * caller, which owns the trigger.
 */
function RunDialog({ label, role = 'dialog', focusKey = '', onClose, children }: RunDialogProps) {
  const boundary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boundary.current?.querySelector<HTMLElement>('input, textarea, select, button, [href]')?.focus();
  }, [focusKey]);

  return (
    <div
      ref={boundary}
      role={role}
      aria-label={label}
      className="run-dialog"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <h2 className="run-dialog-title">{label}</h2>
      {children}
    </div>
  );
}

/** Write to the clipboard when there is one; a refusal is reported, never thrown. */
function copyToClipboard(text: string, onRefused: () => void): boolean {
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (clipboard === undefined) return false;
  void clipboard.writeText(text).catch(onRefused);
  return true;
}

/**
 * The header's compact run-data menu (spec §19). Every action that is about the run *record* rather
 * than the plan lives here — save status, JSON download, plan code, import, duplicate, rename,
 * delete and theme — so none of them takes space from the team or the results.
 *
 * All three import sources converge on one path: a file's text, a pasted plan code and a pasted
 * share link are each handed to the injected `prepareImport`, which validates without writing, and
 * the same dialog then previews the result and asks for confirmation. Nothing is replaced until
 * that confirmation, so a mistyped code or a cancelled preview leaves the open run untouched.
 */
export function RunMenu({
  playthrough,
  saveStatus,
  theme,
  onThemeChange,
  prepareImport,
  onImport,
  onRename,
  onDuplicate,
  onDelete,
}: RunMenuProps) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<RunDialogKind | null>(null);
  const [importText, setImportText] = useState('');
  const [preview, setPreview] = useState<RunImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [planCodeCopied, setPlanCodeCopied] = useState(false);
  const [planCodeError, setPlanCodeError] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);

  // Serializing a whole run is not free, so the download target is built only while it is offered.
  const download = useMemo(
    () => (playthrough === null || !open ? null : createPlaythroughDownloadHref(playthrough)),
    [open, playthrough],
  );

  const openDialog = (kind: RunDialogKind): void => {
    setOpen(false);
    setPreview(null);
    setImportError(null);
    setImportText('');
    setRenameText(playthrough?.name ?? '');
    setDialog(kind);
  };

  const closeDialog = (): void => {
    setDialog(null);
    setPreview(null);
    setImportError(null);
    setImportText('');
    queueMicrotask(() => trigger.current?.focus());
  };

  const previewImport = (input: string): void => {
    try {
      setPreview(prepareImport(input));
      setImportError(null);
    } catch (error) {
      setPreview(null);
      setImportError(error instanceof Error ? error.message : 'Import failed validation.');
    }
  };

  const previewFile = async (file: File): Promise<void> => {
    try {
      previewImport(await file.text());
    } catch (error) {
      setPreview(null);
      setImportError(error instanceof Error ? error.message : 'The chosen file could not be read.');
    }
  };

  const confirmImport = (): void => {
    if (preview === null) return;
    const imported = preview.playthrough;
    closeDialog();
    onImport(imported);
  };

  const copyPlanCode = (): void => {
    if (playthrough === null) return;
    let code: string;
    try {
      code = encodePlanCode(playthrough);
    } catch (error) {
      setPlanCode(null);
      setPlanCodeCopied(false);
      const reason = error instanceof Error ? error.message : 'Plan code could not be exported.';
      setPlanCodeError(`Plan code export failed: ${reason} Shorten notes, or use Download JSON to save the complete run.`);
      return;
    }
    setPlanCodeError(null);
    setPlanCode(code);
    setPlanCodeCopied(copyToClipboard(code, () => setPlanCodeCopied(false)));
  };

  return (
    <div className="run-menu">
      <p className="run-menu-status" data-status={saveStatus}>{SAVE_LABEL[saveStatus]}</p>

      <button
        ref={trigger}
        type="button"
        className="run-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Run menu
      </button>

      {/* One drop container holds the menu and, beside it rather than inside it, the plan-code
          result and any export error — so `role="menu"` never has to carry non-menuitem content. */}
      {(open || planCode !== null || planCodeError !== null) && (
        <div className="run-menu-drop">
          {open && (
            <div
              className="run-menu-panel"
              role="menu"
              aria-label="Run data"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false);
                  trigger.current?.focus();
                }
              }}
            >
              {download !== null && (
                <a role="menuitem" className="run-menu-item" href={download.href} download={download.filename}>
                  Download JSON
                </a>
              )}
              {playthrough !== null && (
                <button role="menuitem" type="button" className="run-menu-item" onClick={copyPlanCode}>
                  Copy plan code
                </button>
              )}
              <button role="menuitem" type="button" className="run-menu-item" onClick={() => openDialog('import')}>
                Import JSON file or plan code
              </button>
              {playthrough !== null && (
                <>
                  <button
                    role="menuitem"
                    type="button"
                    className="run-menu-item"
                    onClick={() => {
                      setOpen(false);
                      onDuplicate();
                    }}
                  >
                    Duplicate run
                  </button>
                  <button role="menuitem" type="button" className="run-menu-item" onClick={() => openDialog('rename')}>
                    Rename run
                  </button>
                  <button role="menuitem" type="button" className="run-menu-item" onClick={() => openDialog('delete')}>
                    Delete run
                  </button>
                </>
              )}
              <button
                role="menuitemcheckbox"
                type="button"
                className="run-menu-item"
                aria-checked={theme === 'dark'}
                onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
              >
                Dark theme
              </button>
            </div>
          )}

          {planCodeError !== null && (
            <p role="alert" className="run-menu-error">{planCodeError}</p>
          )}

          {planCode !== null && (
            <div className="run-menu-code">
              <p className="run-menu-note">
                {planCodeCopied ? 'Plan code copied to the clipboard.' : 'Copy this plan code by hand.'}
              </p>
              <input className="run-menu-code-field" aria-label="Plan code" readOnly value={planCode} />
            </div>
          )}
        </div>
      )}

      {dialog === 'import' && (
        <RunDialog label="Import FireRed Run?" focusKey={preview === null ? 'choose' : 'preview'} onClose={closeDialog}>
          {preview === null ? (
            <>
              <p className="run-dialog-body">
                Choose an exported JSON file, or paste a plan code or a share link that carries one. Nothing is
                replaced until you confirm.
              </p>
              <div className="run-dialog-field">
                <label htmlFor={`${fieldId}-file`}>JSON file</label>
                <input
                  id={`${fieldId}-file`}
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file !== undefined) void previewFile(file);
                  }}
                />
              </div>
              <div className="run-dialog-field">
                <label htmlFor={`${fieldId}-text`}>Plan code or share link</label>
                <textarea
                  id={`${fieldId}-text`}
                  className="run-dialog-textarea"
                  rows={3}
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                />
              </div>
              <div className="run-dialog-actions">
                <button type="button" className="run-dialog-action" onClick={closeDialog}>Cancel import</button>
                <button type="button" className="run-dialog-action" onClick={() => previewImport(importText)}>
                  Preview import
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="run-dialog-name">{preview.name}</p>
              <p className="run-dialog-body">
                {preview.game} · {preview.memberCount} Pokémon · {preview.milestoneCount} milestones
              </p>
              {playthrough !== null && (
                <p className="run-dialog-body">This replaces the run that is currently open.</p>
              )}
              {preview.warnings.length > 0 && (
                <ul className="run-dialog-warnings">
                  {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              )}
              <div className="run-dialog-actions">
                <button type="button" className="run-dialog-action" onClick={closeDialog}>Cancel import</button>
                <button type="button" className="run-dialog-action" onClick={confirmImport}>Import run</button>
              </div>
            </>
          )}
          {importError !== null && (
            <p role="alert" className="run-dialog-error">Import failed: {importError}</p>
          )}
        </RunDialog>
      )}

      {dialog === 'rename' && (
        <RunDialog label="Rename run" onClose={closeDialog}>
          <div className="run-dialog-field">
            <label htmlFor={`${fieldId}-name`}>Run name</label>
            <input
              id={`${fieldId}-name`}
              value={renameText}
              onChange={(event) => setRenameText(event.target.value)}
            />
          </div>
          <div className="run-dialog-actions">
            <button type="button" className="run-dialog-action" onClick={closeDialog}>Cancel rename</button>
            <button
              type="button"
              className="run-dialog-action"
              disabled={renameText.trim() === ''}
              onClick={() => {
                const name = renameText.trim();
                closeDialog();
                onRename(name);
              }}
            >
              Save name
            </button>
          </div>
        </RunDialog>
      )}

      {dialog === 'delete' && (
        <RunDialog label="Delete this run?" role="alertdialog" onClose={closeDialog}>
          <p className="run-dialog-body">
            {playthrough?.name} is removed from this browser. Download JSON or copy a plan code first if you want
            to keep it.
          </p>
          <div className="run-dialog-actions">
            <button type="button" className="run-dialog-action" onClick={closeDialog}>Cancel delete</button>
            <button
              type="button"
              className="run-dialog-action"
              onClick={() => {
                closeDialog();
                onDelete();
              }}
            >
              Delete permanently
            </button>
          </div>
        </RunDialog>
      )}
    </div>
  );
}
