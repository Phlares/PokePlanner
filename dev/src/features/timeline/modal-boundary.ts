import { useLayoutEffect, type RefObject } from 'react';

interface ElementLock {
  count: number;
  inert: string | null;
  ariaHidden: string | null;
}

const elementLocks = new Map<HTMLElement, ElementLock>();

function lockElement(element: HTMLElement): void {
  const current = elementLocks.get(element);
  if (current) {
    current.count += 1;
    return;
  }
  elementLocks.set(element, {
    count: 1,
    inert: element.getAttribute('inert'),
    ariaHidden: element.getAttribute('aria-hidden'),
  });
  element.setAttribute('inert', '');
  element.setAttribute('aria-hidden', 'true');
}

function unlockElement(element: HTMLElement): void {
  const current = elementLocks.get(element);
  if (!current) return;
  current.count -= 1;
  if (current.count > 0) return;
  elementLocks.delete(element);
  if (current.inert === null) element.removeAttribute('inert');
  else element.setAttribute('inert', current.inert);
  if (current.ariaHidden === null) element.removeAttribute('aria-hidden');
  else element.setAttribute('aria-hidden', current.ariaHidden);
}

function siblingBranches(boundary: HTMLElement): HTMLElement[] {
  const branches = new Set<HTMLElement>();
  let branch = boundary;
  while (branch.parentElement && branch !== document.body) {
    const parent = branch.parentElement;
    Array.from(parent.children).forEach((candidate) => {
      if (candidate !== branch && candidate instanceof HTMLElement) branches.add(candidate);
    });
    branch = parent;
  }
  return [...branches];
}

/** Makes every branch outside a modal's ancestor path inert, preserving nested and pre-existing locks. */
export function useModalBoundary(boundaryRef: RefObject<HTMLElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    if (!active || boundaryRef.current === null) return undefined;
    const branches = siblingBranches(boundaryRef.current);
    branches.forEach(lockElement);
    return () => branches.forEach(unlockElement);
  }, [active, boundaryRef]);
}
