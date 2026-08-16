import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Playthrough } from '../../domain/playthrough';
import { createPlaythroughDownloadHref } from '../../persistence/export-import';
import type { RunImportPreview } from '../../persistence/import-source';
import { encodePlanCode } from '../../persistence/plan-code';
import { useModalBoundary } from '../timeline/modal-boundary';
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

/** Enough of a stored run to name it in the switcher without loading the whole record. */
export interface RunSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export interface RunMenuProps {
  /** The run being worked on, or `null` before one exists — import and theme still apply then. */
  playthrough: Playthrough | null;
  /** Every stored run, in the order the switcher should list them. */
  runs: readonly RunSummary[];
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
  onSwitchRun: (id: string) => void;
  /**
   * Lets the application own focus across a view change. Deleting the last run swaps the whole
   * shell, which unmounts this menu; the caller holds the ref so it can focus the replacement.
   */
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

type RunDialogKind = 'import' | 'rename' | 'delete';

interface RunDialogProps {
  label: string;
  role?: 'dialog' | 'alertdialog';
  /** Changing this re-runs the initial focus move, so a stage change never strands focus. */
  focusKey?: string;
  /**
   * Seal everything outside the dialog. Set for a confirmation that is about to change or destroy
   * the run: without it Tab walks straight back into the workbench, where a milestone control can
   * mutate the very record the confirmation is asking about.
   */
  modal?: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * One dialog shape for every run-data confirmation: named by its question, focus moved inside on
 * open and on each stage change, dismissible from the keyboard, and — when it guards a decision —
 * sealed off from the rest of the application. Focus is restored by the caller, which owns the
 * trigger.
 */
function RunDialog({ label, role = 'dialog', focusKey = '', modal = false, onClose, children }: RunDialogProps) {
  const boundary = useRef<HTMLDivElement>(null);
  useModalBoundary(boundary, modal);

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

/**
 * A plan code is a snapshot of one exact record. Keeping the record beside it is what makes a stale
 * code impossible: the moment an edit hands down a new record, this no longer matches and is not
 * shown, so nobody can copy a plan that describes the run as it was.
 */
type PlanCodeSnapshot =
  | { run: Playthrough; kind: 'code'; code: string; copied: boolean }
  | { run: Playthrough; kind: 'error'; message: string };

/** Where an arrow key, Home or End should land relative to the entry that currently has focus. */
type MenuMove = 'first' | 'last' | 'next' | 'previous';

const MENU_MOVES: Readonly<Record<string, MenuMove>> = {
  ArrowDown: 'next',
  ArrowUp: 'previous',
  Home: 'first',
  End: 'last',
};

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
  runs,
  saveStatus,
  theme,
  onThemeChange,
  prepareImport,
  onImport,
  onRename,
  onDuplicate,
  onDelete,
  onSwitchRun,
  triggerRef,
}: RunMenuProps) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<RunDialogKind | null>(null);
  const [importText, setImportText] = useState('');
  const [preview, setPreview] = useState<RunImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [planCode, setPlanCode] = useState<PlanCodeSnapshot | null>(null);
  const [renameText, setRenameText] = useState('');
  const ownTrigger = useRef<HTMLButtonElement>(null);
  const trigger = triggerRef ?? ownTrigger;
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Serializing a whole run is not free, so the download target is built only while it is offered.
  const download = useMemo(
    () => (playthrough === null || !open ? null : createPlaythroughDownloadHref(playthrough)),
    [open, playthrough],
  );

  // A snapshot taken from a record that has since been replaced describes a run that no longer
  // exists. It is never rendered, which is what keeps the panel from showing a pre-edit plan.
  const planCodeForRun = planCode !== null && planCode.run === playthrough ? planCode : null;

