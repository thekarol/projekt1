import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

const PATHS: Record<string, string> = {
  cart: 'M3 4h2l2.4 11h10.2L20 7H6.2M9 19.5a1 1 0 1 0 0-.01M17 19.5a1 1 0 1 0 0-.01',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  warn: 'M12 4l9 16H3zM12 10v4.5M12 17.5v.01',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  half: 'M12 4a8 8 0 1 0 0 16zM12 4a8 8 0 0 1 0 16',
  menu: 'M4 7h16M4 12h16M4 17h16',
  arrow: 'M5 12h14M13 6l6 6-6 6',
};

export function Icon(props: { name: keyof typeof PATHS | string; size?: number }) {
  const size = props.size ?? 18;
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto' }}>
      <path d={PATHS[props.name] ?? ''} />
    </svg>
  );
}

/** Marks an element that looks final but does nothing in the demo. */
export function Sketch(props: { children?: ReactNode }) {
  return (
    <>
      <span className="ra-sketch">Szkic</span>
      {props.children ? <span className="ra-small ra-muted"> {props.children}</span> : null}
    </>
  );
}

export function Stepper(props: {
  value: number;
  min?: number;
  max?: number;
  label: string;
  onChange: (value: number) => void;
  /** Called when the customer asks for more than is available. */
  onOverflow?: () => void;
}) {
  const min = props.min ?? 0;
  const max = props.max ?? Infinity;
  return (
    <div className="ra-stepper" role="group" aria-label={props.label}>
      <button type="button" aria-label="Mniej" disabled={props.value <= min} onClick={() => props.onChange(Math.max(min, props.value - 1))}>
        <Icon name="minus" />
      </button>
      <output aria-live="polite">{props.value}</output>
      <button
        type="button"
        aria-label="Więcej"
        onClick={() => (props.value >= max ? props.onOverflow?.() : props.onChange(props.value + 1))}
      >
        <Icon name="plus" />
      </button>
    </div>
  );
}

export function Segment<T extends string>(props: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div className="ra-segment" role="group" aria-label={props.label}>
      {props.options.map((option) => (
        <button key={option.value} type="button" aria-pressed={props.value === option.value} onClick={() => props.onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Native dialog: focus is trapped by the browser and Escape closes it. */
export function Dialog(props: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (props.open && !element.open) element.showModal();
    if (!props.open && element.open) element.close();
  }, [props.open]);
  if (!props.open) return null;
  return (
    <dialog
      ref={ref}
      className="ra-dialog"
      style={props.width ? { width: `min(${props.width}px, calc(100vw - 24px))` } : undefined}
      aria-label={props.title}
      onClose={props.onClose}
      onClick={(event) => {
        if (event.target === ref.current) props.onClose();
      }}
    >
      <div className="ra-dialog-body">
        <div className="ra-row ra-between">
          <h2>{props.title}</h2>
          <button type="button" className="ra-btn ra-btn-small" aria-label="Zamknij" onClick={props.onClose}>
            <Icon name="x" />
          </button>
        </div>
        {props.children}
      </div>
    </dialog>
  );
}

export function Notice(props: { kind: 'warn' | 'error' | 'note'; children: ReactNode }) {
  const className = props.kind === 'warn' ? 'ra-warn' : props.kind === 'error' ? 'ra-error' : 'ra-note';
  return (
    <div className={className} role={props.kind === 'error' ? 'alert' : undefined}>
      {props.kind !== 'note' ? <Icon name="warn" /> : null}
      <div>{props.children}</div>
    </div>
  );
}