  const menuEntries = (): HTMLElement[] =>
    [...(panel.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];

  /**
   * Roving tabindex: the menu is one tab stop, and the arrow keys move which entry that is. Reading
   * the entries from the DOM keeps this correct as the menu's contents change with the run.
   */
  const focusEntry = (move: MenuMove): void => {
    const entries = menuEntries();
    if (entries.length === 0) return;
    const current = entries.indexOf(document.activeElement as HTMLElement);
    const index = move === 'first' ? 0
      : move === 'last' ? entries.length - 1
        : move === 'next' ? (current < 0 || current === entries.length - 1 ? 0 : current + 1)
          : (current <= 0 ? entries.length - 1 : current - 1);
    entries.forEach((entry, position) => {
      entry.tabIndex = position === index ? 0 : -1;
    });
    entries[index].focus();
  };

  useEffect(() => {
    if (!open) return;
    focusEntry('first');
  }, [open]);

  // A press anywhere else dismisses the menu. `mousedown` rather than `click`, so the menu is gone
  // before the press lands on whatever was underneath it.
  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [open]);

  const closeMenu = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };

  // Escape is handled at the root, not on the panel: the trigger is not a panel descendant, so a
  // handler down there never sees the key when focus is still on the button that opened the menu.
  const dismissOnEscape = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!open || event.key !== 'Escape') return;
    event.stopPropagation();
    closeMenu();
  };

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
    const run = playthrough;
    let code: string;
    try {
      code = encodePlanCode(run);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Plan code could not be exported.';
      setPlanCode({
        run,
        kind: 'error',
        message: `Plan code export failed: ${reason} Shorten notes, or use Download JSON to save the complete run.`,
      });
      return;
    }
    const copied = copyToClipboard(code, () => setPlanCode((current) => (
      current !== null && current.kind === 'code' && current.run === run ? { ...current, copied: false } : current
    )));
    setPlanCode({ run, kind: 'code', code, copied });
  };

  return (
    <div className="run-menu" ref={root} onKeyDown={dismissOnEscape}>
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

      {/* The drop cannot outlive the menu: everything transient it carries — the plan code, an
          export error — is inside it, so closing the menu takes the whole overlay off screen. The
          plan-code result sits beside `role="menu"` rather than inside it, because a menu may only
          contain menu items. */}
      {open && (
        <div className="run-menu-drop">
          <div
            className="run-menu-panel"
            role="menu"
            aria-label="Run data"
            ref={panel}
            onKeyDown={(event) => {
              const move = MENU_MOVES[event.key];
              if (move === undefined) return;
              event.preventDefault();
              focusEntry(move);
            }}
          >
            {runs.length > 1 && (
              <div className="run-menu-group" role="group" aria-label="Switch run">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    role="menuitemradio"
                    type="button"
                    className="run-menu-item"
                    aria-checked={run.id === playthrough?.id}
                    onClick={() => {
                      setOpen(false);
                      onSwitchRun(run.id);
                    }}
                  >
                    {run.name}
                  </button>
                ))}
              </div>
            )}
            {download !== null && (
              <a
                role="menuitem"
                className="run-menu-item"
                href={download.href}
                download={download.filename}
                onClick={() => setOpen(false)}
              >
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

          {planCodeForRun?.kind === 'error' && (
            <p role="alert" className="run-menu-error">{planCodeForRun.message}</p>
          )}

          {planCodeForRun?.kind === 'code' && (
            <div className="run-menu-code">
              <p className="run-menu-note">
                {planCodeForRun.copied ? 'Plan code copied to the clipboard.' : 'Copy this plan code by hand.'}
              </p>
              <input className="run-menu-code-field" aria-label="Plan code" readOnly value={planCodeForRun.code} />
            </div>
          )}
        </div>
      )}

      {dialog === 'import' && (
        <RunDialog
          label="Import FireRed Run?"
          focusKey={preview === null ? 'choose' : 'preview'}
          modal={preview !== null}
          onClose={closeDialog}
        >
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
        <RunDialog label="Delete this run?" role="alertdialog" modal onClose={closeDialog}>
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
